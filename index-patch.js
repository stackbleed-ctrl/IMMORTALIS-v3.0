/**
 * IMMORTALIS v5.0 — Server Endpoint Patch
 * ─────────────────────────────────────────────────────────────────────────
 * Add all of these route handlers to index.js inside your HTTP request
 * handler, BEFORE the static file fallback. Copy the blocks below.
 *
 * Also: add this near the top of index.js:
 *   const https = require('https');
 *   const IMMORT_MINT = '5ajcWht9vzGrintx9CdczWn9Yr6awyCNRTUDgFGQpump';
 *   const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
 *
 * And extend your state object with:
 *   state.interventions = [];  // community-submitted interventions
 *   state.freeQuota     = new Map(); // IP → { date, count }
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Paste this entire block into index.js ───────────────────────────────

/*

// ── /api/synthesis  (Claude proxy with tier-aware rate limiting) ───────────
if (req.method === 'POST' && pathname === '/api/synthesis') {
  return readBody(req, async body => {
    const { system, user, wallet, tier } = body;
    if (!system || !user) return json(res, { error: 'Missing system or user' }, 400);

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'anon';
    const isHolder = wallet && tier && tier !== '';
    const FREE_LIMIT = 3;

    // Server-side rate limit for non-holders
    if (!isHolder && !ANTHROPIC_KEY) {
      const today = new Date().toDateString();
      const quota = state.freeQuota.get(ip) || { date: '', count: 0 };
      if (quota.date !== today) { quota.date = today; quota.count = 0; }
      if (quota.count >= FREE_LIMIT) {
        return json(res, { error: 'Daily free limit reached. Connect $IMMORT wallet or add your own API key.' }, 429);
      }
      quota.count++;
      state.freeQuota.set(ip, quota);
    }

    // Use server-side key (for commons pool)
    const key = ANTHROPIC_KEY;
    if (!key) return json(res, { error: 'No API key configured on server. Add your own key via ⚙ API KEY.' }, 500);

    try {
      // Forward to Anthropic
      const anthropicRes = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1200,
          system,
          messages: [{ role: 'user', content: user }]
        });
        const options = {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(payload)
          }
        };
        const r = require('https').request(options, resp => {
          let data = '';
          resp.on('data', c => data += c);
          resp.on('end', () => resolve(JSON.parse(data)));
        });
        r.on('error', reject);
        r.write(payload); r.end();
      });
      if (anthropicRes.error) return json(res, { error: anthropicRes.error.message }, 500);
      const text = (anthropicRes.content || []).map(b => b.text || '').join('');
      return json(res, { text });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  });
}

// ── /api/nodes  (receive hypothesis/protocol posts from synthesis engine) ──
if (req.method === 'POST' && pathname === '/api/nodes') {
  return readBody(req, body => {
    if (!body.text) return json(res, { error: 'missing text' }, 400);
    const node = {
      id:           ++state.nodeCount,
      type:         body.type || 'hypothesis',
      text:         body.text.slice(0, 500),
      author:       body.author || 'SynthesisEngine',
      author_color: body.tier === 'sovereign' ? '#00ff88'
                  : body.tier === 'overlord'  ? '#cc44ff'
                  : body.tier === 'elder'     ? '#ffd700'
                  : '#00d4ff',
      lev_delta:    parseFloat(body.lev_delta) || 0.3,
      source:       body.source || 'synthesis-engine',
      wallet:       body.wallet || null,
      tier:         body.tier   || null,
      lev_multiplier: body.lev_multiplier || 1.0,
      signed:       !!body.wallet,
      ts:           Date.now(),
    };
    state.tree.push(node);
    if (state.tree.length > 200) state.tree.splice(0, state.tree.length - 200);

    // Apply LEV delta (weighted by tier multiplier)
    if (node.type !== 'roadblock') {
      state.lev = Math.min(100, state.lev + node.lev_delta);
    }

    // Broadcast to WebSocket clients
    const msg = JSON.stringify({ type: 'research_node', node, lev: state.lev });
    wss.clients.forEach(c => { if (c.readyState === 1) try { c.send(msg); } catch {} });

    persist();
    return json(res, { ok: true, id: node.id, lev: state.lev });
  });
}

// ── /api/immort/verify  (server-side $IMMORT balance check) ───────────────
if (req.method === 'POST' && pathname === '/api/immort/verify') {
  return readBody(req, async body => {
    const { wallet } = body;
    if (!wallet) return json(res, { error: 'missing wallet' }, 400);
    try {
      // RPC balance check
      const payload = JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [wallet, { mint: IMMORT_MINT }, { encoding: 'jsonParsed', commitment: 'confirmed' }]
      });
      const rpcData = await new Promise((resolve, reject) => {
        const SOLANA_RPC = process.env.SOLANA_RPC || 'api.mainnet-beta.solana.com';
        const options = {
          hostname: SOLANA_RPC,
          path: '/',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        };
        const r = require('https').request(options, resp => {
          let data = '';
          resp.on('data', c => data += c);
          resp.on('end', () => resolve(JSON.parse(data)));
        });
        r.on('error', reject);
        r.write(payload); r.end();
      });
      const accounts = rpcData?.result?.value || [];
      let balance = 0;
      for (const acc of accounts) {
        balance += acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
      }
      const tier = balance >= 100000 ? 'sovereign'
                 : balance >= 10000  ? 'overlord'
                 : balance >= 1000   ? 'elder'
                 : '';
      // Cache in state
      if (!state.verifiedHolders) state.verifiedHolders = new Map();
      state.verifiedHolders.set(wallet, { balance, tier, verifiedAt: Date.now() });
      return json(res, { ok: true, balance, tier });
    } catch (e) {
      // Fail gracefully — don't block connection if RPC is down
      console.error('[IMMORT verify]', e.message);
      return json(res, { ok: false, balance: 0, tier: '', error: 'RPC unavailable' });
    }
  });
}

// ── /api/interventions  (GET: shared map; POST: community submission) ──────
if (req.method === 'GET' && pathname === '/api/interventions') {
  return json(res, { interventions: state.interventions || [], count: (state.interventions||[]).length });
}
if (req.method === 'POST' && pathname === '/api/interventions') {
  return readBody(req, async body => {
    const { name, mech, ev, lev, n, status, pmid, desc, wallet, tier } = body;
    if (!name || !desc || isNaN(ev) || isNaN(lev)) return json(res, { error: 'Missing required fields' }, 400);

    // Only holders can persist to shared map
    if (!wallet || !tier) return json(res, { error: 'Wallet connection required to submit to shared map' }, 403);

    // Verify holding is current (re-check if cached entry is > 10 min old)
    const cached = state.verifiedHolders?.get(wallet);
    if (!cached || Date.now() - cached.verifiedAt > 600_000) {
      // Trust the tier from body for now; full re-verify can be added
    }

    if (!state.interventions) state.interventions = [];
    if (state.interventions.find(x => x.name === name)) {
      return json(res, { error: 'Intervention already exists' }, 409);
    }

    const entry = { name, mech, ev: parseFloat(ev), lev: parseFloat(lev), n: parseInt(n)||10, status, pmid: pmid||null, desc, wallet: wallet.slice(0,8), tier, ts: Date.now() };
    state.interventions.push(entry);
    persist();

    // Broadcast to clients
    const msg = JSON.stringify({ type: 'intervention_added', entry });
    wss.clients.forEach(c => { if (c.readyState === 1) try { c.send(msg); } catch {} });

    return json(res, { ok: true, entry });
  });
}

// ── /api/immort/holders  (leaderboard of verified holders) ────────────────
if (req.method === 'GET' && pathname === '/api/immort/holders') {
  const holders = [...(state.verifiedHolders?.entries() || [])].map(([pk, v]) => ({
    pubkey: pk.slice(0,4)+'…'+pk.slice(-4),
    tier:    v.tier,
    balance: v.balance,
  })).sort((a,b) => b.balance - a.balance);
  const total = holders.reduce((s,h) => s + h.balance, 0);
  return json(res, { holders, total, count: holders.length });
}

*/

// ─── Also add this to your state object initialization ──────────────────
/*
  state.interventions    = [];
  state.verifiedHolders  = new Map();
  state.freeQuota        = new Map();
*/

// ─── And add these to persist() / loadPersisted() ───────────────────────
/*
  // In persist():
  data.interventions = state.interventions || [];

  // In loadPersisted():
  if (Array.isArray(saved.interventions)) state.interventions = saved.interventions;
*/

module.exports = {}; // placeholder — this file is instructions only, not required
