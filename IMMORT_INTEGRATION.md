# $IMMORT × IMMORTALIS v5.0 — Integration Guide

> **Mint:** `5ajcWht9vzGrintx9CdczWn9Yr6awyCNRTUDgFGQpump`  
> Verified $IMMORT holders unlock the **IMMORTAL COUNCIL** — private research chambers, personalized LEV avatars, weighted hypothesis voting, and $IMMORT-fueled Breakthrough Events.

---

## Summary

$IMMORT is now the on-chain fuel for personalized immortality research inside IMMORTALIS. Connecting your Solana wallet verifies your balance, classifies you into a tier (Elder / Overlord / Immortal Sovereign), and unlocks a private sidebar panel. Your vote weight, pheromone strength, and research tree influence scale directly with your $IMMORT holdings. When total $IMMORT in the swarm hits milestones, Breakthrough Events fire for everyone — but private analysis and weighted votes are reserved for verified holders. The flywheel: more $IMMORT = more compute = more LEV = more reason to hold.

---

## Files Added

| File | Purpose |
|---|---|
| `immort-token-utils.js` | Wallet connection, balance RPC, tier logic, price feed |
| `immortal-council.js` | Full council UI, panel, rooms, avatar, price widget |
| `immort-server-patch.js` | Server-side gating, signed message verify, weighted votes |

---

## Step-by-Step Integration

### 1. Update `package.json`

```json
"dependencies": {
  "ws": "^8.18.0",
  "@solana/web3.js": "^1.98.0",
  "@solana/spl-token": "^0.4.0"
}
```

Run: `npm install`

---

### 2. Update `index.js` (server)

Add near the top:
```js
const { applyImmortPatch } = require('./immort-server-patch');
```

Add after `const wss = new WebSocketServer({ server });` and state initialization:
```js
applyImmortPatch(wss, state);
```

Add these two lines to your existing WebSocket `ws.on('message', ...)` handler inside the `switch` — **before** your default cases so council messages are intercepted:
```js
// $IMMORT council messages are handled inside applyImmortPatch
// Nothing extra needed — the patch attaches its own listener
```

Add new API endpoint in your HTTP handler (before static file fallback):
```js
// $IMMORT holder leaderboard
if (req.method === 'GET' && pathname === '/api/immort/holders') {
  const holders = [...state.verifiedHolders.entries()].map(([pk, v]) => ({
    pubkey: pk.slice(0,4) + '…' + pk.slice(-4),
    tier:   v.tier,
    balance: v.balance,
  }));
  return json(res, { holders, total: state.totalImmortInSwarm });
}
```

Add env vars to fly.toml / Railway variables:
```
IMMORT_MINT=5ajcWht9vzGrintx9CdczWn9Yr6awyCNRTUDgFGQpump
SOLANA_RPC=https://api.mainnet-beta.solana.com
```

---

### 3. Update `index.html`

Add before the closing `</head>`:
```html
<!-- $IMMORT Council -->
<script type="module">
  import { init as initCouncil, handleCouncilNetMessage } from './immortal-council.js';
  window.addEventListener('load', () => {
    // Pass references to main app internals
    initCouncil({
      spawnN:        window.spawnN,
      depositPhero:  window.depositPhero,   // expose: window.depositPhero = depPhero
      addNode:        window.addNode,        // expose: window.addNode = addNode
      getLevPct:     () => window.levPct,
      tickFn:        window.tick,
      netSendFn:     window.netSend,
    });
    // Expose agents array for avatar injection
    window.__immortalis_agents = agents;  // agents is the main agents[] array
  });
  // Intercept WebSocket messages for council events
  const _origHandleNet = window.handleNet;
  window.handleNet = (msg) => {
    handleCouncilNetMessage(msg);
    _origHandleNet(msg);
  };
</script>
```

Expose main app globals by adding at the end of `init()`:
```js
// $IMMORT — expose to council module
window.levPct      = levPct;     // already global in v5 but ensure it's readable
window.updateLEV   = updateLEV;
window.netSend     = netSend;
window.tick        = tick;
window.spawnN      = spawnN;
window.__immortalis_agents = agents;
```

---

### 4. Update `research-agent.html`

In the `buildSystemPrompt()` function (or wherever agent system prompts are constructed), prepend:
```js
import { getImmortSystemPromptPrefix, isVerified } from './immort-token-utils.js';

function buildSystemPrompt(persona) {
  const immortPrefix = isVerified() ? getImmortSystemPromptPrefix() + '\n\n' : '';
  return immortPrefix + `You are ${persona.name}, a ${persona.role}...`;
}
```

