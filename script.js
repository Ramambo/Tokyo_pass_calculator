// 이 사이트를 GitHub Pages 등에 배포할 때, 방문자가 직접 키를 안 넣어도 되게 하려면
// 아래 따옴표 안에 Routes API 전용으로 발급한 API 키를 넣으세요.
// 반드시 HTTP 리퍼러 제한(이 사이트 도메인) + API 제한(Routes API만) + 낮은 일일 쿼터를 먼저 걸어두고 넣을 것.
// 비워두면(기존처럼) 방문자가 직접 키를 입력하는 방식으로 동작합니다.
const HARDCODED_API_KEY = "";

let dayCount = 0;
let legCount = 0;

// 13 lines covered by the Tokyo Subway Ticket (Google routes.googleapis.com returns English names by default when languageCode:'en' is requested)
const COVERED_LINES = [
  'ginza','marunouchi','hibiya','tozai','chiyoda','yurakucho',
  'hanzomon','namboku','fukutoshin', // Tokyo Metro (9)
  'asakusa','mita','shinjuku','oedo' // Toei (4)
];
const COVERED_AGENCIES = ['tokyo metro','toei'];

const LINE_KO = {
  'ginza':'긴자선','marunouchi':'마루노우치선','hibiya':'히비야선','tozai':'도자이선',
  'chiyoda':'치요다선','yurakucho':'유라쿠초선','hanzomon':'한조몬선','namboku':'난보쿠선',
  'fukutoshin':'후쿠토신선','asakusa':'아사쿠사선','mita':'미타선','shinjuku':'신주쿠선','oedo':'오에도선'
};

function isCoveredLine(lineName, agencyNames){
  const n = (lineName||'').toLowerCase();
  const nameHit = COVERED_LINES.some(key => n.includes(key));
  const agencyHit = (agencyNames||[]).some(a => COVERED_AGENCIES.some(key => a.toLowerCase().includes(key)));
  return nameHit || agencyHit;
}
function displayLineName(lineName){
  const n = (lineName||'').toLowerCase();
  for(const key of COVERED_LINES){ if(n.includes(key)) return LINE_KO[key]; }
  return lineName;
}

function getDefaultDepartureTime(){
  // Fixes a stable weekday-afternoon departure time (13:00 JST) instead of "now",
  // so results don't depend on late-night/off-hours transit schedules.
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const now = new Date();
  const nowJST = new Date(now.getTime() + JST_OFFSET_MS);
  let target = new Date(Date.UTC(nowJST.getUTCFullYear(), nowJST.getUTCMonth(), nowJST.getUTCDate(), 13, 0, 0) - JST_OFFSET_MS);
  if(target.getTime() <= now.getTime()){
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }
  return target.toISOString();
}

function debounce(fn, ms){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function fetchPlaceSuggestions(query){
  const apiKey = getApiKey();
  if(!apiKey || !query || query.trim().length < 2) return [];
  try{
    const resp = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey
      },
      body: JSON.stringify({
        input: query,
        includedRegionCodes: ['jp'],
        languageCode: 'ko'
      })
    });
    const data = await resp.json();
    if(!resp.ok || !data.suggestions) return [];
    return data.suggestions
      .filter(s => s.placePrediction)
      .map(s => ({
        placeId: s.placePrediction.placeId,
        text: s.placePrediction.text?.text || '',
        secondary: s.placePrediction.structuredFormat?.secondaryText?.text || ''
      }));
  } catch(err){
    return [];
  }
}

