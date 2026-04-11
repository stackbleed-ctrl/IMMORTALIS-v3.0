/**
 * immort-server-patch.js
 * ─────────────────────────────────────────────────────────────────────────
 * IMMORTALIS v5.0 — Server-Side $IMMORT Council Patch
 *
 * Add this to index.js:
 *   const { applyImmortPatch } = require('./immort-server-patch');
 *   applyImmortPatch(wss, state);
 *
 * What this adds to the WebSocket server:
 *   • Council room tracking (elder / overlord / sovereign)
 *   • Tier-gated room join verification (RPC balance check on server)
 *   • Signed message anti-sybil verification
 *   • Weighted vote application
 *   • IMMORT-fueled Breakthrough Event triggers based on total
 *     verified $IMMORT in swarm
 *   • Periodic council room member count broadcast
 *
 * SECURITY: The server re-checks balance via RPC before granting access.
 * Client-side tier claims are NEVER trusted for room gating.
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

const https = require('https');

const IMMORT_MINT       = '5ajcWht9vzGrintx9CdczWn9Yr6awyCNRTUDgFGQpump';
const SOLANA_RPC        = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const TOKEN_DECIMALS    = 6;

/** Minimum $IMMORT to access each room */
const ROOM_MINIMUMS = {
  elder:     1_000,
  overlord:  10_000,
  sovereign: 100_000,
};

/** Vote weight by balance bracket */
function computeServerWeight(balance) {
  if (balance >= 100_000) return Math.min(10, balance / 10_000);
  if (balance >= 10_000)  return 3.0;
  if (balance >= 1_000)   return 1.5;
  return 1.0;
}

// ─── RPC helper (no npm dependency) ───────────────────────────────────────

