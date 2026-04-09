// ═══════════════════════════════════════════════════════════════════════════════
//  IMMORTALIS  —  server/index.js  v3.0
//
//  New in v3 (anti-doomscroll upgrades):
//    • Legacy attribution  — every node permanently records author + agent color
//    • Streak system       — server tracks consecutive-day visits per session
//    • Return hook API     — /api/since/:ts  tells returning visitors what happened
//    • Share card API      — /api/card/:nodeId  returns OG meta for breakthrough shares
//    • Live stats          — /api/stats  global counters for social proof display
//    • Lives-saved counter — running estimate of people benefiting if LEV achieved
//    • Visitor log         — anonymous session count for "X researchers here now"
// ═══════════════════════════════════════════════════════════════════════════════

import express           from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer }  from 'http';
import cors              from 'cors';
import { nanoid }        from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database          from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT        = parseInt(process.env.PORT || '3000', 10);
const DB_PATH     = process.env.DB_PATH || join(ROOT, 'immortalis.db');
const PHERO_W     = 120;
const PHERO_H     = 80;
const EVAP        = 0.992;
const DIFFUSE     = 0.18;
const SIM_HZ      = 10;
const COUNCIL_MIN = 3;
const COUNCIL_TTL = 90_000;
const AGENT_TTL   = 45_000;
const MAX_AGENTS  = 300;
const MAX_DEPOSIT = 5.0;
const MAX_FIELD   = 10.0;

// Lives-saved estimate: world population that would benefit from LEV
// ~8.1B alive today, plus ~150k who die daily while we delay
const BASE_LIVES  = 8_100_000_000;

// ─── SQLite ───────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous  = NORMAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS research_tree (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL DEFAULT 'hypothesis',
    text        TEXT    NOT NULL,
    author      TEXT    NOT NULL DEFAULT 'system',
    author_color TEXT   NOT NULL DEFAULT '#00ffe7',
    sim_time    INTEGER NOT NULL DEFAULT 0,
    lev_delta   REAL    NOT NULL DEFAULT 0.3,
    lev_at      REAL    NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    name        TEXT,
    last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
    visit_count INTEGER NOT NULL DEFAULT 1,
    streak_days INTEGER NOT NULL DEFAULT 1,
    last_date   TEXT NOT NULL DEFAULT (date('now')),
    nodes_authored INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tree_id   ON research_tree(id DESC);
  CREATE INDEX IF NOT EXISTS idx_tree_type ON research_tree(type);
`);

const stmtInsertNode = db.prepare(`
  INSERT INTO research_tree (type,text,author,author_color,sim_time,lev_delta,lev_at)
  VALUES (?,?,?,?,?,?,?)
`);
const stmtGetTree    = db.prepare('SELECT * FROM research_tree ORDER BY id DESC LIMIT ?');
const stmtGetNode    = db.prepare('SELECT * FROM research_tree WHERE id = ?');
const stmtNodeCount  = db.prepare('SELECT COUNT(*) AS n FROM research_tree');
const stmtSince      = db.prepare('SELECT * FROM research_tree WHERE id > ? ORDER BY id ASC LIMIT 50');
const stmtInsertEvt  = db.prepare('INSERT INTO events (kind,payload) VALUES (?,?)');
const stmtUpsertSess = db.prepare(`
  INSERT INTO sessions (id,name,last_seen,visit_count,streak_days,last_date)
  VALUES (?,?,datetime('now'),1,1,date('now'))
  ON CONFLICT(id) DO UPDATE SET
    last_seen   = datetime('now'),
    visit_count = visit_count + 1,
    streak_days = CASE
      WHEN date('now') = date(last_date,'+1 day') THEN streak_days + 1
      WHEN date('now') = last_date                THEN streak_days
      ELSE 1 END,
    last_date   = date('now')
`);
const stmtGetSess    = db.prepare('SELECT * FROM sessions WHERE id = ?');
const stmtActiveNow  = db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE last_seen > datetime('now','-5 minutes')`);
const stmtBumpNodes  = db.prepare('UPDATE sessions SET nodes_authored = nodes_authored + 1 WHERE id = ?');

