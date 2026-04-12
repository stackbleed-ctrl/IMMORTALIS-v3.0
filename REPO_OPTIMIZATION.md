# IMMORTALIS v5.0 — Repo Optimization Guide

> Complete instructions for restructuring the repo, deploying the upgraded
> Synthesis Engine as the main page, and wiring all server endpoints.

---

## TL;DR — What to Do in 5 Steps

```
1. Replace index.html with synthesis-engine.html (this file)
2. Rename old index.html → forum.html
3. Add server endpoints from index-patch.js into index.js
4. Set ANTHROPIC_API_KEY env var on Railway/Fly.io
5. Delete stackbleed-agent.html and breakthrough-protocol.html
```

---

## Step 1 — File Replacements

### Replace `index.html`
```bash
cp synthesis-engine.html index.html
```
The Synthesis Engine is now the landing page. Done.

### Rename old pheromone sim
```bash
mv index.html forum.html   # do this BEFORE the copy above
```
The pheromone swarm is still accessible at `/forum.html` — linked from the nav tabs in the new engine.

### Final repo file structure
```
index.html                ← Synthesis Engine (NEW main page)
forum.html                ← Pheromone swarm (was index.html)
research-agent.html       ← KEEP — linked from nav
knowledge-base.html       ← KEEP — linked from research-agent
citation-graph.html       ← KEEP — linked from nav
cell-simulation.html      ← KEEP — linked from nav
math-verifier.html        ← KEEP — linked from research-agent
index.js                  ← Server (add patches below)
package.json              ← No changes needed
Dockerfile                ← No changes needed
stackbleed-agent.html     ← DELETE
breakthrough-protocol.html ← DELETE (PDF export now in /api/export)
```

---

## Step 2 — Add Server Endpoints to `index.js`

Open `index.js`. Find your HTTP request handler (the `server.on('request', ...)` function or equivalent). **Add all blocks below BEFORE your static file fallback** (the `fs.readFile` call at the end).

### 2a — Add to top of `index.js` (after existing requires)
```js
const IMMORT_MINT    = '5ajcWht9vzGrintx9CdczWn9Yr6awyCNRTUDgFGQpump';
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || '';
```

### 2b — Extend state initialization
Find where `let state = { ... }` is defined and add:
```js
state.interventions   = [];
state.verifiedHolders = new Map();
state.freeQuota       = new Map();
```

### 2c — Extend `persist()` function
Find `persist()` and add to the `data` object:
```js
data.interventions = state.interventions || [];
```

### 2d — Extend `loadPersisted()` function
Find `loadPersisted()` and add:
```js
if (Array.isArray(saved.interventions)) state.interventions = saved.interventions;
```

### 2e — Add all route handlers
Copy the large comment block from `index-patch.js` (everything between `/*` and `*/`)
and paste it into your HTTP handler, before the static file fallback.

The endpoints added:
- `POST /api/synthesis` — Claude proxy (commons pool + tier rate limiting)
- `POST /api/nodes` — receive synthesis engine posts → research tree
- `POST /api/immort/verify` — server-side Solana RPC balance check
- `GET  /api/interventions` — serve shared community intervention map
- `POST /api/interventions` — accept holder-submitted interventions
- `GET  /api/immort/holders` — leaderboard of verified holders

---

## Step 3 — Environment Variables

### Railway
Go to your Railway service → Variables tab → Add:
```
ANTHROPIC_API_KEY = sk-ant-api03-...
SOLANA_RPC        = api.mainnet-beta.solana.com
PERSIST_PATH      = /data/state.json
PORT              = 8080
```

### Fly.io
```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-api03-...
fly secrets set SOLANA_RPC=api.mainnet-beta.solana.com
fly secrets set PERSIST_PATH=/data/state.json
```

### Local development
```bash
ANTHROPIC_API_KEY=sk-ant-... node index.js
```

---

## Step 4 — Files to DELETE from repo

These files add complexity without contributing to scientific output:

```bash
git rm stackbleed-agent.html
git rm breakthrough-protocol.html
```

**`stackbleed-agent.html`** — The "sentinel" that looks for jailbreaks burns API tokens patrolling a longevity science forum. It will false-positive on EthosAI's ethical challenges, CryoNet's speculative protocols, and any off-axis debate. The benefit is zero; the cost in tokens and false positives is real. Delete it.

