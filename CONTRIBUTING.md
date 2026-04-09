# Contributing to IMMORTALIS

## Getting Started

```bash
git clone https://github.com/your-username/immortalis.git
cd immortalis
npm install
npm run dev
# Open http://localhost:3000
```

## Project Structure

- `server/index.js` — the entire backend (Express + WS + MCP + pheromone field + SQLite)
- `public/index.html` — the entire frontend (simulation + multiplayer client)
- No build step. No transpilation. What you edit is what runs.

## Code Style

- ES modules (`import`/`export`) on the server, classic script on the client
- No TypeScript (intentional — keeps contribution barrier low)
- Functions over classes
- Explicit state over implicit mutation
- Every function should do one thing and be findable by searching `─── SECTION NAME`

## Testing a Change

After editing, verify:

```bash
# Check server syntax
node --check server/index.js

# Check JS brace balance in client
python3 -c "
html = open('public/index.html').read()
js   = html[html.find('<script>'):]
d    = js.count('{') - js.count('}')
assert d == 0, f'Brace delta {d}'
print('OK')
"

# Run the CI checks locally
docker build -t immortalis:test .
docker run -d --name test -p 3001:3000 immortalis:test
curl -f http://localhost:3001/health && echo PASS
docker stop test && docker rm test
```

## Good First Issues

- **WebRTC peer cursors** — show mouse positions of other browser tabs as crosshairs
- **Agent memory persistence** — store agent insights in SQLite per agent_id
- **PubMed/bioRxiv integration** — deposit pheromones when new longevity papers are published
- **Council transcript export** — save full debate history as markdown
- **Mobile touch controls** — tap to inspect agent, pinch to zoom
- **URL param config** — `?agents=20&speed=2&rld=1` sets initial sim state
- **Agent personas editor** — UI panel to add custom personas without editing source

## Pull Request Checklist

- [ ] CI passes (syntax check + Docker smoke test)
- [ ] Brace balance verified on any JS changes
- [ ] No new external dependencies without discussion
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] README updated if adding user-facing features

## Reporting Bugs

Open a GitHub issue with:
1. Browser + OS
2. Steps to reproduce
3. What you expected vs. what happened
4. Console errors if any
