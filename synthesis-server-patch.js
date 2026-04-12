// synthesis-server-patch.js
// ─────────────────────────────────────────────────────────────────────────────
// Drop-in patch for index.js — adds the /api/synthesis Research Commons endpoint.
//
// What this does:
//   • Routes Synthesis Engine AI calls through the server's ANTHROPIC_API_KEY
//   • Non-holders: 3 free queries/day (enforced server-side by IP)
//   • $IMMORT token holders: unlimited (tier verified via existing /api/immort/verify)
//   • Keeps per-IP quota in memory (resets at midnight UTC, or on server restart)
//
// Integration — add to index.js:
//
//   const { handleSynthesisEndpoint } = require('./synthesis-server-patch');
//
//   // In your HTTP request handler, BEFORE your existing routes:
//   if (req.method === 'OPTIONS') { /* your existing CORS handler */ }
//   if (req.method === 'POST' && pathname === '/api/synthesis') {
//     handleSynthesisEndpoint(req, res); return;
//   }
// ─────────────────────────────────────────────────────────────────────────────

const FREE_DAILY_LIMIT = 3;

// In-memory quota store: ip -> { date: 'Mon Apr 14 2026', count: N }
// Resets automatically when date changes. Cleared on server restart.
const ipQuota = new Map();

function getDayKey() {
  return new Date().toDateString(); // e.g. "Sat Apr 11 2026"
}

function getQuota(ip) {
  const entry = ipQuota.get(ip) || { date: '', count: 0 };
  if (entry.date !== getDayKey()) return { remaining: FREE_DAILY_LIMIT, exhausted: false };
  const remaining = FREE_DAILY_LIMIT - entry.count;
  return { remaining, exhausted: remaining <= 0 };
}

function consumeQuota(ip) {
  const today = getDayKey();
  const entry = ipQuota.get(ip) || { date: today, count: 0 };
  ipQuota.set(ip, {
    date:  today,
    count: entry.date === today ? entry.count + 1 : 1
  });
}

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function sendJSON(res, status, obj) {
  res.writeHead(status, corsHeaders());
  res.end(JSON.stringify(obj));
}

// Valid tier values from immort-token-utils.js
const VALID_TIERS = new Set(['elder', 'overlord', 'sovereign']);

async function handleSynthesisEndpoint(req, res) {
  const serverKey = process.env.ANTHROPIC_API_KEY;

  if (!serverKey) {
    sendJSON(res, 503, {
      error: 'Research Commons pool not configured on this server. Add your own key via ⚙ API KEY.'
    });
    return;
  }

  // Collect request body
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', async () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON body.' });
      return;
    }

    const { system = '', user = '', wallet, tier } = body;

    if (!user.trim()) {
      sendJSON(res, 400, { error: 'user field is required.' });
      return;
    }

    // ── Determine access level ──────────────────────────────────────────────
    const isTokenHolder = wallet && tier && VALID_TIERS.has(tier);

    if (!isTokenHolder) {
      // Rate-limit anonymous / non-holder requests
      const ip = getClientIP(req);
      const quota = getQuota(ip);

      if (quota.exhausted) {
        sendJSON(res, 429, {
          error: `Daily free limit reached (${FREE_DAILY_LIMIT} queries/day from the Research Commons pool). Connect your $IMMORT wallet for unlimited access.`,
          quota_exhausted: true,
          remaining: 0
        });
        return;
      }

      consumeQuota(ip);
    }

    // ── Proxy to Anthropic ──────────────────────────────────────────────────
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': serverKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system,
          messages: [{ role: 'user', content: user }]
        })
      });

      const data = await anthropicRes.json();

      if (data.error) {
        sendJSON(res, 502, { error: `Anthropic API error: ${data.error.message}` });
        return;
      }

      const text = data.content.map(b => b.text || '').join('');
      const ip   = getClientIP(req);
      const quota = getQuota(ip);

      sendJSON(res, 200, {
        text,
        is_token_holder: isTokenHolder,
        tier:            tier || null,
        // Return remaining quota so client can update UI (only relevant for non-holders)
        remaining_today: isTokenHolder ? null : quota.remaining
      });

    } catch (e) {
      sendJSON(res, 500, { error: `Synthesis proxy error: ${e.message}` });
    }
  });
}

module.exports = { handleSynthesisEndpoint };
