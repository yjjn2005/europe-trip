// ============================================================
// 앱 로직: 탭 전환, 렌더링, 지도, 동기화
// ============================================================

const REGION_KEYS = [...new Set(DAILY.map(d => d.city.split("·")[0]))].filter(k => k !== "이동");

const state = {
  checklist: {},   // "catIdx-itemIdx" -> bool
  daysDone: {},    // day no -> bool
  pin: null,
  lastSync: null,
};

// ---------------- Local persistence ----------------
function loadLocal() {
  try {
    const raw = localStorage.getItem("europe-trip-state");
    if (raw) {
      const parsed = JSON.parse(raw);
      state.checklist = parsed.checklist || {};
      state.daysDone = parsed.daysDone || {};
    }
    state.pin = localStorage.getItem("europe-trip-pin") || null;
  } catch (e) { /* ignore */ }
}

function saveLocal() {
  localStorage.setItem("europe-trip-state", JSON.stringify({
    checklist: state.checklist,
    daysDone: state.daysDone,
  }));
}

// ---------------- Cloudflare Worker sync ----------------
let syncTimer = null;

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function syncNamespace() {
  return (TRIP && TRIP.id) ? TRIP.id : "trip";
}

function setSyncStatus(text, kind) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

async function pushSync() {
  if (!state.pin || !window.SYNC_API_BASE) return;
  try {
    const key = await sha256Hex(syncNamespace() + ":" + state.pin);
    const res = await fetch(`${window.SYNC_API_BASE}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, checklist: state.checklist, daysDone: state.daysDone, updatedAt: Date.now() }),
    });
    if (!res.ok) throw new Error("sync failed");
    state.lastSync = new Date();
    setSyncStatus("동기화됨 · " + state.lastSync.toLocaleTimeString("ko-KR"), "ok");
  } catch (e) {
    setSyncStatus("동기화 실패 — 다시 시도해주세요", "err");
  }
}

function queueSync() {
  saveLocal();
  if (!state.pin) return;
  clearTimeout(syncTimer);
  setSyncStatus("저장 중…", null);
  syncTimer = setTimeout(pushSync, 900);
}

async function pullSync(showStatus = true) {
  if (!state.pin || !window.SYNC_API_BASE) return;
  try {
    if (showStatus) setSyncStatus("불러오는 중…", null);
    const key = await sha256Hex(syncNamespace() + ":" + state.pin);
    const res = await fetch(`${window.SYNC_API_BASE}/state?key=${key}`);
    if (res.status === 404) {
      setSyncStatus("이 코드로 저장된 데이터가 없습니다 — 새로 시작합니다", null);
      return;
    }
    if (!res.ok) throw new Error("pull failed");
    const data = await res.json();
    state.checklist = data.checklist || {};
    state.daysDone = data.daysDone || {};
    saveLocal();
    renderChecklist();
    renderDaily();
    updateHeaderProgress();
    state.lastSync = new Date();
    setSyncStatus("불러옴 · " + state.lastSync.toLocaleTimeString("ko-KR"), "ok");
  } catch (e) {
    setSyncStatus("불러오기 실패 — 코드를 확인해주세요", "err");
  }
}

function connectPin(pin) {
  state.pin = pin.trim();
  if (!state.pin) return;
  localStorage.setItem("europe-trip-pin", state.pin);
  pullSync();
}

// ---------------- Tabs ----------------
function initTabs() {
  document.querySelectorAll(".tabbar button").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.view;
      document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === target));
      document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("active", b === btn));
      if (target === "view-map") setTimeout(initMapIfNeeded, 30);
      window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    });
  });
}

// ---------------- Header ----------------
function applyTripMeta() {
  document.title = `${TRIP.title} — ${TRIP.subtitle}`;
  const titleEl = document.getElementById("tripTitle");
  if (titleEl) titleEl.textContent = `${TRIP.title} · ${TRIP.subtitle}`;
  const subEl = document.querySelector(".app-header .sub");
  if (subEl) {
    const s = new Date(TRIP.start), e = new Date(TRIP.end);
    const fmt = d => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    subEl.textContent = `${fmt(s)} 출발 — ${fmt(e)} 도착 · ${TRIP.people}`;
  }
}

function updateHeaderProgress() {
  const total = DAILY.length;
  const done = Object.values(state.daysDone).filter(Boolean).length;
  const pct = Math.round((done / total) * 100);
  document.getElementById("progressBar").style.width = pct + "%";
  document.getElementById("progressLabel").textContent = `${done} / ${total}일 완료`;

  const today = new Date();
  const start = new Date(TRIP.start);
  const diffDays = Math.round((start - today) / 86400000);
  const dEl = document.getElementById("dDayLabel");
  if (diffDays > 0) dEl.textContent = `D-${diffDays}`;
  else if (diffDays === 0) dEl.textContent = "출발일";
  else if (-diffDays <= TRIP.totalDays) dEl.textContent = `여행 ${-diffDays + 1}일차`;
  else dEl.textContent = "여행 종료";
}

// ---------------- Overview ----------------
function renderOverview() {
  const kv = document.getElementById("overviewKV");
  const rows = [
    ["여행 목적", "은퇴 후 첫 장기 부부 여행 — 성수기를 피해 여유 있게 서유럽·지중해를 둘러보는 2개월 일정"],
    ["기간", `2027년 1월 10일(일) 인천 출발 ~ 2027년 3월 12일(금) 인천 도착 (총 ${TRIP.totalDays}일, ${TRIP.nights}박)`],
    ["방문국", "포르투갈 → 이탈리아(시칠리아) → 그리스 → 프랑스(니스·프로방스) → 이탈리아(피렌체·베네치아·로마)"],
    ["인원", TRIP.people],
    ["숙소 등급", "4성급 호텔 · 부티크 호텔 중심 (도시 중심가, 조식 포함 우선)"],
    ["항공 좌석", "이코노미 비상구 좌석(레그룸 확장석) 우선 지정"],
    ["여행 형태", "자유여행 — 항공권/기차/현지 투어 티켓팅은 전문 여행사에 위임"],
    ["스페인", "작년 방문(10일) 경험이 있어 이번 일정에서는 제외"],
  ];
  kv.innerHTML = rows.map(([k, v]) => `<div class="kv-row"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

  const principles = [
    "스페인은 작년에 10일간 다녀오신 경험이 있어 이번 2개월 여정에서는 제외하고, 포르투갈·이탈리아·그리스·프랑스 남부를 중심으로 설계했습니다.",
    "성수기(6~8월, 부활절 전후)를 피해 1~3월 비수기에 이동함으로써 항공권·숙박비가 낮고, 주요 관광지에서 줄을 서지 않고 여유 있게 관람할 수 있습니다.",
    "겨울철 남유럽은 서울보다 온화합니다(1월 평균 낮기온 리스본 약 15℃, 팔레르모 약 15℃, 아테네 약 14℃, 니스 약 12~14℃). 우기와 겹치는 날이 있어 실내 일정을 함께 배치했습니다.",
    "동선은 가장 추운 1월 중하순에는 온화한 포르투갈·시칠리아·그리스에 머물고, 봄이 가까워지는 2월 중순 이후 북상해 프랑스 남부·이탈리아 중북부로 이동하도록 짰습니다.",
    "인천-리스본 입국, 로마-인천 출국의 오픈조 항공권으로 유럽 내 왕복 이동 없이 효율적으로 이동합니다.",
    "비상구 좌석은 국적기 정상운임(이코노미 M등급 이상) 구매 시 사전지정 가능하며, 거동이 불편하거나 노약자로 판단되면 탑승 현장에서 배정이 거절될 수 있어 예약 시 재확인이 필요합니다.",
  ];
  document.getElementById("principleList").innerHTML = principles.map(p => `<li>${p}</li>`).join("");

  const rm = document.getElementById("regionSummary");
  rm.innerHTML = REGIONS.map(r => {
    const tipEntry = REGION_TIPS.find(t => t.region === r.region);
    return `
    <div class="region-block">
      <div class="region-head"><span>${r.region}</span><span class="range">${r.range}</span></div>
      ${r.cities.map(c => `
        <div class="city-card">
          <div class="city-name">${c.name}</div>
          <div class="city-meta">${c.nights}박 · ${c.range} · ${c.weather} · 숙소: ${c.stay}</div>
          <dl>
            <dt>하이라이트</dt><dd>${c.highlights}</dd>
            <dt>당일투어</dt><dd>${c.dayTrip}</dd>
          </dl>
        </div>
      `).join("")}
      ${tipEntry ? `
        <div class="tips-box">
          <div class="tips-title">꼭 알아야 할 사항</div>
          <ul class="tips-list">${tipEntry.tips.map(t => `<li>${t}</li>`).join("")}</ul>
        </div>
      ` : ""}
    </div>
  `;
  }).join("");
}

// ---------------- Map ----------------
// Group consecutive same-nation stops together and label them
// "<group><letter>" (e.g. 1a, 1b, 2a...) so intra-country legs read as a
// lettered sequence within each numbered country visit.
function computeStopLabels() {
  const labels = [];
  let group = 0;
  let prevNation = null;
  let letterIdx = 0;
  STOPS.forEach(s => {
    if (s.nation !== prevNation) {
      group += 1;
      letterIdx = 0;
      prevNation = s.nation;
    } else {
      letterIdx += 1;
    }
    const letter = String.fromCharCode(97 + letterIdx); // a, b, c...
    labels.push(`${group}${letter}`);
  });
  return labels;
}

let mapInstance = null;
let mapMarkers = [];
let mapInited = false;

function initMapIfNeeded() {
  if (mapInited || !window.google || !window.google.maps) return;
  mapInited = true;
  mapInstance = new google.maps.Map(document.getElementById("map"), {
    zoom: 4,
    center: { lat: 41.5, lng: 10.5 },
    mapId: "EUROPE_TRIP_MAP",
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  // ---- 일자별 경로: 당일(오전~저녁) 이동은 빨간선, 하루→다음날 이동은 파란선 ----
  const toLatLng = id => {
    const wp = WAYPOINTS[id];
    return wp ? { lat: wp[0], lng: wp[1] } : null;
  };

  const withinDaySegs = [];   // 빨간선: 같은 날 안에서의 이동
  const betweenDaySegs = [];  // 파란선: 전날 마지막 지점 → 다음날 첫 지점
  let prevDayLastPoint = null;

  DAILY.forEach(day => {
    const pts = (day.route || []).map(toLatLng).filter(Boolean);
    if (pts.length === 0) return;
    for (let i = 0; i < pts.length - 1; i++) {
      withinDaySegs.push([pts[i], pts[i + 1]]);
    }
    if (prevDayLastPoint) {
      betweenDaySegs.push([prevDayLastPoint, pts[0]]);
    }
    prevDayLastPoint = pts[pts.length - 1];
  });

  const routeLines = [];
  betweenDaySegs.forEach(seg => {
    routeLines.push(new google.maps.Polyline({
      path: seg,
      geodesic: true,
      strokeColor: "#2260D8",
      strokeOpacity: 0.8,
      strokeWeight: 2,
      map: mapInstance,
      zIndex: 1,
    }));
  });
  withinDaySegs.forEach(seg => {
    routeLines.push(new google.maps.Polyline({
      path: seg,
      geodesic: true,
      strokeColor: "#D6362A",
      strokeOpacity: 0.9,
      strokeWeight: 2,
      map: mapInstance,
      zIndex: 2,
    }));
  });

  // ---- 당일투어 등 보조 지점(도시 허브가 아닌 웨이포인트)에 작은 점 마커 ----
  const hubIds = new Set(["lisbon", "porto", "palermo", "taormina", "siracusa", "athens", "nafplio", "nice", "aix", "firenze", "venezia", "roma"]);
  const shownWaypoints = new Set();
  const waypointInfoWindow = new google.maps.InfoWindow();
  Object.keys(WAYPOINT_LABELS).forEach(id => {
    if (hubIds.has(id) || shownWaypoints.has(id) || !WAYPOINTS[id]) return;
    shownWaypoints.add(id);
    const pos = toLatLng(id);
    const dot = new google.maps.Marker({
      position: pos,
      map: mapInstance,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 5,
        fillColor: "#D6362A",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 1.5,
      },
      title: WAYPOINT_LABELS[id],
      zIndex: 3,
    });
    dot.addListener("click", () => {
      waypointInfoWindow.setContent(`<div style="font-family:'Noto Sans KR',sans-serif;font-size:12.5px;font-weight:700;color:#0F2544;">${WAYPOINT_LABELS[id]}</div>`);
      waypointInfoWindow.open(mapInstance, dot);
    });
  });

  const bounds = new google.maps.LatLngBounds();
  const infoWindow = new google.maps.InfoWindow();
  const stopLabels = computeStopLabels();

  STOPS.forEach((s, i) => {
    const marker = new google.maps.Marker({
      position: { lat: s.lat, lng: s.lng },
      map: mapInstance,
      label: { text: stopLabels[i], color: "#B7975C", fontSize: "10.5px", fontWeight: "700" },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 13,
        fillColor: "#0F2544",
        fillOpacity: 1,
        strokeColor: "#B7975C",
        strokeWeight: 2,
      },
      title: s.name,
    });
    marker.addListener("click", () => {
      infoWindow.setContent(`
        <div style="font-family:'Noto Sans KR',sans-serif;min-width:170px;">
          <div style="font-weight:700;color:#0F2544;font-size:14px;margin-bottom:2px;">${stopLabels[i]}. ${s.name}</div>
          <div style="font-size:11.5px;color:#6B6458;margin-bottom:5px;">${s.country} · ${s.range}</div>
          <div style="font-size:12px;color:#252220;">${s.note}</div>
        </div>
      `);
      infoWindow.open(mapInstance, marker);
    });
    mapMarkers.push(marker);
    bounds.extend(marker.getPosition());
  });

  mapInstance.fitBounds(bounds, 40);

  document.getElementById("mapLegend").innerHTML = `
    <div class="legend-item"><span class="swatch navy"></span>일별 이동 — 전날 마지막 지점 → 다음날 첫 지점 (파란선)</div>
    <div class="legend-item"><span class="swatch red"></span>당일 동선 — 오전·오후·저녁 이동, 당일투어 왕복 (빨간선)</div>
  `;

  document.getElementById("stopList").innerHTML = STOPS.map((s, i) => `
    <div class="stop-row" data-idx="${i}">
      <div class="num">${stopLabels[i]}</div>
      <div class="info">
        <div class="name">${s.name}</div>
        <div class="range">${s.country} · ${s.range}</div>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".stop-row").forEach(row => {
    row.addEventListener("click", () => {
      const idx = Number(row.dataset.idx);
      const s = STOPS[idx];
      mapInstance.panTo({ lat: s.lat, lng: s.lng });
      mapInstance.setZoom(9);
      google.maps.event.trigger(mapMarkers[idx], "click");
    });
  });
}

function loadGoogleMaps() {
  if (!window.GOOGLE_MAPS_API_KEY || window.GOOGLE_MAPS_API_KEY.indexOf("REPLACE") === 0) {
    document.getElementById("map").innerHTML =
      '<div style="padding:20px;font-size:13px;color:#6B6458;">지도를 표시하려면 config.js에 Google Maps API 키를 설정해주세요.</div>';
    document.getElementById("stopList").innerHTML = STOPS.map((s, i) => `
      <div class="stop-row"><div class="num">${i + 1}</div>
      <div class="info"><div class="name">${s.name}</div><div class="range">${s.country} · ${s.range}</div></div></div>
    `).join("");
    return;
  }
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${window.GOOGLE_MAPS_API_KEY}&callback=initMapIfNeeded`;
  script.async = true;
  window.initMapIfNeeded = initMapIfNeeded;
  document.head.appendChild(script);
}

// ---------------- Daily schedule ----------------
let dayFilter = "전체";

function renderDayFilters() {
  const el = document.getElementById("dayFilters");
  const keys = ["전체", ...REGION_KEYS, "이동"];
  el.innerHTML = keys.map(k => `<button data-k="${k}" class="${k === dayFilter ? "active" : ""}">${k}</button>`).join("");
  el.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      dayFilter = btn.dataset.k;
      renderDayFilters();
      renderDaily();
    });
  });
}

