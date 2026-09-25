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
    subEl.textContent = `${fmt(s)} 출발 — ${fmt(e)} 밀라노 출발(인천 도착 익일 예상) · ${TRIP.people}`;
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
  const rows = OVERVIEW_FACTS;
  kv.innerHTML = rows.map(([k, v]) => `<div class="kv-row"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

  const principles = PRINCIPLES;
  document.getElementById("principleList").innerHTML = principles.map(p => `<li>${p}</li>`).join("");

  const rm = document.getElementById("regionSummary");
  rm.innerHTML = REGIONS.map(r => {
    const tipEntry = REGION_TIPS.find(t => t.region === r.region);
    return `
    <div class="region-block">
      <div class="region-head"><span class="region-name">${r.region}</span><span class="range">${r.range}</span></div>
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
let mapInstance = null;
let mapMarkers = [];
let mapInited = false;

const CAT_COLOR = { H: "#0F2544", P: "#5B6B4F", T: "#7A7A72", A: "#C99A3E" };
const CAT_LABEL = { H: "호텔(숙박 거점)", P: "여행지", T: "대중교통·경유지", A: "공항" };

function flagPinEl(letter, color, name) {
  const pin = document.createElement("div");
  pin.style.cssText = "display:flex;align-items:flex-end;gap:4px;cursor:pointer;";
  pin.innerHTML = `
    <svg width="26" height="33" viewBox="0 0 30 38" style="flex:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));">
      <line x1="4" y1="6" x2="4" y2="36" stroke="#3a3a34" stroke-width="2.2"/>
      <circle cx="4" cy="36.5" r="2.2" fill="#3a3a34"/>
      <path d="M4 4 L27 4 L20 12 L27 20 L4 20 Z" fill="${color}" stroke="#fff" stroke-width="1.6"/>
      <text x="14" y="16" font-size="11" font-weight="700" fill="#fff" font-family="'Noto Sans KR',sans-serif" text-anchor="middle">${letter}</text>
    </svg>
    <div style="background:rgba(255,252,246,0.96);border:1px solid ${color};border-radius:7px;
      padding:2px 7px;font-size:11px;font-weight:700;color:#20242B;white-space:nowrap;
      box-shadow:0 1px 4px rgba(0,0,0,.18);font-family:'Noto Sans KR',sans-serif;margin-bottom:7px;">${name}</div>`;
  return pin;
}

async function initMapIfNeeded() {
  if (mapInited || !window.google || !window.google.maps) return;
  mapInited = true;
  mapInstance = new google.maps.Map(document.getElementById("map"), {
    zoom: 4,
    center: { lat: 41.5, lng: 10.5 },
    mapId: "DEMO_MAP_ID",
    gestureHandling: "greedy",
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  const toLatLng = id => {
    const wp = WAYPOINTS[id];
    return wp ? { lat: wp[0], lng: wp[1] } : null;
  };
  const nationOf = id => WAYPOINT_NATION[id] || null;

  // ---- 일자별 경로: 국가 간 이동은 빨간 화살표, 국내 이동은 파란선 ----
  const allSegs = [];
  let prevId = null;
  DAILY.forEach(day => {
    const ids = (day.route || []).filter(id => WAYPOINTS[id]);
    if (!ids.length) return;
    if (prevId) allSegs.push({ fromId: prevId, toId: ids[0] });
    for (let i = 0; i < ids.length - 1; i++) allSegs.push({ fromId: ids[i], toId: ids[i + 1] });
    prevId = ids[ids.length - 1];
  });

  const routeLines = [];
  const arrowIcon = { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: "#D6362A", fillColor: "#D6362A", fillOpacity: 1 };
  let interCount = 0, intraCount = 0;
  allSegs.forEach(seg => {
    const from = toLatLng(seg.fromId), to = toLatLng(seg.toId);
    if (!from || !to) return;
    const isInter = nationOf(seg.fromId) && nationOf(seg.toId) && nationOf(seg.fromId) !== nationOf(seg.toId);
    if (isInter) interCount++; else intraCount++;
    routeLines.push(new google.maps.Polyline({
      path: [from, to],
      geodesic: true,
      strokeColor: isInter ? "#D6362A" : "#2260D8",
      strokeOpacity: isInter ? 0.9 : 0.75,
      strokeWeight: isInter ? 3 : 2,
      icons: isInter ? [{ icon: arrowIcon, offset: "0%", repeat: "90px" }] : [],
      map: mapInstance,
      zIndex: isInter ? 2 : 1,
    }));
  });

  // ---- 마커: 카테고리(H 호텔 / P 여행지 / T 대중교통 / A 공항)별 깃발 핀 ----
  const bounds = new google.maps.LatLngBounds();
  const infoWindow = new google.maps.InfoWindow();
  const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
  const hubIds = new Set(STOPS.map((s, i) => {
    const match = Object.entries(WAYPOINTS).find(([id, c]) => c[0] === s.lat && c[1] === s.lng);
    return match ? match[0] : null;
  }).filter(Boolean));

  STOPS.forEach(s => {
    const pin = flagPinEl("H", CAT_COLOR.H, s.name);
    const marker = new AdvancedMarkerElement({ position: { lat: s.lat, lng: s.lng }, map: mapInstance, title: s.name, content: pin, zIndex: 100 });
    marker.addListener("click", () => {
      infoWindow.setContent(`
        <div style="font-family:'Noto Sans KR',sans-serif;min-width:190px;">
          <div style="font-size:10.5px;color:${CAT_COLOR.H};font-weight:700;margin-bottom:2px;">H · ${CAT_LABEL.H}</div>
          <div style="font-weight:700;color:#0F2544;font-size:15px;margin-bottom:3px;">${s.name}</div>
          <div style="font-size:11.5px;color:#6B6458;margin-bottom:5px;">${s.country} · ${s.range}</div>
          <div style="font-size:12px;color:#252220;">${s.note}</div>
        </div>`);
      infoWindow.open({ anchor: marker, map: mapInstance });
    });
    mapMarkers.push(marker);
    bounds.extend({ lat: s.lat, lng: s.lng });
  });

  Object.keys(WAYPOINT_LABELS).forEach(id => {
    if (hubIds.has(id) || !WAYPOINTS[id]) return;
    const cat = WAYPOINT_CATEGORY[id] || "P";
    const color = CAT_COLOR[cat] || CAT_COLOR.P;
    const pos = toLatLng(id);
    const pin = flagPinEl(cat, color, WAYPOINT_LABELS[id]);
    const marker = new AdvancedMarkerElement({ position: pos, map: mapInstance, title: WAYPOINT_LABELS[id], content: pin, zIndex: 50 });
    marker.addListener("click", () => {
      infoWindow.setContent(`
        <div style="font-family:'Noto Sans KR',sans-serif;min-width:170px;">
          <div style="font-size:10.5px;color:${color};font-weight:700;margin-bottom:2px;">${cat} · ${CAT_LABEL[cat]}</div>
          <div style="font-weight:700;color:#0F2544;font-size:13.5px;">${WAYPOINT_LABELS[id]}</div>
        </div>`);
      infoWindow.open({ anchor: marker, map: mapInstance });
    });
  });

  // 출발·도착 라벨 (전체 경로의 첫/마지막 지점)
  if (STOPS.length) {
    new google.maps.Marker({
      position: { lat: STOPS[0].lat, lng: STOPS[0].lng }, map: mapInstance,
      label: { text: "출발", color: "#0F2544", fontWeight: "700", fontSize: "11px" },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0.1, fillOpacity: 0, strokeOpacity: 0 }, zIndex: 1,
    });
    const last = STOPS[STOPS.length - 1];
    new google.maps.Marker({
      position: { lat: last.lat, lng: last.lng }, map: mapInstance,
      label: { text: "도착", color: "#0F2544", fontWeight: "700", fontSize: "11px" },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0.1, fillOpacity: 0, strokeOpacity: 0 }, zIndex: 1,
    });
  }

  mapInstance.fitBounds(bounds, 40);
  const overallBounds = bounds;

  // ---- 지역별 상세 보기 버튼: 눌리면 해당 지역으로 확대 ----
  const regionTabsEl = document.getElementById("mapRegionTabs");
  const regionOptions = [{ label: "전체", ids: null }, ...REGION_MAP_GROUPS];
  regionTabsEl.innerHTML = regionOptions.map((g, i) => `<button data-ri="${i}" class="${i === 0 ? "active" : ""}">${g.label}</button>`).join("");
  regionTabsEl.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      regionTabsEl.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
      const group = regionOptions[Number(btn.dataset.ri)];
      if (!group.ids) { mapInstance.fitBounds(overallBounds, 40); return; }
      const b2 = new google.maps.LatLngBounds();
      group.ids.forEach(id => { const p = toLatLng(id); if (p) b2.extend(p); });
      mapInstance.fitBounds(b2, 48);
    });
  });

  document.getElementById("mapLegend").innerHTML = `
    <div class="legend-item"><span class="swatch red"></span>국가 간 이동 — 화살표(${interCount}구간)</div>
    <div class="legend-item"><span class="swatch navy"></span>국내 이동(${intraCount}구간)</div>
    ${Object.keys(CAT_COLOR).map(c => `<div class="legend-item"><span class="swatch cat" style="background:${CAT_COLOR[c]}"></span>${c} · ${CAT_LABEL[c]}</div>`).join("")}
  `;

  document.getElementById("stopList").innerHTML = STOPS.map((s, i) => `
    <div class="stop-row" data-idx="${i}">
      <div class="num">H</div>
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

// ---------------- Accommodations table ----------------
function renderAccommodations() {
  const el = document.getElementById("accommodationsTable");
  if (!el) return;
  if (typeof ACCOMMODATIONS === "undefined" || !ACCOMMODATIONS.length) {
    el.innerHTML = "";
    return;
  }
  const rows = ACCOMMODATIONS.map(a => `
    <tr>
      <td>${a.country}</td>
      <td>${a.city}</td>
      <td>${a.checkin}~${a.checkout}</td>
      <td class="amt">${a.nights}박</td>
      <td>${a.area}</td>
      <td class="amt">€${a.eur.toLocaleString("en-US")}</td>
    </tr>
  `).join("");
  el.innerHTML = `
    <table class="budget-table">
      <thead><tr><th>국가</th><th>도시</th><th>체크인~아웃</th><th>박</th><th>권장 지역</th><th>1박예산</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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
  renderAccommodations();
  initSyncBar();
  updateHeaderProgress();
  loadGoogleMaps();
  if (state.pin) pullSync(false);

  if ("serviceWorker" in navigator && navigator.serviceWorker) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", boot);