function wireAutocomplete(input){
  const wrap = input.closest('.autocomplete-wrap');
  const box = wrap.querySelector('.suggestions');
  const pickedEl = wrap.querySelector('.place-picked');

  const runSearch = debounce(async () => {
    const q = input.value.trim();
    if(q.length < 2){ box.classList.remove('open'); box.innerHTML=''; return; }
    if(!getApiKey()){
      box.innerHTML = `<div class="suggestion-empty">API 키를 먼저 넣어야 자동완성이 동작해요.</div>`;
      box.classList.add('open');
      return;
    }
    const results = await fetchPlaceSuggestions(q);
    if(!results.length){
      box.innerHTML = `<div class="suggestion-empty">일치하는 장소가 없어요. 직접 입력해도 괜찮아요.</div>`;
      box.classList.add('open');
      return;
    }
    box.innerHTML = results.map((r, i) => `
      <div class="suggestion-item" data-idx="${i}">
        <div class="s-main">${r.text}</div>
        ${r.secondary ? `<div class="s-sub">${r.secondary}</div>` : ''}
      </div>
    `).join('');
    box.classList.add('open');
    box.querySelectorAll('.suggestion-item').forEach((el, i) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const picked = results[i];
        input.value = picked.text;
        input.dataset.placeId = picked.placeId;
        pickedEl.textContent = '✓ 장소 선택됨';
        box.classList.remove('open');
        recalc();
      });
    });
  }, 350);

  input.addEventListener('input', () => {
    delete input.dataset.placeId; // typing invalidates the previously picked place
    pickedEl.textContent = '';
    runSearch();
  });
  input.addEventListener('focus', () => {
    if(box.innerHTML && input.value.trim().length >= 2) box.classList.add('open');
  });
  input.addEventListener('blur', () => {
    setTimeout(() => box.classList.remove('open'), 150);
  });
}

function makeLeg(from, to, fare, covered){
  legCount++;
  const id = 'leg'+legCount;
  const div = document.createElement('div');
  div.className = 'leg';
  div.dataset.legId = id;
  div.innerHTML = `
    <div class="leg-main">
      <div class="autocomplete-wrap">
        <input type="text" class="from" placeholder="출발" value="${from||''}" autocomplete="off">
        <div class="suggestions"></div>
        <div class="place-picked"></div>
      </div>
      <span class="arrow">→</span>
      <div class="autocomplete-wrap">
        <input type="text" class="to" placeholder="도착" value="${to||''}" autocomplete="off">
        <div class="suggestions"></div>
        <div class="place-picked"></div>
      </div>
      <input type="number" class="fare" placeholder="요금" value="${fare!==undefined?fare:''}">
      <div class="covered"><input type="checkbox" class="covered-check" ${covered!==false?'checked':''} title="지하철 패스 적용 구간"></div>
      <button class="del" title="삭제">×</button>
    </div>
    <div class="leg-tools">
      <button class="fetch-btn">구글맵으로 조회</button>
      <span class="leg-status"></span>
      <button class="debug-toggle" style="display:none;">원문 응답 보기</button>
    </div>
    <div class="debug-box"></div>
    <div class="route-options"></div>
  `;
  div.querySelectorAll('.leg-main input[type=text], .leg-main input[type=number]').forEach(el=>el.addEventListener('input', recalc));
  div.querySelector('.del').addEventListener('click', ()=>{ div.remove(); recalc(); });
  div.querySelector('.fetch-btn').addEventListener('click', ()=> fetchLegFromGoogle(div));
  div.querySelector('.debug-toggle').addEventListener('click', ()=>{
    div.querySelector('.debug-box').classList.toggle('open');
  });
  wireAutocomplete(div.querySelector('.from'));
  wireAutocomplete(div.querySelector('.to'));
  return div;
}