function renderDaily() {
  const list = document.getElementById("dailyList");
  const items = DAILY.filter(d => dayFilter === "전체" || d.city.startsWith(dayFilter) || (dayFilter === "이동" && d.transit));
  list.innerHTML = items.map(d => {
    const dt = new Date(d.date);
    const wd = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
    const done = !!state.daysDone[d.no];
    return `
      <div class="day-card ${d.transit ? "transit" : ""} ${done ? "done" : ""}">
        <div class="day-top">
          <div>
            <div class="day-date">${dt.getMonth() + 1}/${dt.getDate()} (${wd}) <span style="font-weight:400;color:#6B6458;font-size:11px;">No.${d.no}</span></div>
            <div class="day-city">${d.city}${d.stay !== "-" ? " · " + d.stay : ""}</div>
          </div>
          <label class="day-check">
            <input type="checkbox" data-no="${d.no}" ${done ? "checked" : ""} aria-label="완료 표시" />
          </label>
        </div>
        <div class="day-body">
          <div class="slot"><span class="label">오전</span><span>${d.am}</span></div>
          <div class="slot"><span class="label">오후</span><span>${d.pm}</span></div>
          <div class="slot"><span class="label">저녁</span><span>${d.eve}</span></div>
        </div>
        ${d.note !== "-" ? `<div class="day-note">${d.note}</div>` : ""}
      </div>
    `;
  }).join("");

  list.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener("change", () => {
      state.daysDone[cb.dataset.no] = cb.checked;
      queueSync();
      updateHeaderProgress();
      cb.closest(".day-card").classList.toggle("done", cb.checked);
    });
  });
}

