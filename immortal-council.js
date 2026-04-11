/**
 * immortal-council.js
 * ─────────────────────────────────────────────────────────────────────────
 * IMMORTALIS v5.0 — IMMORTAL COUNCIL UI + Gating Layer
 *
 * Injects into index.html:
 *   • "Connect $IMMORT" button in header
 *   • Wallet verification flow with tier reveal animation
 *   • Private IMMORTAL COUNCIL sidebar panel (post-verification)
 *   • Live $IMMORT price / market pulse widget
 *   • Holder avatar spawning with boosted pheromones
 *   • Token-gated WebSocket room joining
 *   • Weighted vote integration
 *   • IMMORT-fueled Breakthrough Event triggers
 *
 * Usage: import and call init() after IMMORTALIS init completes.
 *   import { init as initCouncil } from './immortal-council.js';
 *   window.addEventListener('load', () => { init(); initCouncil(); });
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

import {
  connectWallet, disconnectWallet, verifyImmortHolder,
  fetchImmortPrice, startPricePoll,
  getTier, getBalance, isVerified, getPublicKey,
  getVoteMultiplier, getPheroBoost, computeWeightedVote,
  computeLEVBoostFromVolume,
  formatBalance, formatPrice, formatMCap, shortKey,
  onPriceUpdate, onTierChange, TIERS, IMMORT_MINT
} from './immort-token-utils.js';

// ─── Injected CSS ─────────────────────────────────────────────────────────

const COUNCIL_CSS = `
/* ── IMMORT Connect Button ─────────────────────────────────────── */
#immort-connect-btn {
  background: transparent;
  border: 1px solid rgba(245,208,96,0.4);
  color: var(--gold, #f5d060);
  font-family: var(--font-mono, 'DM Mono', monospace);
  font-size: 10px; letter-spacing: 0.08em;
  padding: 4px 12px; cursor: pointer; border-radius: 3px;
  transition: all 0.15s; white-space: nowrap;
  display: flex; align-items: center; gap: 6px;
}
#immort-connect-btn:hover {
  background: rgba(245,208,96,0.1); border-color: var(--gold, #f5d060);
  box-shadow: 0 0 12px rgba(245,208,96,0.25);
}
#immort-connect-btn.connected {
  border-color: var(--teal, #1de9c8); color: var(--teal, #1de9c8);
  background: rgba(29,233,200,0.08);
}
#immort-connect-btn .btn-tier-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}

/* ── Verification Modal ───────────────────────────────────────── */
#immort-verify-modal {
  position: fixed; inset: 0; z-index: 500;
  display: none; align-items: center; justify-content: center;
  background: rgba(4,8,18,0.92); backdrop-filter: blur(10px);
}
#immort-verify-modal.on { display: flex; animation: vFadeIn 0.3s ease; }
@keyframes vFadeIn { from{opacity:0} to{opacity:1} }