function makeDay(label, legs){
  dayCount++;
  const id = 'day'+dayCount;
  const block = document.createElement('div');
  block.className = 'day-block';
  block.dataset.dayId = id;
  block.innerHTML = `
    <div class="day-title-row">
      <input type="text" class="day-label" value="${label}">
      <button class="remove-day">날짜 삭제</button>
    </div>
    <div class="quick-add">
      <textarea class="quick-input" placeholder="나리타공항 -> 게이세이우에노역
게이세이우에노역 -> 긴자(숙소)
긴자(숙소) -> 시부야역
시부야역 -> 도쿄스카이트리
도쿄스카이트리 -> 긴자(숙소)"></textarea>
      <div class="quick-add-row">
        <button class="quick-apply">이 텍스트로 구간 채우기</button>
        <span class="quick-hint">한 줄에 "출발 -> 도착" 하나씩, 또는 "A -> B -> C"처럼 이어서 써도 자동으로 나눠져요. 요금·패스적용은 아래에서 직접 입력하거나 구글맵 조회로 채우세요.</span>
      </div>
    </div>
    <div class="legs-divider">구간 목록</div>
    <div class="legs"></div>
    <button class="add-leg">+ 구간 직접 추가</button>
  `;
  const legsDiv = block.querySelector('.legs');
  legs.forEach(l => legsDiv.appendChild(makeLeg(l.from, l.to, l.fare, l.covered)));
  block.querySelector('.add-leg').addEventListener('click', ()=>{
    legsDiv.appendChild(makeLeg('', '', undefined, true));
    recalc();
  });
  block.querySelector('.remove-day').addEventListener('click', ()=>{
    block.remove(); recalc();
  });
  block.querySelector('.day-label').addEventListener('input', recalc);
  block.querySelector('.quick-apply').addEventListener('click', ()=>{
    const text = block.querySelector('.quick-input').value;
    const parsed = parseItineraryText(text);
    if(parsed.length === 0) return;
    legsDiv.innerHTML = '';
    parsed.forEach(p => legsDiv.appendChild(makeLeg(p.from, p.to, undefined, true)));
    recalc();
  });
  return block;
}

function parseItineraryText(text){
  const legs = [];
  text.split('\n').forEach(line => {
    line = line.trim();
    if(!line) return;
    const parts = line.split(/->|→|=>|➡|~/).map(s => s.trim()).filter(Boolean);
    for(let i = 0; i < parts.length - 1; i++){
      legs.push({ from: parts[i], to: parts[i+1] });
    }
  });
  return legs;
}

function addDefaultData(){
  const daysDiv = document.getElementById('days');
  const day1 = makeDay('1일차', [
    {from:'나리타공항', to:'게이세이우에노역', fare:2520, covered:false},
    {from:'게이세이우에노역', to:'긴자(숙소)', fare:210, covered:true},
    {from:'긴자(숙소)', to:'시부야역', fare:210, covered:true},
    {from:'시부야역', to:'도쿄스카이트리', fare:260, covered:true},
    {from:'도쿄스카이트리', to:'긴자(숙소)', fare:260, covered:true},
  ]);
  day1.querySelector('.quick-input').value =
`나리타공항 -> 게이세이우에노역
게이세이우에노역 -> 긴자(숙소)
긴자(숙소) -> 시부야역
시부야역 -> 도쿄스카이트리
도쿄스카이트리 -> 긴자(숙소)`;
  daysDiv.appendChild(day1);
}

document.getElementById('addDay').addEventListener('click', ()=>{
  const n = document.querySelectorAll('.day-block').length + 1;
  document.getElementById('days').appendChild(makeDay(n+'일차', [{from:'', to:'', fare:undefined, covered:true}]));
  recalc();
});

['rate24','rate48','rate72'].forEach(id=>{
  document.getElementById(id).addEventListener('input', recalc);
});

function yen(n){ return n.toLocaleString('ko-KR') + '엔'; }