// ---------------- Budget ----------------
function renderBudget() {
  const container = document.getElementById("budgetCategories");
  let grandTotal = 0;

  container.innerHTML = BUDGET_DETAILED.map((cat, ci) => {
    const subtotal = cat.items.reduce((s, it) => s + it.amount, 0);
    grandTotal += subtotal;
    return `
      <div class="budget-cat">
        <button class="budget-cat-head" data-ci="${ci}">
          <span class="cat-name"><span class="caret">▸</span>${cat.category}</span>
          <span class="cat-sub">${subtotal.toLocaleString("ko-KR")}원</span>
        </button>
        <table class="budget-table budget-cat-body" id="budgetCat-${ci}">
          <tbody>
            ${cat.items.map(it => `
              <tr>
                <td>${it.label}</td>
                <td>${it.note}</td>
                <td class="amt">${it.amount.toLocaleString("ko-KR")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }).join("");

  document.getElementById("budgetGrandTotal").textContent = grandTotal.toLocaleString("ko-KR") + "원";
  document.getElementById("budgetPerPerson").textContent = "1인당 약 " + Math.round(grandTotal / 2).toLocaleString("ko-KR") + "원";

  container.querySelectorAll(".budget-cat-head").forEach(btn => {
    btn.addEventListener("click", () => {
      const body = document.getElementById("budgetCat-" + btn.dataset.ci);
      const open = body.classList.toggle("open");
      btn.classList.toggle("open", open);
    });
  });
  // Open the first category by default
  const firstBtn = container.querySelector(".budget-cat-head");
  if (firstBtn) firstBtn.click();
}

// ---------------- Checklist ----------------
function renderChecklist() {
  const el = document.getElementById("checklistBody");
  el.innerHTML = CHECKLIST.map((grp, ci) => `
    <div class="check-group">
      <div class="cat">${grp.cat}</div>
      ${grp.items.map((it, ii) => {
        const key = ci + "-" + ii;
        const done = !!state.checklist[key];
        return `
          <div class="check-item ${done ? "done" : ""}">
            <input type="checkbox" id="chk-${key}" data-key="${key}" ${done ? "checked" : ""} />
            <label for="chk-${key}">${it}</label>
          </div>
        `;
      }).join("")}
    </div>
  `).join("");

  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener("change", () => {
      state.checklist[cb.dataset.key] = cb.checked;
      queueSync();
      cb.closest(".check-item").classList.toggle("done", cb.checked);
    });
  });
}

