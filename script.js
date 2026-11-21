'use strict';
/* =========================================================================
   AKTU PLACEMENT ANALYTICS
   Part 1: pure logic (data cleaning, statistics, regression, evaluation)
   Part 2: user interface (pages, buttons, charts)
   ========================================================================= */

/* ------------------------------ PART 1: LOGIC ------------------------------ */
const Logic = (function () {
  const OVERALL = 'Overall';

  // ---- CSV parsing (PapaParse if loaded, tiny built-in parser otherwise) ----
  function parseCSVText(text) {
    text = String(text).replace(/^﻿/, '');
    if (typeof Papa !== 'undefined') {
      return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
    }
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = ''; rows.push(row); row = [];
      } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    const header = rows[0].map(s => s.trim());
    return rows.slice(1).filter(r => r.some(x => x.trim() !== '')).map(r => {
      const o = {}; header.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i]; }); return o;
    });
  }

  // Missing values become null. They are NEVER turned into zero.
  function num(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function text(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

  function normaliseBranch(b) {
    const t = text(b), l = t.toLowerCase();
    if (l === 'overall') return OVERALL;
    if (l === 'mis') return 'MIS';           // "Mis" and "MIS" become one name
    return t;
  }
  function yearNumber(label) {
    const m = String(label).match(/(\d{4})/);
    return m ? Number(m[1]) : null;
  }
  function yearLabel(y) { return y + '-' + String((y + 1) % 100).padStart(2, '0'); }

  function cleanRows(raw) {
    const rows = [];
    raw.forEach((r, idx) => {
      const get = k => {                       // tolerate stray spaces in header names
        if (k in r) return r[k];
        const key = Object.keys(r).find(x => x.trim().toLowerCase() === k.toLowerCase());
        return key === undefined ? '' : r[key];
      };
      const total = num(get('total_student')), placed = num(get('placed_students'));
      const calc = (total !== null && total > 0 && placed !== null) ? placed / total * 100 : null;
      const label = text(get('graduation_year'));
      rows.push({
        id: idx,
        college: text(get('college_name')),
        branch: normaliseBranch(get('Branch')),
        yearLabel: label,
        year: yearNumber(label),
        total, placed,
        csvPct: num(get('placement_percentage')),
        calcPct: calc,
        avgPkg: num(get('average_package')),
        highPkg: num(get('highest_package')),
        companies: text(get('total companies')) || null
      });
    });
    return rows;
  }

  // The percentage used everywhere (recomputed by default, CSV value on request)
  function pctOf(row, useCsv) { return useCsv ? row.csvPct : row.calcPct; }

  // College-level records = Overall rows only. Branch-level = every other row.
  function overallRows(rows, useCsv) {
    return rows.filter(r => r.branch === OVERALL && r.year !== null && pctOf(r, useCsv) !== null);
  }
  function branchRows(rows, useCsv) {
    return rows.filter(r => r.branch !== OVERALL && r.year !== null && pctOf(r, useCsv) !== null);
  }

  // ---- statistics ----
  const sum = a => a.reduce((s, x) => s + x, 0);
  const mean = a => a.length ? sum(a) / a.length : null;
  function quantile(sortedAsc, p) {            // linear interpolation (same as Excel QUARTILE.INC / NumPy)
    if (!sortedAsc.length) return null;
    const pos = (sortedAsc.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
  }
  function median(a) { return quantile([...a].sort((x, y) => x - y), 0.5); }
  function sampleVariance(a) {                 // divides by n-1
    if (a.length < 2) return null;
    const m = mean(a);
    return sum(a.map(x => (x - m) ** 2)) / (a.length - 1);
  }
  function modeOf(a) {                         // values compared at 2 decimals; no repeat = no mode
    const f = new Map();
    a.forEach(x => { const k = x.toFixed(2); f.set(k, (f.get(k) || 0) + 1); });
    let best = 0; f.forEach(c => { if (c > best) best = c; });
    if (best < 2) return { modes: [], count: best };
    return { modes: [...f].filter(([, c]) => c === best).map(([k]) => Number(k)), count: best };
  }
  function summary(a) {
    const s = [...a].sort((x, y) => x - y);
    const v = sampleVariance(a);
    const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75);
    return {
      n: a.length, mean: mean(a), median: quantile(s, 0.5), mode: modeOf(a),
      variance: v, sd: v === null ? null : Math.sqrt(v),
      min: s.length ? s[0] : null, max: s.length ? s[s.length - 1] : null,
      q1, q3, iqr: q1 === null ? null : q3 - q1
    };
  }
  function frequencyTable(a, width) {          // classes 0-10, 10-20 ... 90-100 (100 goes in the last class)
    const w = width || 10, nb = Math.ceil(100 / w), rows = [];
    for (let i = 0; i < nb; i++) rows.push({ lo: i * w, hi: (i + 1) * w, freq: 0 });
    a.forEach(x => { let i = Math.floor(x / w); if (i >= nb) i = nb - 1; if (i < 0) i = 0; rows[i].freq++; });
    let cum = 0;
    rows.forEach(r => { cum += r.freq; r.cum = cum; r.rel = a.length ? r.freq / a.length * 100 : 0; });
    return rows;
  }

  // ---- linear regression (least squares): y = intercept + slope * x ----
  function linreg(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    const mx = mean(xs), my = mean(ys);
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
    if (sxx === 0) return null;                // all x equal: no line can be fitted
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx, n };
  }
  const clip = v => Math.max(0, Math.min(100, v));

  function groupByCollege(rows, useCsv) {
    const m = new Map();
    rows.forEach(r => { if (!m.has(r.college)) m.set(r.college, []); m.get(r.college).push(r); });
    m.forEach(list => list.sort((a, b) => a.year - b.year));
    return m;
  }

  function predictNext(list, useCsv, targetYear) {
    const xs = list.map(r => r.year), ys = list.map(r => pctOf(r, useCsv));
    const m = linreg(xs, ys);
    if (!m) return null;
    const raw = m.intercept + m.slope * targetYear;
    return { model: m, raw, value: clip(raw), clipped: raw !== clip(raw) };
  }

  // ---- evaluation: train on all years but the latest, test on the latest ----
  function evaluate(rowsOverall, useCsv) {
    const points = [], skipped = [];
    groupByCollege(rowsOverall, useCsv).forEach((list, college) => {
      if (list.length < 3) { skipped.push({ college, records: list.length }); return; }
      const train = list.slice(0, -1), test = list[list.length - 1];
      const m = linreg(train.map(r => r.year), train.map(r => pctOf(r, useCsv)));
      if (!m) { skipped.push({ college, records: list.length }); return; }
      const pred = m.intercept + m.slope * test.year;   // not clipped, so the error is the model's own
      const actual = pctOf(test, useCsv);
      points.push({ college, testYear: test.year, testLabel: test.yearLabel,
        trainLabels: train.map(r => r.yearLabel), actual, pred, err: actual - pred });
    });
    const n = points.length;
    if (!n) return { points, skipped, n: 0, mae: null, mse: null, rmse: null, r2: null };
    const mae = mean(points.map(p => Math.abs(p.err)));
    const mse = mean(points.map(p => p.err ** 2));
    const ma = mean(points.map(p => p.actual));
    const sst = sum(points.map(p => (p.actual - ma) ** 2));
    const r2 = (n >= 2 && sst > 0) ? 1 - sum(points.map(p => p.err ** 2)) / sst : null;
    return { points, skipped, n, mae, mse, rmse: Math.sqrt(mse), r2 };
  }

  // ---- CSV export ----
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) {
    const head = ['college_name', 'Branch', 'graduation_year', 'year_number', 'total_student', 'placed_students',
      'placement_percentage_csv', 'placement_percentage_recomputed', 'average_package', 'highest_package', 'total companies'];
    const lines = [head.join(',')];
    rows.forEach(r => lines.push([r.college, r.branch, r.yearLabel, r.year, r.total, r.placed, r.csvPct,
      r.calcPct === null ? null : r.calcPct.toFixed(6), r.avgPkg, r.highPkg, r.companies].map(csvCell).join(',')));
    return lines.join('\r\n');
  }

  return { OVERALL, parseCSVText, cleanRows, pctOf, overallRows, branchRows, mean, median, quantile, sampleVariance,
    modeOf, summary, frequencyTable, linreg, clip, groupByCollege, predictNext, evaluate, toCSV, yearLabel, yearNumber, num };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Logic;