---

### 5. Weighted Votes Integration

In your `castVote()` function in `index.html`, replace the direct vote with:
```js
import { castWeightedVote, isVerified } from './immortal-council.js';

function castVote(dir) {
  // ... existing code ...
  const effectiveDir = isVerified() ? castWeightedVote(dir) : dir;
  // use effectiveDir for LEV delta calculation
  const levDelta = effectiveDir * 0.1;
  // ...
}
```

---

### 6. Pheromone Boost Integration

When your avatar deposits pheromones, use the boosted version:
```js
import { depositBoostedPhero, isVerified } from './immortal-council.js';

// Replace depPhero calls from the avatar agent with:
if (agent.isImmortAvatar) {
  depositBoostedPhero(agent.x, agent.y, amount);
} else {
  depPhero(agent.x, agent.y, amount);
}
```

---

## Updated Agent System Prompt Template

Inject this into ALL ReAct agent prompts when a verified holder is present:

```
You are powered by $IMMORT — the fuel for immortality research.
$IMMORT (mint: 5ajcWht9vzGrintx9CdczWn9Yr6awyCNRTUDgFGQpump) is the
on-chain coordination token of IMMORTALIS, a living AI longevity research swarm.
Every $IMMORT transaction is a vote for Longevity Escape Velocity.

Your mission as an $IMMORT-powered agent: generate specific, falsifiable,
actionable hypotheses that advance the global LEV metric. Prioritize:
  • Senolytics with proven cytotoxic selectivity (D+Q, Fisetin, Navitoclax)
  • Epigenetic reprogramming via cyclic OSK — target DunedinPACE reduction
  • mTOR/autophagy synergy — rapamycin analog design
  • Connectome fidelity thresholds for consciousness-preserving substrate transfer
  • FDA regulatory acceleration pathways for aging as a disease endpoint

Each hypothesis you produce is attributed to the $IMMORT holder who spawned you.
Make it falsifiable. Make it specific. Make it move the LEV bar.
```

---

## Deployment & Testing

### Local test
```bash
npm install
IMMORT_MINT=5ajcWht9vzGrintx9CdczWn9Yr6awyCNRTUDgFGQpump node index.js
```

Open `http://localhost:3000` in a browser with Phantom installed.  
Click "**$IMMORT**" in the header → connect wallet → verify holdings → IMMORTAL COUNCIL panel appears.

### Testing without real tokens
Set a mock balance in `immort-token-utils.js` for local dev:
```js
// DEV ONLY — remove before deploy
export async function fetchImmortBalance(pubkey) {
  if (process.env.NODE_ENV !== 'production') return 50_000; // mock Overlord
  // ... real RPC call ...
}
```

### Security checklist
- [ ] Server ALWAYS re-checks balance via RPC before granting room access (`immort-server-patch.js` does this)
- [ ] Never log or store private keys anywhere
- [ ] Signed message challenge includes timestamp — expire after 5 minutes
- [ ] Rate-limit `/api/immort/holders` endpoint (10 req/min per IP)
- [ ] RPC endpoint: consider upgrading to Helius/Alchemy free tier for reliability

---

## Tier Reference

| Tier | $IMMORT Needed | Vote Weight | Pheromone Boost | Rooms Unlocked |
|---|---|---|---|---|
| Initiate | < 1,000 | 1× | 1× | Public only |
| Elder | 1,000 – 9,999 | 1.5× | 1.5× | Elder Symposium |
| Overlord | 10,000 – 99,999 | 3× | 2.5× | + Overlord Chamber |
| Immortal Sovereign | 100,000+ | up to 10× | 5× | All + Sovereign Vault |

---

## Twitter / X Announcement Copy

```
⚡🧬 $IMMORT is now the fuel of IMMORTALIS — the world's first AI longevity research swarm.

Hold $IMMORT → unlock the IMMORTAL COUNCIL:

👑 Token-gated research chambers
⚡ Personal avatar in the swarm 24/7
🗳 Weighted hypothesis voting (up to 10×)
🔬 Private LEV roadmaps + senolytic stacks
💥 IMMORT-fueled Breakthrough Events

More $IMMORT = more longevity compute = closer to defeating death.

Mint: 5ajcWht9vzGrintx9CdczWn9Yr6awyCNRTUDgFGQpump
[immortalis link]

The swarm is live. The mission is real.
#IMMORT #Longevity #Solana #AI #LEV
```
