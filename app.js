/* ============================================================
   장애인기업종합지원센터 전국 월간 모니터링 리포트
   그래프 1개 = CSV 1개 구조. data/ 폴더 CSV만 수정하면 갱신됨.

   data/
     holidays.csv       주말·공휴일 목록
     temp_hq.csv        본사 온도 (서울1층, 서울3층, 최고기온)
     temp_regional.csv  지역센터 온도 (진주, 충북, 부천, 최고기온)
     temp_gachi.csv     가치만드소 온도 (광주, 아산, 최고기온)
     oper_hq.csv        본사 층별 가동시간
     oper_north.csv     북부(부천) 공간별 가동시간
     oper_middle.csv    중부(충북) 공간별 가동시간
     oper_south.csv     남부(진주) 공간별 가동시간
     oper_gachi.csv     가치만드소 공간별 가동시간
     increase_work.csv  전월 대비 증감 (근무시간)
     increase_off.csv   전월 대비 증감 (근무외)
   ============================================================ */

const OUTDOOR_KEY = '최고기온(℃)';
const LC = ['#2D6BFF','#E5484D','#22C55E','#F59E0B','#7C3AED','#0F766E','#BE185D','#0EA5E9'];
const GRID = '#EEF1F6';
let HOLIDAYS = new Set();

/* ── CSV 파서 ──────────────────────────────────────────────── */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  return lines.map(line => {
    const cells = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { cells.push(cur); cur = ''; }
        else cur += c;
      }
    }
    cells.push(cur);
    return cells.map(s => s.trim());
  });
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(v); return isNaN(n) ? null : n;
}

function toSeriesMap(rows) {
  const names = rows[0].slice(1);
  const map = {}; names.forEach(n => map[n] = []);
  const labels = [];
  for (let r = 1; r < rows.length; r++) {
    const d = rows[r][0] ?? '';
    const m = d.match(/(\d{4})-(\d{2})-(\d{2})/);
    labels.push(m ? String(Number(m[3])) : d);
    names.forEach((n, ci) => map[n].push(num(rows[r][ci+1])));
  }
  return { names, map, labels };
}

function toObjects(rows) {
  const header = rows[0];
  return rows.slice(1).map(row => {
    const o = {}; header.forEach((h, i) => o[h] = row[i] ?? ''); return o;
  });
}

/* ── 주말·공휴일 x축 빨간 라벨 ─────────────────────────────── */
function tickColor() {
  return ctx => HOLIDAYS.has(Number(ctx.tick.label)) ? '#E5484D' : '#5B6577';
}

/* ── 28℃ 이상 빨간 구역 플러그인 ───────────────────────────── */
const redZonePlugin = {
  id: 'redZone',
  beforeDraw(chart) {
    const { ctx, chartArea, scales: { y } } = chart;
    if (!chartArea || !y) return;
    const y28 = y.getPixelForValue(28);
    if (y28 > chartArea.top) {
      ctx.save();
      ctx.fillStyle = 'rgba(229,72,77,0.08)';
      ctx.fillRect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, y28 - chartArea.top);
      ctx.strokeStyle = 'rgba(229,72,77,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y28);
      ctx.lineTo(chartArea.right, y28);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
};

/* ── 온도 라인 차트 (실외 점선, 28℃ 빨간 구역) ─────────────── */
function mkTempChart(canvasId, legendId, locationName, series) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const innerNames = series.names.filter(n => n !== OUTDOOR_KEY);
  const datasets = innerNames.map((label, i) => ({
    label, data: series.map[label],
    borderColor: LC[i % LC.length], backgroundColor: 'transparent',
    borderWidth: 2, fill: false, spanGaps: true, tension: .35,
    pointRadius: 0, pointHoverRadius: 4
  }));
  if (series.map[OUTDOOR_KEY]) {
    datasets.push({
      label: '실외 최고기온', data: series.map[OUTDOOR_KEY],
      borderColor: '#111827', backgroundColor: 'transparent',
      borderWidth: 1.8, borderDash: [5, 4], fill: false, spanGaps: true,
      tension: .35, pointRadius: 0, pointHoverRadius: 4
    });
  }
  const chart = new Chart(el, {
    type: 'line',
    data: { labels: series.labels, datasets },
    plugins: [redZonePlugin],
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: items => `${items[0].label}일`, label: c => ` ${c.dataset.label}: ${c.parsed.y}℃` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16, font: { size: 9 }, color: tickColor() } },
        y: { min: 14, suggestedMax: 34, ticks: { callback: v => v + '℃', font: { size: 9.5 } }, grid: { color: GRID } }
      }
    }
  });
  if (legendId) {
    const lg = document.getElementById(legendId);
    if (lg) {
      lg.innerHTML = innerNames.map((n, i) => `<span><i style="background:${LC[i%LC.length]}"></i>${n}</span>`).join('') +
        `<span><i style="background:#111827;height:0;border-top:2px dashed #111827;width:18px"></i>실외 최고기온</span>` +
        `<span><i style="background:rgba(229,72,77,0.15);border:1px dashed rgba(229,72,77,0.4);width:12px;height:12px;border-radius:2px"></i>28℃ 이상</span>`;
    }
  }
}