/* ------------------------------ PART 2: UI ------------------------------ */
if (typeof document !== 'undefined') {
  (function () {
    const L = Logic;
    const PALETTE = ['#1d4ed8', '#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316'];
    const state = {
      page: 'home', useCsv: false, level: 'college',
      aCollege: null, aYear: 'all',
      cmp: new Set(), pCollege: null,
      dsCollege: 'all', dsScope: 'all', dsSearch: ''
    };
    let rows = [], colleges = [], years = [], colorOf = {};
    let loadedFrom = '';
    const charts = {};

    // ---------- helpers ----------
    const $ = id => document.getElementById(id);
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const NA = '<span class="na">Not reported</span>';
    const f2 = v => v === null || v === undefined ? NA : v.toFixed(2);
    const fp = v => v === null || v === undefined ? NA : v.toFixed(2) + '%';
    const fi = v => v === null || v === undefined ? NA : Number(v).toLocaleString('en-IN');
    const P = r => L.pctOf(r, state.useCsv);
    const overall = () => L.overallRows(rows, state.useCsv);
    const branchOnly = () => L.branchRows(rows, state.useCsv);

    function chips(items, isActive, action, extra) {
      return items.map(it => `<button class="chip ${isActive(it.value) ? 'active' : ''}" data-action="${action}" data-value="${esc(it.value)}" aria-pressed="${isActive(it.value)}">${esc(it.label)}</button>`).join('') + (extra || '');
    }
    const collegeItems = () => colleges.map(c => ({ value: c, label: c }));
    function kpi(label, value, sub, small) {
      return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value ${small ? 'small' : ''}">${value}</div><div class="sub">${sub || ''}</div></div>`;
    }
    function mkChart(id, config) {
      if (charts[id]) { charts[id].destroy(); delete charts[id]; }
      const el = $(id);
      if (!el) return;
      if (typeof Chart === 'undefined') { el.parentElement.innerHTML = '<div class="error">Chart.js could not be loaded (check your internet connection).</div>'; return; }
      config.options = Object.assign({ responsive: true, maintainAspectRatio: false }, config.options || {});
      charts[id] = new Chart(el, config);
    }
    const yAxis = (title) => ({ min: 0, max: 100, title: { display: true, text: title || 'Placement %' } });
    function download(name, content) {
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    const table = (head, body, numCols) => `<div class="table-wrap"><table><thead><tr>${head.map((h, i) => `<th class="${numCols && numCols.includes(i) ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
    const tr = (cells, numCols) => `<tr>${cells.map((c, i) => `<td class="${numCols && numCols.includes(i) ? 'num' : ''}">${c}</td>`).join('')}</tr>`;

    function pageHeader(title, lead) { return `<h2>${title}</h2><p class="lead">${lead}</p>`; }

    // ---------- HOME ----------
    function renderHome() {
      const o = overall();
      if (!o.length) { $('page-home').innerHTML = pageHeader('Home', '') + '<div class="error">No usable Overall records found.</div>'; return; }
      const vals = o.map(P);
      const hi = o.reduce((a, b) => P(b) > P(a) ? b : a), lo = o.reduce((a, b) => P(b) < P(a) ? b : a);
      const byYear = years.map(y => { const v = o.filter(r => r.year === y).map(P); return v.length ? L.mean(v) : null; });
      const byCollege = colleges.map(c => { const v = o.filter(r => r.college === c).map(P); return v.length ? L.mean(v) : null; });
      $('page-home').innerHTML = pageHeader('Home Dashboard', 'Overview of college-level placement records (rows where Branch = "Overall").') + `
        <div class="grid kpis">
          ${kpi('Colleges', colleges.length, 'in the dataset')}
          ${kpi('Overall records', o.length, 'college × year')}
          ${kpi('Average placement', fp(L.mean(vals)), 'mean of all records')}
          ${kpi('Highest placement', fp(P(hi)), esc(hi.college) + ' · ' + esc(hi.yearLabel))}
          ${kpi('Lowest placement', fp(P(lo)), esc(lo.college) + ' · ' + esc(lo.yearLabel))}
        </div>
        <div class="grid two" style="margin-top:18px">
          <div class="card"><h3>Year-wise placement trend</h3><div class="chart-box"><canvas id="ch-home-trend"></canvas></div></div>
          <div class="card"><h3>Average placement by college</h3><div class="chart-box"><canvas id="ch-home-college"></canvas></div></div>
        </div>
        <div class="note">Placement % source: <b>${state.useCsv ? 'values stored in the CSV' : 'recomputed as placed ÷ total × 100'}</b>. Change it with the buttons under the navigation bar.</div>`;
      const ds = colleges.map(c => ({
        label: c, data: years.map(y => { const r = o.find(x => x.college === c && x.year === y); return r ? P(r) : null; }),
        borderColor: colorOf[c], backgroundColor: colorOf[c], borderWidth: 1.5, borderDash: [4, 4], pointRadius: 3, tension: .25, spanGaps: true
      }));
      ds.unshift({ label: 'All colleges (average)', data: byYear, borderColor: '#0b2a5b', backgroundColor: '#0b2a5b', borderWidth: 4, pointRadius: 5, tension: .25, spanGaps: true });
      mkChart('ch-home-trend', { type: 'line', data: { labels: years.map(L.yearLabel), datasets: ds },
        options: { scales: { y: yAxis() }, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y === null ? 'Not reported' : c.parsed.y.toFixed(2) + '%'}` } } } } });
      mkChart('ch-home-college', { type: 'bar', data: { labels: colleges, datasets: [{ label: 'Average placement %', data: byCollege, backgroundColor: colleges.map(c => colorOf[c]), borderRadius: 8 }] },
        options: { scales: { y: yAxis() }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y.toFixed(2) + '%' } } } } });
    }

    // ---------- COLLEGE ANALYSIS ----------
    function renderCollege() {
      const o = overall().filter(r => r.college === state.aCollege).sort((a, b) => a.year - b.year);
      const cYears = o.map(r => r.yearLabel);
      if (state.aYear !== 'all' && !cYears.includes(state.aYear)) state.aYear = 'all';
      const sel = state.aYear === 'all' ? o[o.length - 1] : o.find(r => r.yearLabel === state.aYear);
      const yr = sel ? sel.yearLabel : null;
      const branches = rows.filter(r => r.college === state.aCollege && r.branch !== L.OVERALL && r.yearLabel === yr);
      const withPct = branches.filter(r => P(r) !== null), without = branches.filter(r => P(r) === null);
      const compObj = sel ? sel.companies : null;

      let html = pageHeader('College Analysis', 'Pick a college and a year. Values that are missing in the dataset are shown as "Not reported" (never as zero).') + `
        <div class="controls">
          <div class="group"><h4>College</h4><div class="chips">${chips(collegeItems(), v => v === state.aCollege, 'acollege')}</div></div>
          <div class="group"><h4>Year</h4><div class="chips">${chips([{ value: 'all', label: 'Latest year' }, ...cYears.map(y => ({ value: y, label: y }))], v => v === state.aYear, 'ayear')}</div></div>
        </div>`;
      if (!sel) { $('page-college').innerHTML = html + '<div class="error">No Overall records for this college.</div>'; return; }
      html += `<h3 style="margin-top:0">${esc(state.aCollege)} · ${esc(sel.yearLabel)}</h3>
        <div class="grid kpis">
          ${kpi('Total students', fi(sel.total), 'Overall row')}
          ${kpi('Placed students', fi(sel.placed), 'Overall row')}
          ${kpi('Placement %', fp(P(sel)), state.useCsv ? 'CSV value' : 'placed ÷ total × 100')}
          ${kpi('Average package', sel.avgPkg === null ? NA : sel.avgPkg.toFixed(2), 'units as stored in dataset')}
          ${kpi('Highest package', sel.highPkg === null ? NA : sel.highPkg.toFixed(2), 'units as stored in dataset')}
          ${kpi('Companies visited', compObj ? esc(compObj) : NA, 'as reported')}
        </div>
        <div class="grid two" style="margin-top:18px">
          <div class="card"><h3>Placement trend (all years)</h3><div class="chart-box"><canvas id="ch-col-trend"></canvas></div></div>
          <div class="card"><h3>Branch-wise placement · ${esc(sel.yearLabel)}</h3>
            ${withPct.length ? '<div class="chart-box"><canvas id="ch-col-branch"></canvas></div>' : '<div class="note">No branch-wise percentage can be computed for this year.</div>'}
            ${without.length ? `<div class="note">Not reported (total students missing): ${without.map(r => `${esc(r.branch)} (${fi(r.placed)} placed)`).join(', ')}</div>` : ''}
          </div>
        </div>
        <div class="card"><h3>All records for ${esc(state.aCollege)}</h3>${table(['Year', 'Total students', 'Placed', 'Placement %', 'Avg package', 'Highest package', 'Companies'],
        o.map(r => tr([esc(r.yearLabel), fi(r.total), fi(r.placed), fp(P(r)), r.avgPkg === null ? NA : r.avgPkg.toFixed(2), r.highPkg === null ? NA : r.highPkg.toFixed(2), r.companies ? esc(r.companies) : NA], [1, 2, 3, 4, 5])).join(''), [1, 2, 3, 4, 5])}</div>`;
      $('page-college').innerHTML = html;
      mkChart('ch-col-trend', { type: 'line', data: { labels: cYears, datasets: [{ label: 'Placement %', data: o.map(P), borderColor: colorOf[state.aCollege], backgroundColor: colorOf[state.aCollege] + '33', fill: true, tension: .25, pointRadius: 5 }] },
        options: { scales: { y: yAxis() }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y.toFixed(2) + '%' } } } } });
      if (withPct.length) mkChart('ch-col-branch', { type: 'bar', data: { labels: withPct.map(r => r.branch), datasets: [{ label: 'Placement %', data: withPct.map(P), backgroundColor: '#2f6df0', borderRadius: 6 }] },
        options: { indexAxis: 'y', scales: { x: { min: 0, max: 100, title: { display: true, text: 'Placement %' } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.x.toFixed(2) + '%' } } } } });
    }

    // ---------- STATISTICS ----------
    function explain(s, label) {
      if (!s.n) return '';
      const m = s.mode.modes.length ? `The most repeated value is ${s.mode.modes.map(x => x.toFixed(2) + '%').join(', ')} (appears ${s.mode.count} times).` : 'No placement value repeats, so there is <b>no mode</b>.';
      return `<ul class="explain">
        <li><b>Mean (${fp(s.mean)}):</b> the usual "average". If every ${label} had the same placement, it would be this value. One very high or low value can pull it.</li>
        <li><b>Median (${fp(s.median)}):</b> the middle value after sorting. Half of the records are below it and half above it.</li>
        <li><b>Mode:</b> ${m}</li>
        <li><b>Variance (${s.variance === null ? 'needs 2+ records' : s.variance.toFixed(2)}):</b> how spread out the values are, using the sample formula (divide by n − 1). Bigger means more spread; its unit is %², so it is hard to read directly.</li>
        <li><b>Standard deviation (${s.sd === null ? 'needs 2+ records' : s.sd.toFixed(2)}):</b> the square root of variance. Roughly, a typical ${label} is about this many percentage points away from the mean.</li>
        <li><b>Minimum / Maximum (${fp(s.min)} / ${fp(s.max)}):</b> the weakest and strongest placement. The range is ${(s.max - s.min).toFixed(2)} points.</li>
        <li><b>Quartiles:</b> Q1 = ${fp(s.q1)} (25% of records are below), Q3 = ${fp(s.q3)} (75% are below). IQR = ${s.iqr.toFixed(2)} points: the spread of the middle half of the data.</li>
        <li><b>Frequency table &amp; histogram:</b> count how many records fall into each 10-point class (0–10, 10–20, …). A tall bar means many records have that placement level.</li>
        <li><b>Box plot:</b> the box runs from Q1 to Q3, the dark line is the median, the thin line reaches min and max. A long box or whiskers means a wide spread.</li>
      </ul>`;
    }
    function renderStats() {
      const isBranch = state.level === 'branch';
      const src = isBranch ? branchOnly() : overall();
      const vals = src.map(P), s = L.summary(vals);
      const label = isBranch ? 'branch record' : 'college record';
      let html = pageHeader('Statistics', 'Descriptive statistics of placement percentage. College-level and branch-level rows are never mixed.') + `
        <div class="controls"><div class="group"><h4>Statistical level</h4><div class="chips">
          ${chips([{ value: 'college', label: 'College-level (Overall rows)' }, { value: 'branch', label: 'Branch-level (branch rows)' }], v => v === state.level, 'level')}
        </div></div></div>`;
      if (!s.n) { $('page-stats').innerHTML = html + '<div class="error">No records available at this level.</div>'; return; }
      const na = '<span class="na">needs 2+ records</span>';
      html += `<div class="grid kpis">
          ${kpi('Records (n)', s.n, isBranch ? 'branch rows with a computable %' : 'Overall rows')}
          ${kpi('Mean', fp(s.mean))}${kpi('Median', fp(s.median))}
          ${kpi('Mode', s.mode.modes.length ? s.mode.modes.map(x => x.toFixed(2) + '%').join(', ') : '<span class="na">No mode</span>', s.mode.modes.length ? 'repeated ' + s.mode.count + '×' : 'no value repeats', true)}
          ${kpi('Variance (sample)', s.variance === null ? na : s.variance.toFixed(2), 'divides by n − 1')}
          ${kpi('Standard deviation', s.sd === null ? na : s.sd.toFixed(2), 'percentage points')}
          ${kpi('Minimum', fp(s.min))}${kpi('Maximum', fp(s.max))}
          ${kpi('Q1 (25%)', fp(s.q1))}${kpi('Q3 (75%)', fp(s.q3))}${kpi('IQR', s.iqr.toFixed(2), 'Q3 − Q1')}
        </div>
        <div class="card" style="margin-top:18px"><h3>What do these results mean?</h3>${explain(s, label)}</div>`;
      const ft = L.frequencyTable(vals, 10);
      html += `<div class="grid two"><div class="card"><h3>Frequency table (class width 10)</h3>${table(['Class (%)', 'Frequency', 'Relative %', 'Cumulative'],
        ft.map((r, i) => tr([`${r.lo} – ${r.hi}${i === ft.length - 1 ? ' (incl. 100)' : ''}`, r.freq, r.rel.toFixed(1) + '%', r.cum]), [1, 2, 3]).join(''), [1, 2, 3])}</div>
        <div class="card"><h3>Histogram</h3><div class="chart-box"><canvas id="ch-hist"></canvas></div></div></div>
        <div class="card"><h3>Box plot</h3><div class="chart-box tall"><canvas id="ch-box"></canvas></div></div>`;
      // per-college summary
      const groups = L.groupByCollege(src, state.useCsv);
      html += `<div class="card"><h3>Summary by college (${isBranch ? 'branch rows' : 'Overall rows'})</h3>${table(['College', 'n', 'Mean', 'Median', 'Std dev', 'Min', 'Max'],
        [...groups].map(([c, list]) => { const g = L.summary(list.map(P)); return tr([esc(c), g.n, fp(g.mean), fp(g.median), g.sd === null ? NA : g.sd.toFixed(2), fp(g.min), fp(g.max)], [1, 2, 3, 4, 5, 6]); }).join(''), [1, 2, 3, 4, 5, 6])}</div>`;
      $('page-stats').innerHTML = html;

      mkChart('ch-hist', { type: 'bar', data: { labels: ft.map(r => `${r.lo}–${r.hi}`), datasets: [{ label: 'Records', data: ft.map(r => r.freq), backgroundColor: '#2f6df0', borderRadius: 4, categoryPercentage: 1, barPercentage: .95 }] },
        options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Number of records' } }, x: { title: { display: true, text: 'Placement % class' } } }, plugins: { legend: { display: false } } } });

      // Box plot built from floating bars: whisker (min-max), box (Q1-Q3), median and mean markers
      const cats = [{ name: 'All records', v: vals }, ...[...groups].map(([c, list]) => ({ name: c, v: list.map(P) }))];
      const st = cats.map(c => L.summary(c.v));
      const thin = (arr, color, thick, name) => ({ label: name, data: arr, backgroundColor: color, borderWidth: 0, grouped: false, barThickness: thick });
      mkChart('ch-box', { type: 'bar', data: {
        labels: cats.map(c => c.name), datasets: [
          thin(st.map(x => [x.min, x.max]), '#7aa7ff', 4, 'Min – Max'),
          thin(st.map(x => [x.q1, x.q3]), '#2f6df0', 34, 'Q1 – Q3'),
          thin(st.map(x => [x.median - 0.4, x.median + 0.4]), '#0b2a5b', 34, 'Median'),
          thin(st.map(x => [x.mean - 0.4, x.mean + 0.4]), '#f59e0b', 18, 'Mean')] },
        options: { indexAxis: 'y', scales: { x: { min: 0, max: 100, title: { display: true, text: 'Placement %' } } },
          plugins: { tooltip: { callbacks: { label: c => {
            const x = st[c.dataIndex];
            if (c.dataset.label === 'Min – Max') return `Min ${x.min.toFixed(2)}% · Max ${x.max.toFixed(2)}%`;
            if (c.dataset.label === 'Q1 – Q3') return `Q1 ${x.q1.toFixed(2)}% · Q3 ${x.q3.toFixed(2)}%`;
            if (c.dataset.label === 'Median') return `Median ${x.median.toFixed(2)}%`;
            return `Mean ${x.mean.toFixed(2)}%`; } } } } } });
    }

    // ---------- COMPARISON ----------
    function renderCompare() {
      const o = overall();
      const sel = colleges.filter(c => state.cmp.has(c));
      let html = pageHeader('Comparison', 'Select two or more colleges (tap a chip to add or remove it).') + `
        <div class="controls"><div class="group"><h4>Colleges</h4><div class="chips">
          ${chips(collegeItems(), v => state.cmp.has(v), 'ctoggle')}
          <button class="chip ghost" data-action="call" data-value="">Select all</button>
          <button class="chip ghost" data-action="cnone" data-value="">Clear</button>
        </div></div></div>`;
      if (sel.length < 2) { $('page-compare').innerHTML = html + '<div class="note">Select at least two colleges to see the comparison.</div>'; return; }
      const data = sel.map(c => ({ c, list: o.filter(r => r.college === c).sort((a, b) => a.year - b.year) }));
      const head = ['College', ...years.map(L.yearLabel), 'Mean', 'Min', 'Max', 'Change (first → last)'];
      const body = data.map(({ c, list }) => {
        const v = list.map(P), ch = list.length >= 2 ? P(list[list.length - 1]) - P(list[0]) : null;
        return tr([esc(c), ...years.map(y => { const r = list.find(x => x.year === y); return r ? fp(P(r)) : NA; }),
          fp(L.mean(v)), fp(Math.min(...v)), fp(Math.max(...v)),
          ch === null ? NA : `<b style="color:${ch >= 0 ? 'var(--ok)' : 'var(--bad)'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)} pts</b>`], years.map((_, i) => i + 1).concat([years.length + 1, years.length + 2, years.length + 3, years.length + 4]));
      }).join('');
      html += `<div class="card"><h3>Comparison table</h3>${table(head, body, head.map((_, i) => i).slice(1))}</div>
        <div class="grid two"><div class="card"><h3>Year-wise trend</h3><div class="chart-box"><canvas id="ch-cmp-line"></canvas></div></div>
        <div class="card"><h3>Grouped bars by year</h3><div class="chart-box"><canvas id="ch-cmp-bar"></canvas></div></div></div>`;
      $('page-compare').innerHTML = html;
      const dsets = (type) => data.map(({ c, list }) => ({
        label: c, data: years.map(y => { const r = list.find(x => x.year === y); return r ? P(r) : null; }),
        borderColor: colorOf[c], backgroundColor: type === 'line' ? colorOf[c] : colorOf[c], borderWidth: type === 'line' ? 3 : 0, pointRadius: 5, tension: .25, spanGaps: true, borderRadius: type === 'bar' ? 6 : 0 }));
      const tip = { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y === null ? 'Not reported' : c.parsed.y.toFixed(2) + '%'}` } };
      mkChart('ch-cmp-line', { type: 'line', data: { labels: years.map(L.yearLabel), datasets: dsets('line') }, options: { scales: { y: yAxis() }, plugins: { tooltip: tip } } });
      mkChart('ch-cmp-bar', { type: 'bar', data: { labels: years.map(L.yearLabel), datasets: dsets('bar') }, options: { scales: { y: yAxis() }, plugins: { tooltip: tip } } });
    }

    // ---------- PREDICTION ----------
    function renderPredict() {
      const o = overall();
      const target = Math.max(...o.map(r => r.year)) + 1, tLabel = L.yearLabel(target);
      const list = o.filter(r => r.college === state.pCollege).sort((a, b) => a.year - b.year);
      const pr = L.predictNext(list, state.useCsv, target);
      let html = pageHeader('Prediction', `One Linear Regression per college: placement % against year, fitted by least squares. Estimate for ${tLabel}.`) + `
        <div class="warning">⚠️ This is a statistical <b>estimate</b> from only a few past years. It is not a guarantee and real placements can differ a lot.</div>
        <div class="controls"><div class="group"><h4>College</h4><div class="chips">${chips(collegeItems(), v => v === state.pCollege, 'pcollege')}</div></div></div>`;
      if (!pr) {
        html += `<div class="error">${esc(state.pCollege)} has ${list.length} usable record(s). At least 2 records (in different years) are needed to fit a line, so no prediction is shown.</div>`;
      } else {
        const m = pr.model;
        html += `<div class="grid kpis">
          ${kpi('Predicted placement ' + tLabel, fp(pr.value), pr.clipped ? 'model gave ' + pr.raw.toFixed(2) + '%, limited to 0–100' : 'clipped to 0–100 range')}
          ${kpi('Trend per year', (m.slope >= 0 ? '+' : '') + m.slope.toFixed(2) + ' pts', m.slope >= 0 ? 'rising on average' : 'falling on average')}
          ${kpi('Records used', m.n, list.map(r => r.yearLabel).join(', '), true)}
          ${kpi('Model', 'y = ' + m.intercept.toFixed(1) + (m.slope >= 0 ? ' + ' : ' − ') + Math.abs(m.slope).toFixed(2) + '·year', 'least squares line', true)}
        </div>
        <div class="card" style="margin-top:18px"><h3>Historical data and ${tLabel} estimate</h3><div class="chart-box"><canvas id="ch-pred"></canvas></div></div>`;
      }
      // table for all colleges
      html += `<div class="card"><h3>Estimates for every college (${tLabel})</h3>${table(['College', 'Records', 'Latest actual', 'Estimate ' + tLabel, 'Note'],
        colleges.map(c => { const l = o.filter(r => r.college === c).sort((a, b) => a.year - b.year), p = L.predictNext(l, state.useCsv, target);
          return tr([esc(c), l.length, l.length ? fp(P(l[l.length - 1])) : NA, p ? fp(p.value) : NA, p ? (p.clipped ? 'clipped to 0–100' : '') : 'needs 2+ records'], [1, 2, 3]); }).join(''), [1, 2, 3])}</div>`;
      $('page-predict').innerHTML = html;
      if (pr) {
        const labels = [...years.map(L.yearLabel), tLabel], xs = [...years, target];
        mkChart('ch-pred', { type: 'line', data: { labels, datasets: [
          { label: 'Actual placement %', data: xs.map(y => { const r = list.find(x => x.year === y); return r ? P(r) : null; }), borderColor: colorOf[state.pCollege], backgroundColor: colorOf[state.pCollege], borderWidth: 3, pointRadius: 5, spanGaps: true },
          { label: 'Fitted line', data: xs.map(y => L.clip(pr.model.intercept + pr.model.slope * y)), borderColor: '#64748b', borderDash: [6, 6], pointRadius: 0, borderWidth: 2 },
          { label: 'Predicted ' + tLabel, data: xs.map(y => y === target ? pr.value : null), borderColor: '#f59e0b', backgroundColor: '#f59e0b', pointStyle: 'triangle', pointRadius: 11, showLine: false }] },
          options: { scales: { y: yAxis() }, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y === null ? '' : c.parsed.y.toFixed(2) + '%'}` } } } } });
      }
    }

    // ---------- MODEL EVALUATION ----------
    function renderEval() {
      const ev = L.evaluate(overall(), state.useCsv);
      let html = pageHeader('Model Evaluation', 'For each college with at least 3 records, the model is trained on all years except the latest and tested on the latest year. Errors from all colleges are pooled.');
      if (!ev.n) { $('page-eval').innerHTML = html + '<div class="error">No college has 3 or more usable records, so the model cannot be evaluated.</div>'; return; }
      html += `<div class="warning">⚠️ Only <b>${ev.n}</b> test point${ev.n === 1 ? '' : 's'} exist (one per college). Treat these scores as a rough indication, not as proof of accuracy.</div>
        <div class="grid kpis">
          ${kpi('MAE', ev.mae.toFixed(3), 'mean absolute error (points)')}
          ${kpi('MSE', ev.mse.toFixed(3), 'mean squared error')}
          ${kpi('RMSE', ev.rmse.toFixed(3), 'root mean squared error')}
          ${kpi('R²', ev.r2 === null ? NA : ev.r2.toFixed(3), 'closer to 1 is better')}
        </div>
        <div class="grid two" style="margin-top:18px">
          <div class="card"><h3>Actual vs predicted (test year)</h3>${table(['College', 'Trained on', 'Test year', 'Actual', 'Predicted', 'Error'],
        ev.points.map(p => tr([esc(p.college), esc(p.trainLabels.join(', ')), esc(p.testLabel), fp(p.actual), fp(p.pred), (p.err >= 0 ? '+' : '') + p.err.toFixed(2)], [3, 4, 5])).join(''), [3, 4, 5])}
            ${ev.skipped.length ? `<div class="note">Skipped (fewer than 3 records): ${ev.skipped.map(s => esc(s.college) + ' (' + s.records + ')').join(', ')}</div>` : ''}</div>
          <div class="card"><h3>Chart</h3><div class="chart-box"><canvas id="ch-eval"></canvas></div></div>
        </div>
        <div class="note">Predictions here are the raw model output (not clipped), so the scores reflect the model itself. MAE = average size of the error. RMSE punishes big errors more. R² compares the model with simply guessing the average of the test values.</div>`;
      $('page-eval').innerHTML = html;
      mkChart('ch-eval', { type: 'bar', data: { labels: ev.points.map(p => p.college + ' (' + p.testLabel + ')'), datasets: [
        { label: 'Actual', data: ev.points.map(p => p.actual), backgroundColor: '#1d4ed8', borderRadius: 6 },
        { label: 'Predicted', data: ev.points.map(p => p.pred), backgroundColor: '#f59e0b', borderRadius: 6 }] },
        options: { scales: { y: { title: { display: true, text: 'Placement %' }, suggestedMin: 0, suggestedMax: 100 } }, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%` } } } } });
    }

    // ---------- DATASET ----------
    function filteredRows() {
      const q = state.dsSearch.trim().toLowerCase();
      return rows.filter(r => (state.dsCollege === 'all' || r.college === state.dsCollege)
        && (state.dsScope === 'all' || (state.dsScope === 'overall' ? r.branch === L.OVERALL : r.branch !== L.OVERALL))
        && (!q || [r.college, r.branch, r.yearLabel].some(s => s.toLowerCase().includes(q))));
    }
    function dsTableHTML() {
      const f = filteredRows();
      const body = f.map(r => {
        const diff = r.csvPct !== null && r.calcPct !== null && Math.abs(r.csvPct - r.calcPct) > 0.01;
        return `<tr${diff ? ' style="background:#fff7e6"' : ''}>${[esc(r.college), esc(r.branch), esc(r.yearLabel), fi(r.total), fi(r.placed), fp(r.csvPct), fp(r.calcPct) + (diff ? ' ⚠️' : ''),
          r.avgPkg === null ? NA : r.avgPkg, r.highPkg === null ? NA : r.highPkg, r.companies ? esc(r.companies) : NA].map((c, i) => `<td class="${i >= 3 && i <= 8 ? 'num' : ''}">${c}</td>`).join('')}</tr>`;
      }).join('');
      return `<p class="lead">Showing <b>${f.length}</b> of ${rows.length} rows. ⚠️ marks rows where the CSV percentage differs from placed ÷ total.</p>` +
        table(['College', 'Branch', 'Year', 'Total students', 'Placed', 'Placement % (CSV)', 'Placement % (recomputed)', 'Avg package', 'Highest package', 'Companies'], body || '<tr><td colspan="10">No rows match.</td></tr>');
    }
    function renderDataset() {
      const cols = [['college_name', r => r.college], ['Branch', r => r.branch], ['graduation_year', r => r.yearLabel], ['total_student', r => r.total],
        ['placed_students', r => r.placed], ['placement_percentage', r => r.csvPct], ['average_package', r => r.avgPkg], ['highest_package', r => r.highPkg], ['total companies', r => r.companies]];
      const colInfo = cols.map(([n, g]) => { const vals = rows.map(g), miss = vals.filter(v => v === null || v === '').length;
        const numeric = vals.filter(v => v !== null && v !== '').every(v => typeof v === 'number');
        return { n, type: numeric ? 'number' : 'text', filled: rows.length - miss, miss }; });
      const mism = rows.filter(r => r.csvPct !== null && r.calcPct !== null && Math.abs(r.csvPct - r.calcPct) > 0.01);
      const nOverall = rows.filter(r => r.branch === L.OVERALL).length;
      $('page-dataset').innerHTML = pageHeader('Dataset', 'Browse, search and download the data. Missing values stay missing: they are never turned into zero.') + `
        <div class="grid kpis">${kpi('Rows', rows.length)}${kpi('Columns', cols.length)}${kpi('Overall rows', nOverall, 'used for college-level analysis')}${kpi('Branch rows', rows.length - nOverall, 'used for branch-level analysis')}</div>
        ${mism.length ? `<div class="warning" style="margin-top:18px">⚠️ ${mism.length} row${mism.length > 1 ? 's have' : ' has'} a CSV placement % that does not match placed ÷ total: ${mism.map(r => `${esc(r.college)} ${esc(r.yearLabel)} ${esc(r.branch)} (CSV ${r.csvPct.toFixed(2)}% vs ${r.calcPct.toFixed(2)}%)`).join('; ')}. The site recomputes the value by default.</div>` : ''}
        <div class="grid two" style="margin-top:18px">
          <div class="card"><h3>Column types &amp; missing values</h3>${table(['Column', 'Type', 'Filled', 'Missing'], colInfo.map(c => tr([esc(c.n), c.type, c.filled, c.miss ? `<b style="color:var(--warn)">${c.miss}</b>` : '0'], [2, 3])).join(''), [2, 3])}
            <div class="note">"total companies" is text because values like "50+" are not exact numbers.</div></div>
          <div class="card"><h3>Download</h3><p class="lead">The cleaned file has consistent branch names (Mis/MIS → MIS), a year number, and both the CSV and recomputed placement %. Missing cells stay empty.</p>
            <div class="chips"><button class="btn" data-action="dl-clean">⬇ Download cleaned CSV</button><button class="btn secondary" data-action="dl-filtered">⬇ Download current view</button></div></div>
        </div>
        <div class="controls"><div class="group"><h4>Search</h4><input id="ds-search" class="search" type="search" placeholder="Search college, branch or year…" value="${esc(state.dsSearch)}" /></div>
          <div class="group"><h4>College</h4><div class="chips">${chips([{ value: 'all', label: 'All colleges' }, ...collegeItems()], v => v === state.dsCollege, 'dscollege')}</div></div>
          <div class="group"><h4>Rows</h4><div class="chips">${chips([{ value: 'all', label: 'All rows' }, { value: 'overall', label: 'Overall only' }, { value: 'branch', label: 'Branch rows only' }], v => v === state.dsScope, 'dsscope')}</div></div></div>
        <div class="card" id="ds-table">${dsTableHTML()}</div>`;
      $('ds-search').addEventListener('input', e => { state.dsSearch = e.target.value; $('ds-table').innerHTML = dsTableHTML(); });
    }

    // ---------- ROUTING / EVENTS ----------
    const RENDER = { home: renderHome, college: renderCollege, stats: renderStats, compare: renderCompare, predict: renderPredict, eval: renderEval, dataset: renderDataset };
    function show(page) {
      if (!RENDER[page]) page = 'home';
      state.page = page;
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
      document.querySelectorAll('.pill').forEach(b => {
        const on = b.dataset.value === page; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false');
        if (on) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      });
      document.querySelectorAll('.settingsbar .chip').forEach(b => b.classList.toggle('active', (b.dataset.value === 'csv') === state.useCsv));
      RENDER[page]();
    }
    function onAction(a, v) {
      switch (a) {
        case 'nav': history.replaceState(null, '', '#' + v); window.scrollTo({ top: 0 }); return show(v);
        case 'src': state.useCsv = v === 'csv'; return show(state.page);
        case 'acollege': state.aCollege = v; state.aYear = 'all'; break;
        case 'ayear': state.aYear = v; break;
        case 'level': state.level = v; break;
        case 'ctoggle': state.cmp.has(v) ? state.cmp.delete(v) : state.cmp.add(v); break;
        case 'call': colleges.forEach(c => state.cmp.add(c)); break;
        case 'cnone': state.cmp.clear(); break;
        case 'pcollege': state.pCollege = v; break;
        case 'dscollege': state.dsCollege = v; break;
        case 'dsscope': state.dsScope = v; break;
        case 'dl-clean': return download('aktu_placement_cleaned.csv', L.toCSV(rows));
        case 'dl-filtered': return download('aktu_placement_filtered.csv', L.toCSV(filteredRows()));
        default: return;
      }
      show(state.page);
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (b) onAction(b.dataset.action, b.dataset.value);
    });
    window.addEventListener('hashchange', () => show(location.hash.slice(1) || 'home'));

    // ---------- START ----------
    function start(text, from) {
      rows = L.cleanRows(L.parseCSVText(text));
      const o = L.overallRows(rows, false);
      colleges = [...new Set(rows.filter(r => r.branch === L.OVERALL).map(r => r.college))].sort();
      years = [...new Set(o.map(r => r.year))].sort((a, b) => a - b);
      colleges.forEach((c, i) => { colorOf[c] = PALETTE[i % PALETTE.length]; });
      state.aCollege = colleges[0]; state.pCollege = colleges[0];
      colleges.slice(0, 3).forEach(c => state.cmp.add(c));
      loadedFrom = from;
      $('status').textContent = `Data loaded from ${from} · ${rows.length} rows · ${colleges.length} colleges`;
      show(location.hash.slice(1) || 'home');
    }
    function fail(msg) { $('status').innerHTML = `<div class="error">${msg}</div>`; }

    fetch('placement_data_filled.csv')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(t => start(t, 'placement_data_filled.csv'))
      .catch(() => {
        if (typeof EMBEDDED_CSV === 'string') start(EMBEDDED_CSV, 'the built-in backup copy (data.js) because the CSV file could not be fetched. Use VS Code Live Server or GitHub Pages to read the CSV file directly');
        else fail('Could not load placement_data_filled.csv. Open the site with VS Code "Live Server" (double-clicking index.html blocks fetch).');
      });
  })();
}
