/* ============================================================
   서울 본사 장애인기업종합지원센터 월간 모니터링 리포트

   데이터 파일명은 아래 DATA_FILES 설정표에서 관리합니다.
   데이터팀이 보낸 CSV를 그 이름 그대로 data/ 폴더에 넣으면
   새로고침 시 리포트가 자동 갱신됩니다. (파일명이 바뀌면 설정표만 수정)
   ============================================================ */

const DAYS = Array.from({length:30},(_,i)=>i+1);          // 9월 = 30일
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
  operReserve:'4-3.csv',   // 섹션4-3 — 공용공간 자동 꺼짐 예약 전후 비교
  night1F:   '4-4-night.csv', // 섹션4-4 — 1층 야간 자동 꺼짐 예약 전후 비교
  incWork:   '4-4.csv',    // 섹션4-5 — 사용량/전월대비(근무시간)
  incOff:    '4-5.csv'     // 섹션4-6 — 사용량/전월대비(근무외)
};

/* ✏️ 공휴일 날짜 — 주말(토·일)은 자동 계산되고, 여기엔 공휴일만 적으면 됩니다.
   해당 날짜의 x축 라벨이 빨간색으로 표시됩니다. (매달 이 줄만 갱신) */
const PUBLIC_HOLIDAYS = ['2026-09-24', '2026-09-25']; // 2026년 9월 평일 공휴일

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
  }).filter((row, i) => i === 0 || row.some(c => String(c).replace(/\t/g, '').trim() !== ''));
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
function seriesValues(series){
  return series.names.flatMap(name => (series.map[name] || []).filter(v => Number.isFinite(v)));
}
function scaleForValues(values, {unit='', minAtZero=false, minPad=1}={}){
  const nums = values.filter(v => Number.isFinite(v));
  if(!nums.length) return {ticks:{callback:v=>`${v}${unit}`,font:{size:9.5}},grid:{color:'#EEF1F6'}};
  let lo = Math.min(...nums), hi = Math.max(...nums);
  const spread = Math.max(hi - lo, minPad);
  let min = minAtZero ? 0 : Math.floor((lo - spread * 0.18) * 2) / 2;
  let max = Math.ceil((hi + spread * 0.18) * 2) / 2;
  if(max <= min) max = min + minPad;
  return {
    min,
    max,
    ticks:{callback:v=>`${v}${unit}`,font:{size:9.5}},
    grid:{color:'#EEF1F6'}
  };
}
function tempScale(){
  return {
    min:20,
    max:36,
    ticks:{stepSize:2, callback:v=>`${v}℃`, font:{size:9.5}},
    grid:{color:'#EEF1F6'}
  };
}
function pick(row, keys, index, fallback=''){
  if(row.__cells?.[index] !== undefined && row.__cells[index] !== '') return row.__cells[index];
  for(const key of keys){
    if(row[key] !== undefined && row[key] !== '') return row[key];
  }
  return fallback;
}
function pickKey(row, keys, fallback=''){
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
    .replace(/서울(?=별관)/g, '서울 ')
    .replace(/(\d)층/g, '$1층')
    .replace(/\s+/g, ' ')
    .trim();
}
function cssColor(name, fallback){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function withAlpha(color, alpha){
  const hex = String(color || '').trim();
  if(/^#[0-9A-Fa-f]{6}$/.test(hex)){
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

const SERIES_LABELS = {
  tempZone: ['실외 최고기온','서울 1층','서울 2층','서울 3층','서울 6층','서울 7층','서울 별관'],
  ctrlLow: ['B1층 소회의실','1층 로비','1층 안내센터','2층 로비','2층 회의실','2층 로비2','3층 회의실','별관 로비','실외 최고기온'],
  ctrl6: ['6층 노조사무실','6층 본부장실','6층 사무실1','6층 사무실2','6층 사무실3','6층 이사장실','실외 최고기온'],
  ctrl7: ['7층 본부장실1','7층 본부장실2','7층 사무실1','7층 사무실2','7층 사무실3','7층 회의실','실외 최고기온'],
  operZone: ['서울 B1층','서울 1층','서울 2층','서울 3층','서울 6층','서울 7층','서울 별관'],
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
  const yScale = tempScale();
  // 실외 계열은 검은 점선, 나머지는 컬러 실선
  const outdoorName = getOutdoorName(series);
  const innerNames = series.names.filter(n => n !== outdoorName);
  const datasets = innerNames.map((label,i)=>({
    label, data:series.map[label],
    borderColor:LC[i%LC.length], backgroundColor:'transparent',
    borderWidth:1.9, fill:false, spanGaps:false, tension:.35,
    pointRadius:0, pointHoverRadius:4
  }));
  if(outdoorName && series.map[outdoorName]){
    datasets.push({
      label:'실외 최고기온', data:series.map[outdoorName],
      borderColor:'#111827', backgroundColor:'transparent',
      borderWidth:2, borderDash:[5,4], fill:false, spanGaps:false, tension:.35,
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
        y:yScale
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
  const yScale = scaleForValues(seriesValues(series), {unit:'h', minAtZero:true, minPad:1});
  new Chart(el,{
    type:'line',
    data:{labels:DAYS,datasets:series.names.map((label,i)=>({
      label, data:series.map[label], borderColor:LC[i%LC.length], backgroundColor:'transparent',
      borderWidth:1.9, fill:false, spanGaps:false, tension:.35, pointRadius:0, pointHoverRadius:4
    }))},
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{...TT,callbacks:{
        title:items=>`${items[0].label}일`, label:c=>` ${c.dataset.label}: ${c.parsed.y}h`
      }}},
      scales:{
        x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:false,font:{size:9},color:tickColor()}},
        y:yScale
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
  const yScale = scaleForValues(seriesValues(series), {unit:'h', minAtZero:true, minPad:1});
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
        y:yScale
      }
    }
  });
  if(legendId){
    const lg = document.getElementById(legendId);
    if(lg) lg.innerHTML = series.names.map((n,i)=>`<span><i style="background:${i === 0 ? '#2D6BFF' : '#E5484D'};height:8px"></i>${n}</span>`).join('');
  }
}

/* ── 예약 전후 비교 혼합차트 (막대=가동시간 · 연결선=감소율) ───── */
function mkReserveChart(canvasId, legendId, rows){
  const el = document.getElementById(canvasId);
  if(!el) return;
  const labels = rows.map(r => pickKey(r, ['제어기 닉네임', '공간', '구역명', 'HUB_NICKNAME']));
  const before = rows.map(r => num(pickKey(r, ['예약 전 일평균 가동시간'])));
  const header = rows[0]?.__header || [];
  const calcRate = (from, to) => Number.isFinite(from) && from !== 0 && Number.isFinite(to) ? +(((from - to) / from) * 100).toFixed(2) : null;
  const daysInMonth = month => new Date(2026, month, 0).getDate();
  const monthCols = header
    .map(key => {
      const m = String(key).match(/^(\d+)월 일평균 가동시간$/);
      return m ? { key, month:Number(m[1]) } : null;
    })
    .filter(Boolean)
    .sort((a,b)=>a.month-b.month);
  const afterKey = header.find(k => ['예약 직후 일평균 가동시간', '예약 후 일평균 가동시간'].includes(k));
  const periodCols = [];
  if(afterKey) periodCols.push({
    key:afterKey,
    label:afterKey.includes('직후') ? '예약 직후 일평균 가동시간(6/16~6/30)' : '예약 후 일평균 가동시간',
    rateKeys:['예약 전 대비 예약 직후 감소율(%)', '예약 전 대비 예약 후 감소율(%)', '감소율(%)'],
    rateLabel:'예약 직후 감소율'
  });
  monthCols.forEach(col => periodCols.push({
    key:col.key,
    label:`${col.month}월 일평균 가동시간(${col.month}/1~${col.month}/${daysInMonth(col.month)})`,
    rateKeys:[`예약 전 대비 ${col.month}월 감소율(%)`],
    rateLabel:`${col.month}월 감소율`
  }));

  const LBL_BEFORE = '예약 전 일평균 가동시간(6/1~6/15)';
  const barColors = ['#2D6BFF', '#22C55E', '#F59E0B', '#7C3AED', '#0F766E', '#BE185D'];
  const lineStyles = [
    {color:'#E5484D', dash:[]},
    {color:'#7C3AED', dash:[4, 3]},
    {color:'#B91C1C', dash:[2, 3]},
    {color:'#0F766E', dash:[5, 3]}
  ];
  const periodSeries = periodCols.map((col, idx) => {
    const values = rows.map(r => num(pickKey(r, [col.key, '당월 일평균 가동시간'])));
    const rates = rows.map((r, i) => num(pickKey(r, col.rateKeys)) ?? calcRate(before[i], values[i]));
    return {
      ...col,
      values,
      rates,
      datasetIndex:idx + 1,
      barColor:barColors[(idx + 1) % barColors.length],
      lineStyle:lineStyles[idx % lineStyles.length]
    };
  });
  const reserveConnector = {
    id:`reserveConnector-${canvasId}`,
    afterDatasetsDraw(chart){
      const {ctx, chartArea} = chart;
      const beforeMeta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.lineWidth = 1.25;
      ctx.font = '700 8.5px Pretendard, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const draw = (targetMeta, rateData, color, dash, labelOffset, xNudge=0)=>{
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.setLineDash(dash);
        beforeMeta.data.forEach((beforeBar, i)=>{
          const targetBar = targetMeta.data[i];
          if(!beforeBar || !targetBar || !Number.isFinite(rateData[i])) return;
          const x1 = beforeBar.x;
          const y1 = beforeBar.y;
          const x2 = targetBar.x;
          const y2 = targetBar.y;
          const labelX = Math.min(chartArea.right - 18, Math.max(chartArea.left + 18, (x1 + x2) / 2 + xNudge));
          const labelY = Math.max(chartArea.top + 10, (y1 + y2) / 2 - labelOffset);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          [ [x1,y1], [x2,y2] ].forEach(([x,y])=>{
            ctx.beginPath();
            ctx.arc(x, y, 2.1, 0, Math.PI * 2);
            ctx.fill();
          });
          const txt = `${rateData[i].toFixed(1)}%`;
          const w = ctx.measureText(txt).width + 6;
          ctx.fillStyle = 'rgba(255,255,255,.88)';
          ctx.fillRect(labelX - w / 2, labelY - 6, w, 12);
          ctx.fillStyle = color;
          ctx.fillText(txt, labelX, labelY);
        });
      };
      periodSeries.forEach((series, idx)=>{
        draw(
          chart.getDatasetMeta(series.datasetIndex),
          series.rates,
          series.lineStyle.color,
          series.lineStyle.dash,
          14 + (idx * 7),
          (idx - (periodSeries.length - 1) / 2) * 18
        );
      });
      ctx.restore();
    }
  };
  const datasets = [
    {type:'bar', label:LBL_BEFORE, data:before, yAxisID:'y',
     backgroundColor:'rgba(45,107,255,.72)', borderColor:'#2D6BFF',
     borderWidth:1, borderRadius:4, maxBarThickness:34},
    ...periodSeries.map(series => ({
      type:'bar', label:series.label, data:series.values, yAxisID:'y',
      backgroundColor:withAlpha(series.barColor, .72), borderColor:series.barColor,
      borderWidth:1, borderRadius:4, maxBarThickness:34
    }))
  ];
  const maxValue = Math.max(...datasets.flatMap(ds => ds.data).filter(v => Number.isFinite(v)), 0);
  const yMax = Math.max(3, Math.ceil(maxValue * 1.2 * 2) / 2);
  new Chart(el,{
    data:{labels, datasets},
    plugins:[reserveConnector],
    options:{
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{...TT,callbacks:{
        label:c => ` ${c.dataset.label}: ${c.parsed.y}h`,
        afterBody:items => {
          const i = items?.[0]?.dataIndex;
          return periodSeries
            .filter(series => Number.isFinite(series.rates[i]))
            .map(series => `${series.rateLabel}: ${series.rates[i].toFixed(1)}%`);
        }
      }}},
      scales:{
        x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:false,font:{size:10.5}}},
        y:{position:'left', min:0, max:yMax,
           title:{display:true,text:'일평균 가동시간(시간)',font:{size:10}},
           ticks:{stepSize:0.5, callback:v=>`${v}`,font:{size:9.5}}, grid:{color:'#EEF1F6'}}
      }
    }
  });
  if(legendId){
    const lg = document.getElementById(legendId);
    if(lg){
      const barLegend = [`<span><i style="background:#2D6BFF;height:8px"></i>${LBL_BEFORE}</span>`]
        .concat(periodSeries.map(series => `<span><i style="background:${series.barColor};height:8px"></i>${series.label}</span>`));
      const lineLegend = periodSeries.map(series => {
        const {color, dash} = series.lineStyle;
        const dashStyle = dash.length ? `background:transparent;border-top:2px dashed ${color};height:0` : `background:${color};height:2px`;
        return `<span><i style="${dashStyle};width:18px;border-radius:0"></i>${series.rateLabel} 연결선</span>`;
      });
      lg.innerHTML = barLegend.concat(lineLegend).join('');
    }
  }
}