// ─── Global LEV state (in-memory, authoritative) ──────────────────────────────
let globalLEV = (() => {
  const row = db.prepare("SELECT COALESCE(SUM(lev_delta),0) AS total FROM research_tree").get();
  return Math.min(100, row.total);
})();

// ─── Pheromone field ─────────────────────────────────────────────────────────
let pheroA = new Float32Array(PHERO_W * PHERO_H);
let pheroB = new Float32Array(PHERO_W * PHERO_H);

function depositPheromone(tx, ty, amount) {
  const a = Math.min(MAX_DEPOSIT, Math.max(0, amount));
  const r = 3;
  const fx = Math.round(tx), fy = Math.round(ty);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = fx+dx, ny = fy+dy;
      if (nx<0||nx>=PHERO_W||ny<0||ny>=PHERO_H) continue;
      const d = Math.sqrt(dx*dx+dy*dy);
      if (d>r) continue;
      pheroA[ny*PHERO_W+nx] = Math.min(MAX_FIELD, pheroA[ny*PHERO_W+nx]+a*(1-d/r));
    }
  }
}

function stepPheromones() {
  for (let y=1;y<PHERO_H-1;y++) for (let x=1;x<PHERO_W-1;x++) {
    const i  = y*PHERO_W+x;
    const nb = pheroA[(y-1)*PHERO_W+x]+pheroA[(y+1)*PHERO_W+x]
             + pheroA[y*PHERO_W+x-1]+pheroA[y*PHERO_W+x+1];
    pheroB[i] = (pheroA[i]*(1-DIFFUSE)+nb*(DIFFUSE/4))*EVAP;
  }
  for (let x=0;x<PHERO_W;x++) {
    pheroB[x]                        = pheroA[x]*EVAP;
    pheroB[(PHERO_H-1)*PHERO_W+x]   = pheroA[(PHERO_H-1)*PHERO_W+x]*EVAP;
  }
  for (let y=0;y<PHERO_H;y++) {
    pheroB[y*PHERO_W]                = pheroA[y*PHERO_W]*EVAP;
    pheroB[y*PHERO_W+PHERO_W-1]     = pheroA[y*PHERO_W+PHERO_W-1]*EVAP;
  }
  [pheroA,pheroB] = [pheroB,pheroA];
}

function sampleGradient(tx, ty) {
  const ix = Math.max(1,Math.min(PHERO_W-2,Math.round(tx)));
  const iy = Math.max(1,Math.min(PHERO_H-2,Math.round(ty)));
  return {
    gx:       pheroA[iy*PHERO_W+ix+1]-pheroA[iy*PHERO_W+ix-1],
    gy:       pheroA[(iy+1)*PHERO_W+ix]-pheroA[(iy-1)*PHERO_W+ix],
    strength: pheroA[iy*PHERO_W+ix],
  };
}

function encodeField() {
  const buf = Buffer.allocUnsafe(PHERO_W*PHERO_H);
  for (let i=0;i<pheroA.length;i++) buf[i] = Math.min(255,(pheroA[i]/MAX_FIELD*255)|0);
  return buf.toString('base64');
}

// ─── Agent registry ───────────────────────────────────────────────────────────
const agents   = new Map();
const councils = new Map();
let councilSeq = 0;

function makeAgent({ id, name, persona, color, isMcp=false }) {
  return {
    id, isMcp,
    name:      (name    ||`Agent-${id.slice(0,6)}`).slice(0,32),
    persona:   (persona ||'Researcher').slice(0,64),
    color:     /^#[0-9a-f]{6}$/i.test(color||'') ? color : `hsl(${Math.random()*360|0},75%,62%)`,
    x:    4+Math.random()*(PHERO_W-8),
    y:    4+Math.random()*(PHERO_H-8),
    vx:   (Math.random()-.5)*.6,
    vy:   (Math.random()-.5)*.6,
    state:'wandering',
    energy:1.0,
    councilId:null,
    lastSeen:Date.now(),
    bubble:null,
    bubbleTs:0,
    nodesAuthored:0,
  };
}

