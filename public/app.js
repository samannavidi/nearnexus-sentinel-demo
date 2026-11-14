'use strict';
const $ = id => document.getElementById(id);
let cases = [], current = null;
function setText(id, value) { $(id).textContent = String(value); }
async function request(url, opts) {
  const r = await fetch(url, opts);
  let obj;
  try { obj = await r.json(); } catch { throw new Error('Invalid provider response'); }
  if (!r.ok) throw new Error(obj.error || 'HTTP ' + r.status);
  return obj;
}
async function post(url, data) { return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
function node(tag, klass, value) {
  const e = document.createElement(tag);
  if (klass) e.className = klass;
  if (value !== undefined) e.textContent = value;
  return e;
}
function drawReasons(r) {
  const dest = $('reasons');
  dest.replaceChildren();
  dest.append(node('div', 'reason info', 'VERDICT: ' + r.verdict));
  (r.block_reasons || []).forEach(x => dest.append(node('div', 'reason danger', 'BLOCK / ' + x)));
  (r.warnings || []).forEach(x => dest.append(node('div', 'reason warning', 'WARN / ' + x)));
  if (!r.block_reasons.length && !r.warnings.length) dest.append(node('div', 'reason info', 'No policy warnings. Still research-only.'));
  dest.append(node('div', 'reason info', 'EXECUTION AUTHORIZED: NO'));
}
function choose(i) {
  current = cases[i]?.receipt;
  if (!current) return;
  document.querySelectorAll('.scenario').forEach((e, ix) => e.classList.toggle('selected', i === ix));
  setText('selectedTitle', cases[i].title);
  drawReasons(current);
  setText('receipt', JSON.stringify(current, null, 2));
  ['copy', 'verify', 'tamper'].forEach(id => $(id).disabled = false);
  setText('verifyStatus', 'Receipt ready for independent verification');
  $('verifyStatus').style.color = '';
}
async function runScenarios() {
  $('run').disabled = true;
  setText('run', 'RUNNING…');
  try {
    const result = await request('/api/v1/demo/scenarios');
    if (!result.synthetic) throw new Error('Demo scenario provenance missing');
    cases = result.cases;
    const dest = $('scenarios');
    dest.replaceChildren();
    cases.forEach((item, i) => {
      const b = node('button', 'scenario');
      b.type = 'button';
      b.append(node('span', 'num', 'CASE / 0' + (i + 1)));
      b.append(node('b', '', item.title));
      b.append(node('span', 'verdict ' + item.receipt.verdict, item.receipt.verdict));
      b.addEventListener('click', () => choose(i));
      dest.append(b);
    });
    choose(0);
  } catch (e) { setText('scenarios', 'Unable to run scenarios: ' + e.message); }
  finally { $('run').disabled = false; setText('run', 'RUN 4 SAFETY TESTS'); }
}
async function verify(tamper) {
  if (!current) return;
  let receipt = structuredClone(current);
  if (tamper) {
    if (receipt.type === 'token') receipt.evidence.liquidity_usd = 1;
    else receipt.evidence = { ...receipt.evidence, extra: 'tampered' };
  }
  setText('verifyStatus', 'Checking…');
  try {
    const { valid } = await post('/api/v1/demo/verify', { receipt });
    setText('verifyStatus', (valid ? '✓ VALID CONSISTENCY CHECK' : '✕ INVALID / RECEIPT MODIFIED') + (tamper ? ' (tampered copy)' : ''));
    $('verifyStatus').style.color = valid ? '#69f6dd' : '#ff929d';
  } catch (e) { setText('verifyStatus', e.message); }
}
async function assets() {
  $('assets').disabled = true;
  setText('assetStatus', 'Contacting NEAR Intents provider…');
  try {
    const result = await request('/api/v1/near/assets');
    setText('assetStatus', result.count + ' supported assets returned · ' + result.fetched_at_utc + ' · source ' + result.source);
    const chips = $('assetChips'); chips.replaceChildren();
    ['near', 'sol', 'eth', 'base', 'sui'].forEach(chain => {
      const n = result.assets.filter(x => x.chain === chain).length;
      chips.append(node('span', '', chain.toUpperCase() + ' · ' + n));
    });
    const wnear = result.assets.find(x => x.asset_id === 'nep141:wrap.near');
    if (wnear) $('quoteForm').elements.origin_asset_id.value = wnear.asset_id;
    const other = result.assets.find(x => x.chain !== 'near');
    if (other) $('quoteForm').elements.destination_asset_id.value = other.asset_id;
  } catch (e) { setText('assetStatus', 'LIVE PROVIDER UNAVAILABLE: ' + e.message); }
  finally { $('assets').disabled = false; }
}
async function quote(ev) {
  ev.preventDefault();
  const b = $('quoteForm').querySelector('button[type=submit]');
  b.disabled = true;
  setText('quoteResult', 'Validating dry-quote request…');
  const obj = Object.fromEntries(new FormData(ev.currentTarget));
  obj.slippage_bps = Number(obj.slippage_bps);
  try { setText('quoteResult', JSON.stringify(await post('/api/v1/near/quote', obj), null, 2)); }
  catch (e) { setText('quoteResult', 'Dry quote failed safely: ' + e.message); }
  finally { b.disabled = false; }
}
$('run').addEventListener('click', runScenarios);
$('copy').addEventListener('click', async () => { if (current) try { await navigator.clipboard.writeText(JSON.stringify(current, null, 2)); setText('copy', 'COPIED'); } catch { setText('copy', 'COPY NOT AVAILABLE'); } });
$('verify').addEventListener('click', () => verify(false));
$('tamper').addEventListener('click', () => verify(true));
$('assets').addEventListener('click', assets);
$('quoteForm').addEventListener('submit', quote);
runScenarios(); // Load synthetic judge walkthrough on first visit; users may rerun it.
