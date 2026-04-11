/**
 * TOOLS_API.js — IMMORTALIS v5.0
 * Drop-in tools dispatcher for index.js
 *
 * Provides: pubmed_search, arxiv_search, fetch_abstract, clinicaltrials_search
 * All sources are free, no API key required.
 * Responses are cached for 15 minutes to avoid hammering external APIs.
 *
 * USAGE — add to index.js HTTP handler:
 *
 *   const { handleToolsEndpoint, handleWsToolCall } = require('./TOOLS_API');
 *
 *   // In HTTP request handler:
 *   if (req.method === 'OPTIONS') {
 *     res.writeHead(204, {
 *       'Access-Control-Allow-Origin': '*',
 *       'Access-Control-Allow-Headers': 'Content-Type',
 *       'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
 *     });
 *     res.end(); return;
 *   }
 *   if (req.method === 'POST' && pathname === '/api/tools') {
 *     handleToolsEndpoint(req, res); return;
 *   }
 *
 *   // In WebSocket message handler:
 *   if (data.type === 'tool_call') {
 *     handleWsToolCall(ws, data); return;
 *   }
 */

const https = require('https');

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, ts: Date.now() });
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'IMMORTALIS/5.0 longevity-research-swarm' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Tools ────────────────────────────────────────────────────────────────────

/**
 * pubmed_search
 * Search PubMed via NCBI E-utilities. Returns up to max_results papers sorted by date.
 */
async function pubmed_search({ query, max_results = 5 }) {
  if (!query) throw new Error('query is required');
  const cacheKey = `pubmed:${query}:${max_results}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${max_results}&sort=date&retmode=json`;
  const searchBody = await fetchUrl(searchUrl);
  const searchData = JSON.parse(searchBody);
  const ids = searchData.esearchresult?.idlist || [];

  if (ids.length === 0) return cacheSet(cacheKey, []) || [];

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
  const summaryBody = await fetchUrl(summaryUrl);
  const summaryData = JSON.parse(summaryBody);
  const result = summaryData.result || {};

  const papers = ids.map(id => {
    const paper = result[id] || {};
    return {
      pmid: id,
      title: paper.title || 'Unknown title',
      authors: (paper.authors || []).map(a => a.name).slice(0, 3).join(', '),
      journal: paper.fulljournalname || paper.source || '',
      pubdate: paper.pubdate || '',
      doi: paper.elocationid || '',
    };
  }).filter(p => p.title !== 'Unknown title');

  cacheSet(cacheKey, papers);
  return papers;
}

/**
 * fetch_abstract
 * Fetch full abstract text for a PubMed paper by PMID.
 */
async function fetch_abstract({ pmid }) {
  if (!pmid) throw new Error('pmid is required');
  const cacheKey = `abstract:${pmid}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text`;
  const text = await fetchUrl(url);
  const trimmed = text.trim();
  cacheSet(cacheKey, trimmed);
  return trimmed;
}

/**
 * arxiv_search
 * Search arXiv preprints. Returns up to max_results recent papers.
 */
async function arxiv_search({ query, max_results = 5 }) {
  if (!query) throw new Error('query is required');
  const cacheKey = `arxiv:${query}:${max_results}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${max_results}&sortBy=submittedDate&sortOrder=descending`;
  const xml = await fetchUrl(url);

  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const id = (entry.match(/<id>(.*?)<\/id>/) || [])[1] || '';
    const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s+/g, ' ').trim() || '';
    const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/\s+/g, ' ').trim() || '';
    const published = (entry.match(/<published>(.*?)<\/published>/) || [])[1] || '';
    const authorMatches = [...entry.matchAll(/<name>(.*?)<\/name>/g)].map(m => m[1]);
    entries.push({
      arxiv_id: id.replace('http://arxiv.org/abs/', ''),
      title,
      authors: authorMatches.slice(0, 3).join(', '),
      published: published.slice(0, 10),
      abstract: summary.slice(0, 500) + (summary.length > 500 ? '...' : ''),
      url: id,
    });
  }

  cacheSet(cacheKey, entries);
  return entries;
}

/**
 * clinicaltrials_search
 * Search ClinicalTrials.gov for active longevity trials.
 */
async function clinicaltrials_search({ query, max_results = 5 }) {
  if (!query) throw new Error('query is required');
  const cacheKey = `trials:${query}:${max_results}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://clinicaltrials.gov/api/query/full_studies?expr=${encodeURIComponent(query)}&min_rnk=1&max_rnk=${max_results}&fmt=json`;
  const body = await fetchUrl(url);
  const data = JSON.parse(body);
  const studies = data.FullStudiesResponse?.FullStudies || [];

  const results = studies.map(s => {
    const study = s.Study || {};
    const proto = study.ProtocolSection || {};
    const id = proto.IdentificationModule || {};
    const status = proto.StatusModule || {};
    const design = proto.DesignModule || {};
    return {
      nct_id: id.NCTId || '',
      title: id.BriefTitle || '',
      status: status.OverallStatus || '',
      phase: (design.PhaseList?.Phase || []).join(', '),
      start_date: status.StartDateStruct?.StartDate || '',
      url: `https://clinicaltrials.gov/study/${id.NCTId}`,
    };
  });

  cacheSet(cacheKey, results);
  return results;
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

const TOOLS = { pubmed_search, fetch_abstract, arxiv_search, clinicaltrials_search };

async function dispatchTool(tool, args) {
  const fn = TOOLS[tool];
  if (!fn) throw new Error(`Unknown tool: ${tool}. Available: ${Object.keys(TOOLS).join(', ')}`);
  return await fn(args || {});
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

function handleToolsEndpoint(req, res) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { tool, args } = JSON.parse(body);
      const result = await dispatchTool(tool, args);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ ok: true, tool, result }));
    } catch (err) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

// ─── WebSocket handler ────────────────────────────────────────────────────────

function handleWsToolCall(ws, data) {
  const { request_id, tool, args } = data;
  dispatchTool(tool, args)
    .then(result => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'tool_result', request_id, ok: true, tool, result }));
      }
    })
    .catch(err => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'tool_result', request_id, ok: false, error: err.message }));
      }
    });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { handleToolsEndpoint, handleWsToolCall, dispatchTool, TOOLS };