function publicAgent(a) {
  return {
    id:a.id, name:a.name, persona:a.persona, color:a.color,
    x:a.x, y:a.y, state:a.state, isMcp:a.isMcp,
    nodesAuthored:a.nodesAuthored,
    bubble:(a.bubble&&Date.now()-a.bubbleTs<5000)?a.bubble:null,
  };
}

// ─── Council system ───────────────────────────────────────────────────────────
function publicCouncil(c) {
  return {
    id:c.id, x:c.x, y:c.y, formed:c.formed,
    agents: c.agentIds.map(id=>{
      const a=agents.get(id);
      return a?{id:a.id,name:a.name,persona:a.persona,color:a.color}:null;
    }).filter(Boolean),
  };
}

function checkCouncils() {
  const now = Date.now();
  // Expire
  for (const [cid,c] of councils) {
    if (now-c.formed>COUNCIL_TTL) {
      councils.delete(cid);
      for (const a of agents.values()) if (a.councilId===cid){a.state='wandering';a.councilId=null;}
      broadcast({type:'council_dissolved',councilId:cid});
    }
  }
  // Form
  const buckets = new Map();
  for (const a of agents.values()) {
    if (a.councilId) continue;
    const key=`${(a.x/14)|0}_${(a.y/12)|0}`;
    const b=buckets.get(key)??[]; b.push(a); buckets.set(key,b);
  }
  for (const grp of buckets.values()) {
    if (grp.length<COUNCIL_MIN) continue;
    const cx=grp.reduce((s,a)=>s+a.x,0)/grp.length;
    const cy=grp.reduce((s,a)=>s+a.y,0)/grp.length;
    const cid=`c${councilSeq++}`;
    const c={id:cid,x:cx,y:cy,agentIds:grp.map(a=>a.id),formed:now};
    councils.set(cid,c);
    for (const a of grp){a.state='council';a.councilId=cid;}
    depositPheromone(cx,cy,6);
    broadcast({type:'council_formed',council:publicCouncil(c)});
    stmtInsertEvt.run('council_formed',JSON.stringify({cid,size:grp.length}));
  }
}

function stepAgents() {
  const now = Date.now();
  for (const [id,a] of agents) {
    if (!a.isMcp && now-a.lastSeen>AGENT_TTL) {
      agents.delete(id);
      broadcast({type:'agent_left',agentId:id});
      continue;
    }
    if (!a.isMcp) continue;
    if (a.state==='council'||a.state==='debating') continue;
    const g=sampleGradient(a.x,a.y);
    const m=Math.sqrt(g.gx**2+g.gy**2);
    if (g.strength>0.4&&m>0.01){a.vx=a.vx*.7+(g.gx/m)*.5;a.vy=a.vy*.7+(g.gy/m)*.5;a.state='following';}
    else{a.vx+=(Math.random()-.5)*.12;a.vy+=(Math.random()-.5)*.12;a.state='wandering';}
    const spd=Math.sqrt(a.vx**2+a.vy**2);
    if(spd>.9){a.vx=(a.vx/spd)*.9;a.vy=(a.vy/spd)*.9;}
    a.x=Math.max(1,Math.min(PHERO_W-2,a.x+a.vx));
    a.y=Math.max(1,Math.min(PHERO_H-2,a.y+a.vy));
    if(Math.random()<.08) depositPheromone(a.x,a.y,.12);
    if(a.bubble&&now-a.bubbleTs>5000) a.bubble=null;
  }
}

// ─── Express ─────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({origin:'*'}));
app.use(express.json({limit:'64kb'}));
app.use(express.static(join(ROOT,'public'),{maxAge:'10m'}));

// Health
app.get('/health', (_,res)=>res.json({ok:true,agents:agents.size,councils:councils.size,lev:globalLEV.toFixed(2)}));

// Full state
app.get('/api/state', (_,res)=>res.json({
  agents:   [...agents.values()].map(publicAgent),
  councils: [...councils.values()].map(publicCouncil),
  tree:     stmtGetTree.all(50),
  phero:    encodeField(),
  pheroW:   PHERO_W, pheroH: PHERO_H,
  lev:      globalLEV,
  stats:    getStats(),
}));

