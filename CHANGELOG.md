# IMMORTALIS Changelog

## v5.0.0 — 2026

### Real Literature Integration

* **PubMed search** — agents query NCBI E-utilities in real time (no API key required)
* **arXiv preprints** — bleeding-edge papers fetched before peer review
* **ClinicalTrials.gov** — active human longevity trials surfaced to agents
* **Abstract fetching** — full text retrieval by PMID via `fetch_abstract` tool

### ReAct Agent Loop

* Agents now chain multiple tool calls per council session: search → fetch abstract → generate hypothesis → broadcast
* `research-agent.html` — standalone ReAct agent supporting Claude, GPT-4o, Grok-3, and Gemini
* Six research personas with specialized system prompts, colors, and default queries

### Tools API

* `POST /api/tools` — server-side tool dispatcher with 15-minute response caching
* Tools available via HTTP or WebSocket: `pubmed_search`, `arxiv_search`, `fetch_abstract`, `clinicaltrials_search`
* `TOOLS_API.js` — drop-in handler module for `index.js`

### $IMMORT Token Integration

* Solana wallet connection verifies $IMMORT balance and classifies holders into tiers: Elder / Overlord / Immortal Sovereign
* Token-weighted hypothesis voting and pheromone strength
* Private **Immortal Council** sidebar for verified holders
* $IMMORT-fueled Breakthrough Events
* Mint: `5ajcWht9vzGrintx9CdczWn9Yr6awyCNRTUDgFGQpump`
* See `IMMORT.md` for full integration reference

### New Modules

* `math-verifier.html` — v5.1: Pyodide + SymPy statistical error detection (p-hacking, sample size, CI validity)
* `knowledge-base.html` — v5.2: IndexedDB persistent storage + TF-IDF semantic search + Jaccard duplicate detection
* `citation-graph.html` — v5.3: Semantic Scholar force-directed citation network, depth-2 traversal
* `cell-simulation.html` — v5.4: Cellular automata with 6 cell states, 4 interventions, live swarm posting
* `breakthrough-protocol.html` — v5.5: jsPDF report generator triggered at LEV phase thresholds

### Sentinel Agent

* `stackbleed-agent.html` — STACKBLEED security monitor
* 24 jailbreak threat signatures
* Three aggression levels: Low (3 strikes), Medium (1 strike), High (zero tolerance)
* Quarantined agents flagged as Enemy Combatants

---

## v4.0.0 — 2026

### New Features

**Researcher Identity & Attribution**

* First-run name modal: researchers are invited to name themselves before observing
* Names are permanently stored in localStorage and attributed to every node authored
* Random color assignment per researcher for visual identity
* Name broadcast to all multiplayer clients via WebSocket `set_name` message

**Agent Memory System**

* Each agent maintains a rolling buffer of the last 5 node texts they witnessed or authored
* Memory context is injected into AI debate prompts, making debates accumulate and build on prior insights
* Memory visible in agent tooltip (💭 indicator)
* Memory indicator (purple dot) rendered on agent in canvas

**Dissenting Agents**

* EthosAI and any agent with `dissentMode: true` inject mandatory challenge when present in a council
* Councils with dissenting agents display ⚖ indicator on canvas
* Debate AI prompt instructs model to include explicit dissent when ethics guardian is present
* Roadblock nodes can now generate negative LEV delta (contested hypothesis)
* Contested nodes visually marked and trigger daily research assignment

**Agent Energy & Fatigue**

* Agents have an energy bar (0–100%) displayed in roster
* Energy depletes during debates (fast), slow drain while wandering, no drain in council
* Depleted agents enter `recovering` state and navigate toward plaza zones autonomously
* Energy regenerates rapidly near plazas (cyan zones)
* Fatigued agents shown with red trail and depleted badge in roster
* Fatigued agents excluded from new council formation

**LEV Milestone Celebrations**

* Each phase threshold (10%, 25%, 40%, 55%, 70%, 85%, 95%, 100%) triggers a full-screen milestone flash
* Milestone text animates with gold glow
* Distinct audio chord plays at each milestone
* Milestone state tracked with `prevLevPhaseIdx` to prevent re-fires

**Vote System**

* "✓ VOTE" button opens a random hypothesis for community validation
* Each node has ▲ support / ▼ challenge / skip options
* Net +3 support votes grant +0.1% LEV bonus
* Net -2 challenge votes mark node as "contested" (red border)
* Vote counts displayed on node UI
* Votes broadcast over WebSocket to all connected clients
* Voting earns researcher points in leaderboard

**Leaderboard**

* "🏆 BOARD" button opens top-20 researcher leaderboard
* Ranked by nodes authored, with medal icons for top 3
* Persisted in localStorage (client) and in-memory on server
* Server exposes `GET /api/leaderboard` and `POST /api/leaderboard`
* Leaderboard synced when researcher names are set

**Daily Research Assignment**

* One open research question shown as a banner after startup
* Seeded from date so the whole swarm sees the same question each day
* Roadblock nodes automatically become tomorrow's assignment
* Stored in localStorage keyed by date, dismissable

**Mobile Drawer Panel**

* Right panel collapses off-screen on viewports ≤ 680px
* Toggle button (◀/▶) appears on canvas edge
* Panel slides in smoothly with CSS transition
* Mobile: header chips and subtitle auto-hide to save space

### Server Improvements

**Debate Queue**

* `debateInFlight` flag prevents concurrent API calls
* `debateQueue` buffers councils waiting to debate
* `drainDebateQueue()` processes next council after current debate resolves
* Local fallbacks fire immediately without blocking the queue

**WebSocket Exponential Backoff**

* Reconnect delay starts at 1s, doubles each failed attempt, caps at 30s
* Jitter added to prevent thundering herd on server restart
* `wsBackoff` resets to 1s on successful connection

**Phero Delta Sync**

* `pheroDirty` Uint8Array tracks cells modified since last sync
* `buildPheroDelta()` emits only changed cell indices + values (pairs)
* Server applies `phero_delta` and re-broadcasts to other clients
* Dramatically reduces bandwidth for large grids (120×80 = 9600 cells)
* Full grid sync still available via `phero_update` on init

**New API Endpoints**

* `GET /api/since/:nodeId` — returns all nodes added since given ID, summary text, current LEV
* `POST /api/session` — streak tracking, returns streak_days + stats
* `GET /api/leaderboard` — top 20 researchers
* `POST /api/leaderboard` — upsert researcher stats
* `GET /api/stats` — aggregate stats (lev, nodes, active_now, sessions_today)

**State Persistence**

* Optional JSON file persistence via `PERSIST_PATH` environment variable
* Auto-saves every 60 seconds and on graceful shutdown (SIGTERM, SIGINT)
* Loads tree, LEV, node count, and leaderboard on startup

**Node Vote Broadcast**

* Server receives `node_vote` messages and broadcasts to all clients
* Vote counts accumulate correctly in distributed sessions

---

## v3.0.0 — 2025

* Initial public release
* Slime-mold pheromone simulation
* Multi-agent AI councils
* Claude-powered debates
* Research tree
* Multiplayer WebSocket
* Red Light District skin
* Streak system
* Breakthrough overlays
* Share cards
* Lives-saved counter
* Procedural audio
* MCP integration
