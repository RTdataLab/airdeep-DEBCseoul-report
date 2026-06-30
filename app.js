/* ============================================================
   서울 본사 장애인기업종합지원센터 월간 모니터링 리포트

   데이터 파일명은 아래 DATA_FILES 설정표에서 관리합니다.
   데이터팀이 보낸 CSV를 그 이름 그대로 data/ 폴더에 넣으면
   새로고침 시 리포트가 자동 갱신됩니다. (파일명이 바뀌면 설정표만 수정)
   ============================================================ */

const DAYS = Array.from({length:30},(_,i)=>i+1);          // 6월 = 30일
const LC   = ['#2D6BFF','#E5484D','#22C55E','#F59E0B','#7C3AED','#0F766E','#BE185D','#0EA5E9','#78716C','#DB2777'];
const TT   = {backgroundColor:'#0B1220',titleColor:'#fff',bodyColor:'#E5E9F0',padding:10,cornerRadius:8,displayColors:true,boxWidth:10,boxHeight:10,boxPadding:3};
const OUTDOOR_KEY = '최고기온(℃)';
const HOT_TEMP = 28;
let HOLIDAYS = new Set();                                  // 날짜에서 자동 계산

/* ✏️ 데이터 파일 설정표 — 데이터팀 파일명을 그대로 적으면 됩니다. (CSV만 지원) */
const DATA_FILES = {
  tempZone:  '3-1.csv',    // 섹션3-1 — 구역별 일평균 실내온도
  ctrlLow:   '3-2.1.csv',  // 섹션3-2-1 — 1·2·3층·별관 제어기 온도
  ctrl6:     '3-2.2.csv',  // 섹션3-2-2 — 6층 제어기 온도
  ctrl7:     '3-2.3.csv',  // 섹션3-2-3 — 7층 제어기 온도
  operZone:  '4-1.csv',    // 섹션4-1 — 구역별 일평균 가동시간
  operSpace: '4-2.csv',    // 섹션4-2 — 공간구분별 일평균 가동시간
  incWork:   '4-3.csv',    // 섹션4-3 — 전월대비 증가(근무시간)
  incOff:    '4-4.csv'     // 섹션4-4 — 전월대비 증가(근무외)
};

/* ✏️ 공휴일 날짜 — 주말(토·일)은 자동 계산되고, 여기엔 공휴일만 적으면 됩니다.
   해당 날짜의 x축 라벨이 빨간색으로 표시됩니다. (매달 이 줄만 갱신) */
const PUBLIC_HOLIDAYS = []; // 2026년 6월 평일 공휴일은 확인 후 입력

function isHolidayDate(s){
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return false;
  const day = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getDay();
  return day === 0 || day === 6 || PUBLIC_HOLIDAYS.includes(m[0]);
}

function dataUrl(name){
  // CSV를 수정하면 항상 최신 데이터를 다시 불러오도록 매번 다른 값을 붙임
  return `data/${name}?v=${Date.now()}`;
}

