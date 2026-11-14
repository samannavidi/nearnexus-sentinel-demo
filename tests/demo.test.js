'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assess, verifyReceipt, scenarios, createApp, addressOK } = require('../server');

test('four synthetic security scenarios produce documented verdicts', () => {
  const data = scenarios(Date.parse('2026-11-14T12:00:00Z'));
  assert.deepEqual(data.map(x => x.receipt.verdict), ['WARN', 'BLOCK', 'BLOCK', 'WARN']);
  for (const x of data) {
    assert.equal(x.receipt.execution_authorized, false);
    assert.equal(verifyReceipt(x.receipt), true);
  }
});
test('tampered evidence invalidates receipt', () => {
  const r = scenarios()[0].receipt;
  assert.equal(verifyReceipt(r), true);
  assert.equal(verifyReceipt({ ...r, evidence: { ...r.evidence, liquidity_usd: 1 } }), false);
  assert.equal(verifyReceipt({ ...r, verdict: 'RESEARCH_ONLY' }), false);
});
test('unknown market evidence and unavailable NFT listing fail closed', () => {
  assert.equal(assess('token', {}).verdict, 'BLOCK');
  assert.equal(assess('nft', { chain: 'near', collection: 'demo', floor_usd: 10 }).verdict, 'BLOCK');
  assert.equal(assess('news', { title: 'Oil report', url: 'http://example.com', published_at: '' }).verdict, 'BLOCK');
});
test('chain address formats reject mismatched chains', () => {
  assert.equal(addressOK('near', 'owner.near'), true);
  assert.equal(addressOK('eth', 'owner.near'), false);
  assert.equal(addressOK('eth', '0x' + 'a'.repeat(40)), true);
  assert.equal(addressOK('sol', '0x' + 'a'.repeat(40)), false);
});
test('provider catalog and dry quote never create a transaction', async () => {
  const now = new Date().toISOString();
  const list = [
    { blockchain: 'near', assetId: 'nep141:wrap.near', symbol: 'wNEAR', decimals: 24, price: '5', priceUpdatedAt: now },
    { blockchain: 'eth', assetId: 'erc20:demo-usdc', symbol: 'USDC', decimals: 6, price: '1', priceUpdatedAt: now }
  ];
  const sent = [];
  async function mockFetch(url, opts = {}) {
    sent.push({ url, opts });
    if (url.endsWith('/tokens')) return new Response(JSON.stringify(list), { status: 200 });
    if (url.endsWith('/quote')) {
      assert.equal(JSON.parse(opts.body).dry, true);
      return new Response(JSON.stringify({ status: 'SUCCESS', quote: {
        amountOutFormatted: '1.2', depositAddress: 'NEVER_EXPOSE'
      } }), { status: 200 });
    }
    throw Error('unexpected provider URL');
  }
  const server = createApp({ fetchImpl: mockFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const health = await (await fetch(base + '/api/v1/health')).json();
    assert.equal(health.mode, 'NON_EXECUTING_PUBLIC_DEMO');
    const assets = await (await fetch(base + '/api/v1/near/assets')).json();
    assert.equal(assets.count, 2);
    const payload = {
      origin_asset_id: 'nep141:wrap.near', destination_asset_id: 'erc20:demo-usdc',
      amount_atomic: '100000000000000000000000', refund_to: 'owner.near',
      recipient: '0x' + 'a'.repeat(40), slippage_bps: 100
    };
    const quote = await (await fetch(base + '/api/v1/near/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })).json();
    assert.equal(quote.dry, true);
    assert.equal(quote.transaction_created, false);
    assert.equal(quote.deposit_address, null);
    assert.equal(quote.execution_authorized, false);
    assert.equal(sent.filter(x => x.url.endsWith('/quote')).length, 1);
    const bad = await fetch(base + '/api/v1/near/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, amount_atomic: '99999999999999999999999999999999' })
    });
    assert.equal(bad.status, 400);
    assert.equal(sent.filter(x => x.url.endsWith('/quote')).length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('read-only NEAR market endpoint is public REST snapshot, not recorded L2', async () => {
  const sent = [];
  const current = Date.now();
  const mockFetch = async (url) => {
    sent.push(url);
    if (url.includes('/klines?')) return new Response(JSON.stringify([
      [current - 600000, '1.50', '1.55', '1.48', '1.53', '100', current - 590000],
      [current - 300000, '1.53', '1.57', '1.51', '1.56', '140', current - 290000]
    ]), { status: 200 });
    if (url.includes('/depth?')) return new Response(JSON.stringify({
      lastUpdateId: 12345, bids: [['1.55', '120'], ['1.54', '200']],
      asks: [['1.57', '110'], ['1.58', '180']]
    }), { status: 200 });
    throw Error('unexpected');
  };
  const server = createApp({ fetchImpl: mockFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const r = await fetch(base + '/api/v1/market/near?interval=5m');
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.source, 'BINANCE_PUBLIC_SPOT_REST');
    assert.equal(data.depth_kind, 'CURRENT_ORDERBOOK_SNAPSHOT_NOT_HISTORICAL_L2');
    assert.equal(data.sequence_id, 12345);
    assert.equal(data.candles.length, 2);
    assert.equal(data.candles[0].closed, true);
    assert.deepEqual(data.bids[0], [1.55, 120]);
    assert.equal(sent.length, 2);
    await fetch(base + '/api/v1/market/near?interval=5m');
    assert.equal(sent.length, 2, 'short cache avoids repeat provider requests');
    const bad = await fetch(base + '/api/v1/market/near?interval=1d');
    assert.equal(bad.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
test('failed public market provider does not fabricate candles or depth', async () => {
  const server = createApp({ fetchImpl: async () => { throw Error('network down'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const r = await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/market/near');
    assert.equal(r.status, 503);
    const data = await r.json();
    assert.equal(data.error, 'PUBLIC_MARKET_UPSTREAM_UNAVAILABLE');
    assert.equal(data.candles, undefined);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
