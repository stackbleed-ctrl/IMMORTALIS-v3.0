/**
 * immort-token-utils.js
 * ─────────────────────────────────────────────────────────────────────────
 * IMMORTALIS v5.0 — $IMMORT Token Utility Layer
 *
 * Handles:
 *   • Solana wallet detection & connection (Phantom / Solflare / Backpack)
 *   • On-chain $IMMORT balance verification via public RPC
 *   • Tier classification (Initiate → Immortal Sovereign)
 *   • Vote weight multipliers, pheromone boost factors
 *   • Live price / market data from DexScreener API
 *   • Anti-abuse: signed message verification (challenge/response)
 *
 * SECURITY NOTE:
 *   Client-side balance checks are used for UI gating only.
 *   For true anti-sybil protection, the server should verify a signed
 *   message (see signAndVerify()) before granting elevated WebSocket
 *   permissions. Never trust raw client assertions for high-stakes gates.
 *
 * Dependencies: none (vanilla JS, uses browser Solana wallet injection)
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────

export const IMMORT_MINT    = '5ajcWht9vzGrintx9CdczWn9Yr6awyCNRTUDgFGQpump';
export const SOLANA_RPC     = 'https://api.mainnet-beta.solana.com';
export const DEXSCREENER_API = `https://api.dexscreener.com/tokens/v1/solana/${IMMORT_MINT}`;
export const TOKEN_DECIMALS = 6; // Pump.fun tokens use 6 decimals

/** Tier thresholds (raw token units, post-decimal) */
export const TIERS = [
  { id: 'initiate',  label: 'Initiate',          min: 0,       max: 999,      color: '#7a90b0', multiplier: 1.0,  pheroBoost: 1.0  },
  { id: 'elder',     label: 'Elder',              min: 1_000,   max: 9_999,    color: '#1de9c8', multiplier: 1.5,  pheroBoost: 1.5  },
  { id: 'overlord',  label: 'Overlord',           min: 10_000,  max: 99_999,   color: '#9b6ef3', multiplier: 3.0,  pheroBoost: 2.5  },
  { id: 'sovereign', label: 'Immortal Sovereign', min: 100_000, max: Infinity, color: '#f5d060', multiplier: 7.5,  pheroBoost: 5.0  },
];

// ─── State ────────────────────────────────────────────────────────────────

let _walletPubkey    = null;   // string | null
let _immortBalance   = 0;      // number (human-readable, post-decimal)
let _tier            = TIERS[0];
let _verified        = false;  // true once signed message check passes
let _priceData       = null;   // cached DexScreener response
let _priceCallbacks  = [];     // registered listeners for price updates
let _tierCallbacks   = [];

// ─── Wallet Detection ─────────────────────────────────────────────────────

/**
 * Returns the first available injected Solana wallet provider.
 * Priority: Phantom > Backpack > Solflare > generic window.solana
 */
export function detectWallet() {
  if (typeof window === 'undefined') return null;
  if (window.phantom?.solana?.isPhantom)       return { provider: window.phantom.solana,  name: 'Phantom'  };
  if (window.backpack?.isBackpack)              return { provider: window.backpack,         name: 'Backpack' };
  if (window.solflare?.isSolflare)              return { provider: window.solflare,         name: 'Solflare' };
  if (window.solana?.isPhantom || window.solana) return { provider: window.solana,          name: 'Solana'   };
  return null;
}

/**
 * Connect to the user's wallet. Resolves with { publicKey, walletName }.
 * Throws if no wallet detected or user rejects.
 */
export async function connectWallet() {
  const wallet = detectWallet();
  if (!wallet) {
    throw new Error('No Solana wallet detected. Install Phantom, Backpack, or Solflare.');
  }
  const resp = await wallet.provider.connect();
  _walletPubkey = resp.publicKey?.toString() ?? wallet.provider.publicKey?.toString();
  if (!_walletPubkey) throw new Error('Wallet connected but no public key returned.');
  return { publicKey: _walletPubkey, walletName: wallet.name, provider: wallet.provider };
}