/* ── 단일 위치 온도 차트 (그룹 CSV에서 하나의 컬럼만) ────────── */
function mkSingleTempChart(canvasId, locationKey, series) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const datasets = [{
    label: locationKey, data: series.map[locationKey],
    borderColor: '#2D6BFF', backgroundColor: 'transparent',
    borderWidth: 2, fill: false, spanGaps: true, tension: .35,
    pointRadius: 0, pointHoverRadius: 4
  }];
  if (series.map[OUTDOOR_KEY]) {
    datasets.push({
      label: '실외 최고기온', data: series.map[OUTDOOR_KEY],
      borderColor: '#111827', backgroundColor: 'transparent',
      borderWidth: 1.8, borderDash: [5, 4], fill: false, spanGaps: true,
      tension: .35, pointRadius: 0, pointHoverRadius: 4
    });
  }
  new Chart(el, {
    type: 'line',
    data: { labels: series.labels, datasets },
    plugins: [redZonePlugin],
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: items => `${items[0].label}일`, label: c => ` ${c.dataset.label}: ${c.parsed.y}℃` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16, font: { size: 9 }, color: tickColor() } },
        y: { min: 14, suggestedMax: 34, ticks: { callback: v => v + '℃', font: { size: 9.5 } }, grid: { color: GRID } }
      }
    }
  });
}

/* ── 가동시간 라인 차트 ─────────────────────────────────────── */
function mkOperLine(canvasId, legendId, series) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  new Chart(el, {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: series.names.map((label, i) => ({
        label, data: series.map[label],
        borderColor: LC[i % LC.length], backgroundColor: 'transparent',
        borderWidth: 1.9, fill: false, spanGaps: true, tension: .35,
        pointRadius: 0, pointHoverRadius: 4
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: items => `${items[0].label}일`, label: c => ` ${c.dataset.label}: ${c.parsed.y}h` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16, font: { size: 9 }, color: tickColor() } },
        y: { min: 0, suggestedMax: 6, ticks: { callback: v => v + 'h', font: { size: 9.5 } }, grid: { color: GRID } }
      }
    }
  });
  if (legendId) {
    const lg = document.getElementById(legendId);
    if (lg) lg.innerHTML = series.names.map((n, i) => `<span><i style="background:${LC[i%LC.length]}"></i>${n}</span>`).join('');
  }
}

/* ── 전월 대비 증감 표 ─────────────────────────────────────── */
function fillIncreaseTable(tbodyId, rows) {
  const tb = document.getElementById(tbodyId);
  if (!tb) return;
  const data = rows.map(r => {
    const zone = (r['HUB_NICKNAME'] || r['지역'] || '').replace(/^[^_]+_/, '');
    const prev = num(r['총가동시간_시간_4월']) ?? 0;
    const cur  = num(r['총가동시간_시간_5월']) ?? 0;
    const diff = +(cur - prev).toFixed(1);
    const pct  = prev > 0 ? +((diff / prev) * 100).toFixed(1) : null;
    return { zone, prev, cur, diff, pct };
  }).sort((a, b) => b.diff - a.diff);
  tb.innerHTML = data.map((r, i) => {
    const pctTxt = r.pct == null ? '—' : `<span class="${r.pct>0?'risk':'ok-txt'}">${r.pct>0?'▲':'▼'} ${Math.abs(r.pct)}%</span>`;
    const diffTxt = `<span class="${r.diff>0?'risk':'ok-txt'}">${r.diff>0?'+':''}${r.diff}</span>`;
    const rank = i === 0 ? '<span class="rk1">1</span>' : `<span class="rkn">${i+1}</span>`;
    return `<tr><td class="num">${rank}</td><td><strong>${r.zone}</strong></td><td class="num">${r.prev}</td><td class="num">${r.cur}</td><td class="num">${diffTxt}</td><td class="num">${pctTxt}</td></tr>`;
  }).join('');
}