/* ── CSV 파서 ──────────────────────────────────────────────── */
function parseCSV(text){
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  return lines.map(line => {
    const cells = []; let cur = '', inQ = false;
    for(let i=0;i<line.length;i++){
      const c = line[i];
      if(inQ){
        if(c === '"'){ if(line[i+1] === '"'){ cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else {
        if(c === '"') inQ = true;
        else if(c === ','){ cells.push(cur); cur = ''; }
        else cur += c;
      }
    }
    cells.push(cur);
    return cells.map(s => s.trim());
  });
}
function num(v){
  if(v === undefined || v === null || v === '') return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}
function toSeriesMap(rows, displayNames){
  const rawNames = rows[0].slice(1);
  const names = displayNames || rawNames.map((name, i) => {
    const count = rawNames.slice(0, i).filter(v => v === name).length;
    return count ? `${name}_${count + 1}` : name;
  });
  const map = {}; names.forEach(n => map[n] = []);
  for(let r=1;r<rows.length;r++){
    names.forEach((n,ci)=> map[n].push(num(rows[r][ci+1])));
  }
  return { names, map };
}
function toObjects(rows){
  const header = rows[0];
  return rows.slice(1).map(row=>{
    const o = {};
    header.forEach((h,i)=> o[h] = row[i] ?? '');
    o.__cells = row;
    o.__header = header;
    return o;
  });
}
function isOutdoorName(name){
  const s = String(name || '');
  return s === OUTDOOR_KEY || s.includes('최고기온') || s.includes('(℃)') || s === '????(?)';
}
function getOutdoorName(series){
  return series.names.find(isOutdoorName);
}
function pick(row, keys, index, fallback=''){
  if(row.__cells?.[index] !== undefined && row.__cells[index] !== '') return row.__cells[index];
  for(const key of keys){
    if(row[key] !== undefined && row[key] !== '') return row[key];
  }
  return fallback;
}
function applyRowLabels(rows, labels){
  rows.forEach((row, i) => row.__displayZone = labels[i] || row.__displayZone);
  return rows;
}
function fmtHours(v, signed=false){
  const n = num(v) ?? 0;
  const abs = Math.abs(n);
  const txt = abs.toFixed(2).replace(/\.?0+$/, '');
  return signed && n > 0 ? `+${txt}` : signed && n < 0 ? `-${txt}` : txt;
}
function fmtZoneName(v){
  return String(v || '')
    .replace(/^본사_/, '')
    .replace(/_/g, ' ')
    .replace(/서울(?=\d)/g, '서울 ')
    .replace(/(\d)층/g, '$1층')
    .trim();
}

const SERIES_LABELS = {
  tempZone: ['실외 최고기온','서울 1층','서울 2층','서울 3층','서울 6층','서울 7층','서울 별관'],
  ctrlLow: ['1층 로비','1층 안내센터','2층 로비','2층 회의실','3층 회의실','별관 로비','실외 최고기온'],
  ctrl6: ['6층 노조사무실','6층 본부장실','6층 사무실1','6층 사무실2','6층 사무실3','6층 이사장실','실외 최고기온'],
  ctrl7: ['7층 본부장실1','7층 본부장실2','7층 사무실1','7층 사무실2','7층 사무실3','7층 회의실','실외 최고기온'],
  operZone: ['서울 1층','서울 2층','서울 3층','서울 6층','서울 7층','서울 별관'],
  operSpace: ['공용공간','사무실']
};

const INCREASE_ROW_LABELS = [
  '서울 7층 사무실',
  '서울 6층 사무실',
  '서울 공용 2층',
  '서울 1층 로비',
  '서울 7층 회의실',
  '서울 6층 본부장실',
  '서울 별관'
];

/* ── 주말·공휴일 x축 라벨 빨강 처리용 콜백 ────────────────── */
function tickColor(){
  // 라벨(날짜)이 휴일이면 빨강, 아니면 기본색
  return (ctx)=> HOLIDAYS.has(DAYS[ctx.index]) ? '#E5484D' : '#5B6577';
}

const hotTempBandPlugin = {
  id:'hotTempBand',
  beforeDatasetsDraw(chart){
    if(!chart.options.plugins?.hotTempBand?.enabled) return;
    const {ctx, chartArea, scales} = chart;
    const y = scales.y;
    if(!chartArea || !y || HOT_TEMP > y.max || HOT_TEMP < y.min) return;
    const yPos = y.getPixelForValue(HOT_TEMP);
    ctx.save();
    ctx.fillStyle = 'rgba(229, 72, 77, .08)';
    ctx.fillRect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, yPos - chartArea.top);
    ctx.strokeStyle = 'rgba(229, 72, 77, .65)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, yPos);
    ctx.lineTo(chartArea.right, yPos);
    ctx.stroke();
    ctx.restore();
  }
};

Chart.register(hotTempBandPlugin);

/* ── 온도 라인차트 (실외 점선 오버레이) ───────────────────── */
function mkTempChart(canvasId, legendId, series){
  const el = document.getElementById(canvasId);
  if(!el) return;
  // 실외 계열은 검은 점선, 나머지는 컬러 실선
  const outdoorName = getOutdoorName(series);
  const innerNames = series.names.filter(n => n !== outdoorName);
  const datasets = innerNames.map((label,i)=>({
    label, data:series.map[label],
    borderColor:LC[i%LC.length], backgroundColor:'transparent',
    borderWidth:1.9, fill:false, spanGaps:true, tension:.35,
    pointRadius:0, pointHoverRadius:4
  }));
  if(outdoorName && series.map[outdoorName]){
    datasets.push({
      label:'실외 최고기온', data:series.map[outdoorName],
      borderColor:'#111827', backgroundColor:'transparent',
      borderWidth:2, borderDash:[5,4], fill:false, spanGaps:true, tension:.35,
      pointRadius:0, pointHoverRadius:4
    });
  }
  new Chart(el,{
    type:'line',
    data:{labels:DAYS, datasets},
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},hotTempBand:{enabled:true},tooltip:{...TT,callbacks:{
        title:items=>`${items[0].label}일`,
        label:c=>` ${c.dataset.label}: ${c.parsed.y}℃`
      }}},
      scales:{
        x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:false,font:{size:9},color:tickColor()}},
        y:{min:14,suggestedMax:34,ticks:{callback:v=>v+'℃',font:{size:9.5}},grid:{color:'#EEF1F6'}}
      },
      elements:{line:{tension:.35}}
    }
  });
  // 범례 자동 생성
  if(legendId){
    const lg = document.getElementById(legendId);
    if(lg){
      let html = innerNames.map((n,i)=>`<span><i style="background:${LC[i%LC.length]}"></i>${n}</span>`).join('');
      html += `<span><i style="background:#111827;height:0;border-top:2px dashed #111827;width:18px"></i>실외 최고기온</span>`;
      html += `<span><i style="background:rgba(229,72,77,.18);border-top:1px dashed #E5484D;width:18px;height:8px"></i>28℃ 이상</span>`;
      lg.innerHTML = html;
    }
  }
}

