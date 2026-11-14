'use strict';
// Public NEAR Spot showcase: Binance REST OHLCV + CURRENT book snapshot.
// Never a historical orderbook recorder, real-time stream or trading tool.
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('nearCandle');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const intervals = ['1m', '5m', '15m', '1h'];
  let interval = '5m', market = null, busy = false, chartBounds = null;
  const fmt = x => Number(x).toLocaleString('en-US', { maximumFractionDigits: 5 });
  const amount = x => Number(x).toLocaleString('en-US', { maximumFractionDigits: 2 });
  function element(tag, className, value) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (value !== undefined) e.textContent = value;
    return e;
  }
  function draw() {
    if (!market || !canvas.isConnected) return;
    const width = Math.max(340, canvas.clientWidth || 820);
    const height = Math.max(230, canvas.clientHeight || 315);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const candles = market.candles.slice(-110), n = candles.length;
    if (!n) return;
    const left = 14, right = 71, top = 13, bottom = 32;
    const plotHeight = height - top - bottom;
    const mainH = plotHeight * 0.76;
    const prices = candles.flatMap(c => [c.l, c.h]);
    let low = Math.min(...prices), high = Math.max(...prices);
    const pad = Math.max((high - low) * .08, high * .0005);
    low -= pad;
    high += pad;
    const xAt = i => left + (i + .5) * (width - left - right) / n;
    const yAt = p => top + (high - p) / (high - low) * mainH;
    ctx.font = '11px Consolas, monospace';
    ctx.textBaseline = 'middle';
    for (let j = 0; j <= 4; j++) {
      const y = top + mainH * j / 4;
      ctx.strokeStyle = '#21384a';
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right + 2, y); ctx.stroke();
      ctx.fillStyle = '#66879b';
      ctx.fillText((high - (high - low) * j / 4).toFixed(4), width - right + 10, y);
    }
    const step = (width - left - right) / n;
    const maxVol = Math.max(...candles.map(c => c.v), 1);
    candles.forEach((c, i) => {
      const x = xAt(i), up = c.c >= c.o;
      const color = up ? '#59e8be' : '#ff8a96';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(x, yAt(c.h)); ctx.lineTo(x, yAt(c.l)); ctx.stroke();
      const bTop = yAt(Math.max(c.o, c.c));
      const bHeight = Math.max(1.3, Math.abs(yAt(c.o) - yAt(c.c)));
      ctx.fillRect(x - Math.max(1, step * .29), bTop, Math.max(2, step * .58), bHeight);
      ctx.globalAlpha = .32;
      const vH = c.v / maxVol * (plotHeight - mainH - 7);
      ctx.fillRect(x - Math.max(1, step * .26), top + plotHeight - vH, Math.max(2, step * .52), vH);
      ctx.globalAlpha = 1;
    });
    ctx.fillStyle = '#708fa0';
    for (let j = 0; j < 5; j++) {
      const idx = Math.min(n - 1, Math.round(j * (n - 1) / 4));
      const dt = new Date(candles[idx].t);
      const label = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      ctx.fillText(label + 'Z', Math.max(8, xAt(idx) - 15), height - 12);
    }
    const last = candles[n - 1];
    const y = yAt(last.c);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#68e6c1b5';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right + 1, y); ctx.stroke();
    ctx.setLineDash([]);
    chartBounds = { candles, left, step, yAt };
  }
  function levels(id, rows, side) {
    const root = $(id);
    root.replaceChildren();
    const sample = rows.slice(0, 12);
    const max = Math.max(...sample.map(x => x[1]), 1);
    sample.forEach(([price, qty]) => {
      const div = element('div', 'book-row ' + side);
      const bar = element('div', 'book-bar');
      bar.style.width = Math.max(2, qty / max * 100).toFixed(1) + '%';
      div.append(bar);
      div.append(element('span', 'book-price', fmt(price)));
      div.append(element('span', 'book-quantity', amount(qty)));
      root.append(div);
    });
  }
  function render(data) {
    market = data;
    const last = data.candles[data.candles.length - 1];
    const bid = data.bids[0][0], ask = data.asks[0][0];
    $('nearPrice').textContent = '$' + fmt(last.c);
    $('nearSpread').textContent = 'SPREAD ' + ((ask - bid) / ((ask + bid) / 2) * 100).toFixed(4) + '%';
    $('nearStatus').textContent = 'LIVE PUBLIC REST SNAPSHOT · ' + new Date(data.fetched_at_utc).toLocaleString() +
      ' · NEARUSDT Spot · ' + data.candles.length + ' candles · Book update ID ' + (data.sequence_id ?? 'not provided');
    $('nearStatus').classList.remove('error');
    levels('nearAsks', data.asks, 'sell');
    levels('nearBids', data.bids, 'buy');
    draw();
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    $('nearRefresh').disabled = true;
    try {
      const resp = await fetch('/api/v1/market/near?interval=' + encodeURIComponent(interval), { cache: 'no-store' });
      const obj = await resp.json();
      if (!resp.ok) throw new Error(obj.error || 'UPSTREAM_ERROR');
      if (obj.source !== 'BINANCE_PUBLIC_SPOT_REST' || obj.pair !== 'NEARUSDT') throw new Error('SOURCE_VALIDATION_FAILED');
      render(obj);
    } catch (e) {
      $('nearStatus').textContent = 'LIVE MARKET UNAVAILABLE — ' + e.message + ' · No synthetic prices shown';
      $('nearStatus').classList.add('error');
      if (!market) {
        $('nearPrice').textContent = 'UNAVAILABLE';
        $('nearAsks').replaceChildren();
        $('nearBids').replaceChildren();
      }
    } finally {
      $('nearRefresh').disabled = false;
      busy = false;
    }
  }
  $('nearRefresh').addEventListener('click', refresh);
  document.querySelectorAll('[data-interval]').forEach(b => b.addEventListener('click', () => {
    const next = b.dataset.interval;
    if (!intervals.includes(next)) return;
    interval = next;
    document.querySelectorAll('[data-interval]').forEach(x => x.classList.toggle('active', x === b));
    refresh();
  }));
  canvas.addEventListener('mousemove', event => {
    if (!chartBounds) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const i = Math.round((x - chartBounds.left) / chartBounds.step - .5);
    const c = chartBounds.candles[Math.max(0, Math.min(chartBounds.candles.length - 1, i))];
    $('nearHover').textContent = new Date(c.t).toISOString().slice(0, 16) + 'Z  O ' + fmt(c.o) +
      '  H ' + fmt(c.h) + '  L ' + fmt(c.l) + '  C ' + fmt(c.c);
  });
  canvas.addEventListener('mouseleave', () => {
    $('nearHover').textContent = 'Move pointer across chart to inspect a candle';
  });
  window.addEventListener('resize', draw);
  refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
})();
