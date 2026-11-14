'use strict';
/*
 * NEXUS Sentinel — standalone, public, evaluation-only sample.
 * This file contains no proprietary Hunter/market models and no transaction execution.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const POLICY = Object.freeze({
  // Deliberately illustrative demo constants, NOT original NEXUS production thresholds.
  tokenMinLiquidityUsd: 18000, tokenMinDailyTrades: 12,
  tokenNewPairHours: 18, tokenVolumeToLiquidityWarning: 11,
  maxFeedAgeMinutes: 12, newsMaxAgeHours: 24,
  trustedNewsDomains: ['cointelegraph.com', 'theblock.co'],
  executionEnabled: false
});
const CATALOG_URL = 'https://1click.chaindefuser.com/v0/tokens';
const QUOTE_URL = 'https://1click.chaindefuser.com/v0/quote';
const CHAINS = new Set(['near', 'eth', 'base', 'sol', 'sui']);
const TOPICS = /\b(bitcoin|btc|ethereum|ether|eth|solana|sol|sui|near|crypto|blockchain|web3|defi|nft|wallet|token|stablecoin|dex|exchange|memecoin|hack|exploit)\b/i;
function canonical(o) {
  if (Array.isArray(o)) return o.map(canonical);
  if (o && typeof o === 'object') return Object.fromEntries(Object.keys(o).sort().map(k => [k, canonical(o[k])]));
  return o;
}
function digest(o) { return crypto.createHash('sha256').update(JSON.stringify(canonical(o))).digest('hex'); }
function str(x, n = 160) { return String(x == null ? '' : x).slice(0, n); }
function num(x) { return x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x); }
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function addressOK(chain, a) {
  if (chain === 'near') return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(a) || /^[a-f0-9]{64}$/.test(a);
  if (chain === 'eth' || chain === 'base') return /^0x[0-9a-f]{40}$/i.test(a);
  if (chain === 'sui') return /^0x[0-9a-f]{64}$/i.test(a);
  if (chain === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  return false;
}
function assess(type, item, now = Date.now()) {
  if (!['token', 'nft', 'news'].includes(type) || !item || Array.isArray(item) || typeof item !== 'object') fail('INVALID_EVIDENCE');
  const block = [], warn = [];
  let evidence;
  if (type === 'token') {
    const liq = num(item.liquidity_usd), trades = num(item.trades_24h), age = num(item.pair_age_hours);
    const volume = num(item.volume_24h_usd), feedAge = num(item.feed_age_minutes);
    evidence = { chain: str(item.chain, 24), contract: str(item.contract, 128),
      liquidity_usd: liq, trades_24h: trades, pair_age_hours: age,
      volume_24h_usd: volume, feed_age_minutes: feedAge,
      holder_checked: item.holder_checked === true, contract_checked: item.contract_checked === true };
    if (!evidence.chain || !evidence.contract) block.push('IDENTITY_NOT_VERIFIED');
    if (liq === null || liq < POLICY.tokenMinLiquidityUsd) block.push('INSUFFICIENT_VERIFIED_LIQUIDITY');
    if (trades === null || trades < POLICY.tokenMinDailyTrades) block.push('INSUFFICIENT_TRADING_ACTIVITY');
    if (feedAge === null || feedAge > POLICY.maxFeedAgeMinutes || feedAge < 0) block.push('FEED_NOT_FRESH');
    if (age === null || age < POLICY.tokenNewPairHours) warn.push('NEW_OR_UNDATED_PAIR');
    if (volume !== null && liq > 0 && volume / liq > POLICY.tokenVolumeToLiquidityWarning) warn.push('ABNORMAL_VOLUME_TO_LIQUIDITY');
    if (!evidence.holder_checked) warn.push('HOLDER_AUDIT_MISSING');
    if (!evidence.contract_checked) warn.push('CONTRACT_AUDIT_MISSING');
  } else if (type === 'nft') {
    const owners = num(item.owners), supply = num(item.supply);
    evidence = { chain: str(item.chain, 24), collection: str(item.collection, 128),
      floor_usd: num(item.floor_usd), owners, supply,
      individual_listing_verified: item.individual_listing_verified === true,
      ownership_verified: item.ownership_verified === true };
    if (!evidence.chain || !evidence.collection) block.push('COLLECTION_IDENTITY_MISSING');
    if (!evidence.individual_listing_verified) block.push('NO_VERIFIED_BUYABLE_LISTING');
    if (evidence.floor_usd === null || evidence.floor_usd <= 0) block.push('FLOOR_NOT_AVAILABLE');
    if (!evidence.ownership_verified) warn.push('OWNERSHIP_NOT_VERIFIED');
    if (owners === null || supply === null || supply <= 0 || owners / supply < 0.2) warn.push('OWNER_DISTRIBUTION_UNCLEAR');
  } else {
    let host = '';
    try { const u = new URL(str(item.url, 600)); if (u.protocol === 'https:') host = u.hostname.toLowerCase(); } catch {}
    const ts = Date.parse(str(item.published_at, 50));
    const ageH = Number.isFinite(ts) ? (now - ts) / 3600000 : null;
    evidence = { title: str(item.title, 220), source_host: host,
      published_at: str(item.published_at, 50), corroborating_sources: num(item.corroborating_sources),
      age_hours: ageH === null ? null : Number(ageH.toFixed(3)) };
    if (!TOPICS.test(evidence.title)) block.push('NOT_CRYPTO_RELEVANT');
    if (!host || !POLICY.trustedNewsDomains.some(d => host === d || host.endsWith('.' + d))) block.push('UNVERIFIED_PUBLISHER');
    if (ageH === null || ageH < 0) block.push('INVALID_PUBLICATION_TIME');
    else if (ageH > POLICY.newsMaxAgeHours) warn.push('OLD_HEADLINE');
    if (evidence.corroborating_sources === null || evidence.corroborating_sources < 2) warn.push('NO_INDEPENDENT_CORROBORATION');
  }
  const verdict = block.length ? 'BLOCK' : warn.length ? 'WARN' : 'RESEARCH_ONLY';
  const data = { schema: 'nexus-sentinel-public-demo-v1', type, evidence, verdict,
    block_reasons: block, warnings: warn, evaluated_at_utc: new Date(now).toISOString(),
    research_only: true, execution_authorized: false, onchain_attestation: false };
  return { ...data, digest_sha256: digest(data),
    notice: 'Integrity checksum only: not a signature, contract audit, execution approval or independent timestamp proof.' };
}
function verifyReceipt(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const { digest_sha256, notice, ...body } = r;
  if (typeof digest_sha256 !== 'string' || digest(body) !== digest_sha256) return false;
  if (!body.research_only || body.execution_authorized !== false || body.onchain_attestation !== false) return false;
  const now = Date.parse(body.evaluated_at_utc);
  if (!Number.isFinite(now)) return false;
  try {
    // Recompute policy outcome from submitted evidence; do not just check the checksum.
    if (body.type === 'news') {
      // News receipts store only a normalized host, not the untrusted original URL.
      const reconstructed = { title: body.evidence.title, url: 'https://' + body.evidence.source_host + '/',
        published_at: body.evidence.published_at, corroborating_sources: body.evidence.corroborating_sources };
      const expected = assess('news', reconstructed, now);
      return expected.verdict === body.verdict &&
        JSON.stringify(expected.block_reasons) === JSON.stringify(body.block_reasons) &&
        JSON.stringify(expected.warnings) === JSON.stringify(body.warnings);
    }
    const e = body.evidence;
    let input;
    if (body.type === 'token') input = e;
    else if (body.type === 'nft') input = { ...e, individual_listing_verified: e.individual_listing_verified };
    else return false;
    const expected = assess(body.type, input, now);
    return expected.verdict === body.verdict &&
      JSON.stringify(expected.block_reasons) === JSON.stringify(body.block_reasons) &&
      JSON.stringify(expected.warnings) === JSON.stringify(body.warnings);
  } catch { return false; }
}
function scenarios(now = Date.now()) {
  return [
    { id: 'review', title: 'A liquid market with incomplete audits',
      receipt: assess('token', { chain: 'near', contract: 'wrap.near', liquidity_usd: 125000,
        trades_24h: 185, pair_age_hours: 250, volume_24h_usd: 95000, feed_age_minutes: 2 }, now) },
    { id: 'unsafe', title: 'Thin liquidity, stale token',
      receipt: assess('token', { chain: 'sol', contract: 'synthetic-only', liquidity_usd: 800,
        trades_24h: 6, pair_age_hours: 0.5, volume_24h_usd: 1400, feed_age_minutes: 45 }, now) },
    { id: 'nft', title: 'NFT collection without a verified listing',
      receipt: assess('nft', { chain: 'eth', collection: 'synthetic-collection', floor_usd: 210,
        owners: 400, supply: 1000, individual_listing_verified: false }, now) },
    { id: 'news', title: 'Uncorroborated crypto security headline',
      receipt: assess('news', { title: 'Bitcoin exchange wallet exploit under investigation',
        url: 'https://cointelegraph.com/news/synthetic-example', published_at: new Date(now - 120000).toISOString(),
        corroborating_sources: 1 }, now) }
  ];
}
function createApp({ fetchImpl = fetch } = {}) {
  let cache = null;
  const requests = new Map();
  async function catalog() {
    if (cache && Date.now() - cache.when < 90000) return cache.data;
    let r;
    try { r = await fetchImpl(CATALOG_URL, { signal: AbortSignal.timeout(10000) }); }
    catch { fail('NEAR_PROVIDER_UNAVAILABLE', 503); }
    if (!r.ok) fail('NEAR_CATALOG_HTTP_ERROR', 503);
    let list;
    try { list = await r.json(); } catch { fail('NEAR_CATALOG_INVALID_RESPONSE', 502); }
    if (!Array.isArray(list)) fail('NEAR_CATALOG_INVALID_RESPONSE', 502);
    const assets = list.filter(x => x && CHAINS.has(x.blockchain) && typeof x.assetId === 'string' &&
      Number.isInteger(x.decimals) && x.decimals >= 0 && x.decimals <= 30).slice(0, 1200)
      .map(x => ({ asset_id: x.assetId, chain: x.blockchain,
        symbol: str(x.symbol, 24), decimals: x.decimals,
        price_usd: num(x.price), price_updated_at: str(x.priceUpdatedAt, 60) }));
    const data = { source: 'NEAR_INTENTS_1CLICK', mode: 'LIVE_READ_ONLY',
      fetched_at_utc: new Date().toISOString(), count: assets.length, assets };
    cache = { data, when: Date.now() };
    return data;
  }
  async function dryQuote(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) fail('INVALID_REQUEST');
    const allowed = ['origin_asset_id', 'destination_asset_id', 'amount_atomic', 'recipient', 'refund_to', 'slippage_bps'];
    if (Object.keys(x).some(k => !allowed.includes(k))) fail('UNEXPECTED_QUOTE_FIELD');
    const assets = (await catalog()).assets;
    const origin = assets.find(a => a.asset_id === x.origin_asset_id);
    const target = assets.find(a => a.asset_id === x.destination_asset_id);
    if (!origin || !target || origin.asset_id === target.asset_id) fail('INVALID_ASSET_PAIR');
    if (!/^[1-9][0-9]{0,39}$/.test(String(x.amount_atomic || ''))) fail('INVALID_ATOMIC_AMOUNT');
    if (!addressOK(origin.chain, String(x.refund_to || '')) ||
        !addressOK(target.chain, String(x.recipient || ''))) fail('CHAIN_ADDRESS_MISMATCH');
    const bps = Number(x.slippage_bps);
    if (!Number.isInteger(bps) || bps < 10 || bps > 300) fail('SLIPPAGE_OUT_OF_RANGE');
    const age = Date.now() - Date.parse(origin.price_updated_at);
    if (!Number.isFinite(age) || age < 0 || age > 600000 || !(origin.price_usd > 0)) fail('ORIGIN_PRICE_NOT_FRESH', 503);
    const estimatedUsd = Number(x.amount_atomic) / 10 ** origin.decimals * origin.price_usd;
    if (!(estimatedUsd > 0) || estimatedUsd > 100) fail('DRY_QUOTE_LIMIT_100_USD');
    const req = { dry: true, swapType: 'EXACT_INPUT', slippageTolerance: bps,
      originAsset: origin.asset_id, destinationAsset: target.asset_id,
      depositType: 'ORIGIN_CHAIN', amount: x.amount_atomic,
      recipient: x.recipient, recipientType: 'DESTINATION_CHAIN',
      refundTo: x.refund_to, refundType: 'ORIGIN_CHAIN',
      deadline: new Date(Date.now() + 900000).toISOString() };
    let r;
    try { r = await fetchImpl(QUOTE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req), signal: AbortSignal.timeout(15000) }); }
    catch { fail('NEAR_DRY_QUOTE_UNAVAILABLE', 503); }
    if (!r.ok) fail('NEAR_DRY_QUOTE_REJECTED', 503);
    let out;
    try { out = await r.json(); } catch { fail('NEAR_DRY_QUOTE_BAD_RESPONSE', 502); }
    return { mode: 'MAINNET_DRY_QUOTE_ONLY', provider: 'NEAR_INTENTS_1CLICK',
      estimated_input_usd: Number(estimatedUsd.toFixed(4)), origin_chain: origin.chain, destination_chain: target.chain,
      amount_out_formatted: out?.quote?.amountOutFormatted || null,
      min_amount_out: out?.quote?.minAmountOut || null,
      provider_status: str(out?.status || 'PREVIEW', 60),
      dry: true, wallet_connected: false, transaction_created: false, deposit_address: null,
      execution_authorized: false, notice: 'Preview only. Quote may expire or fail; no funds moved.' };
  }
  // Public showcase: read-only NEAR Spot REST candles and ONE current depth snapshot.
  // The private project's five-hour recorder and its raster history are NOT exposed here.
  const marketCache = new Map();
  async function nearMarket(interval = '5m') {
    if (!['1m', '5m', '15m', '1h'].includes(interval)) fail('INVALID_CANDLE_INTERVAL');
    const entry = marketCache.get(interval);
    if (entry && Date.now() - entry.when < 15000) return entry.data;
    const base = 'https://api.binance.com/api/v3/';
    let candlesResponse, depthResponse;
    try {
      [candlesResponse, depthResponse] = await Promise.all([
        fetchImpl(base + 'klines?symbol=NEARUSDT&interval=' + interval + '&limit=120',
          { signal: AbortSignal.timeout(10000) }),
        fetchImpl(base + 'depth?symbol=NEARUSDT&limit=100',
          { signal: AbortSignal.timeout(10000) })
      ]);
    } catch { fail('PUBLIC_MARKET_UPSTREAM_UNAVAILABLE', 503); }
    if (!candlesResponse.ok || !depthResponse.ok) fail('PUBLIC_MARKET_UPSTREAM_HTTP_ERROR', 503);
    let rows, book;
    try { [rows, book] = await Promise.all([candlesResponse.json(), depthResponse.json()]); }
    catch { fail('PUBLIC_MARKET_INVALID_JSON', 502); }
    if (!Array.isArray(rows) || !rows.length || !Array.isArray(book?.bids) || !Array.isArray(book?.asks))
      fail('PUBLIC_MARKET_INVALID_SHAPE', 502);
    const candles = rows.filter(r => Array.isArray(r) && r.length > 6 &&
      r.slice(0, 6).every(v => Number.isFinite(Number(v)))).map(r => ({
        t: Number(r[0]), o: Number(r[1]), h: Number(r[2]),
        l: Number(r[3]), c: Number(r[4]), v: Number(r[5]), closed: Date.now() > Number(r[6])
      }));
    const asLevels = arr => arr.slice(0, 60).filter(r =>
      Array.isArray(r) && Number(r[0]) > 0 && Number(r[1]) > 0).map(r =>
      [Number(r[0]), Number(r[1])]);
    const bids = asLevels(book.bids), asks = asLevels(book.asks);
    if (!candles.length || !bids.length || !asks.length ||
      !(bids[0][0] < asks[0][0])) fail('PUBLIC_MARKET_INVALID_BOOK', 502);
    const data = {
      source: 'BINANCE_PUBLIC_SPOT_REST', pair: 'NEARUSDT', interval,
      fetched_at_utc: new Date().toISOString(),
      depth_kind: 'CURRENT_ORDERBOOK_SNAPSHOT_NOT_HISTORICAL_L2',
      sequence_id: Number.isInteger(book.lastUpdateId) ? book.lastUpdateId : null,
      candles, bids, asks
    };
    marketCache.set(interval, { when: Date.now(), data });
    return data;
  }
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
    const send = (status, data) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const file = (name, type) => { res.writeHead(200, { ...headers, 'Content-Type': type }); res.end(fs.readFileSync(path.join(__dirname, 'public', name))); };
    try {
      if (req.method === 'GET' && pathname === '/') return file('index.html', 'text/html; charset=utf-8');
      if (req.method === 'GET' && pathname === '/app.js') return file('app.js', 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && pathname === '/market.js') return file('market.js', 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && pathname === '/styles.css') return file('styles.css', 'text/css; charset=utf-8');
      if (req.method === 'GET' && pathname === '/api/v1/market/near') {
        const interval = new URL(req.url, 'http://localhost').searchParams.get('interval') || '5m';
        return send(200, await nearMarket(interval));
      }
      if (req.method === 'GET' && pathname === '/api/v1/health') return send(200, { ok: true, mode: 'NON_EXECUTING_PUBLIC_DEMO' });
      if (req.method === 'GET' && pathname === '/api/v1/demo/scenarios')
        return send(200, { synthetic: true, executable: false, cases: scenarios() });
      if (req.method === 'GET' && pathname === '/api/v1/near/assets') return send(200, await catalog());
      if (['POST'].includes(req.method) && ['/api/v1/demo/assess', '/api/v1/demo/verify', '/api/v1/near/quote'].includes(pathname)) {
        const ip = req.socket.remoteAddress || 'local', key = ip + pathname, now = Date.now();
        const bucket = (requests.get(key) || []).filter(t => now - t < 60000);
        if (bucket.length >= (pathname.endsWith('/quote') ? 5 : 40)) return send(429, { error: 'RATE_LIMITED' });
        bucket.push(now); requests.set(key, bucket);
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 32768) fail('REQUEST_TOO_LARGE', 413); }
        if (!req.headers['content-type']?.startsWith('application/json')) fail('JSON_CONTENT_TYPE_REQUIRED', 415);
        let payload; try { payload = JSON.parse(raw); } catch { fail('INVALID_JSON'); }
        if (pathname === '/api/v1/demo/assess') return send(200, { receipt: assess(payload.type, payload.evidence) });
        if (pathname === '/api/v1/demo/verify') return send(200, { valid: verifyReceipt(payload.receipt) });
        return send(200, await dryQuote(payload));
      }
      return send(404, { error: 'NOT_FOUND' });
    } catch (err) { return send(err.status || 500, { error: err.status ? err.message : 'INTERNAL_ERROR' }); }
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 4315);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('INVALID_PORT');
  createApp().listen(port, '127.0.0.1', () => console.log('NEXUS Sentinel demo at http://127.0.0.1:' + port));
}
module.exports = { POLICY, assess, verifyReceipt, scenarios, createApp, addressOK };
