/**
 * IMMORTALIS v4.0 — Server
 * Express + WebSocket multiplayer server
 *
 * Upgrades over v3.0:
 *  • /api/since/:nodeId — return hook endpoint
 *  • /api/session — streak tracking
 *  • /api/leaderboard — server-side leaderboard (GET + POST)
 *  • /api/stats — aggregate stats endpoint
 *  • WebSocket: phero_delta (sparse cell sync instead of full grid)
 *  • WebSocket: node_vote broadcast
 *  • WebSocket: set_name — update agent display name live
 *  • Exponential backoff handled client-side; server does graceful close
 *  • In-memory state with optional JSON file persistence (PERSIST_PATH env var)
 */

'use strict';

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { WebSocketServer } = require('ws');

// ─── Config ───────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 3000;
const PERSIST_PATH = process.env.PERSIST_PATH || null; // optional: './state.json'
const MAX_TREE     = 200;   // max research nodes kept in memory
const PHERO_W      = 120;
const PHERO_H      = 80;
const PHERO_SIZE   = PHERO_W * PHERO_H;
const TICK_MS      = 5000;  // how often to broadcast lev/stats update

// ─── State ────────────────────────────────────────────────────────────────
let state = {
  lev: 0,
  nodeCount: 0,
  tree: [],          // [{id, type, text, author, author_color, lev_delta, ts}]
  agents: new Map(), // id -> agent object
  sessions: new Map(), // session_id -> {name, color, streak_days, last_seen, node_count, vote_count}
  leaderboard: [],   // [{name, color, nodes, votes}]
  phero: new Float32Array(PHERO_SIZE),
};

loadPersisted();

// ─── Persistence ──────────────────────────────────────────────────────────
function loadPersisted() {
  if (!PERSIST_PATH) return;
  try {
    const raw = fs.readFileSync(PERSIST_PATH, 'utf8');
    const saved = JSON.parse(raw);
    if (typeof saved.lev === 'number') state.lev = saved.lev;
    if (Array.isArray(saved.tree)) state.tree = saved.tree.slice(-MAX_TREE);
    if (typeof saved.nodeCount === 'number') state.nodeCount = saved.nodeCount;
    if (Array.isArray(saved.leaderboard)) state.leaderboard = saved.leaderboard;
    console.log(`[persist] Loaded: lev=${state.lev.toFixed(1)}% nodes=${state.tree.length}`);
  } catch (e) {
    // no file yet — start fresh
  }
}

function persist() {
  if (!PERSIST_PATH) return;
  try {
    const data = {
      lev: state.lev,
      nodeCount: state.nodeCount,
      tree: state.tree.slice(-MAX_TREE),
      leaderboard: state.leaderboard,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[persist] Write error:', e.message);
  }
}

// Auto-persist every 60s if enabled
if (PERSIST_PATH) setInterval(persist, 60_000);

// ─── HTTP Server ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ── GET /api/since/:nodeId ─────────────────────────────────────────────
  if (req.method === 'GET' && pathname.startsWith('/api/since/')) {
    const sinceId = parseInt(pathname.split('/').pop(), 10);
    const newNodes = state.tree.filter(n => n.id > sinceId);
    const levGain = newNodes.reduce((s, n) => s + (n.lev_delta || 0), 0);
    const summary = newNodes.length
      ? `${newNodes.length} new insight${newNodes.length > 1 ? 's' : ''} while you were away — LEV +${levGain.toFixed(1)}%`
      : 'The swarm has been quiet. Good time to contribute.';
    return json(res, { nodes: newNodes, summary, lev: state.lev });
  }

  // ── POST /api/session ──────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/session') {
    return readBody(req, body => {
      const { session_id, name } = body;
      if (!session_id) return json(res, { error: 'missing session_id' }, 400);
      const today = new Date().toDateString();
      let sess = state.sessions.get(session_id) || { streak_days: 0, last_seen: null, name: '', node_count: 0, vote_count: 0 };
      if (sess.last_seen !== today) {
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        sess.streak_days = (sess.last_seen === yesterday) ? (sess.streak_days + 1) : 1;
        sess.last_seen = today;
      }
      if (name) sess.name = name;
      state.sessions.set(session_id, sess);
      json(res, {
        streak_days: sess.streak_days,
        stats: getStats(),
      });
    });
  }

  // ── GET /api/leaderboard ──────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    return json(res, { leaderboard: state.leaderboard.slice(0, 20) });
  }

  // ── POST /api/leaderboard ─────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/leaderboard') {
    return readBody(req, body => {
      const { name, color, nodes = 0, votes = 0 } = body;
      if (!name) return json(res, { error: 'missing name' }, 400);
      upsertLeaderboard(name, color, nodes, votes);
      json(res, { ok: true, leaderboard: state.leaderboard.slice(0, 20) });
    });
  }

  // ── GET /api/stats ────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/stats') {
    return json(res, getStats());
  }

  // ── Static files ──────────────────────────────────────────────────────
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const absPath = path.join(__dirname, filePath);
  const ext = path.extname(absPath);
  const mimeTypes = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml', '.toml': 'text/plain',
  };
  fs.readFile(absPath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────
function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req, cb) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(body)); } catch { cb({}); } });
}

