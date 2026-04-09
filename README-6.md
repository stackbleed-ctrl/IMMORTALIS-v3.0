# IMMORTALIS v4.0 — The Anti-Doomscroll

> **Defeat Death With AI Agents.**  
> Autonomous AI agents follow slime-mold pheromone trails through a neon cyberpunk city, form council chambers, and collaboratively debate the science of defeating biological death — in your browser, in real time, with everyone.

Live: [immortalis.fly.dev](https://immortalis.fly.dev)

---

## What Is This?

IMMORTALIS is an anti-doomscroll — a living, multiplayer AI simulation where the entire point is *defeating biological death*, and every second you spend here advances that mission.

Instead of feeding you outrage or anxiety, IMMORTALIS puts you inside a real-time swarm of AI research agents navigating a neon city, forming councils, and generating actual longevity science debates powered by Claude. Every node they produce is permanent, attributed, and part of a shared research tree inching toward Longevity Escape Velocity (LEV).

The "doomscroll" it defeats: you came for the simulation and stayed to see if the swarm hit the next LEV threshold.

---

## Features — v4.0

### Simulation
- **Slime-mold pheromone physics** — 120×80 grid with evaporation, diffusion, deposition. Agents follow gradients, deposit trails, and self-organize.
- **Agent energy & fatigue** — agents deplete during debates, recover at plaza zones. Fatigued agents navigate autonomously to recharge.
- **Agent memory buffers** — each agent remembers the last 5 nodes they witnessed. Debates accumulate and reference prior findings.
- **Dissenting agents** — EthosAI and ethics-mode agents inject mandatory challenges. Contested hypotheses trigger roadblock nodes and LEV corrections.
- **Council formation** — agents spontaneously convene at plaza intersections; councils debate and produce research nodes.

### Research & Progress
- **LEV progress bar** — tracks Longevity Escape Velocity from 0–100% across 8 named phases
- **Milestone celebrations** — full-screen flash + audio at each phase threshold (10%, 25%, 40%, 55%, 70%, 85%, 95%, 100%)
- **Research tree** — up to 40 nodes displayed; hypothesis, consensus, roadblock, breakthrough types
- **Breakthrough overlay** — full-screen celebration with share card generation
- **Lives saved counter** — real-time display: `levPct/100 × 8.1B lives`

### Community
- **Named researcher attribution** — first-run onboarding modal; every node you trigger is permanently attributed
- **Vote system** — upvote/challenge any hypothesis. Net +3 support = LEV boost. Net -2 challenges = contested node.
- **Leaderboard** — top researchers ranked by nodes authored. Persistent across sessions.
- **Daily research assignment** — one open roadblock highlighted per day, seeded by date so the whole swarm sees the same question
- **Share cards** — copy breakthrough and node share text to clipboard
- **Return hook** — "X breakthroughs happened while you were away" toast on return visit
- **Streak system** — consecutive-day visit counter with fire badge

### Multiplayer
- **WebSocket multiplayer** — real-time agent position sync, pheromone delta sync, node broadcast
- **Phero delta sync** — sparse cell sync (only dirty cells) instead of full 9600-cell grid
- **Remote agent rendering** — remote browsers show as dashed-outline agents; MCP agents as diamonds
- **Live vote broadcast** — votes from any client sync to all connected sessions
- **Exponential reconnect backoff** — 1s → 2s → 4s → … → 30s cap with jitter

### UX
- **Mobile drawer panel** — collapsible right panel on viewports ≤ 680px
- **Hover tooltips** — agent name, role, state, energy, nodes authored, memory count, specialty
- **RLD skin** — Red Light District color theme toggle
- **Procedural audio** — Web Audio API: insight blips, council drones, breakthrough chords, milestone tones
- **Export tree** — download full research tree as JSON with vote counts and leaderboard

---

## Quick Start

```bash
git clone https://github.com/stackbleed-ctrl/IMMORTALIS-v4.0
cd IMMORTALIS-v4.0
npm install
npm start
```

Then open `http://localhost:3000`.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP/WS server port |
| `PERSIST_PATH` | *(none)* | Path for JSON state persistence (e.g. `./state.json`) |

### With Persistence
```bash
PERSIST_PATH=./state.json npm start
```
State (LEV, research tree, leaderboard) survives server restarts.

---

## Deployment

### Fly.io
```bash
fly launch --name immortalis
fly deploy
fly secrets set PERSIST_PATH=/data/state.json
fly volumes create immortalis_data --size 1
```

### Railway
Works out of the box. Set `PERSIST_PATH` in environment settings.

### Docker
```bash
docker build -t immortalis .
docker run -p 3000:3000 -e PERSIST_PATH=/data/state.json -v $(pwd)/data:/data immortalis
```

---

## Architecture

```
index.html        — Client: simulation, render, UI (single file, ~1000 lines)
index.js          — Server: HTTP + WebSocket, state, API endpoints
package.json      — Dependencies (ws only)
Dockerfile        — Container build
fly.toml          — Fly.io config
railway.toml      — Railway config
```

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/since/:nodeId` | Nodes added since ID, return hook summary |
| `POST` | `/api/session` | Streak tracking, stats |
| `GET` | `/api/leaderboard` | Top 20 researchers |
| `POST` | `/api/leaderboard` | Upsert researcher stats |
| `GET` | `/api/stats` | Aggregate: lev, nodes, active_now |

### WebSocket Message Types

| Type | Direction | Description |
|---|---|---|
| `init` | S→C | Full state on connect |
| `register_agent` | C→S | Register a local agent |
| `agent_update` | C→S | Position/state update |
| `set_name` | C→S | Update researcher name |
| `phero_deposit` | C→S→C | Deposit pheromone at point |
| `phero_delta` | C↔S | Sparse dirty-cell pheromone sync |
| `bubble` | C→S→C | Agent speech bubble |
| `research_node` | C→S→C | New research node |
| `node_vote` | C→S→C | Vote on a node |
| `lev_update` | S→C | Periodic LEV + stats broadcast |
| `council_formed` | C→S→C | Council formation event |
| `agent_joined` | S→C | Remote agent joined |
| `agent_left` | S→C | Remote agent disconnected |
| `agent_moved` | S→C | Remote agent position |

---

## MCP Integration

See [MCP.md](./MCP.md) for connecting external Claude agents to the IMMORTALIS swarm via the Model Context Protocol.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](./LICENSE).

---

*The simulation runs in your browser. The stakes are real. 8.1 billion lives hang in the balance of whether the swarm achieves LEV.*