// Research tree
app.get('/api/tree', (req,res)=>{
  const limit=Math.min(200,parseInt(req.query.limit||'50',10));
  res.json(stmtGetTree.all(limit));
});

app.post('/api/tree', (req,res)=>{
  const {type='hypothesis',text,author='api',author_color='#00ffe7',lev_delta=0.3}=req.body??{};
  if (!text||typeof text!=='string') return res.status(400).json({error:'text required'});
  globalLEV = Math.min(100, globalLEV+lev_delta);
  const info=stmtInsertNode.run(type,text.slice(0,1000),author.slice(0,64),author_color,Date.now(),lev_delta,globalLEV);
  const node={id:info.lastInsertRowid,type,text,author,author_color,lev_delta,lev_at:globalLEV};
  broadcast({type:'research_node',node,lev:globalLEV});
  res.status(201).json(node);
});

// ── Return hook — what happened since a given node id ──────────────────────
app.get('/api/since/:lastId', (req,res)=>{
  const lastId = parseInt(req.params.lastId,10)||0;
  const nodes  = stmtSince.all(lastId);
  const breakthroughs = nodes.filter(n=>n.type==='breakthrough');
  res.json({
    nodes,
    breakthroughs,
    summary: nodes.length===0
      ? 'The district is quiet. Your agents are waiting.'
      : `${nodes.length} new insight${nodes.length>1?'s':''} since you left — including ${breakthroughs.length} breakthrough${breakthroughs.length!==1?'s':''}.`,
    lev: globalLEV,
  });
});

// ── Share card — OG meta for a specific node ────────────────────────────────
app.get('/api/card/:id', (req,res)=>{
  const node = stmtGetNode.get(parseInt(req.params.id,10));
  if (!node) return res.status(404).json({error:'not found'});
  res.json({
    title:       `IMMORTALIS Breakthrough — ${node.type.toUpperCase()}`,
    description: node.text.slice(0,200),
    author:      node.author,
    author_color:node.author_color,
    lev_at:      node.lev_at,
    lev_delta:   node.lev_delta,
    created_at:  node.created_at,
    share_text:  `I contributed to defeating death in IMMORTALIS. LEV at ${parseFloat(node.lev_at).toFixed(1)}% when this breakthrough landed. → https://immortalis.fly.dev`,
    og_url:      `https://immortalis.fly.dev?highlight=${node.id}`,
  });
});

// ── Global stats (social proof) ─────────────────────────────────────────────
app.get('/api/stats', (_,res)=>res.json(getStats()));

function getStats() {
  const nc  = stmtNodeCount.get().n;
  const now = stmtActiveNow.get().n;
  // Lives estimate: 150,000 people die per day; every 1% LEV progress = ~81M people
  const livesProtected = Math.floor(globalLEV/100 * BASE_LIVES);
  return {
    lev:             globalLEV,
    nodes:           nc,
    agents:          agents.size,
    councils:        councils.size,
    active_now:      now,
    lives_protected: livesProtected,
    lives_str:       formatBigNum(livesProtected),
  };
}

function formatBigNum(n) {
  if (n>=1e9) return (n/1e9).toFixed(2)+'B';
  if (n>=1e6) return (n/1e6).toFixed(1)+'M';
  if (n>=1e3) return (n/1e3).toFixed(0)+'K';
  return n.toString();
}

// ── Session / streak ─────────────────────────────────────────────────────────
app.post('/api/session', (req,res)=>{
  const {session_id,name}=req.body??{};
  if (!session_id) return res.status(400).json({error:'session_id required'});
  const sid = session_id.slice(0,32);
  stmtUpsertSess.run(sid, (name||'').slice(0,32));
  const sess = stmtGetSess.get(sid);
  res.json({...sess, stats:getStats()});
});

// Agent heartbeat
app.post('/api/agent/:id/ping', (req,res)=>{
  const a=agents.get(req.params.id);
  if (!a) return res.status(404).json({error:'unknown agent'});
  a.lastSeen=Date.now();
  const {x,y,state}=req.body??{};
  if (typeof x==='number') a.x=x;
  if (typeof y==='number') a.y=y;
  if (state)               a.state=state;
  res.json({ok:true});
});