/* ── 1층 야간 자동 꺼짐 예약 전후 비교 ───────────────────── */
function nightChange(raw, before, after){
  const text = String(raw || '');
  const found = text.match(/-?\d+(?:\.\d+)?/);
  const rate = found ? Math.abs(Number(found[0])) : Math.abs(((after - before) / before) * 100);
  const up = text.includes('▲') || (!text.includes('▼') && after > before);
  const decimals = found?.[0]?.includes('.') ? found[0].split('.')[1].length : 2;
  const rateText = Number.isFinite(rate)
    ? rate.toFixed(Math.min(2, decimals)).replace(/\.?0+$/, '')
    : '0';
  return { up, text:`${up ? '▲' : '▼'} ${rateText}%`, rate };
}
function mkNightOffSingleChart(canvasId, legendId, rows){
  const el = document.getElementById(canvasId);
  if(!el) return;
  const row = rows.find(r =>
    String(r['공간'] || '').trim().includes('안내센터') &&
    (String(r['분석 구간'] || '').includes('22~06') || String(r['분석 구간'] || '').includes('22시~06시'))
  ) || rows.find(r => String(r['분석 구간'] || '').includes('22~06'));
  if(!row) return;
  const header = row.__header || [];
  const monthCols = header
    .map(key => {
      const m = String(key).match(/^(\d+)월 평균 가동시간$/);
      return m ? { key, month:Number(m[1]) } : null;
    })
    .filter(Boolean)
    .sort((a,b)=>a.month-b.month);
  const labels = monthCols.map(col => `${col.month}월`);
  const values = monthCols.map(col => num(row[col.key]) ?? 0);
  const monthIndex = new Map(monthCols.map((col, i) => [col.month, i]));
  let changes = header
    .map(key => {
      const m = String(key).match(/^(\d+)월 대비 (\d+)월 감소율\(%\)$/);
      if(!m) return null;
      const fromMonth = Number(m[1]);
      const toMonth = Number(m[2]);
      if(!monthIndex.has(fromMonth) || !monthIndex.has(toMonth)) return null;
      const fromIdx = monthIndex.get(fromMonth);
      const toIdx = monthIndex.get(toMonth);
      return {
        key,
        fromMonth,
        toMonth,
        fromIdx,
        toIdx,
        change:nightChange(row[key], values[fromIdx], values[toIdx])
      };
    })
    .filter(Boolean)
    .sort((a,b)=>a.toMonth-b.toMonth);
  if(!changes.length && values.length > 1){
    changes = values.slice(1).map((_, i) => ({
      fromMonth:monthCols[0].month,
      toMonth:monthCols[i + 1].month,
      fromIdx:0,
      toIdx:i + 1,
      change:nightChange('', values[0], values[i + 1])
    }));
  }
  const yMax = Math.max(1, Math.ceil(Math.max(...values, 0) * 1.45 * 2) / 2);
  const brand = cssColor('--brand', LC[0]);
  const warn = cssColor('--warn', LC[3]);
  const good = cssColor('--good', LC[2]);
  const alert = cssColor('--alert', LC[1]);
  const purple = '#7C3AED';
  const line = cssColor('--line', '#E5E9F0');
  const ink = cssColor('--ink', '#0B1220');
  const muted = cssColor('--muted', '#5B6577');
  const monthColor = month => ({6:brand, 7:warn, 8:good, 9:purple}[month] || LC[month % LC.length]);
  const barColors = monthCols.map(col => monthColor(col.month));
  const lg = document.getElementById(legendId);
  if(lg){
    const bars = monthCols.map((col, i) => `<span><i style="background:${barColors[i]};height:8px"></i>${col.month}월 평균 가동시간</span>`);
    const rates = changes.map((spec, i) => {
      const dashed = i > 0;
      const style = dashed ? `background:transparent;border-top:2px dashed ${alert};height:0;width:18px;border-radius:0` : `background:${alert};height:2px;width:18px;border-radius:0`;
      return `<span><i style="${style}"></i>${spec.fromMonth}월 대비 ${spec.toMonth}월 감소율</span>`;
    });
    lg.innerHTML = bars.concat(rates).join('');
  }
  const nightLabelPlugin = {
    id:`nightSingleLabel-${canvasId}`,
    afterDatasetsDraw(chart){
      const {ctx, chartArea} = chart;
      const m0 = chart.getDatasetMeta(0);
      const bars = m0.data;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const drawRate = (spec, idx)=>{
        const {fromIdx, toIdx, change} = spec;
        const b0 = bars[fromIdx], b1 = bars[toIdx];
        if(!b0 || !b1 || !change) return;
        const dash = idx === 0 ? [] : [4, 3];
        const p0X = b0.x;
        const p1X = b1.x;
        const p0Y = b0.y + (idx * 5);
        const p1Y = b1.y + (idx * 5);
        ctx.save();
        ctx.strokeStyle = alert;
        ctx.lineWidth = 1.15;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(p0X, p0Y);
        ctx.lineTo(p1X, p1Y);
        ctx.stroke();
        ctx.restore();

        const labelT = idx === 0 ? .52 : .66;
        const midX = p0X + ((p1X - p0X) * labelT);
        const midY = p0Y + ((p1Y - p0Y) * labelT) - 18 - (idx * 6);
        ctx.fillStyle = alert;
        ctx.font = '800 10px Pretendard, system-ui, sans-serif';
        ctx.fillText(change.text, midX, Math.max(chartArea.top + 12, midY));
      };
      changes.forEach((spec, idx)=>drawRate(spec, idx));

      bars.forEach((bar, i)=>{
        if(!bar) return;
        ctx.fillStyle = ink;
        ctx.font = '700 9.5px Pretendard, system-ui, sans-serif';
        ctx.fillText(values[i].toFixed(2), bar.x, Math.max(chartArea.top + 8, bar.y - 8));
      });
      ctx.restore();
    }
  };
  new Chart(el,{
    type:'bar',
    data:{labels,datasets:[
      {label:'평균 가동시간', data:values,
       backgroundColor:barColors.map(color => withAlpha(color, .72)),
       borderColor:barColors,
       borderWidth:1, borderRadius:4, maxBarThickness:46}
    ]},
    plugins:[nightLabelPlugin],
    options:{
      responsive:true, maintainAspectRatio:false,
      layout:{padding:{top:34}},
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{...TT,callbacks:{
        title:items=>items[0].label,
        label:c=>` 평균 가동시간: ${c.parsed.y.toFixed(2)}h`,
        afterBody:items=>{
          const idx = items?.[0]?.dataIndex;
          return changes
            .filter(spec => spec.toIdx === idx)
            .map(spec => `${spec.fromMonth}월 대비 ${spec.toMonth}월 감소율: ${spec.change.text.replace('▼ ', '').replace('▲ ', '')}`);
        }
      }}},
      scales:{
        x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:false,font:{size:11},color:muted}},
        y:{min:0,max:yMax,
          title:{display:true,text:'평균 가동시간(시간)',font:{size:10}},
          ticks:{stepSize:.5, callback:v=>`${v}`,font:{size:9.5},color:muted},
          grid:{color:line}}
      }
    }
  });
}
function mkNightOffCharts(legendId, rows){
  mkNightOffSingleChart('c-night-1f', legendId, rows);
}