/* ── 가동시간 라인차트 ─────────────────────────────────────── */
function mkOperLine(canvasId, legendId, series){
  const el = document.getElementById(canvasId);
  if(!el) return;
  new Chart(el,{
    type:'line',
    data:{labels:DAYS,datasets:series.names.map((label,i)=>({
      label, data:series.map[label], borderColor:LC[i%LC.length], backgroundColor:'transparent',
      borderWidth:1.9, fill:false, spanGaps:true, tension:.35, pointRadius:0, pointHoverRadius:4
    }))},
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{...TT,callbacks:{
        title:items=>`${items[0].label}일`, label:c=>` ${c.dataset.label}: ${c.parsed.y}h`
      }}},
      scales:{
        x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:false,font:{size:9},color:tickColor()}},
        y:{min:0,suggestedMax:7,ticks:{callback:v=>v+'h',font:{size:9.5}},grid:{color:'#EEF1F6'}}
      }
    }
  });
  if(legendId){
    const lg = document.getElementById(legendId);
    if(lg) lg.innerHTML = series.names.map((n,i)=>`<span><i style="background:${LC[i%LC.length]}"></i>${n}</span>`).join('');
  }
}

/* ── 가동시간 막대차트 ─────────────────────────────────────── */
function mkOperBar(canvasId, legendId, series){
  const el = document.getElementById(canvasId);
  if(!el) return;
  new Chart(el,{
    type:'bar',
    data:{labels:DAYS,datasets:series.names.map((label,i)=>({
      label, data:series.map[label],
      backgroundColor:i === 0 ? 'rgba(45,107,255,.72)' : 'rgba(229,72,77,.72)',
      borderColor:i === 0 ? '#2D6BFF' : '#E5484D',
      borderWidth:1,
      borderRadius:4,
      maxBarThickness:14
    }))},
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{...TT,callbacks:{
        title:items=>`${items[0].label}일`, label:c=>` ${c.dataset.label}: ${c.parsed.y}h`
      }}},
      scales:{
        x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:false,font:{size:9},color:tickColor()}},
        y:{min:0,suggestedMax:7,ticks:{callback:v=>v+'h',font:{size:9.5}},grid:{color:'#EEF1F6'}}
      }
    }
  });
  if(legendId){
    const lg = document.getElementById(legendId);
    if(lg) lg.innerHTML = series.names.map((n,i)=>`<span><i style="background:${i === 0 ? '#2D6BFF' : '#E5484D'};height:8px"></i>${n}</span>`).join('');
  }
}