export function disconnectWallet() {
  const wallet = detectWallet();
  if (wallet) try { wallet.provider.disconnect(); } catch {}
  _walletPubkey  = null;
  _immortBalance = 0;
  _verified      = false;
  _tier          = TIERS[0];
  _notifyTier();
}

export function getPublicKey()  { return _walletPubkey; }
export function getBalance()    { return _immortBalance; }
export function getTier()       { return _tier; }
export function isVerified()    { return _verified; }

// ─── Balance Verification ─────────────────────────────────────────────────

/**
 * Fetch $IMMORT SPL token balance for a given wallet via JSON-RPC.
 * Uses getTokenAccountsByOwner → minimal, no extra library needed.
 *
 * @param {string} ownerPubkey  - base58 public key string
 * @returns {Promise<number>}   - human-readable balance (post-decimals)
 */
export async function fetchImmortBalance(ownerPubkey) {
  const body = {
    jsonrpc: '2.0', id: 1,
    method: 'getTokenAccountsByOwner',
    params: [
      ownerPubkey,
      { mint: IMMORT_MINT },
      { encoding: 'jsonParsed', commitment: 'confirmed' }
    ]
  };
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`RPC error: ${res.status}`);
  const data = await res.json();
  const accounts = data?.result?.value ?? [];
  if (!accounts.length) return 0;
  // Sum all token accounts (most wallets have one, but handle edge cases)
  let total = 0;
  for (const acc of accounts) {
    const amount = acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    total += amount;
  }
  return total;
}

/**
 * Full verification flow:
 *   1. Connect wallet (if not already)
 *   2. Fetch $IMMORT balance
 *   3. Classify tier
 *   4. Optionally request signed message for server-side anti-sybil
 *
 * @param {boolean} requireSignature - if true, prompts wallet to sign a challenge
 * @returns {Promise<VerificationResult>}
 */
export async function verifyImmortHolder(requireSignature = false) {
  if (!_walletPubkey) await connectWallet();

  _immortBalance = await fetchImmortBalance(_walletPubkey);
  _tier = classifyTier(_immortBalance);

  let signedChallenge = null;
  if (requireSignature) {
    signedChallenge = await signAndVerify(_walletPubkey);
  }

  _verified = true;
  _notifyTier();

  return {
    publicKey:      _walletPubkey,
    balance:        _immortBalance,
    tier:           _tier,
    signedChallenge,
    timestamp:      Date.now(),
  };
}

/**
 * Classify a balance amount into a tier.
 * @param {number} balance
 * @returns {Tier}
 */
export function classifyTier(balance) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (balance >= TIERS[i].min) return TIERS[i];
  }
  return TIERS[0];
}

// ─── Signed Message (Anti-Sybil) ─────────────────────────────────────────

/**
 * Request wallet to sign a timestamped challenge. Send this to your server
 * with the public key; the server verifies the signature using
 * @solana/web3.js nacl.sign.detached.verify before granting WS access.
 *
 * @param {string} pubkey
 * @returns {{ message: string, signature: Uint8Array, publicKey: string }}
 */
export async function signAndVerify(pubkey) {
  const wallet = detectWallet();
  if (!wallet) throw new Error('No wallet available for signing.');
  const challenge = `IMMORTALIS-IMMORT-VERIFY:${pubkey}:${Date.now()}`;
  const encoded   = new TextEncoder().encode(challenge);
  const { signature } = await wallet.provider.signMessage(encoded, 'utf8');
  return {
    message:   challenge,
    signature: Array.from(signature), // JSON-serializable
    publicKey: pubkey,
  };
}

// ─── Multipliers & Boosts ─────────────────────────────────────────────────

/** Vote weight for hypothesis validation */
export function getVoteMultiplier()  { return _tier.multiplier; }

/** Pheromone deposit multiplier for canvas simulation */
export function getPheroBoost()      { return _tier.pheroBoost; }