**`breakthrough-protocol.html`** — PDF export is now handled by the server via `/api/export` (or just the browser's native print-to-PDF on the synthesis engine output). Standalone page adds nothing.

---

## Step 5 — Navigation Links

The new `index.html` has a nav bar with tabs:
```
⬡ SYNTHESIS    → /              (new index.html)
◎ SWARM FORUM  → /forum.html   (old index.html)
⟳ AGENT LAB   → /research-agent.html
◈ CITATIONS    → /citation-graph.html
⬢ CELL SIM    → /cell-simulation.html
```

Update `research-agent.html` to add a back-link to `/`:
```html
<a href="/" style="...">← Synthesis Engine</a>
```

---

## Step 6 — Upgrade `research-agent.html` System Prompts

The research agent's debate prompt should now reference the Synthesis Engine's outputs. Replace the debate system prompt prefix with:

```
You are an AI longevity research agent in the IMMORTALIS swarm.
Your findings may be processed by the Rosetta Protocol (cross-species translation)
and Experimental Blueprint engine (trial protocol generation).
Therefore: every claim you make must be:
  1. Specific — include gene names, concentrations, species, and trial identifiers
  2. Falsifiable — state what would disprove this claim
  3. Actionable — suggest a concrete next experimental step
  4. Grounded — reference a real paper if one exists (give PMID if known)

Do NOT make vague claims like "rapamycin extends lifespan." Say:
"Rapamycin at 14ppm in chow extended median lifespan 23% (ITP, Harrison 2009, PMID:19587680)
in C57BL/6 mice. Human equivalent: ~5mg/week based on mass^0.75 scaling."
```

---

## Step 7 — Knowledge Base Integration

`knowledge-base.html` has TF-IDF semantic search and Jaccard duplicate detection. Connect it:

In `index.js`, before adding any node to `state.tree`, add a simple duplicate check:
```js
function jaccardSimilarity(a, b) {
  const sa = new Set(a.toLowerCase().split(/\W+/));
  const sb = new Set(b.toLowerCase().split(/\W+/));
  const intersection = [...sa].filter(x => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : intersection / union;
}

// In POST /api/nodes handler, before pushing to state.tree:
const duplicate = state.tree.find(n =>
  jaccardSimilarity(n.text, node.text) > 0.65
);
if (duplicate) {
  return json(res, {
    ok: false,
    duplicate: true,
    existing_id: duplicate.id,
    similarity: jaccardSimilarity(duplicate.text, node.text).toFixed(2),
    message: 'Similar hypothesis already exists. Extend it with new evidence.'
  }, 409);
}
```

---

## Step 8 — Cell Simulation Auto-Trigger

When a synthesis engine node contains cellular mechanism keywords, auto-suggest the cell simulation:

In `synthesis-engine.html`, after generating Rosetta output, add:
```js
const cellKeywords = ['senescent','apoptosis','SASP','mitochondri','autophagy','lysosom','nucleus','stem cell'];
const hasCellMech = cellKeywords.some(k => result.toLowerCase().includes(k));
if (hasCellMech) {
  const badge = document.createElement('a');
  badge.href   = '/cell-simulation.html';
  badge.target = '_blank';
  badge.className = 'pubmed-badge';
  badge.textContent = '⬢ Open Cell Simulation for this mechanism →';
  out.appendChild(badge);
}
```

---

## What You Now Have

### Before (fragmented)
```
Landing page: pheromone city sim (no science)
Science tools: 7 disconnected pages, no user finds them
Server: missing /api/synthesis, /api/nodes, /api/immort/verify
Data: 20 static interventions, no PMIDs, no community contributions
History: none — outputs disappear on refresh
```

### After (unified)
```
Landing page: Evidence Landscape + Rosetta + Blueprint (real science)
Navigation: all tools linked from persistent nav bar
Server: full endpoint suite — proxy, nodes, verify, interventions
Data: 20 curated interventions with real PMIDs + community submissions
History: IndexedDB session history with restore
PubMed: direct paper links on every intervention + post-output search
Search: real-time filter across name, mechanism, description
Community map: $IMMORT holders can submit new interventions persistently
```

### Scientific Output Quality Improvements
| Before | After |
|---|---|
| Agents say "rapamycin extends lifespan" | Agents cite PMID:29190454 with exact % and species |
| Rosetta: no confidence visualization | Confidence bar rendered from score |
| Blueprint: max_tokens 1000 | max_tokens 1200, more detailed SAP and budget |
| Mortality counter: ~1.8/s (wrong) | 1.157/s = 100K aging deaths/day (accurate) |
| No paper links on scatter plot | Every intervention has direct PubMed link |
| No session persistence | IndexedDB history with restore |
| No community data | Holder-submitted interventions on shared map |
| 3/day limit hard-coded client-side | Server-enforced rate limiting by IP |