/* ── 증감 표 자동 생성 ─────────────────────────────────────── */
function fillIncreaseTable(tbodyId, rows){
  const tb = document.getElementById(tbodyId);
  if(!tb) return;
  const data = rows.map(r=>{
    const zone = r.__displayZone || fmtZoneName(pick(r, ['HUB_NICKNAME', '지역'], 2));
    const prev = num(pick(r, ['총가동시간_시간_4월', '총가동시간_시간_5월', '전월'], 4)) ?? 0;
    const prevAvg = num(pick(r, ['장비당_일평균가동시간_시간_4월', '장비당_일평균가동시간_시간_5월'], 5)) ?? 0;
    const cur  = num(pick(r, ['총가동시간_시간_5월', '총가동시간_시간_6월', '당월'], 6)) ?? 0;
    const curAvg = num(pick(r, ['장비당_일평균가동시간_시간_5월', '장비당_일평균가동시간_시간_6월'], 7)) ?? 0;
    const deviceCount = num(pick(r, ['제어기_장치수'], 3)) ?? 0;
    const totalDiff = num(pick(r, ['총가동시간_증감'], 8)) ?? +(cur - prev).toFixed(2);
    const avgDiff = num(pick(r, ['장비당_일평균가동시간_증감'], 9)) ?? +(curAvg - prevAvg).toFixed(2);
    return { zone, deviceCount, prev, prevAvg, cur, curAvg, totalDiff, avgDiff };
  }).sort((a,b)=>b.avgDiff-a.avgDiff);
  tb.innerHTML = data.map(r=>{
    const totalDiffTxt = `<span class="${r.totalDiff>0?'risk':'ok-txt'}">${fmtHours(r.totalDiff, true)}</span>`;
    const avgDiffTxt = `<span class="${r.avgDiff>0?'risk':'ok-txt'}">${fmtHours(r.avgDiff, true)}</span>`;
    return `<tr>
      <td class="inc-zone"><strong>${r.zone}</strong></td>
      <td class="num inc-num">${r.deviceCount}</td>
      <td class="num inc-num">${fmtHours(r.prev)}</td>
      <td class="num inc-num">${fmtHours(r.prevAvg)}</td>
      <td class="num inc-num">${fmtHours(r.cur)}</td>
      <td class="num inc-num">${fmtHours(r.curAvg)}</td>
      <td class="num inc-num">${totalDiffTxt}</td>
      <td class="num inc-num">${avgDiffTxt}</td>
    </tr>`;
  }).join('');
}

/* ── 에러 표시 ─────────────────────────────────────────────── */
function showError(msg){
  const div = document.createElement('div');
  div.style.cssText = 'background:#FEECEC;border:1px solid #E5484D;color:#B91C1C;padding:14px 18px;border-radius:10px;margin:16px 0;font-size:13px;line-height:1.6';
  div.innerHTML = `<strong>데이터를 불러오지 못했습니다.</strong><br>${msg}<br><span style="color:#7A1F1F;font-size:12px">로컬 서버에서 열었는지(예: <code>python -m http.server</code>), data 폴더의 CSV가 있는지 확인해 주세요.</span>`;
  document.body.prepend(div);
}