/* ── 에러 표시 ─────────────────────────────────────────────── */
function showError(msg) {
  const div = document.createElement('div');
  div.style.cssText = 'background:#FEECEC;border:1px solid #E5484D;color:#B91C1C;padding:14px 18px;border-radius:10px;margin:16px 0;font-size:13px;line-height:1.6';
  div.innerHTML = `<strong>데이터를 불러오지 못했습니다.</strong><br>${msg}<br><span style="color:#7A1F1F;font-size:12px">로컬 서버에서 열었는지(예: <code>python -m http.server</code>), data 폴더의 CSV 파일이 있는지 확인해 주세요.</span>`;
  document.body.prepend(div);
}

/* ── 메인 ──────────────────────────────────────────────────── */
async function main() {
  Chart.defaults.font.family = "'Pretendard Variable', Pretendard, -apple-system, system-ui, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#5B6577';

  const files = [
    'data/holidays.csv',
    'data/temp_hq.csv', 'data/temp_regional.csv', 'data/temp_gachi.csv',
    'data/oper_hq.csv', 'data/oper_north.csv', 'data/oper_middle.csv',
    'data/oper_south.csv', 'data/oper_gachi.csv',
    'data/increase_work.csv', 'data/increase_off.csv'
  ];

  let texts;
  try {
    const res = await Promise.all(files.map(f => fetch(f)));
    if (res.some(r => !r.ok)) throw new Error('CSV 파일 응답 오류 (HTTP)');
    texts = await Promise.all(res.map(r => r.text()));
  } catch(e) { showError(e.message); return; }

  let holiRows, tempHQ, tempRegional, tempGachi,
      operHQ, operNorth, operMiddle, operSouth, operGachi,
      incWork, incOff;
  try {
    [0].forEach(() => {
      holiRows     = toObjects(parseCSV(texts[0]));
      tempHQ       = toSeriesMap(parseCSV(texts[1]));
      tempRegional = toSeriesMap(parseCSV(texts[2]));
      tempGachi    = toSeriesMap(parseCSV(texts[3]));
      operHQ       = toSeriesMap(parseCSV(texts[4]));
      operNorth    = toSeriesMap(parseCSV(texts[5]));
      operMiddle   = toSeriesMap(parseCSV(texts[6]));
      operSouth    = toSeriesMap(parseCSV(texts[7]));
      operGachi    = toSeriesMap(parseCSV(texts[8]));
      incWork      = toObjects(parseCSV(texts[9]));
      incOff       = toObjects(parseCSV(texts[10]));
    });
  } catch(e) { showError('CSV 파싱 오류: ' + e.message); return; }

  HOLIDAYS = new Set(holiRows.map(r => num(Object.values(r)[0])).filter(v => v != null));

  /* 3. 온도 차트 — 본사 (서울 1층, 3층 각각) */
  mkSingleTempChart('c-temp-hq-1f', '서울_1층_평균온도', tempHQ);
  mkSingleTempChart('c-temp-hq-3f', '서울_3층_평균온도', tempHQ);

  /* 3. 온도 차트 — 지역센터 (진주, 충북, 부천 각각) */
  mkSingleTempChart('c-temp-jinju',  '진주_평균온도',  tempRegional);
  mkSingleTempChart('c-temp-chungbuk', '충북_평균온도', tempRegional);
  mkSingleTempChart('c-temp-bucheon', '부천_평균온도', tempRegional);

  /* 3. 온도 차트 — 가치만드소 (광주, 아산 각각) */
  mkSingleTempChart('c-temp-gwangju', '광주_평균온도', tempGachi);
  mkSingleTempChart('c-temp-asan',    '아산_평균온도',  tempGachi);

  /* 4. 가동시간 라인 차트 */
  mkOperLine('c-oper-hq',     'lg-oper-hq',     operHQ);
  mkOperLine('c-oper-north',  'lg-oper-north',   operNorth);
  mkOperLine('c-oper-middle', 'lg-oper-middle',  operMiddle);
  mkOperLine('c-oper-south',  'lg-oper-south',   operSouth);
  mkOperLine('c-oper-gachi',  'lg-oper-gachi',   operGachi);

  /* 5. 전월 대비 증감 표 */
  fillIncreaseTable('incWorkB', incWork);
  fillIncreaseTable('incOffB',  incOff);
}

window.addEventListener('DOMContentLoaded', main);