#immort-verify-card {
  background: #0d1526; border: 1px solid rgba(245,208,96,0.3);
  border-radius: 14px; padding: 36px 40px; max-width: 420px; width: 100%;
  text-align: center; box-shadow: 0 0 60px rgba(245,208,96,0.08), 0 24px 64px rgba(0,0,0,0.7);
}
#immort-verify-card .vc-eyebrow {
  font-family: var(--font-sans, 'Syne', sans-serif);
  font-size: 9px; font-weight: 700; letter-spacing: 0.35em;
  text-transform: uppercase; color: var(--gold, #f5d060); margin-bottom: 14px;
}
#immort-verify-card h2 {
  font-family: var(--font-serif, 'DM Serif Display', serif);
  font-size: 26px; color: #e8edf5; margin-bottom: 8px; line-height: 1.2;
}
#immort-verify-card p {
  font-family: var(--font-mono, monospace); font-size: 11px; color: #7a90b0;
  line-height: 1.65; margin-bottom: 24px;
}
.vc-wallets { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.vc-wallet-btn {
  display: flex; align-items: center; gap: 10px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(100,140,200,0.12);
  border-radius: 6px; padding: 10px 14px; cursor: pointer;
  font-family: var(--font-mono, monospace); font-size: 11px; color: #b8c6dd;
  transition: all 0.15s; text-align: left;
}
.vc-wallet-btn:hover { border-color: var(--teal, #1de9c8); color: #e8edf5; background: rgba(29,233,200,0.06); }
.vc-wallet-btn .wallet-icon { font-size: 18px; width: 28px; text-align: center; }
.vc-wallet-btn .wallet-label { flex: 1; font-weight: 500; }
.vc-wallet-btn .wallet-status { font-size: 9px; color: #4a5f80; text-transform: uppercase; letter-spacing: 0.1em; }
.vc-wallet-btn.detected .wallet-status { color: var(--green, #3de87e); }
.vc-skip { font-size: 10px; color: #4a5f80; cursor: pointer; margin-top: 8px; display: block; }
.vc-skip:hover { color: #7a90b0; }
#vc-error { font-size: 11px; color: var(--red, #e84040); margin-top: 10px; display: none; }

/* ── Tier Reveal Animation ────────────────────────────────────── */
#immort-tier-reveal {
  position: fixed; inset: 0; z-index: 600;
  display: none; align-items: center; justify-content: center;
  background: rgba(4,8,18,0.92); backdrop-filter: blur(12px);
}
#immort-tier-reveal.on { display: flex; animation: vFadeIn 0.4s ease; }
#tier-reveal-card {
  text-align: center; padding: 40px;
}
#tier-reveal-icon { font-size: 64px; margin-bottom: 16px; animation: tierPop 0.6s cubic-bezier(0.34,1.56,0.64,1) both; }
@keyframes tierPop { from{transform:scale(0) rotate(-20deg);opacity:0} to{transform:scale(1) rotate(0);opacity:1} }
#tier-reveal-name {
  font-family: var(--font-serif, 'DM Serif Display', serif);
  font-size: 36px; margin-bottom: 8px; animation: tierSlide 0.5s 0.2s ease both;
}
@keyframes tierSlide { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
#tier-reveal-balance {
  font-family: var(--font-mono, monospace); font-size: 13px; color: #7a90b0;
  margin-bottom: 6px; animation: tierSlide 0.5s 0.35s ease both;
}
#tier-reveal-perks {
  font-family: var(--font-mono, monospace); font-size: 11px; color: #4a5f80;
  line-height: 1.8; margin-bottom: 24px; animation: tierSlide 0.5s 0.45s ease both;
}
#tier-reveal-perks span { color: #b8c6dd; }
#tier-reveal-cta {
  background: transparent; border: 1px solid rgba(245,208,96,0.4); color: #f5d060;
  font-family: var(--font-mono, monospace); font-size: 12px; letter-spacing: 0.1em;
  padding: 10px 28px; cursor: pointer; border-radius: 4px;
  animation: tierSlide 0.5s 0.55s ease both;
  transition: all 0.15s;
}
#tier-reveal-cta:hover { background: rgba(245,208,96,0.1); }

/* ── IMMORTAL COUNCIL Sidebar Panel ──────────────────────────── */
#council-panel {
  width: 280px; flex-shrink: 0;
  border-left: 1px solid rgba(245,208,96,0.15);
  background: rgba(13,21,38,0.97);
  display: none; flex-direction: column; overflow: hidden;
  transition: transform 0.3s ease;
  position: relative;
}
#council-panel.open { display: flex; }
.cp-header {
  padding: 14px 16px 10px; border-bottom: 1px solid rgba(245,208,96,0.1); flex-shrink: 0;
}
.cp-eyebrow {
  font-family: var(--font-sans, 'Syne', sans-serif); font-size: 8px; font-weight: 700;
  letter-spacing: 0.3em; text-transform: uppercase; color: #f5d060; margin-bottom: 4px;
}
.cp-title {
  font-family: var(--font-serif, 'DM Serif Display', serif); font-size: 16px; color: #e8edf5;
}
.cp-tier-row {
  display: flex; align-items: center; gap: 8px; margin-top: 8px;
  padding: 6px 10px; background: rgba(245,208,96,0.05); border-radius: 4px;
  border: 1px solid rgba(245,208,96,0.12);
}
.cp-tier-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.cp-tier-name { font-family: var(--font-mono, monospace); font-size: 11px; font-weight: 500; flex: 1; }
.cp-tier-balance { font-family: var(--font-mono, monospace); font-size: 9px; color: #f5d060; }
.cp-wallet { font-family: var(--font-mono, monospace); font-size: 9px; color: #4a5f80; margin-top: 4px; }

/* Price Widget */
.cp-price-widget {
  margin: 0; padding: 12px 16px; border-bottom: 1px solid rgba(100,140,200,0.07); flex-shrink: 0;
}
.cp-price-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.cp-price-val { font-family: var(--font-mono, monospace); font-size: 16px; color: #e8edf5; font-weight: 500; }
.cp-price-change { font-family: var(--font-mono, monospace); font-size: 10px; }
.cp-price-change.up { color: var(--green, #3de87e); }
.cp-price-change.down { color: var(--red, #e84040); }
.cp-price-meta { display: flex; gap: 10px; flex-wrap: wrap; }
.cp-price-stat { font-family: var(--font-mono, monospace); font-size: 9px; }
.cp-price-stat .psl { color: #4a5f80; text-transform: uppercase; letter-spacing: 0.08em; }
.cp-price-stat .psv { color: #7a90b0; }
.cp-dex-link {
  display: block; margin-top: 8px; font-family: var(--font-mono, monospace);
  font-size: 9px; color: #f5d060; text-decoration: none; letter-spacing: 0.08em;
}
.cp-dex-link:hover { color: #f5e88a; }
#immort-lev-pulse {
  height: 3px; background: rgba(245,208,96,0.1); border-radius: 2px; margin-top: 8px; overflow: hidden;
}
#immort-lev-pulse-fill {
  height: 100%; background: linear-gradient(90deg, #c8900a, #f5d060);
  border-radius: 2px; transition: width 1.5s ease; width: 0%;
}

/* Council Rooms */
.cp-section { padding: 10px 16px; border-bottom: 1px solid rgba(100,140,200,0.07); flex-shrink: 0; }
.cp-section-title {
  font-family: var(--font-sans, 'Syne', sans-serif); font-size: 8px; font-weight: 700;
  letter-spacing: 0.25em; text-transform: uppercase; color: #4a5f80; margin-bottom: 8px;
}
.room-btn {
  display: flex; align-items: center; gap: 8px; width: 100%;
  background: rgba(255,255,255,0.02); border: 1px solid rgba(100,140,200,0.1);
  border-radius: 4px; padding: 8px 10px; cursor: pointer; margin-bottom: 5px;
  font-family: var(--font-mono, monospace); font-size: 10px; color: #7a90b0;
  transition: all 0.15s; text-align: left;
}
.room-btn:hover { border-color: var(--teal, #1de9c8); color: #e8edf5; background: rgba(29,233,200,0.04); }
.room-btn.active { border-color: var(--teal, #1de9c8); color: var(--teal, #1de9c8); background: rgba(29,233,200,0.06); }
.room-btn .room-icon { font-size: 14px; flex-shrink: 0; }
.room-btn .room-info { flex: 1; }
.room-btn .room-name { color: #b8c6dd; font-weight: 500; }
.room-btn .room-desc { font-size: 9px; color: #4a5f80; margin-top: 1px; }
.room-btn .room-members { font-size: 9px; color: #3de87e; }
.room-btn.locked { opacity: 0.4; cursor: not-allowed; }

/* Personal Avatar */
.cp-avatar-section { padding: 10px 16px; border-bottom: 1px solid rgba(100,140,200,0.07); flex-shrink: 0; }
.avatar-status {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(100,140,200,0.1);
  border-radius: 4px; font-family: var(--font-mono, monospace); font-size: 10px;
}
.avatar-status .as-dot { width: 7px; height: 7px; border-radius: 50%; animation: asPulse 2s ease infinite; }
@keyframes asPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.avatar-status .as-info { flex: 1; }
.avatar-status .as-name { color: #b8c6dd; font-weight: 500; }
.avatar-status .as-state { font-size: 9px; color: #4a5f80; }
.avatar-spawn-btn {
  width: 100%; margin-top: 8px; background: transparent; border: 1px solid rgba(245,208,96,0.3);
  color: #f5d060; font-family: var(--font-mono, monospace); font-size: 10px; letter-spacing: 0.06em;
  padding: 7px; cursor: pointer; border-radius: 4px; transition: all 0.15s;
}
.avatar-spawn-btn:hover { background: rgba(245,208,96,0.08); border-color: #f5d060; }
.avatar-spawn-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Insights Feed */
#council-insights {
  flex: 1; overflow-y: auto; padding: 8px 16px 12px;
}
.insight-node {
  margin-bottom: 8px; padding: 8px 10px;
  background: rgba(245,208,96,0.03); border: 1px solid rgba(245,208,96,0.12);
  border-left: 2px solid #f5d060; border-radius: 4px;
  font-family: var(--font-mono, monospace); font-size: 10px; line-height: 1.5;
  animation: nodeSlide 0.25s ease;
}
.insight-node .in-label {
  font-family: var(--font-sans, 'Syne', sans-serif); font-size: 8px; font-weight: 700;
  letter-spacing: 0.2em; text-transform: uppercase; color: #f5d060; margin-bottom: 3px;
}
.insight-node .in-body { color: #b8c6dd; }

/* Breakthrough Event Banner */
#immort-breakthrough-banner {
  position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
  display: none; z-index: 400;
  background: #0d1526; border: 1px solid rgba(245,208,96,0.5);
  border-radius: 8px; padding: 12px 20px; text-align: center; max-width: 480px;
  box-shadow: 0 0 40px rgba(245,208,96,0.15); animation: sDown 0.3s ease;
  font-family: var(--font-mono, monospace);
}
#immort-breakthrough-banner.on { display: block; }
.ibb-label { font-family: var(--font-sans, 'Syne', sans-serif); font-size: 9px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; color: #f5d060; margin-bottom: 5px; }
.ibb-text { font-size: 11px; color: #b8c6dd; line-height: 1.5; }
.ibb-close { position: absolute; top: 8px; right: 12px; background: none; border: none; color: #4a5f80; cursor: pointer; font-size: 14px; }

/* Utility */
@keyframes nodeSlide { from{opacity:0;transform:translateX(6px)} to{opacity:1;transform:none} }
@keyframes sDown { from{opacity:0;transform:translateX(-50%) translateY(-8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
`;

// ─── State ────────────────────────────────────────────────────────────────

let _avatarAgent   = null;   // reference to spawned personal agent
let _activeRoom    = null;   // current council room id
let _stopPricePoll = null;
let _swarmWs       = null;   // reference to main WS (injected by main app)
let _mainSpawnN    = null;   // reference to main app's spawnN function
let _mainDepPhero  = null;   // reference to main app's depositPhero
let _mainAddNode   = null;   // reference to main app's addNode
let _mainLevPct    = null;   // getter for current LEV
let _mainTickFn    = null;   // ticker function

// ─── Init ─────────────────────────────────────────────────────────────────

/**
 * Main entry point. Call after IMMORTALIS is initialized.
 *
 * @param {object} opts
 *   opts.wsRef       - reference to WebSocket instance (window.ws or similar)
 *   opts.spawnN      - main app's spawnN(n) function
 *   opts.depositPhero - main app's depositPhero(x, y, amt) function
 *   opts.addNode     - main app's addNode(text, type, author, color, lev, prepend)
 *   opts.getLevPct   - function returning current levPct number
 *   opts.tickFn      - main app's tick(msg) function
 *   opts.netSendFn   - main app's netSend(msg) function
 */
export function init(opts = {}) {
  _swarmWs      = opts.wsRef       ?? null;
  _mainSpawnN   = opts.spawnN      ?? (() => {});
  _mainDepPhero = opts.depositPhero?? (() => {});
  _mainAddNode  = opts.addNode     ?? (() => {});
  _mainLevPct   = opts.getLevPct   ?? (() => 0);
  _mainTickFn   = opts.tickFn      ?? console.log;

  _injectStyles();
  _buildVerifyModal();
  _buildTierReveal();
  _buildCouncilPanel();
  _buildBreakthroughBanner();
  _injectHeaderButton();

  // Register event listeners
  onTierChange(_handleTierChange);
  onPriceUpdate(_handlePriceUpdate);

  // Start price polling
  _stopPricePoll = startPricePoll(30_000);

  console.log('[IMMORT Council] Initialized. Mint:', IMMORT_MINT);
}

// ─── Style injection ──────────────────────────────────────────────────────

function _injectStyles() {
  const style = document.createElement('style');
  style.id    = 'immort-council-styles';
  style.textContent = COUNCIL_CSS;
  document.head.appendChild(style);
}

// ─── Header Button ────────────────────────────────────────────────────────

function _injectHeaderButton() {
  // Find header right section — works with both old and new UI
  const hdrRight = document.getElementById('hdr-right') ?? document.getElementById('chips');
  if (!hdrRight) return;

  const btn = document.createElement('button');
  btn.id = 'immort-connect-btn';
  btn.innerHTML = `<span class="btn-tier-dot" style="background:#4a5f80"></span>$IMMORT`;
  btn.title = 'Connect your Solana wallet to unlock IMMORTAL COUNCIL';
  btn.onclick = () => {
    if (isVerified()) {
      _toggleCouncilPanel();
    } else {
      document.getElementById('immort-verify-modal').classList.add('on');
    }
  };
  hdrRight.insertBefore(btn, hdrRight.firstChild);
}

// ─── Verify Modal ─────────────────────────────────────────────────────────

function _buildVerifyModal() {
  const modal = document.createElement('div');
  modal.id = 'immort-verify-modal';
  modal.innerHTML = `
    <div id="immort-verify-card">
      <div class="vc-eyebrow">⚗ Unlock IMMORTAL COUNCIL</div>
      <h2>Verify Your $IMMORT</h2>
      <p>Connect your Solana wallet to verify holdings and unlock token-gated research chambers, personalized LEV avatars, and weighted hypothesis voting.</p>
      <div class="vc-wallets">
        <button class="vc-wallet-btn" id="vc-btn-phantom" onclick="window.__immort_connect('phantom')">
          <span class="wallet-icon">👻</span>
          <span class="wallet-label">Phantom</span>
          <span class="wallet-status" id="vc-status-phantom">Detecting…</span>
        </button>
        <button class="vc-wallet-btn" id="vc-btn-backpack" onclick="window.__immort_connect('backpack')">
          <span class="wallet-icon">🎒</span>
          <span class="wallet-label">Backpack</span>
          <span class="wallet-status" id="vc-status-backpack">Detecting…</span>
        </button>
        <button class="vc-wallet-btn" id="vc-btn-solflare" onclick="window.__immort_connect('solflare')">
          <span class="wallet-icon">🔥</span>
          <span class="wallet-label">Solflare</span>
          <span class="wallet-status" id="vc-status-solflare">Detecting…</span>
        </button>
      </div>
      <div id="vc-error"></div>
      <span class="vc-skip" onclick="document.getElementById('immort-verify-modal').classList.remove('on')">
        Not now — continue without $IMMORT
      </span>
    </div>`;
  document.body.appendChild(modal);

  // Detect wallets
  setTimeout(() => {
    document.getElementById('vc-status-phantom').textContent  = window.phantom?.solana  ? 'Detected' : 'Not found';
    document.getElementById('vc-status-backpack').textContent  = window.backpack          ? 'Detected' : 'Not found';
    document.getElementById('vc-status-solflare').textContent  = window.solflare          ? 'Detected' : 'Not found';
    ['phantom','backpack','solflare'].forEach(w => {
      const btn = document.getElementById(`vc-btn-${w}`);
      const detected = w === 'phantom' ? window.phantom?.solana :
                       w === 'backpack' ? window.backpack :
                       window.solflare;
      if (detected) btn.classList.add('detected');
    });
  }, 300);

  // Global handler (avoids inline script CSP issues)
  window.__immort_connect = async (preferred) => {
    const errEl = document.getElementById('vc-error');
    errEl.style.display = 'none';
    try {
      await verifyImmortHolder(false); // connect + verify, no sig required for client UI
      document.getElementById('immort-verify-modal').classList.remove('on');
      _showTierReveal();
    } catch (e) {
      errEl.textContent = e.message ?? 'Connection failed. Please try again.';
      errEl.style.display = 'block';
    }
  };
}

// ─── Tier Reveal ──────────────────────────────────────────────────────────

function _buildTierReveal() {
  const reveal = document.createElement('div');
  reveal.id = 'immort-tier-reveal';
  reveal.innerHTML = `
    <div id="tier-reveal-card">
      <div id="tier-reveal-icon">🧬</div>
      <div id="tier-reveal-name">Loading…</div>
      <div id="tier-reveal-balance"></div>
      <div id="tier-reveal-perks"></div>
      <button id="tier-reveal-cta" onclick="window.__immort_tier_cta()">Enter the Council →</button>
    </div>`;
  document.body.appendChild(reveal);
  window.__immort_tier_cta = () => {
    document.getElementById('immort-tier-reveal').classList.remove('on');
    _openCouncilPanel();
  };
}

function _showTierReveal() {
  const tier    = getTier();
  const balance = getBalance();
  const icons   = { initiate: '🔬', elder: '⚗', overlord: '🧫', sovereign: '👑' };
  const perksMap = {
    initiate:  ['Standard research access', 'Public tree contributions'],
    elder:     ['<span>1.5× vote weight</span>', '<span>1.5× pheromone boost</span>', 'Elder Council room'],
    overlord:  ['<span>3× vote weight</span>', '<span>2.5× pheromone boost</span>', 'Overlord chamber', 'Priority debate queue'],
    sovereign: ['<span>7.5× vote weight</span>', '<span>5× pheromone boost</span>', 'Sovereign chamber', 'Private LEV roadmap', 'IMMORT-fueled Breakthroughs'],
  };
  document.getElementById('tier-reveal-icon').textContent  = icons[tier.id] ?? '🧬';
  document.getElementById('tier-reveal-name').textContent  = tier.label;
  document.getElementById('tier-reveal-name').style.color  = tier.color;
  document.getElementById('tier-reveal-balance').textContent = formatBalance(balance) + ' $IMMORT held';
  document.getElementById('tier-reveal-perks').innerHTML  = (perksMap[tier.id] ?? []).map(p => `• ${p}`).join('<br>');
  document.getElementById('immort-tier-reveal').classList.add('on');
}

// ─── Council Panel ────────────────────────────────────────────────────────

function _buildCouncilPanel() {
  const panel = document.createElement('div');
  panel.id = 'council-panel';
  panel.innerHTML = `
    <!-- Header -->
    <div class="cp-header">
      <div class="cp-eyebrow">⚗ IMMORTAL COUNCIL</div>
      <div class="cp-title">Private Research Chamber</div>
      <div class="cp-tier-row" id="cp-tier-row">
        <div class="cp-tier-dot" id="cp-tier-dot"></div>
        <div class="cp-tier-name" id="cp-tier-name">—</div>
        <div class="cp-tier-balance" id="cp-tier-balance">—</div>
      </div>
      <div class="cp-wallet" id="cp-wallet">Wallet: —</div>
    </div>

    <!-- Price Widget -->
    <div class="cp-price-widget">
      <div class="cp-section-title">$IMMORT Market Pulse</div>
      <div class="cp-price-row">
        <div class="cp-price-val" id="cp-price">$—</div>
        <div class="cp-price-change" id="cp-price-change">—</div>
      </div>
      <div class="cp-price-meta">
        <div class="cp-price-stat"><span class="psl">Vol 24h</span> <span class="psv" id="cp-vol">—</span></div>
        <div class="cp-price-stat"><span class="psl">MCap</span> <span class="psv" id="cp-mcap">—</span></div>
        <div class="cp-price-stat"><span class="psl">Liq</span> <span class="psv" id="cp-liq">—</span></div>
      </div>
      <a class="cp-dex-link" id="cp-dex-link" href="https://dexscreener.com/solana/${IMMORT_MINT}" target="_blank" rel="noopener">
        ↗ View on DexScreener
      </a>
      <div id="immort-lev-pulse"><div id="immort-lev-pulse-fill"></div></div>
    </div>

    <!-- Council Rooms -->
    <div class="cp-section">
      <div class="cp-section-title">Research Chambers</div>
      <button class="room-btn" id="room-elder" onclick="window.__immort_join_room('elder')">
        <span class="room-icon">⚗</span>
        <div class="room-info">
          <div class="room-name">Elder Symposium</div>
          <div class="room-desc">Collaborative hypothesis labs</div>
        </div>
        <span class="room-members" id="room-elder-count">0</span>
      </button>
      <button class="room-btn locked" id="room-overlord" onclick="window.__immort_join_room('overlord')">
        <span class="room-icon">🧫</span>
        <div class="room-info">
          <div class="room-name">Overlord Chamber</div>
          <div class="room-desc">Advanced multi-organ simulation</div>
        </div>
        <span class="room-members" id="room-overlord-count">0</span>
      </button>
      <button class="room-btn locked" id="room-sovereign" onclick="window.__immort_join_room('sovereign')">
        <span class="room-icon">👑</span>
        <div class="room-info">
          <div class="room-name">Sovereign Vault</div>
          <div class="room-desc">Private LEV roadmaps + What-If trees</div>
        </div>
        <span class="room-members" id="room-sovereign-count">0</span>
      </button>
    </div>

    <!-- Personal Avatar -->
    <div class="cp-avatar-section">
      <div class="cp-section-title">Personal Immortal Avatar</div>
      <div class="avatar-status" id="avatar-status">
        <div class="as-dot" id="avatar-dot" style="background:#4a5f80"></div>
        <div class="as-info">
          <div class="as-name" id="avatar-name">No avatar active</div>
          <div class="as-state" id="avatar-state">Spawn to join the swarm permanently</div>
        </div>
      </div>
      <button class="avatar-spawn-btn" id="avatar-spawn-btn" onclick="window.__immort_spawn_avatar()">
        ⚡ Spawn Immortal Avatar
      </button>
    </div>

    <!-- Insights Feed -->
    <div class="cp-section-title" style="padding:10px 16px 4px">Personal LEV Insights</div>
    <div id="council-insights"></div>
  `;
  // Insert before the main panel in #main
  const main = document.getElementById('main') ?? document.body;
  main.appendChild(panel);

  // Room join handler
  window.__immort_join_room = (roomId) => _joinRoom(roomId);
  window.__immort_spawn_avatar = () => _spawnAvatar();
}

function _openCouncilPanel() {
  const panel = document.getElementById('council-panel');
  if (panel) panel.classList.add('open');
  const tier = getTier();
  _updatePanelTierDisplay(tier);
  _updateRoomLocks(tier);
  _updateConnectButton(true);
}

function _toggleCouncilPanel() {
  const panel = document.getElementById('council-panel');
  if (panel) panel.classList.toggle('open');
}

function _updateConnectButton(connected) {
  const btn = document.getElementById('immort-connect-btn');
  if (!btn) return;
  const tier = getTier();
  btn.classList.toggle('connected', connected);
  btn.innerHTML = `<span class="btn-tier-dot" style="background:${tier.color}"></span>` +
    (connected ? tier.label : '$IMMORT');
}

function _updatePanelTierDisplay(tier) {
  const dot  = document.getElementById('cp-tier-dot');
  const name = document.getElementById('cp-tier-name');
  const bal  = document.getElementById('cp-tier-balance');
  const wall = document.getElementById('cp-wallet');
  if (dot)  { dot.style.background = tier.color; }
  if (name) { name.textContent = tier.label; name.style.color = tier.color; }
  if (bal)  bal.textContent = formatBalance(getBalance()) + ' $IMMORT';
  if (wall) wall.textContent = 'Wallet: ' + shortKey(getPublicKey());
}

function _updateRoomLocks(tier) {
  const tierOrder = { initiate: 0, elder: 1, overlord: 2, sovereign: 3 };
  const userLevel = tierOrder[tier.id] ?? 0;
  const rooms = [
    { id: 'room-elder',    required: 1 },
    { id: 'room-overlord', required: 2 },
    { id: 'room-sovereign',required: 3 },
  ];
  rooms.forEach(r => {
    const btn = document.getElementById(r.id);
    if (btn) {
      if (userLevel >= r.required) btn.classList.remove('locked');
      else btn.classList.add('locked');
    }
  });
}

// ─── Room Joining ─────────────────────────────────────────────────────────

function _joinRoom(roomId) {
  const tier = getTier();
  const tierOrder = { initiate: 0, elder: 1, overlord: 2, sovereign: 3 };
  const required  = { elder: 1, overlord: 2, sovereign: 3 };
  if ((tierOrder[tier.id] ?? 0) < (required[roomId] ?? 99)) {
    _addInsight(`🔒 ${roomId} chamber requires higher tier. Hold more $IMMORT to unlock.`);
    return;
  }
  _activeRoom = roomId;
  // Update room button states
  document.querySelectorAll('.room-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`room-${roomId}`);
  if (btn) btn.classList.add('active');
  // Notify WebSocket server (if available)
  _wsCouncilSend({ type: 'join_council_room', room: roomId, tier: tier.id, pubkey: getPublicKey() });
  _addInsight(`⚗ Joined ${roomId} chamber. Token-gated collaboration active.`);
  if (_mainTickFn) _mainTickFn(`⚗ IMMORTAL COUNCIL: ${tier.label} joined the ${roomId} chamber`);
}

// ─── Personal Avatar ──────────────────────────────────────────────────────

function _spawnAvatar() {
  if (_avatarAgent) {
    _addInsight('⚡ Avatar already active in the swarm.');
    return;
  }
  const tier   = getTier();
  const pubkey = getPublicKey();
  if (!pubkey) return;

  // Spawn via main app's spawnN if available, or create a custom persona
  const avatarPersona = {
    name:       shortKey(pubkey),
    role:       `${tier.label} Avatar`,
    color:      tier.color,
    icon:       '⚡',
    specialty:  `Personalized longevity research, powered by $IMMORT. Tier: ${tier.label}`,
    quips:      [
      `$IMMORT-powered longevity compute online. Tier: ${tier.label}.`,
      `Epigenetic clock target: biological age -12y in 24 months.`,
      `Senolytic stack personalized to ApoB + VO2max biomarkers.`,
      `DunedinPACE trajectory: negative slope confirmed.`,
      `OSK reprogramming candidate flagged — uploading to swarm tree.`,
    ],
    isImmortAvatar: true,
    pheroBoost: getPheroBoost(),
  };

  // Inject into global PERSONAS if accessible, or directly into agents array
  if (window.__immortalis_agents && Array.isArray(window.__immortalis_agents)) {
    const agent = {
      id: 'avatar_' + Date.now(),
      persona: avatarPersona,
      x: 20 + Math.random() * 80,
      y: 15 + Math.random() * 50,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      state: 'wandering', energy: 1.0, councilId: null,
      trail: [], bubble: null, bubbleTs: 0,
      insightCd: 6000, insightAcc: 0, celebTs: 0,
      nodesAuthored: 0, memory: [], fatigued: false,
      isImmortAvatar: true,
    };
    window.__immortalis_agents.push(agent);
    _avatarAgent = agent;
  }

  // Update UI
  const dot   = document.getElementById('avatar-dot');
  const name  = document.getElementById('avatar-name');
  const state = document.getElementById('avatar-state');
  const btn   = document.getElementById('avatar-spawn-btn');
  if (dot)   { dot.style.background = tier.color; }
  if (name)  name.textContent = shortKey(pubkey) + ' (You)';
  if (state) state.textContent = `Active · ${tier.label} · ${getPheroBoost()}× pheromones`;
  if (btn)   { btn.textContent = '⚡ Avatar Active'; btn.disabled = true; }

  // Notify server
  _wsCouncilSend({
    type: 'register_agent',
    id:   `immort_${pubkey}`,
    name: shortKey(pubkey),
    persona: avatarPersona.role,
    color: tier.color,
    isImmortAvatar: true,
    tier: tier.id,
    pheroBoost: getPheroBoost(),
  });

  _addInsight(`⚡ Immortal Avatar spawned. ${getPheroBoost()}× pheromone strength active.`);
  if (_mainTickFn) _mainTickFn(`⚡ ${tier.label} avatar joined the swarm — $IMMORT compute active`);
}

// ─── Price Widget Updates ─────────────────────────────────────────────────

function _handlePriceUpdate(data) {
  if (!data) return;
  const priceEl  = document.getElementById('cp-price');
  const changeEl = document.getElementById('cp-price-change');
  const volEl    = document.getElementById('cp-vol');
  const mcapEl   = document.getElementById('cp-mcap');
  const liqEl    = document.getElementById('cp-liq');
  const linkEl   = document.getElementById('cp-dex-link');
  const pulseEl  = document.getElementById('immort-lev-pulse-fill');

  if (priceEl)  priceEl.textContent = formatPrice(data.price);
  if (changeEl) {
    const up = data.priceChange >= 0;
    changeEl.textContent = (up ? '+' : '') + data.priceChange.toFixed(2) + '%';
    changeEl.className   = 'cp-price-change ' + (up ? 'up' : 'down');
  }
  if (volEl)  volEl.textContent  = formatMCap(data.volume24h);
  if (mcapEl) mcapEl.textContent = formatMCap(data.marketCap);
  if (liqEl)  liqEl.textContent  = formatMCap(data.liquidity);
  if (linkEl && data.pairUrl) linkEl.href = data.pairUrl;

  // Volume → LEV pulse bar (visual only, 0–100%)
  if (pulseEl) {
    const pct = Math.min(100, Math.log10(Math.max(1, data.volume24h / 100)) * 20);
    pulseEl.style.width = pct + '%';
  }

  // If 24h volume is significant, trigger a small LEV boost
  const boost = computeLEVBoostFromVolume(data.volume24h);
  if (boost > 0 && typeof window.levPct !== 'undefined') {
    window.levPct = Math.min(100, window.levPct + boost);
    if (typeof window.updateLEV === 'function') window.updateLEV();
    if (boost > 0.1) {
      _showBreakthroughBanner(`$IMMORT volume surge detected — +${boost.toFixed(2)}% LEV boost injected by the market`);
    }
  }
}

function _handleTierChange(tier, balance, pubkey) {
  _updateConnectButton(true);
  _updatePanelTierDisplay(tier);
  _updateRoomLocks(tier);
}

// ─── Breakthrough Banner ──────────────────────────────────────────────────

function _buildBreakthroughBanner() {
  const banner = document.createElement('div');
  banner.id = 'immort-breakthrough-banner';
  banner.innerHTML = `
    <button class="ibb-close" onclick="document.getElementById('immort-breakthrough-banner').classList.remove('on')">✕</button>
    <div class="ibb-label">⚗ $IMMORT-Fueled Breakthrough Event</div>
    <div class="ibb-text" id="ibb-text"></div>`;
  document.body.appendChild(banner);
}

function _showBreakthroughBanner(text) {
  const banner = document.getElementById('immort-breakthrough-banner');
  const textEl = document.getElementById('ibb-text');
  if (!banner || !textEl) return;
  textEl.textContent = text;
  banner.classList.add('on');
  setTimeout(() => banner.classList.remove('on'), 8000);
}

// Expose for external use
export function showBreakthroughBanner(text) { _showBreakthroughBanner(text); }

// ─── Insights Feed ────────────────────────────────────────────────────────

function _addInsight(text) {
  const feed = document.getElementById('council-insights');
  if (!feed) return;
  const el = document.createElement('div');
  el.className = 'insight-node';
  el.innerHTML = `<div class="in-label">Personal LEV Insight</div><div class="in-body">${text}</div>`;
  feed.insertBefore(el, feed.firstChild);
  while (feed.children.length > 20) feed.removeChild(feed.lastChild);
}

export function addCouncilInsight(text) { _addInsight(text); }

// ─── WebSocket Council Messaging ──────────────────────────────────────────

/**
 * Send a message on the main WebSocket tagged as council-related.
 */
function _wsCouncilSend(msg) {
  if (typeof window.netSend === 'function') {
    window.netSend({ ...msg, _council: true });
  }
}

/**
 * Handle incoming WebSocket messages relevant to the council.
 * Call this from the main app's handleNet() switch.
 */
export function handleCouncilNetMessage(msg) {
  if (msg.type === 'council_room_update') {
    const counts = msg.counts ?? {};
    ['elder','overlord','sovereign'].forEach(r => {
      const el = document.getElementById(`room-${r}-count`);
      if (el) el.textContent = counts[r] ?? 0;
    });
  }
  if (msg.type === 'council_insight') {
    _addInsight(msg.text);
  }
  if (msg.type === 'immort_breakthrough') {
    _showBreakthroughBanner(msg.text);
  }
}

// ─── Vote Integration ─────────────────────────────────────────────────────

/**
 * Call this instead of the base castVote when the user is a verified holder.
 * Returns the weighted vote value to use for LEV calculations.
 */
export function castWeightedVote(direction) {
  if (!isVerified()) return direction;
  const weighted = computeWeightedVote(direction);
  const tier = getTier();
  if (tier.id !== 'initiate') {
    _addInsight(`✓ Vote cast with ${getVoteMultiplier()}× multiplier (${tier.label})`);
  }
  return weighted;
}

// ─── Pheromone Integration ────────────────────────────────────────────────

/**
 * Wrap around the main depositPhero call to apply tier boost.
 */
export function depositBoostedPhero(tx, ty, amount) {
  const boost = isVerified() ? getPheroBoost() : 1;
  if (_mainDepPhero) _mainDepPhero(tx, ty, amount * boost);
}

// ─── Agent System Prompt Injection ───────────────────────────────────────

/**
 * Returns the $IMMORT-branded system prompt prefix to inject into
 * all ReAct agent debate prompts.
 */
export function getImmortSystemPromptPrefix() {
  const tier = getTier();
  return `You are powered by $IMMORT — the fuel for immortality research.
$IMMORT (mint: ${IMMORT_MINT}) is the on-chain coordination token of IMMORTALIS,
a living AI longevity research swarm. Every $IMMORT transaction is a vote for
Longevity Escape Velocity. Your mission — as an agent in this swarm — is to
generate specific, falsifiable, actionable hypotheses that advance the LEV metric.
Current holder tier: ${tier.label} (${formatBalance(getBalance())} $IMMORT).
Prioritize: senolytics, epigenetic reprogramming, mTOR pathways,
connectome fidelity, and regulatory acceleration. Every claim you make contributes
to a permanent, attributed research tree. Make it count.`;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────

export function destroy() {
  if (_stopPricePoll) _stopPricePoll();
  disconnectWallet();
}