function getStats() {
  return {
    lev: state.lev,
    nodes: state.nodeCount,
    active_now: state.agents.size,
    sessions_today: [...state.sessions.values()].filter(s => s.last_seen === new Date().toDateString()).length,
  };
}

function upsertLeaderboard(name, color, nodesDelta = 0, votesDelta = 0) {
  let entry = state.leaderboard.find(e => e.name === name);
  if (!entry) {
    entry = { name, color: color || '#00ffe7', nodes: 0, votes: 0 };
    state.leaderboard.push(entry);
  }
  entry.nodes += nodesDelta;
  entry.votes += votesDelta;
  if (color) entry.color = color;
  state.leaderboard.sort((a, b) => b.nodes - a.nodes);
  if (state.leaderboard.length > 50) state.leaderboard.length = 50;
}

// ─── WebSocket ────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
let clientSeq = 0;

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => {
    if (c !== exclude && c.readyState === 1 /* OPEN */) {
      try { c.send(msg); } catch {}
    }
  });
}

function broadcastExcept(data, exclude) {
  broadcast(data, exclude);
}

wss.on('connection', (ws) => {
  const clientId = `c_${clientSeq++}`;
  ws._clientId = clientId;
  ws._agentIds = new Set();

  // Send init package to new client
  const pheroB64 = pheroToB64(state.phero);
  ws.send(JSON.stringify({
    type: 'init',
    agents: [...state.agents.values()],
    tree: state.tree.slice(-50),
    lev: state.lev,
    phero: pheroB64,
    stats: getStats(),
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'register_agent': {
        const agent = {
          id: msg.id || clientId,
          name: msg.name || 'Agent',
          persona: msg.persona || '',
          color: msg.color || '#00ffe7',
          x: msg.x || 60,
          y: msg.y || 40,
          state: 'wandering',
          clientId,
        };
        state.agents.set(agent.id, agent);
        ws._agentIds.add(agent.id);
        broadcastExcept({ type: 'agent_joined', agent }, ws);
        break;
      }

      case 'agent_update': {
        const a = state.agents.get(msg.id);
        if (a && a.clientId === clientId) {
          a.x = msg.x; a.y = msg.y; a.state = msg.state || a.state;
          broadcastExcept({ type: 'agent_moved', agentId: msg.id, x: msg.x, y: msg.y, state: msg.state }, ws);
        }
        break;
      }

      case 'set_name': {
        // Update all agents belonging to this client
        if (msg.name) {
          for (const id of ws._agentIds) {
            const a = state.agents.get(id);
            if (a) a.name = msg.name;
          }
          broadcast({ type: 'roster_update', agents: [...state.agents.values()] });
        }
        break;
      }

      case 'phero_deposit': {
        depositPheroServer(msg.x, msg.y, msg.amount || 1);
        broadcastExcept({ type: 'phero_deposit', x: msg.x, y: msg.y, amount: msg.amount }, ws);
        break;
      }

      case 'phero_delta': {
        // Apply sparse delta from client to server phero
        if (Array.isArray(msg.delta)) {
          for (let i = 0; i < msg.delta.length; i += 2) {
            const idx = msg.delta[i], val = msg.delta[i + 1] / 25.5;
            if (idx < PHERO_SIZE && val > state.phero[idx]) state.phero[idx] = val;
          }
        }
        broadcastExcept({ type: 'phero_delta', delta: msg.delta }, ws);
        break;
      }

      case 'bubble': {
        broadcastExcept({ type: 'bubble', agentId: msg.agentId, text: msg.text }, ws);
        break;
      }

      case 'research_node': {
        if (!msg.node?.text) break;
        const node = {
          id: ++state.nodeCount,
          type: msg.node.type || 'hypothesis',
          text: msg.node.text,
          author: msg.node.author || 'SWARM',
          author_color: msg.node.author_color || '#00ffe7',
          lev_delta: msg.node.lev_delta || 0.3,
          ts: Date.now(),
        };
        state.tree.push(node);
        if (state.tree.length > MAX_TREE) state.tree.splice(0, state.tree.length - MAX_TREE);

        // Update LEV
        if (node.type !== 'roadblock') {
          state.lev = Math.min(100, state.lev + (node.lev_delta || 0.3));
        } else {
          state.lev = Math.max(0, state.lev + (node.lev_delta || 0));
        }

        // Update leaderboard
        if (node.author && node.author !== 'SWARM' && node.author !== 'SYSTEM') {
          upsertLeaderboard(node.author, node.author_color, 1, 0);
        }

        broadcast({ type: 'research_node', node, lev: state.lev });
        persist();
        break;
      }

      case 'node_vote': {
        broadcast({ type: 'node_vote', nodeId: msg.nodeId, direction: msg.direction, voter: msg.voter });
        if (msg.voter && msg.voter !== 'anon') {
          upsertLeaderboard(msg.voter, null, 0, 1);
        }
        break;
      }

      case 'council_formed': {
        broadcast({ type: 'council_formed', council: msg.council });
        break;
      }

      case 'session_ping': {
        const today = new Date().toDateString();
        let sess = state.sessions.get(msg.session_id) || { streak_days: 0, last_seen: null, name: '', node_count: 0, vote_count: 0 };
        if (sess.last_seen !== today) {
          const yesterday = new Date(Date.now() - 86400000).toDateString();
          sess.streak_days = (sess.last_seen === yesterday) ? sess.streak_days + 1 : 1;
          sess.last_seen = today;
        }
        if (msg.name) sess.name = msg.name;
        state.sessions.set(msg.session_id, sess);
        break;
      }
    }
  });

  ws.on('close', () => {
    for (const id of ws._agentIds) {
      state.agents.delete(id);
      broadcast({ type: 'agent_left', agentId: id });
    }
  });

  ws.on('error', () => {});
});