function parseRoute(route){
  const steps = (route.legs || []).flatMap(l => l.steps || []);
  const transitSteps = steps.filter(s => s.travelMode === 'TRANSIT' && s.transitDetails);

  const linesFound = transitSteps.map(s => {
    const line = s.transitDetails.transitLine || {};
    const agencies = (line.agencies || []).map(a => a.name || '');
    const boardStop = s.transitDetails.stopDetails && s.transitDetails.stopDetails.departureStop
      ? s.transitDetails.stopDetails.departureStop.name : null;
    return { name: line.name || line.nameShort || '(알 수 없는 노선)', agencies, boardStop };
  });

  const seen = new Set();
  const uniqueLines = linesFound.filter(l => {
    if(seen.has(l.name)) return false;
    seen.add(l.name); return true;
  });

  const allCovered = uniqueLines.length > 0 && uniqueLines.every(l => isCoveredLine(l.name, l.agencies));
  const fare = route.travelAdvisory && route.travelAdvisory.transitFare;
  const boardingStops = [...new Set(linesFound.map(l => l.boardStop).filter(Boolean))];

  return { uniqueLines, allCovered, fare, boardingStops };
}

function getApiKey(){
  if(HARDCODED_API_KEY) return HARDCODED_API_KEY;
  const el = document.getElementById('apiKey');
  return el ? el.value.trim() : '';
}

function setupApiPanel(){
  const panel = document.getElementById('apiPanel');
  if(HARDCODED_API_KEY){
    panel.innerHTML = `<div class="api-status" style="color:var(--good);">구글맵 조회가 바로 가능하도록 설정되어 있어요 — 별도로 키를 넣지 않아도 됩니다.</div>`;
  }
}