// ---------------- Address book ----------------
function renderAddresses() {
  const el = document.getElementById("addressList");
  el.innerHTML = ADDRESSES.map(a => `
    <div class="addr-card">
      <div class="addr-city">${a.city}</div>
      <div class="addr-row"><span class="tag">공항/역</span><span class="val">${a.airport}</span>
        <button class="copy" data-copy="${a.airport.replace(/"/g, '&quot;')}">복사</button></div>
      <div class="addr-row"><span class="tag">랜드마크</span><span class="val">${a.landmark}</span>
        <button class="copy" data-copy="${a.landmark.replace(/"/g, '&quot;')}">복사</button></div>
      <div class="addr-row"><span class="tag">숙소지역</span><span class="val">${a.stay}</span>
        <button class="copy" data-copy="${a.stay.replace(/"/g, '&quot;')}">복사</button></div>
    </div>
  `).join("");

  el.querySelectorAll("button.copy").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        const orig = btn.textContent;
        btn.textContent = "복사됨";
        setTimeout(() => { btn.textContent = orig; }, 1200);
      } catch (e) { /* clipboard unavailable */ }
    });
  });
}

// ---------------- Sync bar ----------------
function initSyncBar() {
  const input = document.getElementById("pinInput");
  const connectBtn = document.getElementById("pinConnect");
  if (state.pin) input.value = state.pin;
  connectBtn.addEventListener("click", () => connectPin(input.value));
  input.addEventListener("keydown", e => { if (e.key === "Enter") connectPin(input.value); });
}

// ---------------- Boot ----------------
function boot() {
  loadLocal();
  applyTripMeta();
  initTabs();
  renderOverview();
  renderDayFilters();
  renderDaily();
  renderBudget();
  renderChecklist();
  renderAddresses();
  initSyncBar();
  updateHeaderProgress();
  loadGoogleMaps();
  if (state.pin) pullSync(false);

  if ("serviceWorker" in navigator && navigator.serviceWorker) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", boot);
