# Changelog

## [3.0.0] — 2026-04-09  The Anti-Doomscroll

### Added — Anti-doomscroll upgrades
- **Named legacy** — every research node permanently records author name + avatar color. Agents with authored nodes get a gold outline ring. Your contribution is attributed forever.
- **Streak system** — server tracks consecutive-day visits per session. Fire badge (🔥) with day count shown in LEV panel. Streak resets if you skip a day.
- **Return hook** — on return visit, `GET /api/since/:lastId` tells you exactly what the swarm discovered while you were away. Toast shows "X breakthroughs happened. You were missed."
- **Share cards** — every breakthrough generates a one-click shareable text card with LEV snapshot and link. Individual research nodes have a `↗ SHARE` button. Share button in controls panel.
- **Lives-saved counter** — running estimate of lives protected: `LEV% × 8.1B`. Shown in header chip, LEV panel, and breakthrough overlay. Makes stakes visceral and personal.
- **Web Audio soundscape** — procedural audio via Web Audio API: short blip on insight events, low drone on council formation, ascending chord on breakthrough. Toggle on/off. Off by default (no autoplay).
- **Social proof** — `active_now` counter from server shows how many researchers are here right now. Displayed in header.
- **Contribution proof** — nodes authored count shown per agent in roster. Gold number creates visible legacy.
- **`GET /api/since/:id`** — return hook endpoint returning nodes since last visit + summary string
- **`GET /api/card/:id`** — share card endpoint with OG meta, share_text, author attribution
- **`GET /api/stats`** — global stats: lev, nodes, agents, councils, active_now, lives_protected
- **`POST /api/session`** — session/streak upsert with streak_days tracking
- **`lev_update` WS event** — server broadcasts LEV changes to all clients in real time
- **Global LEV authority** — server maintains canonical LEV value, persisted in SQLite. Clients receive authoritative value on connect and on every research node.
- **`author_color` on nodes** — research tree records and displays avatar color as colored dot next to author name

### Fixed
- LEV value now server-authoritative and persisted — survives server restarts
- `lev_at` column in SQLite records LEV snapshot at time of each node insertion
- Session `nodes_authored` count tracked server-side for MCP agents
- MCP `speak_in_council` now returns `lives_protected` estimate in response

## [2.0.0] — 2026-04-09  Multiplayer + MCP
- WebSocket multiplayer sync across all browser tabs
- MCP endpoint `/mcp` (JSON-RPC 2.0) with 8 tools
- SQLite persistence (research_tree, events)
- Server-authoritative pheromone field
- Diamond-shaped MCP agent avatars
- CI pipeline, Dockerfile, deploy configs
- All monkey-patching removed — clean single-declaration architecture

## [1.0.0] — 2026-04-08  Initial Release
- Single-file browser simulation
- 12 agent personas, pheromone field, council system
- Claude API debates with local fallback
- Red Light District skin