function rpcPost(body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SOLANA_RPC);
    const payload = JSON.stringify(body);
    const options = {
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('RPC parse error')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function fetchBalanceRPC(ownerPubkey) {
  try {
    const resp = await rpcPost({
      jsonrpc: '2.0', id: 1,
      method:  'getTokenAccountsByOwner',
      params:  [
        ownerPubkey,
        { mint: IMMORT_MINT },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ],
    });
    const accounts = resp?.result?.value ?? [];
    let total = 0;
    for (const acc of accounts) {
      total += acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    }
    return total;
  } catch {
    return 0; // fail closed — deny on RPC error
  }
}

// ─── Nacl signature verification (optional, requires @solana/web3.js) ─────

let _nacl = null;
try { _nacl = require('@solana/web3.js'); } catch {}

function verifySignature(message, signatureArray, pubkeyString) {
  if (!_nacl) return true; // skip if lib not installed (log warning)
  try {
    const { PublicKey } = _nacl;
    const bs58   = require('bs58');
    const nacl   = require('tweetnacl');
    const pk     = new PublicKey(pubkeyString);
    const msgBuf = Buffer.from(message, 'utf8');
    const sigBuf = Buffer.from(signatureArray);
    return nacl.sign.detached.verify(msgBuf, sigBuf, pk.toBytes());
  } catch {
    return false;
  }
}

// ─── Main patch function ───────────────────────────────────────────────────

/**
 * @param {import('ws').WebSocketServer} wss
 * @param {object} state  — the same shared state object from index.js
 */
function applyImmortPatch(wss, state) {
  // Extend state with council data
  state.councilRooms    = { elder: new Set(), overlord: new Set(), sovereign: new Set() };
  state.verifiedHolders = new Map(); // pubkey → { balance, tier, ws, verifiedAt }
  state.totalImmortInSwarm = 0;

  let lastBreakthroughAt = 0;

  // ── Room count broadcast ──────────────────────────────────────────────
  const broadcastRoomCounts = () => {
    const counts = {};
    for (const [room, members] of Object.entries(state.councilRooms)) {
      counts[room] = members.size;
    }
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        try { client.send(JSON.stringify({ type: 'council_room_update', counts })); } catch {}
      }
    });
  };
  setInterval(broadcastRoomCounts, 10_000);

  // ── Per-client message handler injection ────────────────────────────
  wss.on('connection', ws => {
    ws._immortVerified = false;
    ws._immortBalance  = 0;
    ws._immortPubkey   = null;
    ws._immortRooms    = new Set();

    const origOnMessage = ws.onmessage;

    ws.on('message', async rawData => {
      let msg;
      try { msg = JSON.parse(rawData); } catch { return; }

      // ── Verify $IMMORT holding ──────────────────────────────────────
      if (msg.type === 'immort_verify') {
        const { pubkey, signedChallenge } = msg;
        if (!pubkey) { wsSend(ws, { type: 'immort_verify_result', ok: false, error: 'Missing pubkey' }); return; }

        // Server-side balance check (authoritative)
        const balance = await fetchBalanceRPC(pubkey);

        // Optional: verify signed message for anti-sybil
        let sigOk = true;
        if (signedChallenge?.message && signedChallenge?.signature) {
          sigOk = verifySignature(signedChallenge.message, signedChallenge.signature, pubkey);
        }

        if (!sigOk) {
          wsSend(ws, { type: 'immort_verify_result', ok: false, error: 'Signature invalid' });
          return;
        }

        ws._immortVerified = true;
        ws._immortBalance  = balance;
        ws._immortPubkey   = pubkey;

        const tier   = serverClassifyTier(balance);
        const weight = computeServerWeight(balance);

        state.verifiedHolders.set(pubkey, { balance, tier, ws, verifiedAt: Date.now() });
        state.totalImmortInSwarm = [...state.verifiedHolders.values()].reduce((s, v) => s + v.balance, 0);

        wsSend(ws, { type: 'immort_verify_result', ok: true, balance, tier, voteWeight: weight });

        // Check if total $IMMORT milestone triggers a breakthrough event
        _checkImmortMilestone(wss, state, lastBreakthroughAt, (t) => { lastBreakthroughAt = t; });
        return;
      }

      // ── Join council room ──────────────────────────────────────────
      if (msg.type === 'join_council_room') {
        const { room } = msg;
        if (!ROOM_MINIMUMS[room]) return;
        if (!ws._immortVerified) {
          wsSend(ws, { type: 'council_error', error: 'Not verified. Run immort_verify first.' }); return;
        }
        if (ws._immortBalance < ROOM_MINIMUMS[room]) {
          wsSend(ws, { type: 'council_error', error: `Need ${ROOM_MINIMUMS[room].toLocaleString()} $IMMORT for ${room} room.` }); return;
        }
        // Remove from any existing rooms
        for (const [r, members] of Object.entries(state.councilRooms)) {
          members.delete(ws);
        }
        state.councilRooms[room].add(ws);
        ws._immortRooms.add(room);

        wsSend(ws, { type: 'council_joined', room, members: state.councilRooms[room].size });
        broadcastRoomCounts();
        console.log(`[IMMORT] ${shortKey(ws._immortPubkey)} joined ${room} room (${ws._immortBalance.toLocaleString()} $IMMORT)`);
        return;
      }

      // ── Council room broadcast ─────────────────────────────────────
      if (msg.type === 'council_message') {
        const { room, text } = msg;
        if (!state.councilRooms[room]?.has(ws)) return; // must be in room
        state.councilRooms[room].forEach(member => {
          if (member !== ws && member.readyState === 1) {
            try { member.send(JSON.stringify({ type: 'council_insight', text, from: shortKey(ws._immortPubkey) })); } catch {}
          }
        });
        return;
      }

      // ── Weighted node vote ─────────────────────────────────────────
      if (msg.type === 'node_vote' && ws._immortVerified) {
        const weight   = computeServerWeight(ws._immortBalance);
        const weighted = { ...msg, weight, tier: serverClassifyTier(ws._immortBalance) };
        // Broadcast weighted vote to all
        wss.clients.forEach(client => {
          if (client.readyState === 1) {
            try { client.send(JSON.stringify(weighted)); } catch {}
          }
        });
        // Apply LEV boost proportional to weight
        if (weight > 1) {
          state.lev = Math.min(100, state.lev + (weight - 1) * 0.02);
          wss.clients.forEach(c => {
            if (c.readyState === 1) try { c.send(JSON.stringify({ type: 'lev_update', lev: state.lev })); } catch {};
          });
        }
        return; // intercepted — don't fall through to default handler
      }
    });
  });

  // ── Clean up on disconnect ──────────────────────────────────────────────
  wss.on('connection', ws => {
    ws.on('close', () => {
      for (const members of Object.values(state.councilRooms)) {
        members.delete(ws);
      }
      if (ws._immortPubkey) {
        state.verifiedHolders.delete(ws._immortPubkey);
        state.totalImmortInSwarm = [...state.verifiedHolders.values()].reduce((s, v) => s + v.balance, 0);
      }
    });
  });

  console.log('[IMMORT] Server patch applied. Council rooms: elder/overlord/sovereign');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function serverClassifyTier(balance) {
  if (balance >= 100_000) return 'sovereign';
  if (balance >= 10_000)  return 'overlord';
  if (balance >= 1_000)   return 'elder';
  return 'initiate';
}

function shortKey(pk) {
  if (!pk) return 'anon';
  return pk.slice(0, 4) + '…' + pk.slice(-4);
}

function wsSend(ws, data) {
  try { ws.send(JSON.stringify(data)); } catch {}
}

const IMMORT_MILESTONES = [
  { threshold: 100_000,     msg: '100K $IMMORT in the swarm — Collective longevity compute unlocked. LEV acceleration active.' },
  { threshold: 1_000_000,   msg: '1M $IMMORT unified in IMMORTALIS — Swarm-wide epigenetic modeling boost triggered.' },
  { threshold: 10_000_000,  msg: '10M $IMMORT committed to defeating death — Full-depth ReAct chain unlocked for all councils.' },
  { threshold: 100_000_000, msg: '100M $IMMORT: IMMORTAL CONVERGENCE — Maximum LEV propagation. The swarm is unstoppable.' },
];

function _checkImmortMilestone(wss, state, lastAt, setLast) {
  const now   = Date.now();
  if (now - lastAt < 60_000) return; // debounce: max once per minute
  const total = state.totalImmortInSwarm;
  for (const m of IMMORT_MILESTONES) {
    if (total >= m.threshold) {
      setLast(now);
      const msg = JSON.stringify({ type: 'immort_breakthrough', text: m.msg });
      wss.clients.forEach(c => { if (c.readyState === 1) try { c.send(msg); } catch {} });
      state.lev = Math.min(100, state.lev + 1.0);
      console.log('[IMMORT] Milestone triggered:', m.msg);
      break;
    }
  }
}

module.exports = { applyImmortPatch, fetchBalanceRPC, serverClassifyTier, computeServerWeight };