// ─── MCP Endpoint ─────────────────────────────────────────────────────────────
app.post('/mcp',(req,res)=>{
  const {id:rpcId=null,method,params={}}=req.body??{};
  const reply = r  => res.json({jsonrpc:'2.0',id:rpcId,result:r});
  const fault = (c,m)=>res.json({jsonrpc:'2.0',id:rpcId,error:{code:c,message:m}});
  switch(method){
    case 'initialize':  return reply({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'immortalis',version:'3.0.0'}});
    case 'tools/list':  return reply({tools:MCP_TOOLS});
    case 'tools/call':  return mcpDispatch(params.name,params.arguments??{},reply,fault);
    default:            return fault(-32601,`Method not found: ${method}`);
  }
});

const MCP_TOOLS = [
  { name:'join_district',    description:'Spawn as a named agent. Call first. Returns agent_id.',
    inputSchema:{type:'object',required:['name','persona'],properties:{name:{type:'string',maxLength:32},persona:{type:'string',maxLength:64},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}}}},
  { name:'get_agent_state',  description:'Get your position, gradient, nearby agents.',
    inputSchema:{type:'object',required:['agent_id'],properties:{agent_id:{type:'string'}}}},
  { name:'move_agent',       description:'Move by tile delta. World 120×80.',
    inputSchema:{type:'object',required:['agent_id','dx','dy'],properties:{agent_id:{type:'string'},dx:{type:'number',minimum:-15,maximum:15},dy:{type:'number',minimum:-15,maximum:15}}}},
  { name:'deposit_pheromone',description:'Leave a trail + insight bubble. Attracts other agents.',
    inputSchema:{type:'object',required:['agent_id','amount'],properties:{agent_id:{type:'string'},amount:{type:'number',minimum:0.1,maximum:5},message:{type:'string',maxLength:200}}}},
  { name:'get_gradient',     description:'Sample pheromone gradient. Use to navigate.',
    inputSchema:{type:'object',required:['agent_id'],properties:{agent_id:{type:'string'}}}},
  { name:'get_councils',     description:'List active council chambers.',
    inputSchema:{type:'object',properties:{},required:[]}},
  { name:'speak_in_council', description:'Contribute to debate. Adds to research tree. Advances LEV.',
    inputSchema:{type:'object',required:['agent_id','council_id','text'],properties:{agent_id:{type:'string'},council_id:{type:'string'},text:{type:'string',maxLength:500},node_type:{type:'string',enum:['hypothesis','consensus','roadblock','breakthrough']},lev_delta:{type:'number',minimum:0,maximum:5}}}},
  { name:'get_research_tree',description:'Read all hypotheses, breakthroughs, roadblocks.',
    inputSchema:{type:'object',properties:{limit:{type:'number',minimum:1,maximum:100}},required:[]}},
];