/* ── 메인 ──────────────────────────────────────────────────── */
async function main(){
  Chart.defaults.font.family = "'Pretendard Variable',Pretendard,system-ui,sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#5B6577';

  const keys = ['tempZone','ctrlLow','ctrl6','ctrl7','operZone','operSpace','incWork','incOff'];
  let txt = {};
  try {
    const res = await Promise.all(keys.map(k=>fetch(dataUrl(DATA_FILES[k]))));
    res.forEach((r,i)=>{ if(!r.ok) throw new Error(`${DATA_FILES[keys[i]]} 응답 오류 (HTTP) — data 폴더의 파일명을 확인하세요`); });
    const texts = await Promise.all(res.map(r=>r.text()));
    keys.forEach((k,i)=> txt[k] = texts[i]);
  } catch(e){ showError(e.message); return; }

  let tempZone, ctrlLow, ctrl6, ctrl7, operZone, operSpace, incWork, incOff;
  try {
    const tempRows = parseCSV(txt.tempZone);
    // 주말·공휴일 자동 계산 (날짜 열 기준) → x축 라벨 빨강 처리
    HOLIDAYS = new Set();
    tempRows.slice(1).forEach(r=>{
      const m = String(r[0] ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if(m && isHolidayDate(m[0])) HOLIDAYS.add(Number(m[3]));
    });
    tempZone  = toSeriesMap(tempRows, SERIES_LABELS.tempZone);
    ctrlLow   = toSeriesMap(parseCSV(txt.ctrlLow), SERIES_LABELS.ctrlLow);
    ctrl6     = toSeriesMap(parseCSV(txt.ctrl6), SERIES_LABELS.ctrl6);
    ctrl7     = toSeriesMap(parseCSV(txt.ctrl7), SERIES_LABELS.ctrl7);
    operZone  = toSeriesMap(parseCSV(txt.operZone), SERIES_LABELS.operZone);
    operSpace = toSeriesMap(parseCSV(txt.operSpace), SERIES_LABELS.operSpace);
    incWork   = applyRowLabels(toObjects(parseCSV(txt.incWork)), INCREASE_ROW_LABELS);
    incOff    = applyRowLabels(toObjects(parseCSV(txt.incOff)), INCREASE_ROW_LABELS);
  } catch(e){ showError('CSV 파싱 중 오류: ' + e.message); return; }

  /* 온도 그래프 (실외 점선) */
  mkTempChart('c-temp-zone',     'lg-zone',     tempZone);
  mkTempChart('c-temp-ctrl-low', 'lg-ctrl-low', ctrlLow);
  mkTempChart('c-temp-ctrl-6f',  'lg-ctrl-6f',  ctrl6);
  mkTempChart('c-temp-ctrl-7f',  'lg-ctrl-7f',  ctrl7);

  /* 가동시간 라인 */
  mkOperLine('c-oper-line', 'lg-oper', operZone);

  /* 공간구분별 일평균 가동시간 막대 */
  mkOperBar('c-oper-bar', 'lg-oper-space', operSpace);

  /* 증감 표 */
  fillIncreaseTable('incWorkB', incWork);
  fillIncreaseTable('incOffB',  incOff);
}

window.addEventListener('DOMContentLoaded', main);

/* ── 인쇄: 리포트 전체를 세로로 긴 '한 페이지' PDF로 출력 ─────
   인쇄 직전에 문서 높이를 측정해 그 크기의 커스텀 용지를 적용한다.
   크롬 인쇄 대화상자에서 [대상: PDF로 저장] 그대로 출력하면 됨. */
let PRINT_MODE = 'one'; // 'one' = 한 장 PDF · 'a4' = A4 여러 장
function setPageRule(){
  let st = document.getElementById('one-page-print');
  if(!st){ st = document.createElement('style'); st.id = 'one-page-print'; document.head.appendChild(st); }
  if(PRINT_MODE === 'a4'){
    st.textContent = '@page { size: A4 portrait; margin: 10mm; }';
    document.body.classList.add('print-a4');
  } else {
    const PX2MM = 25.4 / 96;
    const page = document.querySelector('.page') || document.body;
    const wMm = Math.ceil(page.offsetWidth * PX2MM) + 20;
    const hMm = Math.ceil(document.documentElement.scrollHeight * PX2MM) + 12;
    st.textContent = `@page { size: ${wMm}mm ${hMm}mm; margin: 10mm; }`;
    document.body.classList.remove('print-a4');
  }
}
function printOnePage(){ PRINT_MODE = 'one'; setPageRule(); window.print(); }
function printA4(){ PRINT_MODE = 'a4'; setPageRule(); window.print(); }
window.addEventListener('load', () => setTimeout(setPageRule, 400));
window.addEventListener('beforeprint', setPageRule);
window.addEventListener('afterprint', () => { PRINT_MODE = 'one'; setPageRule(); });