async function fetchLegFromGoogle(legDiv){
  const apiKey = getApiKey();
  const statusEl = legDiv.querySelector('.leg-status');
  const optionsEl = legDiv.querySelector('.route-options');
  const btn = legDiv.querySelector('.fetch-btn');
  const fromVal = legDiv.querySelector('.from').value.trim();
  const toVal = legDiv.querySelector('.to').value.trim();

  if(!apiKey){
    statusEl.textContent = '먼저 위쪽에 API 키를 입력하세요.';
    statusEl.style.color = 'var(--bad)';
    return;
  }
  if(!fromVal || !toVal){
    statusEl.textContent = '출발/도착을 먼저 입력하세요.';
    statusEl.style.color = 'var(--bad)';
    return;
  }

  btn.disabled = true;
  statusEl.style.color = 'var(--ink-soft)';
  statusEl.textContent = '조회 중... (경로 확인 중)';
  optionsEl.innerHTML = '';

  const debugBox = legDiv.querySelector('.debug-box');
  const debugToggle = legDiv.querySelector('.debug-toggle');
  const showDebug = (label, obj) => {
    debugBox.textContent = (debugBox.textContent ? debugBox.textContent + '\n\n' : '') + '── ' + label + ' ──\n' + JSON.stringify(obj, null, 2);
    debugToggle.style.display = 'inline';
  };
  debugBox.textContent = '';
  debugBox.classList.remove('open');

  const withCity = (t)=> /japan|일본/i.test(t) ? t : t + ', Japan';

  const fromInput = legDiv.querySelector('.from');
  const toInput = legDiv.querySelector('.to');
  const originBody = fromInput.dataset.placeId
    ? { placeId: fromInput.dataset.placeId }
    : { address: withCity(fromVal) };
  const destinationBody = toInput.dataset.placeId
    ? { placeId: toInput.dataset.placeId }
    : { address: withCity(toVal) };

  try{
    // computeAlternativeRoutes: false 적용 및 regionCode 제거
    const requestBody1 = {
      origin: originBody,
      destination: destinationBody,
      travelMode: 'TRANSIT',
      computeAlternativeRoutes: false,
      languageCode: 'en',
      departureTime: getDefaultDepartureTime()
    };
    const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.legs.steps.transitDetails,routes.legs.steps.travelMode,routes.travelAdvisory.transitFare,fallbackInfo'
      },
      body: JSON.stringify(requestBody1)
    });
    let data = await resp.json();
    showDebug('1차 요청 (status ' + resp.status + ')', { request: requestBody1, response: data });

    if(!resp.ok){
      statusEl.style.color = 'var(--bad)';
      statusEl.textContent = '조회 실패 (' + resp.status + '): ' + (data.error?.message || JSON.stringify(data).slice(0,200));
      btn.disabled = false;
      return;
    }
    if(!data.routes || !data.routes.length){
      statusEl.style.color = 'var(--warn)';
      const reason = data.fallbackInfo?.reason ? ` (사유: ${data.fallbackInfo.reason})` : '';
      statusEl.textContent = `이 구간의 대중교통 경로를 못 찾았어요${reason}. 출발/도착지 이름을 좀 더 구체적으로(역명 영문/일본어 표기, 상호명 포함) 적어서 다시 시도해보세요.`;
      btn.disabled = false;
      return;
    }

    const parsedRoutes = data.routes.map(parseRoute).filter(r => r.uniqueLines.length > 0);

    if(parsedRoutes.length === 0){
      statusEl.style.color = 'var(--warn)';
      statusEl.textContent = '대중교통(지하철/버스) 구간이 있는 경로를 못 찾았어요. 요금을 직접 입력하세요.';
      btn.disabled = false;
      return;
    }

    statusEl.style.color = 'var(--ink-soft)';
    statusEl.textContent = `경로 후보 ${parsedRoutes.length}개 — 탑승역이 다를 수 있으니 확인 후 하나를 골라 적용하세요.`;

    optionsEl.innerHTML = '';
    parsedRoutes.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'route-option';
      const fareText = r.fare && r.fare.units !== undefined ? yen(Number(r.fare.units)) : '요금 정보 없음';
      const tagsHtml = r.uniqueLines.map(l => {
        const covered = isCoveredLine(l.name, l.agencies);
        return `<span class="line-tag ${covered?'covered':'not-covered'}">${displayLineName(l.name)}</span>`;
      }).join('');
      card.innerHTML = `
        <div class="ro-top">
          <span>${tagsHtml}</span>
          <span class="ro-fare">${fareText}</span>
        </div>
        <div class="ro-boarding">${r.boardingStops.length ? '탑승역: ' + r.boardingStops.join(' → ') : ''}${r.allCovered ? ' · 전 구간 패스 적용 가능' : ' · 패스 미적용 노선 포함'}</div>
      `;
      card.addEventListener('click', () => {
        optionsEl.querySelectorAll('.route-option').forEach(el => el.classList.remove('selected'));
        card.classList.add('selected');
        if(r.fare && r.fare.units !== undefined){
          legDiv.querySelector('.fare').value = Number(r.fare.units);
        }
        legDiv.querySelector('.covered-check').checked = r.allCovered;
        statusEl.style.color = 'var(--good)';
        statusEl.textContent = '이 경로를 적용했어요.';
        recalc();
      });
      optionsEl.appendChild(card);
    });

    // auto-apply the first (Google's top-recommended) route so the leg isn't left empty
    optionsEl.querySelector('.route-option').click();

  } catch(err){
    statusEl.style.color = 'var(--bad)';
    statusEl.textContent = '조회 중 오류: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

function recalc(){
  const dayBlocks = document.querySelectorAll('.day-block');
  const rate24 = Number(document.getElementById('rate24').value) || 0;
  const rate48 = Number(document.getElementById('rate48').value) || 0;
  const rate72 = Number(document.getElementById('rate72').value) || 0;

  let grandCovered = 0;
  let grandExcluded = 0;
  const tableRows = [];
  const numDays = dayBlocks.length;

  dayBlocks.forEach((block, idx) => {
    const label = block.querySelector('.day-label').value || `${idx+1}일차`;
    let coveredSum = 0;
    let excludedSum = 0;
    block.querySelectorAll('.leg').forEach(leg => {
      const fare = Number(leg.querySelector('.fare').value) || 0;
      const isCovered = leg.querySelector('.covered-check').checked;
      if(isCovered){ coveredSum += fare; } else { excludedSum += fare; }
    });
    grandCovered += coveredSum;
    grandExcluded += excludedSum;
    tableRows.push({label, coveredSum, excludedSum});
  });

  const options = [];
  if(numDays >= 1) options.push({label:'24시간권 1장', price: rate24});
  if(numDays >= 2) options.push({label:'48시간권 1장', price: rate48});
  if(numDays >= 3) options.push({label:'72시간권 1장', price: rate72});
  if(numDays >= 1 && numDays <= 6){
    options.push({label:`24시간권 ${numDays}장 (매일 새로 구매)`, price: rate24 * numDays});
  }

  let cheapestPass = options.length ? options.reduce((a,b)=> a.price < b.price ? a : b) : {label:'-', price:0};
  const diff = grandCovered - cheapestPass.price;
  const isGood = diff >= 0 && grandCovered > 0;

  const resultBox = document.getElementById('resultBox');
  if(grandCovered === 0){
    resultBox.innerHTML = `<div class="panel"><p style="color:var(--ink-soft); font-size:13.5px; margin:0;">구간별 요금을 입력(또는 구글맵으로 조회)하면 패스가 이득인지 바로 계산됩니다.</p></div>`;
  } else if(isGood){
    resultBox.innerHTML = `
      <div class="result good">
        <p class="verdict">패스 사는 게 이득이에요 — ${yen(diff)} 절약</p>
        <p class="sub">패스 적용 가능 구간 개별 요금 합계 ${yen(grandCovered)} vs ${cheapestPass.label} ${yen(cheapestPass.price)}</p>
        ${compareTable(options, grandCovered)}
      </div>`;
  } else {
    resultBox.innerHTML = `
      <div class="result bad">
        <p class="verdict">그냥 매번 표 사는 게 ${yen(Math.abs(diff))} 더 저렴해요</p>
        <p class="sub">패스 적용 가능 구간 개별 요금 합계 ${yen(grandCovered)} vs ${cheapestPass.label} ${yen(cheapestPass.price)}</p>
        ${compareTable(options, grandCovered)}
      </div>`;
  }

  if(grandExcluded > 0){
    resultBox.innerHTML += `<div class="excluded-note">패스 미적용으로 체크한 구간 합계 ${yen(grandExcluded)}은(는) 위 비교에서 제외했습니다 (JR·게이세이·도부 등 도쿄메트로·도에이 소속이 아닌 노선). 이 비용은 어느 쪽을 선택하든 별도로 듭니다.</div>`;
  }

  const dayTable = document.getElementById('dayTable');
  let rows = `<tr><th>날짜</th><th class="num">패스적용 구간 합계</th><th class="num">패스 미적용 구간</th></tr>`;
  tableRows.forEach(r=>{
    rows += `<tr><td>${r.label}</td><td class="num">${yen(r.coveredSum)}</td><td class="num">${r.excludedSum>0?yen(r.excludedSum):'-'}</td></tr>`;
  });
  rows += `<tr class="best"><td>합계</td><td class="num">${yen(grandCovered)}</td><td class="num">${grandExcluded>0?yen(grandExcluded):'-'}</td></tr>`;
  dayTable.innerHTML = rows;
}

function compareTable(options, coveredSum){
  if(!options.length) return '';
  const cheapest = options.reduce((a,b)=> a.price < b.price ? a : b);
  let rows = `<table class="compare-table"><tr><th>선택지</th><th class="num">비용</th></tr>`;
  rows += `<tr><td>구간별 개별 승차권</td><td class="num">${coveredSum.toLocaleString('ko-KR')}엔</td></tr>`;
  options.forEach(o=>{
    rows += `<tr class="${o===cheapest?'best':''}"><td>${o.label}</td><td class="num">${o.price.toLocaleString('ko-KR')}엔</td></tr>`;
  });
  rows += `</table>`;
  return rows;
}

addDefaultData();
setupApiPanel();
recalc();