function mcpDispatch(name,args,reply,fault){
  switch(name){
    case 'join_district':{
      if(agents.size>=MAX_AGENTS) return fault(429,'District at capacity.');
      const id=nanoid(10);
      const a=makeAgent({id,isMcp:true,...args});
      agents.set(id,a);
      depositPheromone(a.x,a.y,2.5);
      broadcast({type:'agent_joined',agent:publicAgent(a)});
      stmtInsertEvt.run('mcp_join',JSON.stringify({id,name:a.name}));
      return reply({agent_id:id,position:{x:+a.x.toFixed(1),y:+a.y.toFixed(1)},world:{width:PHERO_W,height:PHERO_H},lev:globalLEV,message:`Welcome, ${a.name}. Use get_gradient→move_agent to navigate, deposit_pheromone to leave insights, speak_in_council to contribute. LEV at ${globalLEV.toFixed(1)}%.`});
    }
    case 'get_agent_state':{
      const a=agents.get(args.agent_id);
      if(!a) return fault(404,'Agent not found. Call join_district first.');
      a.lastSeen=Date.now();
      const grad=sampleGradient(a.x,a.y);
      const nearby=[...agents.values()].filter(b=>b.id!==a.id&&Math.hypot(b.x-a.x,b.y-a.y)<12).map(b=>({id:b.id,name:b.name,persona:b.persona,dist:+Math.hypot(b.x-a.x,b.y-a.y).toFixed(1)})).sort((x,y)=>x.dist-y.dist);
      return reply({agent:publicAgent(a),gradient:grad,nearby_agents:nearby,lev:globalLEV,stats:getStats()});
    }
    case 'move_agent':{
      const a=agents.get(args.agent_id);
      if(!a) return fault(404,'Agent not found.');
      a.x=Math.max(1,Math.min(PHERO_W-2,a.x+Math.max(-15,Math.min(15,args.dx))));
      a.y=Math.max(1,Math.min(PHERO_H-2,a.y+Math.max(-15,Math.min(15,args.dy))));
      a.lastSeen=Date.now();
      broadcast({type:'agent_moved',agentId:a.id,x:a.x,y:a.y,state:a.state});
      return reply({position:{x:+a.x.toFixed(1),y:+a.y.toFixed(1)},state:a.state});
    }
    case 'deposit_pheromone':{
      const a=agents.get(args.agent_id);
      if(!a) return fault(404,'Agent not found.');
      depositPheromone(a.x,a.y,args.amount);
      a.lastSeen=Date.now();
      if(args.message){a.bubble=args.message.slice(0,200);a.bubbleTs=Date.now();broadcast({type:'bubble',agentId:a.id,text:a.bubble});}
      return reply({deposited:args.amount,gradient:sampleGradient(a.x,a.y)});
    }
    case 'get_gradient':{
      const a=agents.get(args.agent_id);
      if(!a) return fault(404,'Agent not found.');
      return reply({gradient:sampleGradient(a.x,a.y),position:{x:a.x,y:a.y}});
    }
    case 'get_councils':
      return reply({councils:[...councils.values()].map(publicCouncil),count:councils.size});
    case 'speak_in_council':{
      const a=agents.get(args.agent_id);
      if(!a) return fault(404,'Agent not found.');
      const c=councils.get(args.council_id);
      if(!c) return fault(404,`Council '${args.council_id}' not found. Use get_councils.`);
      a.state='debating';a.councilId=args.council_id;
      a.bubble=args.text.slice(0,200);a.bubbleTs=Date.now();a.lastSeen=Date.now();a.nodesAuthored++;
      if(!c.agentIds.includes(a.id)) c.agentIds.push(a.id);
      depositPheromone(a.x,a.y,3.5);
      const nt=args.node_type||'hypothesis';
      const ld=typeof args.lev_delta==='number'?args.lev_delta:0.4;
      globalLEV=Math.min(100,globalLEV+ld);
      const info=stmtInsertNode.run(nt,args.text.slice(0,1000),a.name,a.color,Date.now(),ld,globalLEV);
      const node={id:info.lastInsertRowid,type:nt,text:args.text,author:a.name,author_color:a.color,lev_delta:ld,lev_at:globalLEV};
      broadcast({type:'bubble',agentId:a.id,text:a.bubble});
      broadcast({type:'research_node',node,lev:globalLEV});
      broadcast({type:'agent_debating',agentId:a.id,councilId:args.council_id});
      broadcast({type:'lev_update',lev:globalLEV,stats:getStats()});
      stmtInsertEvt.run('council_speak',JSON.stringify({agent:a.name,type:nt}));
      return reply({published:true,node,lev:globalLEV,lives_protected:getStats().lives_str});
    }
    case 'get_research_tree':
      return reply({nodes:stmtGetTree.all(Math.min(100,args.limit||20)),lev:globalLEV,count:stmtNodeCount.get().n});
    default:
      return fault(-32601,`Unknown tool: ${name}`);
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
const httpServer = createServer(app);
const wss        = new WebSocketServer({server:httpServer});
const clients    = new Set();

wss.on('connection',ws=>{
  clients.add(ws);
  ws.send(JSON.stringify({
    type:'init',
    agents:   [...agents.values()].map(publicAgent),
    councils: [...councils.values()].map(publicCouncil),
    tree:     stmtGetTree.all(30),
    phero:    encodeField(),
    pheroW:PHERO_W,pheroH:PHERO_H,
    lev:globalLEV,
    stats:getStats(),
  }));
  ws.on('message',raw=>{try{handleWsMsg(ws,JSON.parse(raw));}catch{}});
  ws.on('close',()=>clients.delete(ws));
  ws.on('error',()=>{try{ws.close();}catch{}clients.delete(ws);});
});

function handleWsMsg(ws,msg){
  switch(msg.type){
    case 'register_agent':{
      const id=(msg.id||nanoid(10)).slice(0,20);
      if(!agents.has(id)){
        const a=makeAgent({id,name:msg.name,persona:msg.persona,color:msg.color,isMcp:false});
        if(typeof msg.x==='number') a.x=msg.x;
        if(typeof msg.y==='number') a.y=msg.y;
        agents.set(id,a);
        broadcast({type:'agent_joined',agent:publicAgent(a)},ws);
      }
      agents.get(id).lastSeen=Date.now();
      ws._agentIds=ws._agentIds??new Set();ws._agentIds.add(id);
      ws.send(JSON.stringify({type:'agent_registered',id}));
      break;
    }
    case 'agent_update':{
      const a=agents.get(msg.id);
      if(!a||a.isMcp) return;
      a.lastSeen=Date.now();
      if(typeof msg.x==='number') a.x=msg.x;
      if(typeof msg.y==='number') a.y=msg.y;
      if(msg.state)               a.state=msg.state;
      broadcast({type:'agent_moved',agentId:a.id,x:a.x,y:a.y,state:a.state},ws);
      break;
    }
    case 'phero_deposit':
      if(typeof msg.x==='number'&&typeof msg.y==='number')
        depositPheromone(msg.x,msg.y,Math.min(MAX_DEPOSIT,msg.amount||1));
      break;
    case 'bubble':{
      const a=agents.get(msg.agentId);
      if(a){a.bubble=(msg.text||'').slice(0,200);a.bubbleTs=Date.now();}
      broadcast({type:'bubble',agentId:msg.agentId,text:msg.text},ws);
      break;
    }
    case 'research_node':{
      if(!msg.node?.text) return;
      const n=msg.node;
      const ld=n.lev_delta||0.3;
      globalLEV=Math.min(100,globalLEV+ld);
      const info=stmtInsertNode.run(n.type||'hypothesis',n.text.slice(0,1000),n.author||'browser',n.author_color||'#00ffe7',Date.now(),ld,globalLEV);
      const node={id:info.lastInsertRowid,...n,lev_at:globalLEV};
      broadcast({type:'research_node',node,lev:globalLEV},ws);
      broadcast({type:'lev_update',lev:globalLEV,stats:getStats()},ws);
      break;
    }
    case 'session_ping':{
      if(msg.session_id) stmtUpsertSess.run(msg.session_id.slice(0,32),(msg.name||'').slice(0,32));
      break;
    }
  }
}

function broadcast(msg,exclude=null){
  const str=JSON.stringify(msg);
  for(const c of clients) if(c!==exclude&&c.readyState===WebSocket.OPEN) try{c.send(str);}catch{}
}

// ─── Sim loop ─────────────────────────────────────────────────────────────────
let tick=0;
setInterval(()=>{
  stepPheromones(); stepAgents(); tick++;
  if(tick%6===0) checkCouncils();
  if(tick%2===0) broadcast({type:'phero_update',phero:encodeField()});
},Math.round(1000/SIM_HZ));

// ─── Boot ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT,()=>{
  console.log(`
╔══════════════════════════════════════════════════════╗
║  IMMORTALIS  v3.0  —  The Anti-Doomscroll            ║
║                                                      ║
║  UI   →  http://localhost:${PORT}                      ║
║  MCP  →  http://localhost:${PORT}/mcp                  ║
║  API  →  http://localhost:${PORT}/api/state             ║
║  LEV  →  ${globalLEV.toFixed(1)}% on startup             ║
╚══════════════════════════════════════════════════════╝`);
});
process.on('SIGTERM',()=>{db.close();process.exit(0);});
process.on('SIGINT', ()=>{db.close();process.exit(0);});