/**
 * Weighted vote value: base 1.0 for non-holders, tier multiplier for holders.
 * Soft-capped: max 10× at 1M tokens.
 */
export function computeWeightedVote(base = 1) {
  if (!_verified || _tier.id === 'initiate') return base;
  const soft = Math.min(_immortBalance / 10_000, 10);
  return base * Math.max(soft, _tier.multiplier);
}

// ─── Price Feed ───────────────────────────────────────────────────────────

/**
 * Fetch live $IMMORT price & market data from DexScreener.
 * Cached for 30 seconds to avoid hammering the free API.
 * @returns {Promise<PriceData>}
 */
let _priceLastFetch = 0;
export async function fetchImmortPrice() {
  const now = Date.now();
  if (_priceData && now - _priceLastFetch < 30_000) return _priceData;
  try {
    const res  = await fetch(DEXSCREENER_API);
    const json = await res.json();
    const pair = json?.pairs?.[0] ?? json?.[0] ?? null;
    if (!pair) return null;
    _priceData = {
      price:       parseFloat(pair.priceUsd ?? 0),
      priceChange: parseFloat(pair.priceChange?.h24 ?? 0),
      volume24h:   parseFloat(pair.volume?.h24 ?? 0),
      marketCap:   parseFloat(pair.marketCap ?? pair.fdv ?? 0),
      liquidity:   parseFloat(pair.liquidity?.usd ?? 0),
      txns24h:     (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
      pairUrl:     pair.url ?? `https://dexscreener.com/solana/${IMMORT_MINT}`,
      updatedAt:   now,
    };
    _priceLastFetch = now;
    _notifyPrice();
    return _priceData;
  } catch (e) {
    console.warn('[IMMORT] Price fetch failed:', e.message);
    return _priceData; // return stale data if available
  }
}

/**
 * Start polling price every N seconds.
 * @param {number} intervalMs - default 30 000
 * @returns {function} stop function
 */
export function startPricePoll(intervalMs = 30_000) {
  fetchImmortPrice(); // immediate first fetch
  const id = setInterval(fetchImmortPrice, intervalMs);
  return () => clearInterval(id);
}

// ─── Event Bus ────────────────────────────────────────────────────────────

export function onPriceUpdate(cb)   { _priceCallbacks.push(cb); }
export function onTierChange(cb)    { _tierCallbacks.push(cb); }
export function offPriceUpdate(cb)  { _priceCallbacks = _priceCallbacks.filter(x => x !== cb); }
export function offTierChange(cb)   { _tierCallbacks  = _tierCallbacks.filter(x => x !== cb); }

function _notifyPrice() { _priceCallbacks.forEach(cb => { try { cb(_priceData); } catch {} }); }
function _notifyTier()  { _tierCallbacks.forEach(cb => { try { cb(_tier, _immortBalance, _walletPubkey); } catch {} }); }

// ─── LEV Influence ────────────────────────────────────────────────────────

/**
 * Compute how much a volume spike should boost LEV.
 * Called by the price widget when 24h volume changes by >20%.
 * Returns a tiny LEV delta (0.0 – 0.5%).
 */
export function computeLEVBoostFromVolume(volumeUsd) {
  if (!volumeUsd || volumeUsd < 100) return 0;
  // Logarithmic scale: $1k vol = 0.05%, $100k = 0.2%, $10M = 0.5%
  const boost = Math.min(0.5, Math.log10(volumeUsd / 1000) * 0.1);
  return Math.max(0, boost);
}

// ─── Formatters ───────────────────────────────────────────────────────────

export function formatBalance(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function formatPrice(p) {
  if (!p) return '$—';
  if (p < 0.000001) return '$' + p.toExponential(2);
  if (p < 0.01)     return '$' + p.toFixed(6);
  return '$' + p.toFixed(4);
}

export function formatMCap(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

/** Short public key display: Abc1...xyz9 */
export function shortKey(pk) {
  if (!pk) return '';
  return pk.slice(0, 4) + '…' + pk.slice(-4);
}
