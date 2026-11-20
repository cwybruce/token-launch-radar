/* Token Radar dashboard: board, filters, sort, detail view, live comparables.
   Reads window.RADAR written by main.ts from the sealed snapshot. No network. */
(function () {
  var D = window.RADAR;
  if (!D) { document.body.innerHTML = '<p style="padding:30px">Radar data (data.js) did not load.</p>'; return; }
  var $ = function (id) { return document.getElementById(id); };
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(c) { return c == null ? '—' : (c > 0 ? '+' : '') + c.toFixed(1) + '%'; }
  function age(a) { return a == null ? 'unknown' : a >= 365 ? (a / 365).toFixed(1) + 'y' : a + 'd'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  $('asOf').textContent = D.as_of;
  $('src').textContent = D.source;
  $('stats').innerHTML =
    '<div class="stat"><b>' + D.board_size + '</b><span>pre-token rows</span></div>' +
    '<div class="stat"><b>' + D.watchlist_size + '</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + D.model.live_median_mcap_tvl.toFixed(2) + 'x</b><span>live median mcap/TVL</span></div>' +
    '<div class="stat"><b>' + money(D.rows[0].implied_value_usd) + '</b><span>top implied value</span></div>';
  $('modelBox').innerHTML = '<b>How the value is built (model ' + esc(D.model_version) + ').</b> ' +
    'implied = TVL × <code>0.28</code> (base, anchored near the live median of ' + D.model.live_median_mcap_tvl.toFixed(2) +
    'x) × size (smaller protocols earn the higher multiple, TVL<sup>−0.06</sup>) × growth (7-day TVL change; falls punished 1.5× harder than rises are rewarded) ' +
    '× maturity (longer with no token, up to 1.0) × chains (2% per extra chain, capped). ' +
    'One function scores every protocol; no name is special-cased. “Records no token” means the snapshot carries no token for it — not proof it has none.';

  var cats = [], chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  cats.forEach(function (c) { $('cat').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });
  chains.forEach(function (c) { $('chain').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });

  var selected = null;
  function filtered() {
    var q = $('q').value.trim().toLowerCase(), cat = $('cat').value, ch = $('chain').value, wo = $('watchOnly').checked;
    var list = D.rows.filter(function (r) {
      if (wo && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (ch && r.chains.indexOf(ch) < 0) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var s = $('sort').value;
    list.sort(function (a, b) {
      if (s === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (s === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (s === 'age') return (b.age_days || 0) - (a.age_days || 0);
      return a.rank - b.rank;
    });
    return list;
  }
  function render() {
    var list = filtered();
    $('rows').innerHTML = list.map(function (r) {
      var g = r.change_7d == null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (selected === r.slug ? 'sel' : '') + '"><td>' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '<br><span style="color:var(--muted);font-size:12px">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num ' + g + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td><td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + r.implied_tvl_multiple.toFixed(2) + 'x</td></tr>';
    }).join('');
    $('count').textContent = list.length + ' of ' + D.board_size + ' pre-token protocols shown. Click a row for its detail and farm plan.';
    document.querySelectorAll('#rows tr').forEach(function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }
  function bar(label, val, max) {
    var p = Math.max(4, Math.min(100, Math.round(val / max * 100)));
    return '<div class="bar"><span>' + label + '</span><b>' + val.toFixed(2) + 'x</b><i><em style="width:' + p + '%"></em></i></div>';
  }
  function showDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    selected = slug;
    var m = r.model;
    $('detail').hidden = false;
    $('detail').innerHTML = '<h2>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) + ' · TVL ' + money(r.tvl_usd) +
      ' · 7-day ' + pct(r.change_7d) + ' · tracked ' + age(r.age_days) + ' · snapshot ' + esc(D.as_of) +
      ' · records no token (no market cap, no CoinGecko id, no symbol in the snapshot).</p>' +
      '<div class="bars">' +
      '<div class="bar"><span>Implied launch value</span><b>' + money(r.implied_value_usd) + '</b><i><em style="width:100%"></em></i></div>' +
      bar('Size multiple', m.size_multiplier, 1.25) + bar('Growth multiple', m.growth_multiplier, 2.0) +
      bar('Maturity multiple', m.maturity_multiplier, 1.0) + bar('Chain multiple', m.chain_multiplier, 1.12) +
      '<div class="bar"><span>Implied / TVL</span><b>' + r.implied_tvl_multiple.toFixed(2) + 'x</b><i><em style="width:' + Math.min(100, r.implied_tvl_multiple / 0.5 * 100) + '%"></em></i></div></div>' +
      '<p style="color:var(--muted)">Model: TVL × 0.28 × ' + m.size_multiplier.toFixed(2) + ' (size) × ' + m.growth_multiplier.toFixed(2) +
      ' (growth ' + (m.growth_pct >= 0 ? '+' : '') + m.growth_pct.toFixed(1) + '%) × ' + m.maturity_multiplier.toFixed(2) +
      ' (maturity) × ' + m.chain_multiplier.toFixed(2) + ' (chains). Live-token median is ' + D.model.live_median_mcap_tvl.toFixed(2) + 'x TVL.</p>' +
      '<h3>How to farm it — 5 steps, with cost and time</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p style="color:var(--muted)">Farm with money you can afford to leave locked for 8–12 weeks. An airdrop is never guaranteed; a snapshot can happen any day, so positions should be open before any announcement, not after.</p>';
    render();
    $('detail').scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  $('liveRows').innerHTML = D.live.map(function (r) {
    return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd) + '</td>' +
      '<td class="num">' + r.ratio.toFixed(2) + 'x</td></tr>';
  }).join('');

  ['q', 'cat', 'chain', 'sort', 'watchOnly'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  // Deep links for screenshots and sharing: #detail=<slug>, #filter=<category>, #q=<text>
  var h = location.hash || '';
  var dm = h.match(/detail=([^&]+)/), fm = h.match(/filter=([^&]+)/), qm = h.match(/q=([^&]+)/);
  if (fm) { $('cat').value = decodeURIComponent(fm[1]); }
  if (qm) { $('q').value = decodeURIComponent(qm[1]); }
  render();
  if (dm) showDetail(decodeURIComponent(dm[1]));
})();