/* ── 증감 표 자동 생성 ─────────────────────────────────────── */
function fillIncreaseTable(tbodyId, rows){
  const tb = document.getElementById(tbodyId);
  if(!tb) return;
  const header = rows[0]?.__header || [];
  const monthKey = (prefix) => header
    .filter(k => new RegExp(`^${prefix}_\\d+월$`).test(k))
    .map(k => ({ key:k, month:num(k.match(/_(\d+)월$/)?.[1]) ?? 0 }))
    .sort((a,b)=>a.month-b.month);
  const totalMonths = monthKey('총가동시간_시간');
  const avgMonths = monthKey('장비당_일평균가동시간_시간');
  const prevTotalKey = totalMonths.at(-2)?.key;
  const curTotalKey = totalMonths.at(-1)?.key;
  const prevAvgKey = avgMonths.at(-2)?.key;
  const curAvgKey = avgMonths.at(-1)?.key;
  const prevMonth = totalMonths.at(-2)?.month;
  const curMonth = totalMonths.at(-1)?.month;
  const hasCompare = Boolean(prevTotalKey && curTotalKey) || rows.some(r => pickKey(r, ['총가동시간_증감']) !== '');
  const table = tb.closest('table');
  if(table && hasCompare){
    const cg = table.querySelector('colgroup');
    if(cg) cg.innerHTML = '<col class="inc-col-zone"><col class="inc-col-count"><col class="inc-col-num"><col class="inc-col-num"><col class="inc-col-num"><col class="inc-col-num"><col class="inc-col-num"><col class="inc-col-num">';
    const head = table.querySelector('thead tr');
    if(head) head.innerHTML = `<th>구역</th><th>장치수</th><th>${prevMonth}월 총 가동시간</th><th>${prevMonth}월 장비당 일평균</th><th>${curMonth}월 총 가동시간</th><th>${curMonth}월 장비당 일평균</th><th>총 가동시간 증감</th><th>장비당 일평균 증감</th>`;
  } else if(table && !hasCompare){
    const cg = table.querySelector('colgroup');
    if(cg) cg.innerHTML = '<col class="inc-col-zone"><col class="inc-col-count"><col class="inc-col-num"><col class="inc-col-num">';
    const head = table.querySelector('thead tr');
    if(head) head.innerHTML = '<th>구역</th><th>제어기 수</th><th>당월 총 가동시간</th><th>장비당 일평균</th>';
  }
  const data = rows.map(r=>{
    const rawZone = fmtZoneName(pick(r, ['HUB_NICKNAME', '지역'], 2));
    const zone = rawZone;
    if(!hasCompare){
      const deviceCount = num(pick(r, ['제어기_장치수'], 3)) ?? 0;
      const cur = num(pick(r, ['총가동시간_시간_4월', '총가동시간_시간'], 4)) ?? 0;
      const curAvg = num(pick(r, ['장비당_일평균가동시간_시간_4월', '장비당_일평균가동시간_시간'], 5)) ?? 0;
      return { zone, deviceCount, cur, curAvg };
    }
    const prev = num(pickKey(r, [prevTotalKey, '전월'], pick(r, [], 4))) ?? 0;
    const prevAvg = num(pickKey(r, [prevAvgKey], pick(r, [], 5))) ?? 0;
    const cur  = num(pickKey(r, [curTotalKey, '당월'], pick(r, [], 6))) ?? 0;
    const curAvg = num(pickKey(r, [curAvgKey], pick(r, [], 7))) ?? 0;
    const deviceCount = num(pickKey(r, ['장치수', '제어기_장치수'], pick(r, [], 3))) ?? 0;
    const totalDiff = num(pickKey(r, ['총가동시간_증감'], pick(r, [], 8))) ?? +(cur - prev).toFixed(2);
    const avgDiff = num(pickKey(r, ['장비당_일평균가동시간_증감'], pick(r, [], 9))) ?? +(curAvg - prevAvg).toFixed(2);
    return { zone, deviceCount, prev, prevAvg, cur, curAvg, totalDiff, avgDiff };
  }).sort((a,b)=>hasCompare ? b.avgDiff-a.avgDiff : b.curAvg-a.curAvg);
  tb.innerHTML = data.map(r=>{
    if(!hasCompare){
      return `<tr>
        <td class="inc-zone"><strong>${r.zone}</strong></td>
        <td class="num inc-num">${r.deviceCount}</td>
        <td class="num inc-num">${fmtHours(r.cur)}</td>
        <td class="num inc-num">${fmtHours(r.curAvg)}</td>
      </tr>`;
    }
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

  const keys = ['tempZone','ctrlLow','ctrl6','ctrl7','operZone','operSpace','operReserve','night1F','incWork','incOff'];
  let txt = {};
  try {
    const res = await Promise.all(keys.map(k=>fetch(dataUrl(DATA_FILES[k]))));
    res.forEach((r,i)=>{ if(!r.ok) throw new Error(`${DATA_FILES[keys[i]]} 응답 오류 (HTTP) — data 폴더의 파일명을 확인하세요`); });
    const texts = await Promise.all(res.map(r=>r.text()));
    keys.forEach((k,i)=> txt[k] = texts[i]);
  } catch(e){ showError(e.message); return; }

  let tempZone, ctrlLow, ctrl6, ctrl7, operZone, operSpace, operReserve, night1F, incWork, incOff;
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
    operReserve = toObjects(parseCSV(txt.operReserve));
    night1F  = toObjects(parseCSV(txt.night1F));
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

  /* 공용공간 자동 꺼짐 예약 전후 혼합차트 */
  mkReserveChart('c-oper-reserve', 'lg-oper-reserve', operReserve);

  /* 1층 야간 자동 꺼짐 예약 전후 비교 */
  mkNightOffCharts('lg-night-1f', night1F);

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