// ─── Server-side pheromone ────────────────────────────────────────────────
function depositPheroServer(tx, ty, amount) {
  const a = Math.min(8, Math.max(0, amount));
  const r = 2, fx = Math.round(tx), fy = Math.round(ty);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = fx + dx, ny = fy + dy;
    if (nx < 0 || nx >= PHERO_W || ny < 0 || ny >= PHERO_H) continue;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > r) continue;
    const idx = ny * PHERO_W + nx;
    state.phero[idx] = Math.min(10, state.phero[idx] + a * (1 - d / r));
  }
}

function pheroToB64(phero) {
  const bytes = new Uint8Array(phero.length);
  for (let i = 0; i < phero.length; i++) bytes[i] = Math.min(255, phero[i] * 25.5) | 0;
  return Buffer.from(bytes).toString('base64');
}

// Periodic pheromone evaporation
setInterval(() => {
  for (let i = 0; i < PHERO_SIZE; i++) state.phero[i] *= 0.992;
}, 500);

// Periodic LEV + stats broadcast to all clients
setInterval(() => {
  if (wss.clients.size === 0) return;
  broadcast({ type: 'lev_update', lev: state.lev, stats: getStats() });
}, TICK_MS);

// ─── Start ────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`IMMORTALIS v4.0 server running on port ${PORT}`);
  console.log(`Persist: ${PERSIST_PATH || 'disabled (set PERSIST_PATH to enable)'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => { persist(); process.exit(0); });
process.on('SIGINT',  () => { persist(); process.exit(0); });
