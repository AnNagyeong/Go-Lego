const container = document.getElementById("map");

const options = {
  center: new kakao.maps.LatLng(37.56184, 127.03811),
  level: 3,
};

const map = new kakao.maps.Map(container, options);
const placesService = new kakao.maps.services.Places();
const geocoder = new kakao.maps.services.Geocoder();
const restoredMapViewFromQuery = restoreMapViewFromQuery();

let markers = [];
let startPlace = null;
let endPlace = null;
let currentPolyline = null;
let currentRoutePolylines = [];
let dangerCircles = [];
let startMarker = null;
let endMarker = null;
let currentLocationMarker = null;
let currentLocationHeading = 0;
let currentWatchId = null;
let kioskMarkers = [];
let nearbyInfoWindow = null;
let clickedPlaceMarker = null;
let currentLocationPosition = null;
let infoPanelState = "route";
let nearbyPanelPlaces = [];
let nearbyPanelKeyword = "주변";
let currentRouteData = null;
let selectedPlaceForRoute = null;
let activeNearbyFilterKeyword = "";
let currentInlineReportTarget = null;

// false 일 땐 지도만 보는 중, true 일 땐 실제 길안내 중
let navigationMode = false;
let lastNavigationPosition = null;
let navigationRouteInitialized = false;
let selectedMobilityType = "walking";
let lastAcceptedLocation = null;
let lastRouteRecalculationAt = 0;
let navigationSimulationTimer = null;
let navigationSimulationActive = false;

if (!restoredMapViewFromQuery) {
  centerMapOnCurrentLocation({
    setStartPlace: false,
    updatePanel: false,
    collapsePanel: false,
    silentError: true,
  });
}

function restoreMapViewFromQuery() {
  const params = new URLSearchParams(location.search);
  let restoredCenter = false;

  if (params.has("mapX") && params.has("mapY")) {
    const mapX = Number(params.get("mapX"));
    const mapY = Number(params.get("mapY"));

    if (!Number.isNaN(mapX) && !Number.isNaN(mapY)) {
      map.setCenter(new kakao.maps.LatLng(mapY, mapX));
      restoredCenter = true;
    }
  }

  if (params.has("mapLevel")) {
    const mapLevel = Number(params.get("mapLevel"));

    if (!Number.isNaN(mapLevel)) {
      map.setLevel(mapLevel);
    }
  }

  return restoredCenter;
}

const NEARBY_SEARCH_RADIUS = 1000;
const LOCATION_HIGH_ACCURACY_METERS = 15;
const LOCATION_USABLE_ACCURACY_METERS = 30;
const LOCATION_MAX_AGE_MS = 30000;
const SNAP_TO_ENTRANCE_DISTANCE = 30;
const MAX_ROUTE_SNAP_DISTANCE = 20;
const GPS_JUMP_DISTANCE_METERS = 80;
const GPS_JUMP_WINDOW_MS = 3000;
const GPS_WALKING_MAX_SPEED_MPS = 12;
const ROUTE_RECALCULATION_DISTANCE = 45;
const ROUTE_RECALCULATION_COOLDOWN_MS = 15000;
const GPS_SIMULATION_STEP_METERS = 8;
const GPS_SIMULATION_INTERVAL_MS = 700;
const DEVELOPMENT_GPS_SIMULATION =
  (location.hostname === "localhost" || location.hostname === "127.0.0.1") &&
  new URLSearchParams(location.search).get("debugGps") === "1";

document.body.classList.toggle("dev-environment", DEVELOPMENT_GPS_SIMULATION);
const NEARBY_CATEGORY_CODES = {
  "편의점": "CS2",
  "카페": "CE7",
  "음식점": "FD6",
  "병원": "HP8",
};

const searchInput = document.getElementById("searchInput");
const backBtn = document.getElementById("backBtn");
const searchBtn = document.getElementById("searchBtn");
const resultList = document.getElementById("resultList");
const quickStartInput = document.getElementById("quickStartInput");
const quickEndInput = document.getElementById("quickEndInput");
const quickSwapRouteBtn = document.getElementById("quickSwapRouteBtn");
const quickRouteResetBtn = document.getElementById("quickRouteResetBtn");
const quickRouteFindBtn = document.getElementById("quickRouteFindBtn");
const routePlannerBackBtn = document.getElementById("routePlannerBackBtn");
const quickRouteResultList = document.getElementById("quickRouteResultList");

const placeSheet = document.getElementById("placeSheet");
const panelContent = document.getElementById("panelContent");
const placeName = document.getElementById("placeName");
const placeAddress = document.getElementById("placeAddress");
const sheetHandle = document.getElementById("sheetHandle");

const startRouteBtn = document.getElementById("startRouteBtn");
const routeListBtn = document.getElementById("routeListBtn");

const chipButtons = document.querySelectorAll(".chip");

const favoriteBtn = document.getElementById("favoriteBtn");
const filterBtn = document.getElementById("filterBtn");
const socialHelpBtn = document.getElementById("socialHelpBtn");
const currentLocationBtn = document.getElementById("currentLocationBtn");
const filterPanel = document.getElementById("filterPanel");
const closeFilterBtn = document.getElementById("closeFilterBtn");
const favoritesPanel = document.getElementById("favoritesPanel");
const closeFavoritesPanelBtn = document.getElementById("closeFavoritesPanelBtn");
const favoriteEditBtn = document.getElementById("favoriteEditBtn");
const favoriteGroupCount = document.getElementById("favoriteGroupCount");
const favoriteSortLabel = document.getElementById("favoriteSortLabel");
const favoriteGroupList = document.getElementById("favoriteGroupList");
const addFavoriteGroupBtn = document.getElementById("addFavoriteGroupBtn");
const socialHelpPanel = document.getElementById("socialHelpPanel");
const closeSocialHelpBtn = document.getElementById("closeSocialHelpBtn");
const requestSocialHelpBtn = document.getElementById("requestSocialHelpBtn");
const socialHelpLocation = document.getElementById("socialHelpLocation");
const socialHelpStatus = document.getElementById("socialHelpStatus");
const volunteerRequestPanel = document.getElementById("volunteerRequestPanel");
const volunteerRequestMapEl = document.getElementById("volunteerRequestMap");
const volunteerRequesterLocation = document.getElementById("volunteerRequesterLocation");
const acceptVolunteerRequestBtn = document.getElementById("acceptVolunteerRequestBtn");
const declineVolunteerRequestBtn = document.getElementById("declineVolunteerRequestBtn");

const loginNavBtn = document.getElementById("loginNavBtn");
const cameraNavBtn = document.getElementById("cameraNavBtn");
const bookmarkNavBtn = document.getElementById("bookmarkNavBtn");
const homeNavBtn = document.getElementById("homeNavBtn");
const nearbyNavBtn = document.getElementById("nearbyNavBtn");
const weatherBadge = document.getElementById("weatherBadge");
const weatherIcon = document.getElementById("weatherIcon") || document.querySelector(".weather-icon");
const weatherTemp = document.getElementById("weatherTemp");
const weatherSummary = document.getElementById("weatherSummary");

let lastWeatherKey = "";
let volunteerPreviewMap = null;
let volunteerPreviewMarker = null;
let volunteerNearbyMarkers = [];
let activeQuickRouteRole = "start";
let quickRouteSearchTimer = null;
let quickRouteSearchId = 0;
let deviceHeadingListenerActive = false;
let favoriteGroups = [];
let favoritesEditMode = false;
let currentFavoriteCandidate = null;
let selectedFavoriteGroupId = null;

loadSelectedRouteFromQuery();

kakao.maps.event.addListener(map, "click", handleMapPlaceClick);

if (backBtn) {
  backBtn.addEventListener("click", handleBackButton);
}

function setActiveNav(button) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
}

if (homeNavBtn) {
  homeNavBtn.addEventListener("click", () => {
    setActiveNav(homeNavBtn);
    favoritesPanel?.classList.add("hidden");
    filterPanel?.classList.add("hidden");
    socialHelpPanel?.classList.add("hidden");
    resetRouteState();
  });
}

if (nearbyNavBtn) {
  nearbyNavBtn.addEventListener("click", () => {
    setActiveNav(nearbyNavBtn);
    clearNearbyFilterSelection();
    searchInput.value = "편의시설";
    searchNearbyPlaces("편의시설");
  });
}

if (loginNavBtn) {
  loginNavBtn.addEventListener("click", () => {
    setActiveNav(loginNavBtn);
    const token = localStorage.getItem("accessnavToken");
    location.href = token ? "mypage.html" : "login.html";
  });
}

if (cameraNavBtn) {
  cameraNavBtn.addEventListener("click", () => {
    setActiveNav(cameraNavBtn);
    openReportPanelAtCurrentMap();
  });
}

if (bookmarkNavBtn) {
  bookmarkNavBtn.addEventListener("click", () => {
    setActiveNav(bookmarkNavBtn);
    openFavoritesPage();
  });
}

if (sheetHandle && placeSheet) {
  sheetHandle.addEventListener("click", () => {
    dismissActiveCaption({ removeCurrentLocation: true });
  });
}

searchBtn.addEventListener("click", () => {
  const keyword = searchInput.value.trim();
  if (!keyword) return;
  clearNearbyFilterSelection();
  searchPlaces(keyword);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const keyword = searchInput.value.trim();
    if (!keyword) return;
    clearNearbyFilterSelection();
    searchPlaces(keyword);
  }
});

chipButtons.forEach((chip) => {
  chip.addEventListener("click", () => {
    const keyword = chip.dataset.keyword;
    document.body.classList.remove("route-mode", "route-planner-mode");

    if (activeNearbyFilterKeyword === keyword) {
      clearActiveNearbyFilter();
      return;
    }

    setActiveNearbyFilter(keyword);
    searchInput.value = keyword;
    searchNearbyPlaces(keyword);
  });
});

if (quickRouteFindBtn) {
  quickRouteFindBtn.addEventListener("click", findQuickRoute);
}

if (quickRouteResetBtn) {
  quickRouteResetBtn.addEventListener("click", resetRouteState);
}

if (quickSwapRouteBtn) {
  quickSwapRouteBtn.addEventListener("click", swapQuickRouteInputs);
}

routePlannerBackBtn?.addEventListener("click", () => {
  document.body.classList.remove("route-planner-mode");
  hideQuickRouteResultList();
  resetPlaceSheet();
});

[quickStartInput, quickEndInput].forEach((input) => {
  input?.addEventListener("focus", () => {
    activeQuickRouteRole = input === quickStartInput ? "start" : "end";
    showQuickRouteResultsForInput(input);
  });

  input?.addEventListener("input", () => {
    activeQuickRouteRole = input === quickStartInput ? "start" : "end";
    showQuickRouteResultsForInput(input);
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      findQuickRoute();
    }
  });
});

document.addEventListener("click", (event) => {
  if (
    event.target.closest(".quick-route-panel") ||
    event.target.closest("#quickRouteResultList")
  ) {
    return;
  }

  hideQuickRouteResultList();
});

if (currentLocationBtn) {
  currentLocationBtn.addEventListener("click", moveToCurrentLocation);
}

if (socialHelpBtn) {
  socialHelpBtn.addEventListener("click", openSocialHelpPanel);
}

if (closeSocialHelpBtn) {
  closeSocialHelpBtn.addEventListener("click", closeSocialHelpPanel);
}

if (socialHelpPanel) {
  socialHelpPanel.addEventListener("click", (event) => {
    if (event.target === socialHelpPanel) {
      closeSocialHelpPanel();
    }
  });
}

if (requestSocialHelpBtn) {
  requestSocialHelpBtn.addEventListener("click", requestSocialHelp);
}

if (volunteerRequestPanel) {
  volunteerRequestPanel.addEventListener("click", (event) => {
    if (event.target === volunteerRequestPanel) {
      volunteerRequestPanel.classList.add("hidden");
    }
  });
}

if (acceptVolunteerRequestBtn) {
  acceptVolunteerRequestBtn.addEventListener("click", () => respondToVolunteerRequest("accepted"));
}

if (declineVolunteerRequestBtn) {
  declineVolunteerRequestBtn.addEventListener("click", () => respondToVolunteerRequest("declined"));
}

if (favoriteBtn) {
  favoriteBtn.addEventListener("click", openFavoritesPage);
}

function openSocialHelpPanel() {
  if (!socialHelpPanel) return;

  favoritesPanel?.classList.add("hidden");
  filterPanel?.classList.add("hidden");
  placeSheet?.classList.add("hidden");

  updateSocialHelpLocationText();
  if (socialHelpStatus) {
    socialHelpStatus.textContent = "대기 중";
    socialHelpStatus.classList.remove("matching");
  }
  if (requestSocialHelpBtn) {
    requestSocialHelpBtn.disabled = false;
    requestSocialHelpBtn.textContent = "주변에 도움 요청하기";
  }

  socialHelpPanel.classList.remove("hidden");
}

function closeSocialHelpPanel() {
  if (!socialHelpPanel) return;
  socialHelpPanel.classList.add("hidden");
}

function updateSocialHelpLocationText() {
  if (!socialHelpLocation) return;

  const position = currentLocationPosition || map.getCenter();
  if (!position) {
    socialHelpLocation.textContent = "현재 위치 확인 중";
    return;
  }

  socialHelpLocation.textContent = "위치 확인 중";
  getSocialHelpLocationLabel().then((label) => {
    socialHelpLocation.textContent = label;
  });
}

function requestSocialHelp() {
  updateSocialHelpLocationText();

  if (socialHelpStatus) {
    socialHelpStatus.textContent = "주변 봉사자에게 요청을 보내는 중";
    socialHelpStatus.classList.add("matching");
  }

  if (requestSocialHelpBtn) {
    requestSocialHelpBtn.disabled = true;
    requestSocialHelpBtn.textContent = "매칭 요청 완료";
  }

  setTimeout(() => {
    if (socialHelpStatus) {
      socialHelpStatus.textContent = "요청이 접수되었습니다. 가까운 봉사자 응답을 기다리는 중";
    }
    showVolunteerRequestPreview();
  }, 900);
}

function showVolunteerRequestPreview() {
  if (!volunteerRequestPanel) return;

  if (volunteerRequesterLocation) {
    volunteerRequesterLocation.textContent = "위치 확인 중";
    getSocialHelpLocationLabel().then((locationText) => {
      volunteerRequesterLocation.textContent = locationText;
    });
  }

  volunteerRequestPanel.classList.remove("hidden");
  renderVolunteerRequestMap();
}

async function getSocialHelpLocationLabel() {
  const namedPlace = getSocialHelpNamedPlace();
  if (namedPlace) return namedPlace;

  const addressLabel = await getAddressLabelFromMapCenter();
  return addressLabel || "현재 지도 위치";
}

function getSocialHelpNamedPlace() {
  if (selectedPlaceForRoute?.place_name) return selectedPlaceForRoute.place_name;
  if (endPlace?.place_name && endPlace.place_name !== "현재 위치") return endPlace.place_name;
  if (startPlace?.place_name && startPlace.place_name !== "현재 위치") return startPlace.place_name;

  const center = currentLocationPosition || map.getCenter();
  if (!center || !nearbyPanelPlaces.length) return "";

  let nearestPlace = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  nearbyPanelPlaces.forEach((place) => {
    const lat = Number(place.y);
    const lng = Number(place.x);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    const distance = getDistance(
      center.getLat(),
      center.getLng(),
      lat,
      lng
    );

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPlace = place;
    }
  });

  return nearestDistance <= 10 ? nearestPlace?.place_name || "" : "";
}

function getAddressLabelFromMapCenter() {
  const position = currentLocationPosition || map.getCenter();
  if (!position || !geocoder) return Promise.resolve("");

  return new Promise((resolve) => {
    geocoder.coord2Address(position.getLng(), position.getLat(), (result, status) => {
      if (status !== kakao.maps.services.Status.OK || !result?.length) {
        resolve("");
        return;
      }

      const roadAddress = result[0].road_address;
      const address = result[0].address;
      resolve(
        roadAddress?.building_name ||
          roadAddress?.address_name ||
          address?.address_name ||
          ""
      );
    });
  });
}

function renderVolunteerRequestMap() {
  if (!volunteerRequestMapEl) return;

  const position = currentLocationPosition || map.getCenter();
  if (!position) return;

  setTimeout(() => {
    if (!volunteerPreviewMap) {
      volunteerPreviewMap = new kakao.maps.Map(volunteerRequestMapEl, {
        center: position,
        level: 4,
      });
      volunteerPreviewMap.setDraggable(false);
      volunteerPreviewMap.setZoomable(false);
    }

    volunteerRequestMapEl.classList.add("map-ready");
    volunteerPreviewMap.setCenter(position);
    volunteerPreviewMap.setLevel(4);
    volunteerPreviewMap.relayout();

    if (!volunteerPreviewMarker) {
      volunteerPreviewMarker = new kakao.maps.Marker({
        map: volunteerPreviewMap,
        position,
      });
    } else {
      volunteerPreviewMarker.setPosition(position);
      volunteerPreviewMarker.setMap(volunteerPreviewMap);
    }

    renderVolunteerNearbyBuildingMarkers(position);
  }, 0);
}

function renderVolunteerNearbyBuildingMarkers(position) {
  if (!volunteerPreviewMap || !position) return;

  volunteerNearbyMarkers.forEach((marker) => marker.setMap(null));
  volunteerNearbyMarkers = [];

  nearbyPanelPlaces
    .map((place) => {
      const lat = Number(place.y);
      const lng = Number(place.x);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

      return {
        place,
        lat,
        lng,
        distance: getDistance(position.getLat(), position.getLng(), lat, lng),
      };
    })
    .filter(Boolean)
    .filter((item) => item.distance <= 10)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .forEach((item) => {
      const marker = new kakao.maps.Marker({
        map: volunteerPreviewMap,
        position: new kakao.maps.LatLng(item.lat, item.lng),
        title: item.place.place_name || "근처 건물",
      });
      volunteerNearbyMarkers.push(marker);
    });
}

function respondToVolunteerRequest(status) {
  if (!volunteerRequestPanel) return;

  if (status === "accepted") {
    alert("지원 요청을 수락했습니다. 신청자에게 이동 중 알림이 전송됩니다.");
  } else {
    alert("지원 요청을 거절했습니다. 다른 주변 사용자에게 요청이 유지됩니다.");
  }

  volunteerRequestPanel.classList.add("hidden");
}

function openFavoritesPage() {
  if (!favoritesPanel) return;

  const token = localStorage.getItem("accessnavToken");
  if (!token) {
    location.href = "login.html";
    return;
  }

  keepCurrentMapView(() => {
    hideResultList();
    placeSheet.classList.add("hidden");
    filterPanel?.classList.add("hidden");
    loadFavoriteGroups();
    renderFavoriteGroups();
    favoritesPanel.classList.remove("hidden");
  });
}

function currentFavoriteStorageKey() {
  const user = getStoredAuthUser();
  return `accessnavFavoriteGroups:${user?.email || "local"}`;
}

function getStoredAuthUser() {
  try {
    return JSON.parse(localStorage.getItem("accessnavUser") || "null");
  } catch {
    return null;
  }
}

function defaultFavoriteGroups() {
  return [
    {
      id: "default",
      name: "기본 그룹",
      count: 6,
      visibility: "private",
      color: "green",
      createdAt: 1,
      places: [],
    },
    {
      id: "namnam",
      name: "남남",
      count: 12,
      visibility: "public",
      color: "purple",
      createdAt: 2,
      places: [],
    },
    {
      id: "cafe",
      name: "경치 좋은 카페",
      count: 5,
      visibility: "private",
      color: "yellow",
      createdAt: 3,
      places: [],
    },
  ];
}

function loadFavoriteGroups() {
  const saved = localStorage.getItem(currentFavoriteStorageKey());
  if (!saved) {
    favoriteGroups = defaultFavoriteGroups();
    saveFavoriteGroups();
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    favoriteGroups = Array.isArray(parsed) ? parsed : defaultFavoriteGroups();
  } catch {
    favoriteGroups = defaultFavoriteGroups();
  }
}

function saveFavoriteGroups() {
  localStorage.setItem(currentFavoriteStorageKey(), JSON.stringify(favoriteGroups));
}

function renderFavoriteGroups() {
  if (!favoriteGroupList) return;
  selectedFavoriteGroupId = null;

  if (favoriteGroupCount) {
    favoriteGroupCount.textContent = String(favoriteGroups.length);
  }
  if (favoriteSortLabel) {
    favoriteSortLabel.textContent = "최신";
  }
  if (favoriteEditBtn) {
    favoriteEditBtn.textContent = favoritesEditMode ? "완료" : "편집";
    favoriteEditBtn.classList.toggle("active", favoritesEditMode);
    favoriteEditBtn.disabled = Boolean(selectedFavoriteGroupId);
  }

  const groups = [...favoriteGroups].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!groups.length) {
    favoriteGroupList.innerHTML = `
      <div class="favorite-empty-state">
        <strong>아직 그룹이 없어요</strong>
        <span>새 그룹을 추가해서 자주 가는 장소를 모아보세요.</span>
      </div>
    `;
    return;
  }

  favoriteGroupList.innerHTML = groups
    .map((group) => favoriteGroupMarkup(group))
    .join("");
}

function favoriteGroupMarkup(group) {
  const visibility = group.visibility === "public" ? "공개" : "나만 보기";
  const color = ["green", "purple", "yellow"].includes(group.color) ? group.color : "green";
  const groupCount = favoriteGroupPlaceCount(group);

  if (favoritesEditMode) {
    return `
      <article class="favorite-group editing" data-group-id="${escapeHTML(group.id)}">
        <span class="favorite-star ${color}" aria-hidden="true">★</span>
        <div class="favorite-edit-fields">
          <input class="favorite-name-input" type="text" value="${escapeHTML(group.name)}" aria-label="그룹 이름" />
          <select class="favorite-visibility-select" aria-label="공개 범위">
            <option value="private" ${group.visibility !== "public" ? "selected" : ""}>나만 보기</option>
            <option value="public" ${group.visibility === "public" ? "selected" : ""}>공개</option>
          </select>
        </div>
        <button class="favorite-delete-button" type="button" data-favorite-action="delete" aria-label="${escapeHTML(
          group.name
        )} 삭제">삭제</button>
      </article>
    `;
  }

  return `
    <article class="favorite-group" data-group-id="${escapeHTML(group.id)}" data-favorite-action="open-group">
      <span class="favorite-star ${color}" aria-hidden="true">★</span>
      <div class="favorite-info">
        <h2>${escapeHTML(group.name)}</h2>
        <p>${groupCount} · ${visibility}</p>
      </div>
      <button class="group-menu-button" type="button" data-favorite-action="menu" aria-label="${escapeHTML(
        group.name
      )} 메뉴">⋮</button>
    </article>
  `;
}

function favoriteGroupPlaceCount(group) {
  const savedPlaceCount = Array.isArray(group.places) ? group.places.length : 0;
  return savedPlaceCount > 0 ? savedPlaceCount : Number(group.count) || 0;
}

function addFavoriteGroup() {
  loadFavoriteGroups();
  const nextNumber = favoriteGroups.length + 1;
  favoriteGroups.unshift({
    id: `group-${Date.now()}`,
    name: `새 그룹 ${nextNumber}`,
    count: 0,
    visibility: "private",
    color: favoriteColorForIndex(favoriteGroups.length),
    createdAt: Date.now(),
    places: [],
  });
  favoritesEditMode = true;
  saveFavoriteGroups();
  renderFavoriteGroups();
  favoriteGroupList?.querySelector(".favorite-name-input")?.focus();
}

function favoriteColorForIndex(index) {
  return ["green", "purple", "yellow"][index % 3];
}

function updateFavoriteGroupFromControl(control) {
  const groupEl = control.closest(".favorite-group");
  const group = favoriteGroups.find((item) => item.id === groupEl?.dataset.groupId);
  if (!group) return;

  if (control.classList.contains("favorite-name-input")) {
    group.name = control.value.trim() || "이름 없는 그룹";
  }
  if (control.classList.contains("favorite-visibility-select")) {
    group.visibility = control.value === "public" ? "public" : "private";
  }
  saveFavoriteGroups();
  renderFavoriteGroups();
}

function deleteFavoriteGroup(button) {
  const groupEl = button.closest(".favorite-group");
  const groupId = groupEl?.dataset.groupId;
  if (!groupId) return;

  favoriteGroups = favoriteGroups.filter((group) => group.id !== groupId);
  saveFavoriteGroups();
  renderFavoriteGroups();
}

function renderFavoriteGroupDetail(groupId) {
  const group = favoriteGroups.find((item) => item.id === groupId);
  if (!favoriteGroupList || !group) return;

  selectedFavoriteGroupId = groupId;
  favoritesEditMode = false;

  if (favoriteEditBtn) {
    favoriteEditBtn.textContent = "편집";
    favoriteEditBtn.classList.remove("active");
    favoriteEditBtn.disabled = true;
  }
  if (favoriteGroupCount) {
    favoriteGroupCount.textContent = String(favoriteGroupPlaceCount(group));
  }
  if (favoriteSortLabel) {
    favoriteSortLabel.textContent = group.name;
  }

  const places = Array.isArray(group.places) ? group.places : [];
  const placeItems = places.length
    ? places
        .map(
          (place, index) => `
            <article class="favorite-place-item" data-favorite-place-index="${index}">
              <div>
                <strong>${escapeHTML(place.name || "이름 없는 장소")}</strong>
                <span>${escapeHTML(place.address || "주소 정보 없음")}</span>
              </div>
              <button type="button" data-favorite-place-remove="${index}" aria-label="${escapeHTML(
                place.name || "장소"
              )} 삭제">삭제</button>
            </article>
          `
        )
        .join("")
    : `
      <div class="favorite-empty-state">
        <strong>저장한 장소가 없어요</strong>
        <span>지도에서 장소를 선택하고 별을 눌러 이 그룹에 추가해보세요.</span>
      </div>
    `;

  favoriteGroupList.innerHTML = `
    <button class="favorite-detail-back" type="button" data-favorite-action="back-groups">← 그룹 목록</button>
    <section class="favorite-group-detail">
      <div class="favorite-group-detail-heading">
        <span class="favorite-star ${escapeHTML(group.color || "green")}" aria-hidden="true">★</span>
        <div>
          <h2>${escapeHTML(group.name)}</h2>
          <p>${places.length}개 장소 · ${group.visibility === "public" ? "공개" : "나만 보기"}</p>
        </div>
      </div>
      <div class="favorite-place-list">
        ${placeItems}
      </div>
    </section>
  `;
}

function removeFavoritePlace(groupId, placeIndex) {
  const group = favoriteGroups.find((item) => item.id === groupId);
  if (!group || !Array.isArray(group.places)) return;

  group.places.splice(placeIndex, 1);
  group.count = group.places.length;
  saveFavoriteGroups();
  renderFavoriteGroupDetail(groupId);
}

function openFavoritePlaceOnMap(groupId, placeIndex) {
  const group = favoriteGroups.find((item) => item.id === groupId);
  const place = group?.places?.[placeIndex];
  if (!place) return;

  favoritesPanel?.classList.add("hidden");
  const mapPlace = {
    place_name: place.name,
    road_address_name: place.address,
    address_name: place.address,
    category_group_name: place.category,
    x: place.lng,
    y: place.lat,
  };
  showNearbyPlaceDetail(mapPlace);
}

function normalizeFavoritePlace(place) {
  const lat = Number(place?.y || place?.lat || 0);
  const lng = Number(place?.x || place?.lng || 0);
  const name = place?.place_name || place?.name || "이름 없는 장소";
  const address = place?.road_address_name || place?.address_name || place?.address || "";

  return {
    id: place?.id || `${name}|${lat.toFixed(6)}|${lng.toFixed(6)}`,
    name,
    address,
    category: placeCategory(place || {}),
    lat,
    lng,
    savedAt: Date.now(),
  };
}

function isPlaceSavedInFavorites(place) {
  const target = normalizeFavoritePlace(place);
  loadFavoriteGroups();
  return favoriteGroups.some((group) =>
    Array.isArray(group.places) && group.places.some((savedPlace) => savedPlace.id === target.id)
  );
}

function openFavoriteGroupPicker(place) {
  const token = localStorage.getItem("accessnavToken");
  if (!token) {
    location.href = "login.html";
    return;
  }

  currentFavoriteCandidate = normalizeFavoritePlace(place);
  loadFavoriteGroups();
  renderFavoriteGroupPicker();
}

function renderFavoriteGroupPicker(message = "") {
  if (!panelContent || !currentFavoriteCandidate) return;

  const groups = [...favoriteGroups].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const groupButtons = groups.length
    ? groups
        .map((group) => {
          const exists = Array.isArray(group.places)
            ? group.places.some((place) => place.id === currentFavoriteCandidate.id)
            : false;
          return `
            <button class="favorite-picker-group" type="button" data-favorite-group-id="${escapeHTML(group.id)}">
              <span class="favorite-star ${escapeHTML(group.color || "green")}" aria-hidden="true">★</span>
              <span>
                <strong>${escapeHTML(group.name)}</strong>
                <small>${favoriteGroupPlaceCount(group)} · ${group.visibility === "public" ? "공개" : "나만 보기"}${
                  exists ? " · 저장됨" : ""
                }</small>
              </span>
            </button>
          `;
        })
        .join("")
    : `<p class="favorite-picker-empty">먼저 그룹을 만들어주세요.</p>`;

  panelContent.innerHTML = `
    <button class="panel-back-button" id="favoritePickerBackBtn" type="button">← 장소</button>
    <div class="favorite-picker-panel">
      <div class="favorite-picker-heading">
        <p class="sheet-label">즐겨찾기 저장</p>
        <h3>${escapeHTML(currentFavoriteCandidate.name)}</h3>
        <p class="muted">${escapeHTML(currentFavoriteCandidate.address || "주소 정보 없음")}</p>
      </div>

      <div class="favorite-picker-list">
        ${groupButtons}
      </div>

      <form class="favorite-picker-form" id="favoritePickerForm">
        <input id="favoritePickerNewGroup" type="text" placeholder="새 그룹 이름 입력" autocomplete="off" />
        <button type="submit">새 그룹에 저장</button>
      </form>

      <p class="favorite-picker-message" id="favoritePickerMessage">${escapeHTML(message)}</p>
    </div>
  `;
}

function savePlaceToFavoriteGroup(groupId) {
  if (!currentFavoriteCandidate) return;

  const group = favoriteGroups.find((item) => item.id === groupId);
  if (!group) return;

  if (!Array.isArray(group.places)) {
    group.places = [];
  }

  const alreadySaved = group.places.some((place) => place.id === currentFavoriteCandidate.id);
  if (!alreadySaved) {
    group.places.unshift(currentFavoriteCandidate);
    group.count = Math.max(Number(group.count) || 0, group.places.length);
    saveFavoriteGroups();
  }

  renderFavoriteGroupPicker(alreadySaved ? "이미 이 그룹에 저장된 장소예요." : "즐겨찾기에 저장했어요.");
}

function createFavoriteGroupWithPlace(name) {
  const trimmedName = name.trim();
  if (!trimmedName || !currentFavoriteCandidate) return;

  const group = {
    id: `group-${Date.now()}`,
    name: trimmedName,
    count: 1,
    visibility: "private",
    color: favoriteColorForIndex(favoriteGroups.length),
    createdAt: Date.now(),
    places: [currentFavoriteCandidate],
  };

  favoriteGroups.unshift(group);
  saveFavoriteGroups();
  renderFavoriteGroupPicker("새 그룹에 저장했어요.");
}

if (closeFavoritesPanelBtn && favoritesPanel) {
  closeFavoritesPanelBtn.addEventListener("click", () => {
    favoritesPanel.classList.add("hidden");
  });
}

favoriteEditBtn?.addEventListener("click", () => {
  favoritesEditMode = !favoritesEditMode;
  loadFavoriteGroups();
  renderFavoriteGroups();
});

addFavoriteGroupBtn?.addEventListener("click", addFavoriteGroup);

favoriteGroupList?.addEventListener("change", (event) => {
  const target = event.target;
  if (
    target instanceof HTMLInputElement &&
    target.classList.contains("favorite-name-input")
  ) {
    updateFavoriteGroupFromControl(target);
    return;
  }

  if (
    target instanceof HTMLSelectElement &&
    target.classList.contains("favorite-visibility-select")
  ) {
    updateFavoriteGroupFromControl(target);
  }
});

favoriteGroupList?.addEventListener("click", (event) => {
  const backGroupsButton = event.target.closest("[data-favorite-action='back-groups']");
  if (backGroupsButton) {
    renderFavoriteGroups();
    return;
  }

  const removePlaceButton = event.target.closest("[data-favorite-place-remove]");
  if (removePlaceButton && selectedFavoriteGroupId) {
    event.stopPropagation();
    removeFavoritePlace(selectedFavoriteGroupId, Number(removePlaceButton.dataset.favoritePlaceRemove));
    return;
  }

  const favoritePlaceItem = event.target.closest("[data-favorite-place-index]");
  if (favoritePlaceItem && selectedFavoriteGroupId) {
    openFavoritePlaceOnMap(selectedFavoriteGroupId, Number(favoritePlaceItem.dataset.favoritePlaceIndex));
    return;
  }

  const deleteButton = event.target.closest("[data-favorite-action='delete']");
  if (deleteButton) {
    deleteFavoriteGroup(deleteButton);
    return;
  }

  const menuButton = event.target.closest("[data-favorite-action='menu']");
  if (menuButton) {
    favoritesEditMode = true;
    renderFavoriteGroups();
    return;
  }

  const groupButton = event.target.closest("[data-favorite-action='open-group']");
  if (groupButton && !favoritesEditMode) {
    renderFavoriteGroupDetail(groupButton.dataset.groupId);
  }
});

favoriteGroupList?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const target = event.target;
  if (
    target instanceof HTMLInputElement &&
    target.classList.contains("favorite-name-input")
  ) {
    target.blur();
  }
});

if (new URLSearchParams(location.search).get("panel") === "favorites") {
  openFavoritesPage();

  if (history.replaceState) {
    history.replaceState(null, "", "index.html");
  }
}

if (filterBtn && filterPanel) {
  filterBtn.addEventListener("click", () => {
    filterPanel.classList.remove("hidden");
    map.relayout();
  });
}

if (closeFilterBtn && filterPanel) {
  closeFilterBtn.addEventListener("click", () => {
    filterPanel.classList.add("hidden");
  });
}

if (filterPanel) {
  filterPanel.addEventListener("click", (event) => {
    if (event.target === filterPanel) {
      filterPanel.classList.add("hidden");
    }
  });
}

document.querySelectorAll("#filterPanel input[type='checkbox']").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    if (checkbox.dataset.filter === "barrier_free_kiosk") {
      if (checkbox.checked) {
        loadBarrierFreeKiosks();
      } else {
        clearKioskMarkers();
      }
    }
  });
});


document.addEventListener("click", (event) => {
  const nearbyCard = event.target.closest(".nearby-place-card");

  if (nearbyCard) {
    const place = nearbyPanelPlaces[Number(nearbyCard.dataset.index)];
    if (place) {
      showNearbyPlaceDetail(place);
    }
    return;
  }

  if (event.target.closest("#nearbyBackBtn")) {
    renderNearbyPanel(nearbyPanelPlaces, nearbyPanelKeyword);
    return;
  }

  if (event.target.closest("#favoritePickerBackBtn")) {
    if (selectedPlaceForRoute) {
      showNearbyPlaceDetail(selectedPlaceForRoute);
    }
    return;
  }

  if (event.target.closest("#favoritePlaceBtn")) {
    if (selectedPlaceForRoute) {
      openFavoriteGroupPicker(selectedPlaceForRoute);
    }
    return;
  }

  const favoriteGroupButton = event.target.closest("[data-favorite-group-id]");
  if (favoriteGroupButton) {
    savePlaceToFavoriteGroup(favoriteGroupButton.dataset.favoriteGroupId);
    return;
  }

  if (event.target.closest("#routePanelBackBtn")) {
    if (currentRouteData?.selectedRoute) {
      updateSelectedRouteSheet(currentRouteData.selectedRoute);
    } else {
      updatePlaceSheet();
    }
    openPlaceSheet();
    return;
  }

  const routeOption = event.target.closest(".route-option");
  if (routeOption && currentRouteData) {
    const route =
      currentRouteData.routes.find((item) => item.id === routeOption.dataset.routeId) ||
      currentRouteData.routes[0];
    if (route) {
      applyRouteSelection(currentRouteData, route);
    }
    return;
  }

  const inlineChip = event.target.closest(".inline-chip");
  if (inlineChip) {
    inlineChip
      .closest(".inline-chip-group")
      ?.querySelectorAll(".inline-chip")
      .forEach((chip) => chip.classList.remove("active"));
    inlineChip.classList.add("active");
    return;
  }

  if (event.target.closest("#inlineReportBackBtn")) {
    dismissActiveCaption({ removeCurrentLocation: false });
    return;
  }

  const mobilityButton = event.target.closest("[data-mobility-type]");
  if (mobilityButton) {
    const nextType = mobilityButton.dataset.mobilityType || "walking";
    if (selectedMobilityType === nextType) return;
    selectedMobilityType = nextType;
    document.querySelectorAll("[data-mobility-type]").forEach((button) => {
      const selected = button.dataset.mobilityType === selectedMobilityType;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    currentRouteData = null;
    clearRoutePolylines();
    clearDangerZones();
    if (startPlace && endPlace) drawDefaultRouteFromSelection();
    return;
  }

  if (event.target.closest("#inlineSubmitReportBtn")) {
    submitInlineReport();
    return;
  }

  if (event.target.closest("#placeReportBtn")) {
    if (selectedPlaceForRoute) {
      openReportPanelAtCurrentMap(selectedPlaceForRoute);
    }
    return;
  }

  if (event.target.closest("#routeListBtn")) {
    if (!startPlace || !endPlace) {
      alert("출발지와 목적지를 모두 선택해주세요.");
      return;
    }

    openRouteListPanel();
    return;
  }

  const routeRoleButton = event.target.closest("[data-route-role]");
  if (routeRoleButton && selectedPlaceForRoute) {
    setRouteEndpoint(selectedPlaceForRoute, routeRoleButton.dataset.routeRole);
    return;
  }

  if (event.target.closest("#clearStartPlaceBtn")) {
    if (navigationMode) stopNavigationTracking({ silent: true });
    startPlace = null;
    activeQuickRouteRole = "start";
    syncQuickRouteInputs();
    if (startMarker) {
      startMarker.setMap(null);
      startMarker = null;
    }
    clearRoutePolylines();
    clearDangerZones();
    currentRouteData = null;
    updatePlaceSheet();
    openPlaceSheet();
    setTimeout(() => quickStartInput?.focus(), 120);
    return;
  }

  if (event.target.closest("#clearEndPlaceBtn")) {
    if (navigationMode) stopNavigationTracking({ silent: true });
    endPlace = null;
    activeQuickRouteRole = "end";
    syncQuickRouteInputs();
    if (endMarker) {
      endMarker.setMap(null);
      endMarker = null;
    }
    clearRoutePolylines();
    clearDangerZones();
    currentRouteData = null;
    updatePlaceSheet();
    openPlaceSheet();
    setTimeout(() => quickEndInput?.focus(), 120);
    return;
  }

  if (event.target.closest("#startRouteBtn")) {
    if (!startPlace || !endPlace) {
      alert("출발지와 목적지를 모두 선택해주세요.");
      return;
    }

    if (navigationMode) {
      stopNavigationTracking();
    } else {
      startNavigationTracking();
    }
    openPlaceSheet();
    return;
  }

  if (event.target.closest("#simulateRouteBtn")) {
    if (navigationSimulationActive) stopNavigationTracking();
    else startNavigationSimulation();
    openPlaceSheet();
  }
});

document.addEventListener("submit", (event) => {
  if (event.target?.id !== "favoritePickerForm") return;
  event.preventDefault();
  const input = document.getElementById("favoritePickerNewGroup");
  createFavoriteGroupWithPlace(input?.value || "");
});

function openReportPage() {
  const targetPlace = endPlace || startPlace;

  if (!targetPlace) {
    alert("먼저 장소를 선택해주세요.");
    return;
  }

  openReportPanelAtCurrentMap(targetPlace);
}

function reportUrlForPlace(place) {
  return (
    `report.html?v=20260830-accessibility` +
    `&name=${encodeURIComponent(place.place_name || place.name || "")}` +
    `&address=${encodeURIComponent(
      place.road_address_name || place.address_name || place.address || ""
    )}` +
    `&x=${place.x || place.lng}&y=${place.y || place.lat}`
  );
}

function openReportAtCurrentLocation() {
  if (currentLocationPosition) {
    location.href =
      "report.html?name=" +
      encodeURIComponent("현재 위치") +
      "&address=" +
      encodeURIComponent("현재 위치에서 제보") +
      `&x=${currentLocationPosition.getLng()}&y=${currentLocationPosition.getLat()}` +
      "&v=20260830-accessibility";
    return;
  }

  if (!navigator.geolocation) {
    alert("현재 위치 기능을 지원하지 않는 브라우저입니다.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      location.href =
        "report.html?name=" +
        encodeURIComponent("현재 위치") +
        "&address=" +
        encodeURIComponent("현재 위치에서 제보") +
        `&x=${lng}&y=${lat}` +
        "&v=20260830-accessibility";
    },
    () => {
      alert("현재 위치를 가져올 수 없습니다. 위치 권한을 허용해주세요.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function openReportPageAtMapCenter() {
  const center = map.getCenter();
  location.href =
    "report.html?name=" +
    encodeURIComponent("지도 중심 위치") +
    "&address=" +
    encodeURIComponent("지도 중심 위치") +
    `&x=${center.getLng()}&y=${center.getLat()}` +
    "&v=20260830-accessibility";
}

function openReportPanelAtCurrentMap(targetPlace = null) {
  keepCurrentMapView(() => {
    const center = map.getCenter();
    const lat = Number(targetPlace?.y || targetPlace?.lat || center.getLat());
    const lng = Number(targetPlace?.x || targetPlace?.lng || center.getLng());
    const locationLabel =
      targetPlace?.road_address_name ||
      targetPlace?.address_name ||
      targetPlace?.address ||
      targetPlace?.place_name ||
      `지도 중심 위치 (${center.getLat().toFixed(6)}, ${center.getLng().toFixed(6)})`;

    currentInlineReportTarget = {
      lat,
      lng,
      label: locationLabel,
      name: targetPlace?.place_name || targetPlace?.name || locationLabel,
    };

    hideResultList();
    favoritesPanel?.classList.add("hidden");
    filterPanel?.classList.add("hidden");
    document.body.classList.remove("route-mode");
    placeSheet?.classList.add("report-sheet");
    placeSheet?.classList.remove("route-sheet", "route-list-sheet");

    panelContent.innerHTML = `
      <div class="report-panel-inline">
        <div class="inline-report-header">
          <button class="inline-report-back" id="inlineReportBackBtn" type="button" aria-label="뒤로가기">←</button>
          <h3>위험 구간 제보</h3>
        </div>

        <label class="inline-field-label">제보 유형</label>
        <div class="inline-chip-group" id="inlineReportTypes">
          <button class="inline-chip active" type="button" data-type="급경사">급경사</button>
          <button class="inline-chip" type="button" data-type="파손 보도">파손 보도</button>
          <button class="inline-chip" type="button" data-type="단차">단차</button>
          <button class="inline-chip" type="button" data-type="미끄러운 노면">미끄러운 노면</button>
          <button class="inline-chip" type="button" data-type="공사 통제">공사 통제</button>
          <button class="inline-chip" type="button" data-type="기타">기타</button>
        </div>

        <label class="inline-field-label">휠체어 진입 정보</label>
        <div class="inline-chip-group" id="inlineAccessibilityTypes">
          <button class="inline-chip active" type="button" data-accessibility="unknown">확인 필요</button>
          <button class="inline-chip" type="button" data-accessibility="accessible">진입 가능</button>
          <button class="inline-chip" type="button" data-accessibility="not_accessible">진입 어려움</button>
        </div>

        <label class="inline-field-label" for="inlineReportLocation">위치</label>
        <input
          id="inlineReportLocation"
          class="inline-field"
          type="text"
          value="${escapeHTML(locationLabel)}"
        />

        <div class="inline-slider-wrap">
          <label class="inline-field-label" for="inlineSlopeRange">경사도 추정(선택)</label>
          <input id="inlineSlopeRange" class="inline-slider" type="range" min="0" max="100" value="10" />
          <div class="inline-slider-value" id="inlineSlopeValue">10%</div>
        </div>

        <label class="inline-field-label" for="inlineReportDetail">상세 설명</label>
        <textarea
          id="inlineReportDetail"
          class="inline-field inline-textarea"
          placeholder="어떤 위험이 있었나요?"
        ></textarea>

        <label class="inline-field-label" for="inlineReportImage">사진 첨부</label>
        <label class="inline-upload-box" for="inlineReportImage" id="inlineReportUploadBox">
          사진 촬영 또는 앨범에서 선택
          <input id="inlineReportImage" type="file" accept="image/*" capture="environment" />
        </label>

        <button class="primary-btn inline-submit-btn" id="inlineSubmitReportBtn" type="button">
          제보하기
        </button>
      </div>
    `;

    const imageInput = document.getElementById("inlineReportImage");
    const uploadBox = document.getElementById("inlineReportUploadBox");
    const slopeRange = document.getElementById("inlineSlopeRange");
    const slopeValue = document.getElementById("inlineSlopeValue");

    imageInput?.addEventListener("change", () => {
      if (imageInput.files.length > 0) {
        uploadBox.childNodes[0].nodeValue = imageInput.files[0].name;
      }
    });

    slopeRange?.addEventListener("input", () => {
      slopeValue.textContent = `${slopeRange.value}%`;
    });

    openPlaceSheet();
  });
}

async function submitInlineReport() {
  const submitButton = document.getElementById("inlineSubmitReportBtn");
  const imageInput = document.getElementById("inlineReportImage");
  const locationInput = document.getElementById("inlineReportLocation");
  const detailInput = document.getElementById("inlineReportDetail");
  const slopeInput = document.getElementById("inlineSlopeRange");
  const center = map.getCenter();
  const reportLat = currentInlineReportTarget?.lat || center.getLat();
  const reportLng = currentInlineReportTarget?.lng || center.getLng();
  const reportName = currentInlineReportTarget?.name || locationInput?.value || "지도 중심 위치";
  const selectedType =
    document.querySelector("#inlineReportTypes .inline-chip.active")?.dataset.type || "기타";
  const wheelchairAccess =
    document.querySelector("#inlineAccessibilityTypes .inline-chip.active")?.dataset.accessibility ||
    "unknown";
  const imageData = imageInput?.files?.[0]
    ? await readImageFileAsDataURL(imageInput.files[0])
    : "";

  submitButton.disabled = true;
  submitButton.textContent = "등록 중...";

  try {
    const response = await fetch("/api/accessibility-reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        placeName: reportName,
        address: locationInput?.value || "지도 중심 위치",
        x: reportLng,
        y: reportLat,
        type: selectedType,
        wheelchairAccess,
        slope: slopeInput?.value || "10",
        detail: detailInput?.value || "",
        imageData,
      }),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "제보 등록에 실패했습니다.");
    }

    alert("제보가 등록되었습니다. 관리자가 확인하면 장소 정보에 반영됩니다.");
    dismissActiveCaption({ removeCurrentLocation: false });
  } catch (error) {
    alert(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "제보하기";
  }
}

function readImageFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("사진을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

function keepCurrentMapView(callback) {
  const center = map.getCenter();
  const level = map.getLevel();
  callback();
  map.setCenter(center);
  map.setLevel(level);
}

function searchPlaces(keyword) {
  hideQuickRouteResultList();
  Promise.all([
    fetchMapServicePlaces(keyword),
    new Promise((resolve) => {
      placesService.keywordSearch(keyword, (data, status) => {
        resolve(status === kakao.maps.services.Status.OK ? data : []);
      });
    }),
  ]).then(([mapServicePlaces, kakaoPlaces]) => {
    const places = [...mapServicePlaces, ...kakaoPlaces];

    if (!places.length) {
      alert("검색 결과가 없습니다.");
      hideResultList();
      return;
    }

    renderResultList(places);
  });
}

function searchKakaoPlaces(keyword, options) {
  return new Promise((resolve) => {
    placesService.keywordSearch(keyword, (data, status) => {
      resolve(status === kakao.maps.services.Status.OK ? data : []);
    }, options);
  });
}

async function handleMapPlaceClick(event) {
  const position = event.latLng;
  if (!position) return;

  try {
    const place = await resolveClickedMapPlace(position);
    showMapClickedPlace(place, position);
  } catch (error) {
    console.warn("지도 클릭 장소 조회 실패:", error);
  }
}

async function resolveClickedMapPlace(position) {
  const addressInfo = await getAddressInfo(position);
  const keywords = [
    addressInfo.buildingName,
    addressInfo.roadAddress,
    addressInfo.address,
  ]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);

  for (const keyword of keywords) {
    const places = await searchKakaoPlaces(keyword, {
      location: position,
      radius: 80,
      sort: kakao.maps.services.SortBy.DISTANCE,
    });
    const nearestPlace = nearestPlaceFromPosition(places, position, 90);
    if (nearestPlace) return nearestPlace;
  }

  const fallbackName =
    addressInfo.buildingName || addressInfo.roadAddress || addressInfo.address || "선택한 위치";

  return {
    place_name: fallbackName,
    road_address_name: addressInfo.roadAddress || "",
    address_name: addressInfo.address || fallbackName,
    category_name: "지도 선택",
    y: position.getLat(),
    x: position.getLng(),
    distance: currentLocationPosition
      ? Math.round(
          getDistance(
            currentLocationPosition.getLat(),
            currentLocationPosition.getLng(),
            position.getLat(),
            position.getLng()
          )
        )
      : "",
  };
}

function getAddressInfo(position) {
  if (!geocoder) {
    return Promise.resolve({ buildingName: "", roadAddress: "", address: "" });
  }

  return new Promise((resolve) => {
    geocoder.coord2Address(position.getLng(), position.getLat(), (result, status) => {
      if (status !== kakao.maps.services.Status.OK || !result?.length) {
        resolve({ buildingName: "", roadAddress: "", address: "" });
        return;
      }

      const roadAddress = result[0].road_address;
      const address = result[0].address;
      resolve({
        buildingName: roadAddress?.building_name || "",
        roadAddress: roadAddress?.address_name || "",
        address: address?.address_name || "",
      });
    });
  });
}

function nearestPlaceFromPosition(places, position, maxDistanceMeters) {
  return places
    .map((place) => {
      const lat = Number(place.y);
      const lng = Number(place.x);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

      return {
        place,
        distance: getDistance(position.getLat(), position.getLng(), lat, lng),
      };
    })
    .filter(Boolean)
    .filter((item) => item.distance <= maxDistanceMeters)
    .sort((a, b) => a.distance - b.distance)[0]?.place || null;
}

function showMapClickedPlace(place, position) {
  clearNearbyFilterSelection();
  clearSearchMarkers();
  hideResultList();
  nearbyPanelPlaces = [place];
  nearbyPanelKeyword = "선택한 장소";

  clickedPlaceMarker = new kakao.maps.Marker({
    map,
    position: new kakao.maps.LatLng(place.y || position.getLat(), place.x || position.getLng()),
    title: place.place_name || "선택한 장소",
  });
  place._marker = clickedPlaceMarker;
  markers.push(clickedPlaceMarker);

  showNearbyPlaceDetail(place);
}

async function fetchMapServicePlaces(keyword) {
  try {
    const response = await fetch(
      `/api/access-places?query=${encodeURIComponent(keyword)}`
    );
    const data = await response.json();

    if (!response.ok || !data.ok) return [];
    return data.items || [];
  } catch {
    return [];
  }
}

function searchNearbyPlaces(keyword) {
  if (currentLocationPosition) {
    searchNearbyPlacesFromPosition(keyword, currentLocationPosition);
    return;
  }

  if (!navigator.geolocation) {
    alert("현재 위치 기능을 지원하지 않는 브라우저입니다.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const currentPosition = new kakao.maps.LatLng(lat, lng);

      searchNearbyPlacesFromPosition(keyword, currentPosition);
    },
    () => {
      alert("현재 위치를 가져올 수 없습니다. 위치 권한을 허용해주세요.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function setActiveNearbyFilter(keyword) {
  activeNearbyFilterKeyword = keyword;
  chipButtons.forEach((chip) => {
    const isActive = chip.dataset.keyword === keyword;
    chip.classList.toggle("active", isActive);
    chip.setAttribute("aria-pressed", String(isActive));
  });
}

function clearNearbyFilterSelection() {
  activeNearbyFilterKeyword = "";
  chipButtons.forEach((chip) => {
    chip.classList.remove("active");
    chip.setAttribute("aria-pressed", "false");
  });
}

function clearActiveNearbyFilter() {
  document.body.classList.remove("route-mode", "route-planner-mode");
  clearNearbyFilterSelection();
  clearSearchMarkers();
  hideResultList();
  nearbyPanelPlaces = [];
  nearbyPanelKeyword = "주변";
  selectedPlaceForRoute = null;

  if (infoPanelState === "nearby" || infoPanelState === "detail") {
    infoPanelState = "route";
    placeSheet?.classList.add("hidden");
  }
}

async function resolveRouteInputPlace(keyword, label) {
  const query = String(keyword || "").trim();
  if (!query) {
    throw new Error(`${label}를 입력해주세요.`);
  }

  const [mapServicePlaces, kakaoPlaces] = await Promise.all([
    fetchMapServicePlaces(query),
    searchKakaoPlaces(query),
  ]);
  const place = [...mapServicePlaces, ...kakaoPlaces].find((item) => item?.x && item?.y);

  if (!place) {
    throw new Error(`${label} 검색 결과가 없습니다.`);
  }

  return place;
}

async function findQuickRoute() {
  if (!quickStartInput || !quickEndInput || !quickRouteFindBtn) return;

  const startKeyword = quickStartInput.value.trim();
  const endKeyword = quickEndInput.value.trim();

  quickRouteFindBtn.disabled = true;
  quickRouteFindBtn.textContent = "검색 중";

  try {
    const [resolvedStartPlace, resolvedEndPlace] = await Promise.all([
      resolveRouteInputPlace(startKeyword, "출발지"),
      resolveRouteInputPlace(endKeyword, "도착지"),
    ]);

    if (
      getDistance(
        Number(resolvedStartPlace.y),
        Number(resolvedStartPlace.x),
        Number(resolvedEndPlace.y),
        Number(resolvedEndPlace.x)
      ) < 3
    ) {
      throw new Error("출발지와 도착지가 같습니다.");
    }

    clearNearbyFilterSelection();
    clearSearchMarkers();
    hideResultList();
    hideQuickRouteResultList();
    clearRoutePolylines();
    clearDangerZones();

    startPlace = resolvedStartPlace;
    endPlace = resolvedEndPlace;
    selectedPlaceForRoute = null;
    currentRouteData = null;
    quickStartInput.value = startPlace.place_name || startKeyword;
    quickEndInput.value = endPlace.place_name || endKeyword;

    updateStartMarker(startPlace);
    updateEndMarker(endPlace);
    document.body.classList.add("route-mode");
    openPlaceSheet();
    updatePlaceSheet();
    await drawDefaultRouteFromSelection();
  } catch (error) {
    alert(error.message);
  } finally {
    quickRouteFindBtn.disabled = false;
    quickRouteFindBtn.textContent = "길찾기 ›";
  }
}

function swapQuickRouteInputs() {
  if (!quickStartInput || !quickEndInput) return;

  const nextStartValue = quickEndInput.value;
  quickEndInput.value = quickStartInput.value;
  quickStartInput.value = nextStartValue;

  if (startPlace || endPlace) {
    const nextStartPlace = endPlace;
    endPlace = startPlace;
    startPlace = nextStartPlace;
    currentRouteData = null;
    clearRoutePolylines();
    clearDangerZones();

    if (startMarker) {
      startMarker.setMap(null);
      startMarker = null;
    }
    if (endMarker) {
      endMarker.setMap(null);
      endMarker = null;
    }
    if (startPlace) updateStartMarker(startPlace);
    if (endPlace) updateEndMarker(endPlace);
    updatePlaceSheet();
  }
}

function searchNearbyPlacesFromPosition(keyword, currentPosition) {
  favoritesPanel?.classList.add("hidden");
  updateCurrentLocationMarker(currentPosition.getLat(), currentPosition.getLng());
  smoothMoveTo(currentPosition);

  const options = {
    location: currentPosition,
    radius: NEARBY_SEARCH_RADIUS,
    sort: kakao.maps.services.SortBy.DISTANCE,
  };

  const callback = (data, status) => {
    clearSearchMarkers();
    hideResultList();

    if (status !== kakao.maps.services.Status.OK || data.length === 0) {
      alert(`현재 위치 1km 안에 ${keyword} 검색 결과가 없습니다.`);
      return;
    }

    drawNearbyPlaceMarkers(data);
    renderNearbyPanel(data, keyword);
    openPlaceSheet();
  };

  const categoryCode = NEARBY_CATEGORY_CODES[keyword];

  if (categoryCode) {
    placesService.categorySearch(categoryCode, callback, options);
  } else {
    placesService.keywordSearch(keyword, callback, options);
  }
}

function drawNearbyPlaceMarkers(places) {
  const bounds = new kakao.maps.LatLngBounds();

  if (currentLocationPosition) {
    bounds.extend(currentLocationPosition);
  }

  places.forEach((place) => {
    const position = new kakao.maps.LatLng(place.y, place.x);
    const marker = new kakao.maps.Marker({
      map,
      position,
      title: place.place_name,
    });

    place._marker = marker;

    kakao.maps.event.addListener(marker, "click", () => {
      if (nearbyInfoWindow) {
        nearbyInfoWindow.close();
      }

      nearbyInfoWindow = new kakao.maps.InfoWindow({
        content: `
          <div style="padding:8px 10px; font-size:13px; line-height:1.4;">
            <strong>${place.place_name}</strong><br />
            <span>${place.road_address_name || place.address_name || "주소 정보 없음"}</span>
          </div>
        `,
      });

      nearbyInfoWindow.open(map, marker);
      showNearbyPlaceDetail(place);
    });

    markers.push(marker);
    bounds.extend(position);
  });

  map.setBounds(bounds);
}

function renderResultList(places) {
  resultList.innerHTML = "";

  places.forEach((place) => {
    const item = document.createElement("div");
    item.className = "result-item";
    item.innerHTML = `
      <strong>${place.place_name}</strong>
      <span>${place.road_address_name || place.address_name || "주소 정보 없음"}</span>
    `;

    item.addEventListener("click", () => {
      showPlaceSelectionPanel(place);
      smoothMoveTo(new kakao.maps.LatLng(place.y, place.x));
      hideResultList();
    });

    resultList.appendChild(item);
  });

  resultList.classList.remove("hidden");
}

function hideResultList() {
  resultList.classList.add("hidden");
}

function hideQuickRouteResultList() {
  quickRouteResultList?.classList.add("hidden");
}

function showQuickRouteResultsForInput(input) {
  if (!quickRouteResultList) return;

  const keyword = input.value.trim();
  clearTimeout(quickRouteSearchTimer);
  hideResultList();

  if (!keyword) {
    hideQuickRouteResultList();
    return;
  }

  const searchId = quickRouteSearchId + 1;
  quickRouteSearchId = searchId;

  quickRouteSearchTimer = setTimeout(async () => {
    const places = await searchRouteCandidatePlaces(keyword);
    if (searchId !== quickRouteSearchId) return;
    renderQuickRouteResultList(places);
  }, 220);
}

async function searchRouteCandidatePlaces(keyword) {
  const [mapServicePlaces, kakaoPlaces] = await Promise.all([
    fetchMapServicePlaces(keyword),
    searchKakaoPlaces(keyword),
  ]);

  const uniquePlaces = new Map();
  [...mapServicePlaces, ...kakaoPlaces].forEach((place) => {
    if (!place?.x || !place?.y) return;
    const key = `${place.place_name || place.name}|${place.x}|${place.y}`;
    if (!uniquePlaces.has(key)) uniquePlaces.set(key, place);
  });

  return [...uniquePlaces.values()].slice(0, 8);
}

function renderQuickRouteResultList(places) {
  if (!quickRouteResultList) return;

  if (!places.length) {
    quickRouteResultList.innerHTML = `
      <div class="result-item quick-route-empty">
        <strong>검색 결과가 없습니다.</strong>
        <span>다른 장소명으로 입력해보세요.</span>
      </div>
    `;
    quickRouteResultList.classList.remove("hidden");
    return;
  }

  quickRouteResultList.innerHTML = "";

  places.forEach((place) => {
    const item = document.createElement("div");
    item.className = "result-item";
    item.innerHTML = `
      <strong>${escapeHTML(place.place_name || place.name || "이름 없음")}</strong>
      <span>${escapeHTML(place.road_address_name || place.address_name || place.address || "주소 정보 없음")}</span>
    `;

    item.addEventListener("click", () => selectQuickRoutePlace(place));
    quickRouteResultList.appendChild(item);
  });

  quickRouteResultList.classList.remove("hidden");
}

function selectQuickRoutePlace(place) {
  hideQuickRouteResultList();
  showPlaceSelectionPanel(place);
  smoothMoveTo(new kakao.maps.LatLng(place.y, place.x));
}

function showPlaceSelectionPanel(place) {
  selectedPlaceForRoute = place;
  infoPanelState = "place-select";
  if (!panelContent) return;
  const savedInFavorites = isPlaceSavedInFavorites(place);

  placeSheet?.classList.remove("report-sheet", "route-sheet", "route-list-sheet");

  panelContent.innerHTML = `
    <div class="place-select-panel">
      ${nearbyPhotoMarkup(0, "detail")}
      <p class="sheet-label">&#51109;&#49548; &#49440;&#53469;</p>
      <div class="nearby-detail-title-row">
        <h3>${escapeHTML(place.place_name || "\uC774\uB984 \uC5C6\uC74C")}</h3>
        <button class="place-favorite-button${savedInFavorites ? " saved" : ""}" id="favoritePlaceBtn" type="button" aria-label="즐겨찾기에 저장">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 3.4 2.62 5.31 5.86.85-4.24 4.13 1 5.83L12 16.76l-5.24 2.76 1-5.83-4.24-4.13 5.86-.85L12 3.4Z" />
          </svg>
        </button>
      </div>
      <p class="muted">${escapeHTML(place.road_address_name || place.address_name || "\uC8FC\uC18C \uC815\uBCF4 \uC5C6\uC74C")}</p>

      <div class="route-endpoint-summary">
        ${routeEndpointSummary()}
      </div>

      <div class="place-select-actions">
        <button class="secondary-btn" type="button" data-route-role="start">&#52636;&#48156;&#51648;&#47196;</button>
        <button class="primary-btn" type="button" data-route-role="end">&#47785;&#51201;&#51648;&#47196;</button>
      </div>
      <button class="report-link-btn place-report-btn" id="placeReportBtn" type="button">
        이 장소 제보하기
      </button>
    </div>
  `;

  loadPlacePhoto(place, panelContent.querySelector("[data-photo-target]"), "detail");
  openPlaceSheet();
}

function setRouteEndpoint(place, role) {
  if (role === "start") {
    startPlace = place;
    updateStartMarker(place);
  } else {
    endPlace = place;
    updateEndMarker(place);
  }

  syncQuickRouteInputs();
  selectedPlaceForRoute = null;
  currentRouteData = null;
  clearRoutePolylines();
  clearDangerZones();
  enterRoutePlannerMode();
  updatePlaceSheet();

  if (startPlace && endPlace) {
    document.body.classList.add("route-mode");
    openPlaceSheet();
    drawDefaultRouteFromSelection();
  } else {
    openPlaceSheet();
    focusMissingRouteEndpoint();
  }
}

function enterRoutePlannerMode() {
  document.body.classList.add("route-planner-mode");
  document.body.classList.remove("route-mode");
  syncQuickRouteInputs();
  dismissActiveCaption({ removeCurrentLocation: false, preserveRouteSelection: true });
}

function focusMissingRouteEndpoint() {
  setTimeout(() => {
    const input = startPlace ? quickEndInput : quickStartInput;
    activeQuickRouteRole = startPlace ? "end" : "start";
    input?.focus();
  }, 120);
}

function routeEndpointSummary() {
  return `
    <div class="route-endpoint-row">
      <span>&#52636;&#48156;</span>
      <strong>${escapeHTML(startPlace?.place_name || "\uC544\uC9C1 \uC120\uD0DD \uC548 \uD568")}</strong>
      ${startPlace ? '<button type="button" id="clearStartPlaceBtn">&#48320;&#44221;</button>' : ""}
    </div>
    <div class="route-endpoint-row">
      <span>&#46020;&#52265;</span>
      <strong>${escapeHTML(endPlace?.place_name || "\uC544\uC9C1 \uC120\uD0DD \uC548 \uD568")}</strong>
      ${endPlace ? '<button type="button" id="clearEndPlaceBtn">&#48320;&#44221;</button>' : ""}
    </div>
  `;
}

function syncQuickRouteInputs() {
  if (quickStartInput) {
    quickStartInput.value = startPlace?.place_name || "";
  }

  if (quickEndInput) {
    quickEndInput.value = endPlace?.place_name || "";
  }
}

function routeQueryParams() {
  const params = new URLSearchParams({
    startName: startPlace.place_name,
    startAddress: startPlace.road_address_name || startPlace.address_name || "",
    startX: startPlace.x,
    startY: startPlace.y,
    name: endPlace.place_name,
    address: endPlace.road_address_name || endPlace.address_name || "",
    x: endPlace.x,
    y: endPlace.y,
    mobilityType: selectedMobilityType,
  });

  return params.toString();
}

async function loadSelectedRouteFromQuery() {
  const params = new URLSearchParams(location.search);
  const routeType = params.get("routeType");

  if (!routeType) return;

  try {
    const response = await fetch(`/api/access-routes?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "경로를 불러오지 못했습니다.");
    }

    const route = data.routes.find((item) => item.id === routeType) || data.routes[0];
    if (!route) {
      throw new Error("선택한 경로를 찾을 수 없습니다.");
    }

    startPlace = {
      place_name: data.start.name,
      y: data.start.lat,
      x: data.start.lng,
      road_address_name: "",
      address_name: data.start.name,
    };
    endPlace = {
      place_name: data.destination.name,
      y: data.destination.lat,
      x: data.destination.lng,
      road_address_name: "",
      address_name: data.destination.name,
    };

    syncRouteEndpoints(data, route);
    syncQuickRouteInputs();
    updateStartMarker(startPlace);
    updateEndMarker(endPlace);
    drawRoute({ path: route.path, colored: true });
    drawDangerZones(routeDangerZones(route));
    updateSelectedRouteSheet(route);
    updateRouteInfo({
      distance: route.distance,
      duration: route.duration * 60,
    });
    updateDangerCount(route.dangerCount);
    updateSafetyRatio(route);

    currentRouteData = {
      ...data,
      selectedRoute: route,
    };
    document.body.classList.add("route-mode");
    openPlaceSheet();
  } catch (error) {
    console.error("선택 경로 로딩 실패:", error);
    alert(error.message);
  }
}

async function drawDefaultRouteFromSelection() {
  try {
    const response = await fetch(`/api/access-routes?${routeQueryParams()}`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "경로를 불러오지 못했습니다.");
    }

    const route =
      data.routes.find((item) => item.id === "accessible") || data.routes[0];

    if (!route) {
      throw new Error("사용 가능한 경로가 없습니다.");
    }

    syncRouteEndpoints(data, route);
    syncQuickRouteInputs();
    updateStartMarker(startPlace);
    updateEndMarker(endPlace);
    drawRoute({ path: route.path, colored: true });
    drawDangerZones(routeDangerZones(route));
    updateSelectedRouteSheet(route);
    updateRouteInfo({
      distance: route.distance,
      duration: route.duration * 60,
    });
    updateDangerCount(route.dangerCount);
    updateSafetyRatio(route);
    currentRouteData = {
      ...data,
      selectedRoute: route,
    };
  } catch (error) {
    console.error("기본 경로 로딩 실패:", error);
    alert("경로 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
}

async function openRouteListPanel() {
  try {
    let data = currentRouteData;

    if (!data?.routes?.length) {
      const response = await fetch(`/api/access-routes?${routeQueryParams()}`);
      data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "경로를 불러오지 못했습니다.");
      }
    }

    currentRouteData = {
      ...data,
      selectedRoute: data.selectedRoute || currentRouteData?.selectedRoute || data.routes[0],
    };
    renderRouteListPanel(currentRouteData);
    openPlaceSheet();
  } catch (error) {
    console.error("경로 목록 로딩 실패:", error);
    alert(error.message);
  }
}

function renderRouteListPanel(data) {
  infoPanelState = "route-list";
  if (!panelContent) return;
  placeSheet?.classList.add("route-sheet", "route-list-sheet");
  placeSheet?.classList.remove("report-sheet");

  const routes = data.routes || [];
  const summaryTitle = `${data.destination?.name || endPlace?.place_name || "목적지"}까지 경로 ${routes.length}개`;
  const routeItems = routes
    .map((route) => {
      const selected = route.id === data.selectedRoute?.id ? " selected" : "";
      const danger = route.dangerCount ? " danger" : "";
      return `
        <button class="route-option${selected}${danger}" type="button" data-route-id="${escapeHTML(route.id)}">
          <span class="route-option-bar" aria-hidden="true"></span>
          <span class="route-option-body">
            <strong>${escapeHTML(route.title)}</strong>
            <span>${route.duration}분 · ${route.distance}m · 계단 ${route.features.stairs}개 · 경사로 ${route.features.ramps}개 · 횡단보도 ${route.features.crosswalks}개</span>
          </span>
        </button>
      `;
    })
    .join("");

  panelContent.innerHTML = `
    <button class="panel-back-button" id="routePanelBackBtn" type="button">← 경로로 돌아가기</button>
    <div class="route-list-panel-heading">
      <p class="sheet-label">경로 목록</p>
      <h3>${escapeHTML(summaryTitle)}</h3>
    </div>
    <div class="route-options">
      ${routeItems}
    </div>
  `;
}

function applyRouteSelection(data, route) {
  currentRouteData = {
    ...data,
    selectedRoute: route,
  };

  syncRouteEndpoints(data, route);
  syncQuickRouteInputs();
  updateStartMarker(startPlace);
  updateEndMarker(endPlace);
  drawRoute({ path: route.path, colored: true });
  drawDangerZones(routeDangerZones(route));
  updateSelectedRouteSheet(route);
  updateRouteInfo({
    distance: route.distance,
    duration: route.duration * 60,
  });
  updateDangerCount(route.dangerCount);
  updateSafetyRatio(route);
  document.body.classList.add("route-mode");
  openPlaceSheet();
}

function syncRouteEndpoints(data, route) {
  const path = route?.path || [];
  const routeStart = path[0];
  const routeEnd = path[path.length - 1];

  if (data.start) {
    startPlace = {
      ...startPlace,
      place_name: data.start.name || startPlace?.place_name || "",
      y: routeStart?.lat ?? data.start.lat,
      x: routeStart?.lng ?? data.start.lng,
      road_address_name: startPlace?.road_address_name || "",
      address_name: data.start.name || startPlace?.address_name || "",
    };
  }

  if (data.destination) {
    endPlace = {
      ...endPlace,
      place_name: data.destination.name || endPlace?.place_name || "",
      y: routeEnd?.lat ?? data.destination.lat,
      x: routeEnd?.lng ?? data.destination.lng,
      road_address_name: endPlace?.road_address_name || "",
      address_name: data.destination.name || endPlace?.address_name || "",
    };
  }
}

function updateSelectedRouteSheet(route) {
  const routeLabel = route.id === "accessible" ? "추천 경로" : "최단 경로";
  renderRoutePanel(
    `${endPlace.place_name}까지 ${routeLabel}`,
    `계단 ${route.features.stairs}개 · 경사로 ${route.features.ramps}개 · ` +
      `엘리베이터 ${route.features.elevators}개 · 횡단보도 ${route.features.crosswalks}개`
  );
}

function updateSafetyRatio(route) {
  const ratio = calculateSafetyRatio(route.path || []);
  const safeBar = document.querySelector(".safety-bar .safe");
  const warnBar = document.querySelector(".safety-bar .warn");
  const labels = document.querySelectorAll(".safety-labels span");

  if (safeBar) {
    safeBar.style.width = `${ratio.safe}%`;
    safeBar.style.flexBasis = `${ratio.safe}%`;
  }
  if (warnBar) {
    warnBar.style.width = `${ratio.warn}%`;
    warnBar.style.flexBasis = `${ratio.warn}%`;
  }
  if (labels[0]) labels[0].textContent = `안전 ${ratio.safe}%`;
  if (labels[1]) labels[1].textContent = `주의 ${ratio.warn}%`;
}

function calculateSafetyRatio(path) {
  if (path.length < 2) {
    return { safe: 100, warn: 0 };
  }

  let safeDistance = 0;
  let warnDistance = 0;

  for (let i = 0; i < path.length - 1; i += 1) {
    const fromNode = path[i];
    const toNode = path[i + 1];
    const distance = getDistance(fromNode.lat, fromNode.lng, toNode.lat, toNode.lng);
    const color = routeSegmentColor(fromNode, toNode);

    if (color === "#48d10f") {
      safeDistance += distance;
    } else {
      warnDistance += distance;
    }
  }

  const total = safeDistance + warnDistance;
  if (!total) {
    return { safe: 100, warn: 0 };
  }

  const safe = Math.round((safeDistance / total) * 100);
  return {
    safe,
    warn: 100 - safe,
  };
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function handleBackButton() {
  if (placeSheet && !placeSheet.classList.contains("hidden")) {
    dismissActiveCaption({ removeCurrentLocation: true });
    return;
  }

  if (startPlace || endPlace || currentPolyline || currentRoutePolylines.length) {
    resetRouteState();
    return;
  }

  history.back();
}

function resetRouteState() {
  stopNavigationTracking({ silent: true });
  selectedMobilityType = "walking";
  clearSearchMarkers();
  clearNearbyFilterSelection();
  clearRoutePolylines();
  clearDangerZones();

  if (startMarker) {
    startMarker.setMap(null);
    startMarker = null;
  }

  if (endMarker) {
    endMarker.setMap(null);
    endMarker = null;
  }

  startPlace = null;
  endPlace = null;
  searchInput.value = "";
  syncQuickRouteInputs();
  hideResultList();
  hideQuickRouteResultList();
  document.body.classList.remove("route-mode");
  resetPlaceSheet();

  if (history.replaceState) {
    history.replaceState(null, "", "index.html");
  }
}

function clearDangerZones() {
  dangerCircles.forEach((circle) => circle.setMap(null));
  dangerCircles = [];
}

function resetPlaceSheet() {
  renderRoutePanel("장소명", "주소가 여기에 표시됩니다.");
  placeSheet.classList.add("hidden");
  placeSheet.classList.remove("collapsed");
  placeSheet.classList.add("expanded");
  document.body.classList.remove("sheet-open");
  updateSafetyRatio({ path: [] });
}

function dismissActiveCaption({
  removeCurrentLocation = false,
  preserveRouteSelection = false,
} = {}) {
  if (clickedPlaceMarker) {
    clickedPlaceMarker.setMap(null);
    markers = markers.filter((marker) => marker !== clickedPlaceMarker);
    clickedPlaceMarker = null;
  }

  if (removeCurrentLocation && currentLocationMarker) {
    currentLocationMarker.setMap(null);
    currentLocationMarker = null;
  }

  currentInlineReportTarget = null;
  if (!preserveRouteSelection) selectedPlaceForRoute = null;
  infoPanelState = "route";
  resetPlaceSheet();
}

function locationFromGeolocation(position) {
  return {
    latitude: Number(position.coords.latitude),
    longitude: Number(position.coords.longitude),
    accuracy: Number(position.coords.accuracy),
    timestamp: Number(position.timestamp || Date.now()),
    speed: Number.isFinite(Number(position.coords.speed)) ? Number(position.coords.speed) : null,
    heading: Number.isFinite(Number(position.coords.heading)) ? Number(position.coords.heading) : null,
  };
}

function validateLocation(location) {
  const coordinatesValid =
    Number.isFinite(location?.latitude) &&
    Number.isFinite(location?.longitude) &&
    Math.abs(location.latitude) <= 90 &&
    Math.abs(location.longitude) <= 180;
  const accuracy = Number.isFinite(location?.accuracy) ? location.accuracy : Infinity;
  const age = Math.max(0, Date.now() - Number(location?.timestamp || 0));
  return {
    valid: coordinatesValid && age <= LOCATION_MAX_AGE_MS,
    accuracy,
    quality:
      accuracy <= LOCATION_HIGH_ACCURACY_METERS
        ? "high"
        : accuracy <= LOCATION_USABLE_ACCURACY_METERS
          ? "usable"
          : "low",
  };
}

function isLocationJump(previousLocation, newLocation) {
  if (!previousLocation || !newLocation) return false;
  const elapsedMs = newLocation.timestamp - previousLocation.timestamp;
  if (elapsedMs <= 0 || elapsedMs > GPS_JUMP_WINDOW_MS) return false;
  const distance = getDistance(
    previousLocation.latitude,
    previousLocation.longitude,
    newLocation.latitude,
    newLocation.longitude
  );
  const impliedSpeed = distance / (elapsedMs / 1000);
  return (
    distance >= GPS_JUMP_DISTANCE_METERS &&
    impliedSpeed > GPS_WALKING_MAX_SPEED_MPS
  );
}

async function findNearbyEntrance(location) {
  const validation = validateLocation(location);
  if (!validation.valid || validation.quality === "low") return null;
  try {
    const params = new URLSearchParams({
      query: "입구",
      lat: location.latitude,
      lng: location.longitude,
    });
    const response = await fetch(`/api/access-places?${params.toString()}`);
    const data = await response.json();
    if (!response.ok || !data.ok) return null;
    return (data.items || [])
      .filter((item) =>
        item.source === "mapservice" &&
        (/entrance/i.test(item.address_name || "") || /정문|후문|쪽문|입구|출입구/.test(item.place_name || ""))
      )
      .map((item) => ({
        ...item,
        distance: getDistance(location.latitude, location.longitude, Number(item.y), Number(item.x)),
      }))
      .filter((item) => item.distance <= SNAP_TO_ENTRANCE_DISTANCE)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  } catch (error) {
    console.warn("주변 출입구 조회 실패:", error);
    return null;
  }
}

function snapToEntrance(location, entrance) {
  if (!entrance || entrance.distance > SNAP_TO_ENTRANCE_DISTANCE) return location;
  return {
    ...location,
    latitude: Number(entrance.y),
    longitude: Number(entrance.x),
    snappedTo: "entrance",
    entrance,
  };
}

function snapToRoute(location, route) {
  const path = route?.path || route || [];
  if (!location || !Array.isArray(path) || path.length < 2) return location;
  const latScale = 111320;
  const lngScale = 111320 * Math.cos((location.latitude * Math.PI) / 180);
  const px = location.longitude * lngScale;
  const py = location.latitude * latScale;
  let best = null;

  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const ax = Number(start.lng) * lngScale;
    const ay = Number(start.lat) * latScale;
    const bx = Number(end.lng) * lngScale;
    const by = Number(end.lat) * latScale;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
      : 0;
    const x = ax + ratio * dx;
    const y = ay + ratio * dy;
    const distance = Math.hypot(px - x, py - y);
    if (!best || distance < best.distance) {
      best = { distance, latitude: y / latScale, longitude: x / lngScale };
    }
  }

  if (!best || best.distance > MAX_ROUTE_SNAP_DISTANCE) {
    return { ...location, routeDistance: best?.distance ?? Infinity };
  }
  return {
    ...location,
    latitude: best.latitude,
    longitude: best.longitude,
    routeDistance: best.distance,
    snappedTo: "route",
  };
}

async function handleRouteDeviation(location) {
  if (!endPlace || Date.now() - lastRouteRecalculationAt < ROUTE_RECALCULATION_COOLDOWN_MS) return;
  lastRouteRecalculationAt = Date.now();
  startPlace = {
    place_name: "현재 위치",
    x: location.longitude,
    y: location.latitude,
    source: "gps",
  };
  updateStartMarker(startPlace);
  syncQuickRouteInputs();
  await drawDefaultRouteFromSelection();
}

function centerMapOnCurrentLocation({
  setStartPlace = true,
  updatePanel = true,
  collapsePanel = true,
  silentError = false,
} = {}) {
  const isLocalhost =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";

  if (!window.isSecureContext && !isLocalhost) {
    if (!silentError) {
      alert("휴대폰 브라우저에서 현재 위치를 쓰려면 HTTPS 주소가 필요합니다.");
    }
    return;
  }

  if (!navigator.geolocation) {
    if (!silentError) {
      alert("현재 위치 기능을 지원하지 않는 브라우저입니다.");
    }
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const location = locationFromGeolocation(position);
      const validation = validateLocation(location);
      if (!validation.valid) {
        if (!silentError) alert("현재 위치 정보가 유효하지 않습니다. 다시 시도해주세요.");
        return;
      }
      const lat = location.latitude;
      const lng = location.longitude;
      const currentPosition = new kakao.maps.LatLng(lat, lng);

      if (setStartPlace) {
        startPlace = {
          place_name: "현재 위치",
          y: lat,
          x: lng,
          road_address_name: "",
          address_name: "현재 위치에서 출발",
        };
      }

      smoothMoveTo(currentPosition);

      setTimeout(() => {
        map.setLevel(3);
      }, 700);

      updateCurrentLocationMarker(lat, lng);

      if (updatePanel) {
        updatePlaceSheet();
      }

      if (collapsePanel) {
        collapsePlaceSheet();
      }
    },
    () => {
      if (!silentError) {
        alert("현재 위치를 가져올 수 없습니다. 위치 권한을 허용해주세요.");
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function moveToCurrentLocation() {
  centerMapOnCurrentLocation({
    setStartPlace: false,
    updatePanel: false,
    collapsePanel: false,
  });
}

function startNavigationTracking() {
  const isLocalhost =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";

  if (!window.isSecureContext && !isLocalhost) {
    alert("실시간 위치 추적은 HTTPS 주소에서 사용할 수 있습니다.");
    return;
  }

  if (!navigator.geolocation) {
    alert("현재 위치 기능을 지원하지 않습니다.");
    return;
  }

  // 이미 GPS 추적 중이라면 기존 추적 중지
  if (currentWatchId !== null) {
    navigator.geolocation.clearWatch(currentWatchId);
  }

  navigationMode = true;
  navigationSimulationActive = false;
  navigationRouteInitialized = false;
  lastAcceptedLocation = null;
  lastRouteRecalculationAt = 0;
  document.body.classList.add("navigation-mode");
  updateStartRouteButtonState();
  startDeviceHeadingTracking();

  currentWatchId = navigator.geolocation.watchPosition(
    (position) => processNavigationLocation(locationFromGeolocation(position)),

    (error) => {
      console.error("GPS 오류:", error);

      if (error.code === 1) {
        alert("위치 권한이 거부되었습니다.");
        stopNavigationTracking();
      } else if (error.code === 2) {
        alert("현재 위치를 확인할 수 없습니다.");
      } else if (error.code === 3) {
        console.warn("위치 확인 시간이 초과되었습니다.");
      }
    },

    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

async function processNavigationLocation(rawLocation, { initializeRoute = true } = {}) {
  const validation = validateLocation(rawLocation);
  if (!validation.valid || isLocationJump(lastAcceptedLocation, rawLocation)) return;

  if (initializeRoute && !navigationRouteInitialized) {
    navigationRouteInitialized = true;
    const entrance = await findNearbyEntrance(rawLocation);
    const correctedStart = snapToEntrance(rawLocation, entrance);
    if (endPlace) {
      startPlace = correctedStart.snappedTo === "entrance"
        ? { ...correctedStart.entrance, source: "mapservice" }
        : {
            place_name: "현재 위치",
            x: correctedStart.longitude,
            y: correctedStart.latitude,
            source: "gps",
          };
      updateStartMarker(startPlace);
      syncQuickRouteInputs();
      await drawDefaultRouteFromSelection();
    }
  }

  const activeRoute = currentRouteData?.selectedRoute || currentRouteData?.routes?.[0];
  const displayLocation = snapToRoute(rawLocation, activeRoute);
  const currentPosition = new kakao.maps.LatLng(displayLocation.latitude, displayLocation.longitude);
  const nextHeading = rawLocation.heading ?? bearingBetweenPositions(lastNavigationPosition, currentPosition);
  currentLocationPosition = currentPosition;
  updateCurrentLocationMarker(displayLocation.latitude, displayLocation.longitude, nextHeading);
  updateLiveNavigationProgress(currentPosition);

  if (
    !navigationSimulationActive &&
    Number.isFinite(displayLocation.routeDistance) &&
    displayLocation.routeDistance > ROUTE_RECALCULATION_DISTANCE
  ) {
    await handleRouteDeviation(rawLocation);
  }

  if (navigationMode) {
    if (typeof map.panTo === "function") map.panTo(currentPosition);
    else map.setCenter(currentPosition);
    map.setLevel(3);
  }

  lastNavigationPosition = currentPosition;
  lastAcceptedLocation = rawLocation;
}

function buildSimulatedRoutePoints(path) {
  const points = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    const distance = getDistance(from.lat, from.lng, to.lat, to.lng);
    const steps = Math.max(1, Math.ceil(distance / GPS_SIMULATION_STEP_METERS));
    for (let step = 0; step < steps; step += 1) {
      const ratio = step / steps;
      points.push({
        latitude: Number(from.lat) + (Number(to.lat) - Number(from.lat)) * ratio,
        longitude: Number(from.lng) + (Number(to.lng) - Number(from.lng)) * ratio,
      });
    }
  }
  const last = path[path.length - 1];
  if (last) points.push({ latitude: Number(last.lat), longitude: Number(last.lng) });
  return points;
}

function startNavigationSimulation() {
  if (!DEVELOPMENT_GPS_SIMULATION) return;
  const route = currentRouteData?.selectedRoute || currentRouteData?.routes?.[0];
  const simulatedPoints = buildSimulatedRoutePoints(route?.path || []);
  if (simulatedPoints.length < 2) {
    alert("먼저 출발지와 목적지를 정해 경로를 만들어주세요.");
    return;
  }

  stopNavigationTracking({ silent: true });
  navigationMode = true;
  navigationSimulationActive = true;
  navigationRouteInitialized = true;
  lastAcceptedLocation = null;
  lastNavigationPosition = null;
  document.body.classList.add("navigation-mode");
  updateStartRouteButtonState();

  let index = 0;
  const playNextPoint = async () => {
    if (!navigationSimulationActive || index >= simulatedPoints.length) {
      stopNavigationTracking({ silent: true });
      return;
    }
    const point = simulatedPoints[index];
    const next = simulatedPoints[Math.min(index + 1, simulatedPoints.length - 1)];
    await processNavigationLocation({
      ...point,
      accuracy: 5,
      timestamp: Date.now(),
      speed: GPS_SIMULATION_STEP_METERS / (GPS_SIMULATION_INTERVAL_MS / 1000),
      heading: bearingBetweenCoordinates(point, next),
    }, { initializeRoute: false });
    index += 1;
    navigationSimulationTimer = window.setTimeout(playNextPoint, GPS_SIMULATION_INTERVAL_MS);
  };
  playNextPoint();
}

function bearingBetweenCoordinates(from, to) {
  if (!from || !to) return currentLocationHeading;
  return bearingBetweenPositions(
    new kakao.maps.LatLng(from.latitude, from.longitude),
    new kakao.maps.LatLng(to.latitude, to.longitude)
  );
}


// 길안내 중지
function stopNavigationTracking({ silent = false } = {}) {
  navigationMode = false;
  navigationSimulationActive = false;
  document.body.classList.remove("navigation-mode");

  if (navigationSimulationTimer !== null) {
    window.clearTimeout(navigationSimulationTimer);
    navigationSimulationTimer = null;
  }

  if (currentWatchId !== null) {
    navigator.geolocation.clearWatch(currentWatchId);
    currentWatchId = null;
  }

  lastNavigationPosition = null;
  lastAcceptedLocation = null;
  navigationRouteInitialized = false;
  updateStartRouteButtonState();

  if (!silent) {
    console.log("길안내 종료");
  }
}

async function startDeviceHeadingTracking() {
  if (deviceHeadingListenerActive || typeof DeviceOrientationEvent === "undefined") return;

  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") return;
    }

    window.addEventListener("deviceorientationabsolute", handleDeviceHeading, true);
    window.addEventListener("deviceorientation", handleDeviceHeading, true);
    deviceHeadingListenerActive = true;
  } catch (error) {
    console.warn("기기 방향 센서를 사용할 수 없습니다:", error);
  }
}

function stopDeviceHeadingTracking() {
  if (!deviceHeadingListenerActive) return;

  window.removeEventListener("deviceorientationabsolute", handleDeviceHeading, true);
  window.removeEventListener("deviceorientation", handleDeviceHeading, true);
  deviceHeadingListenerActive = false;
}

function handleDeviceHeading(event) {
  if (!currentLocationPosition || !currentLocationMarker) return;

  const heading =
    typeof event.webkitCompassHeading === "number"
      ? event.webkitCompassHeading
      : typeof event.alpha === "number"
        ? 360 - event.alpha
        : null;

  if (heading === null) return;

  currentLocationHeading = normalizeHeading(heading);
  currentLocationMarker?.setContent(currentLocationMarkerContent(currentLocationHeading));
}

function updateStartRouteButtonState() {
  const button = document.getElementById("startRouteBtn");
  if (!button) return;

  button.textContent = navigationMode ? "안내 종료" : "안내 시작";
  button.classList.toggle("tracking", navigationMode);

  const simulationButton = document.getElementById("simulateRouteBtn");
  if (simulationButton) {
    simulationButton.textContent = navigationSimulationActive ? "테스트 중지" : "경로 테스트";
    simulationButton.classList.toggle("tracking", navigationSimulationActive);
  }
}

function updateLiveNavigationProgress(currentPosition) {
  const route = currentRouteData?.selectedRoute || currentRouteData?.routes?.[0];
  const path = route?.path || [];
  const destinationPoint = endPlace
    ? { lat: Number(endPlace.y), lng: Number(endPlace.x) }
    : path[path.length - 1];

  const remainingDistance = estimateRemainingRouteDistance(currentPosition, path, destinationPoint);
  if (!Number.isFinite(remainingDistance)) return;

  updateRouteInfo({
    distance: remainingDistance,
    duration: Math.max(30, Math.round(remainingDistance / 1.1)),
  });
}

function estimateRemainingRouteDistance(currentPosition, path, destinationPoint) {
  if (!currentPosition) return Infinity;

  if (!Array.isArray(path) || path.length < 2) {
    if (!destinationPoint) return Infinity;
    return getDistance(
      currentPosition.getLat(),
      currentPosition.getLng(),
      Number(destinationPoint.lat),
      Number(destinationPoint.lng)
    );
  }

  let nearestIndex = 0;
  let nearestDistance = Infinity;

  path.forEach((point, index) => {
    const distance = getDistance(
      currentPosition.getLat(),
      currentPosition.getLng(),
      Number(point.lat),
      Number(point.lng)
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  let remaining = nearestDistance;
  for (let i = nearestIndex; i < path.length - 1; i += 1) {
    remaining += getDistance(
      Number(path[i].lat),
      Number(path[i].lng),
      Number(path[i + 1].lat),
      Number(path[i + 1].lng)
    );
  }

  return remaining;
}

function smoothMoveTo(targetPosition) {
  const currentCenter = map.getCenter();

  const startLat = currentCenter.getLat();
  const startLng = currentCenter.getLng();
  const endLat = targetPosition.getLat();
  const endLng = targetPosition.getLng();

  const duration = 700;
  const startTime = performance.now();

  function animate(now) {
    const progress = Math.min((now - startTime) / duration, 1);

    const easedProgress = 1 - Math.pow(1 - progress, 3);

    const lat = startLat + (endLat - startLat) * easedProgress;
    const lng = startLng + (endLng - startLng) * easedProgress;

    map.setCenter(new kakao.maps.LatLng(lat, lng));

    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  }

  requestAnimationFrame(animate);
}

function updateCurrentLocationMarker(lat, lng, heading = null) {
  startDeviceHeadingTracking();
  const position = new kakao.maps.LatLng(lat, lng);
  currentLocationPosition = position;
  currentLocationHeading = normalizeHeading(heading ?? currentLocationHeading);

  if (!currentLocationMarker) {
    currentLocationMarker = new kakao.maps.CustomOverlay({
      map,
      position,
      yAnchor: 0.5,
      xAnchor: 0.5,
      zIndex: 20,
      content: currentLocationMarkerContent(currentLocationHeading),
    });
  } else {
    currentLocationMarker.setPosition(position);
    currentLocationMarker.setContent(currentLocationMarkerContent(currentLocationHeading));
  }

  updateWeatherBadge(lat, lng);
}

function currentLocationMarkerContent(heading) {
  return `
    <div class="current-location-overlay" style="--heading:${normalizeHeading(heading)}deg" aria-label="현재 위치">
      <span class="current-location-direction" aria-hidden="true"></span>
      <span class="current-location-dot" aria-hidden="true"></span>
    </div>
  `;
}

function normalizeHeading(value) {
  const heading = Number(value);
  if (!Number.isFinite(heading)) return currentLocationHeading || 0;
  return ((heading % 360) + 360) % 360;
}

function bearingBetweenPositions(fromPosition, toPosition) {
  if (!fromPosition || !toPosition) return currentLocationHeading;

  const lat1 = (fromPosition.getLat() * Math.PI) / 180;
  const lat2 = (toPosition.getLat() * Math.PI) / 180;
  const dLng = ((toPosition.getLng() - fromPosition.getLng()) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

async function updateWeatherBadge(lat, lng) {
  if (!weatherBadge || !weatherTemp || !weatherSummary) return;

  const weatherKey = `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`;
  if (weatherKey === lastWeatherKey) return;
  lastWeatherKey = weatherKey;

  weatherBadge.classList.remove("hidden");
  weatherTemp.textContent = "--°";
  weatherSummary.textContent = "";
  setWeatherIcon();

  try {
    const params = new URLSearchParams({ lat, lng });
    const response = await fetch(`/api/weather?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "날씨 정보를 불러오지 못했습니다.");
    }

    const weather = data.weather;
    const temp = weather.temperature;

    setWeatherIcon(weather.code);
    weatherTemp.textContent = temp === null ? "--°" : `${Math.round(temp)}°`;
    weatherSummary.textContent = "";
  } catch (error) {
    console.warn("Weather badge error:", error);
    weatherTemp.textContent = "--°";
    weatherSummary.textContent = "";
    setWeatherIcon();
  }
}

function setWeatherIcon(code) {
  if (!weatherIcon) return;

  weatherIcon.className = `weather-icon ${weatherIconType(code)}`;
}

function weatherIconType(code) {
  const weatherCode = Number(code);

  if (weatherCode === 0) return "sunny";
  if ([1, 2].includes(weatherCode)) return "partly-cloudy";
  if (weatherCode === 3) return "cloudy";
  if ([45, 48].includes(weatherCode)) return "foggy";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) {
    return "rainy";
  }
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return "snowy";
  if ([95, 96, 99].includes(weatherCode)) return "stormy";
  return "cloudy";
}

function updatePlaceSheet() {
  if (startPlace && endPlace) {
    renderRoutePanel(`${endPlace.place_name}\uAE4C\uC9C0`, "");
  } else if (startPlace) {
    renderRoutePanel(
      `\uCD9C\uBC1C\uC9C0: ${startPlace.place_name}`,
      startPlace.road_address_name || startPlace.address_name || "\uC8FC\uC18C \uC815\uBCF4 \uC5C6\uC74C"
    );
  } else if (endPlace) {
    renderRoutePanel(
      `\uBAA9\uC801\uC9C0: ${endPlace.place_name}`,
      endPlace.road_address_name || endPlace.address_name || "\uC8FC\uC18C \uC815\uBCF4 \uC5C6\uC74C"
    );
  } else {
    renderRoutePanel("\uCD9C\uBC1C\uC9C0\uC640 \uBAA9\uC801\uC9C0\uB97C \uC120\uD0DD\uD574\uC8FC\uC138\uC694", "\uC7A5\uC18C\uB97C \uAC80\uC0C9\uD55C \uB4A4 \uCD9C\uBC1C\uC9C0 \uB610\uB294 \uBAA9\uC801\uC9C0\uB85C \uC9C0\uC815\uD560 \uC218 \uC788\uC5B4\uC694.");
  }
}

function renderRoutePanel(title, subtitle = "") {
  infoPanelState = "route";
  if (!panelContent) return;
  placeSheet?.classList.add("route-sheet");
  placeSheet?.classList.remove("report-sheet", "route-list-sheet");

  const hasBothEndpoints = Boolean(startPlace && endPlace);
  const routeDetails = hasBothEndpoints
    ? `
      <div class="info-cards">
        <div class="info-card">
          <strong>-</strong>
          <span>&#50696;&#49345; &#49884;&#44036;</span>
        </div>
        <div class="info-card">
          <strong>-</strong>
          <span>&#44144;&#47532;</span>
        </div>
        <div class="info-card danger">
          <strong>-</strong>
          <span>&#50948;&#54744; &#44396;&#44036;</span>
        </div>
      </div>

      <div class="safety-bar">
        <div class="safe"></div>
        <div class="warn"></div>
      </div>

      <div class="safety-labels">
        <span>&#50504;&#51204;</span>
        <span>&#51452;&#51032;</span>
      </div>

      <div class="sheet-actions">
        <button class="secondary-btn" id="routeListBtn" type="button">&#44221;&#47196; &#47785;&#47197;</button>
        <button class="primary-btn" id="startRouteBtn" type="button">&#50504;&#45236; &#49884;&#51089;</button>
      </div>
      <button class="secondary-btn dev-simulation-btn" id="simulateRouteBtn" type="button">경로 테스트</button>
    `
    : `
      <div class="route-next-step">
        <p>${startPlace ? "\uBAA9\uC801\uC9C0\uB97C \uAC80\uC0C9\uD574\uC11C \uC120\uD0DD\uD574\uC8FC\uC138\uC694." : "\uCD9C\uBC1C\uC9C0\uB97C \uAC80\uC0C9\uD574\uC11C \uC120\uD0DD\uD574\uC8FC\uC138\uC694."}</p>
      </div>
    `;

  panelContent.innerHTML = `
    <p class="sheet-label">&#44221;&#47196; &#49444;&#51221;</p>
    <h3 id="placeName">${escapeHTML(title)}</h3>
    <p id="placeAddress" class="muted">${escapeHTML(subtitle)}</p>

    <div class="route-endpoint-summary compact">
      ${routeEndpointSummary()}
    </div>

    ${mobilityTypeSelectorMarkup()}

    ${routeDetails}
  `;
  updateStartRouteButtonState();
}

function mobilityTypeSelectorMarkup() {
  const options = [
    ["walking", "일반 보행"],
    ["wheelchair", "휠체어"],
    ["stroller", "유모차"],
    ["senior", "고령자"],
  ];
  return `
    <section class="mobility-selector" aria-label="이동 유형 선택">
      <p>이동 유형</p>
      <div class="mobility-options">
        ${options.map(([value, label]) => `
          <button
            type="button"
            class="mobility-option${selectedMobilityType === value ? " active" : ""}"
            data-mobility-type="${value}"
            aria-pressed="${selectedMobilityType === value}"
          >${label}</button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderNearbyPanel(places, keyword = "주변") {
  infoPanelState = "nearby";
  nearbyPanelPlaces = places;
  nearbyPanelKeyword = keyword;
  if (!panelContent) return;
  placeSheet?.classList.remove("report-sheet", "route-sheet", "route-list-sheet");

  const cards = places
    .map((place, index) => {
      const category = placeCategory(place);
      return `
        <article class="nearby-place-card" data-index="${index}">
          ${nearbyPhotoMarkup(index, "list")}
          <div class="nearby-place-body">
            <div class="nearby-title-row">
              <h4>${escapeHTML(place.place_name || "이름 없음")}</h4>
              <span>${escapeHTML(category)}</span>
            </div>
            <p>${escapeHTML(formatPlaceDistance(place))}</p>
            <p class="nearby-accessibility" data-accessibility-index="${index}">${escapeHTML(accessibilityLabel(place))}</p>
          </div>
        </article>
      `;
    })
    .join("");

  panelContent.innerHTML = `
    <div class="info-panel-heading">
      <p class="sheet-label">주변 시설</p>
      <h3>${escapeHTML(keyword)} 주변 목록</h3>
      <p class="muted">현재 위치 기준으로 가까운 시설을 보여줍니다.</p>
    </div>
    <div class="nearby-list">
      ${cards}
    </div>
  `;

  loadNearbyPlacePhotos(places);
  loadNearbyAccessibility(places);
}

function showNearbyPlaceDetail(place) {
  infoPanelState = "detail";
  selectedPlaceForRoute = place;
  if (!panelContent) return;
  placeSheet?.classList.remove("report-sheet", "route-sheet", "route-list-sheet");
  const savedInFavorites = isPlaceSavedInFavorites(place);

  const position = new kakao.maps.LatLng(place.y, place.x);
  smoothMoveTo(position);

  if (place._marker) {
    place._marker.setMap(map);
  }

  panelContent.innerHTML = `
    <button class="panel-back-button" id="nearbyBackBtn" type="button">← 목록</button>
    ${nearbyPhotoMarkup(0, "detail")}
    <div class="nearby-detail">
      <p class="sheet-label">${escapeHTML(placeCategory(place))}</p>
      <div class="nearby-detail-title-row">
        <h3>${escapeHTML(place.place_name || "이름 없음")}</h3>
        <button class="place-favorite-button${savedInFavorites ? " saved" : ""}" id="favoritePlaceBtn" type="button" aria-label="즐겨찾기에 저장">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 3.4 2.62 5.31 5.86.85-4.24 4.13 1 5.83L12 16.76l-5.24 2.76 1-5.83-4.24-4.13 5.86-.85L12 3.4Z" />
          </svg>
        </button>
      </div>
      <p class="muted">${escapeHTML(place.road_address_name || place.address_name || "주소 정보 없음")}</p>
      <div class="nearby-detail-meta">
        <span>${escapeHTML(formatPlaceDistance(place))}</span>
        <span data-accessibility-detail>${escapeHTML(accessibilityLabel(place))}</span>
      </div>
      <div class="route-endpoint-summary">
        ${routeEndpointSummary()}
      </div>
      <div class="place-select-actions">
        <button class="secondary-btn" type="button" data-route-role="start">&#52636;&#48156;&#51648;&#47196;</button>
        <button class="primary-btn" type="button" data-route-role="end">&#47785;&#51201;&#51648;&#47196;</button>
      </div>
      <button class="report-link-btn place-report-btn" id="placeReportBtn" type="button">
        이 장소 제보하기
      </button>
    </div>
  `;

  loadPlacePhoto(place, panelContent.querySelector("[data-photo-target]"), "detail");
  loadPlaceAccessibility(place, panelContent.querySelector("[data-accessibility-detail]"));
  openPlaceSheet();
}

function placeCategory(place) {
  const category = place.category_group_name || place.category_name || "시설";
  return String(category).split(">").pop().trim() || "시설";
}

function formatPlaceDistance(place) {
  const distance = Number(place.distance);

  if (!Number.isNaN(distance) && distance > 0) {
    return `현재 위치에서 ${formatDistance(distance)}`;
  }

  if (currentLocationPosition && place.y && place.x) {
    const meters = getDistance(
      currentLocationPosition.getLat(),
      currentLocationPosition.getLng(),
      Number(place.y),
      Number(place.x)
    );
    return `현재 위치에서 ${formatDistance(meters)}`;
  }

  return "현재 위치 기준 거리 확인 중";
}

function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)}km`;
  }

  return `${Math.round(meters)}m`;
}

function accessibilityLabel(place) {
  if (place?.accessibilityStatus) {
    return accessibilityTextFromStatus(place.accessibilityStatus);
  }

  return "휠체어 진입 정보 확인 필요";
}

function accessibilityTextFromStatus(status) {
  if (status === "accessible") return "휠체어 진입 가능";
  if (status === "not_accessible") return "휠체어 진입 어려움";
  return "휠체어 진입 정보 확인 필요";
}

function nearbyPhotoMarkup(index, variant = "list") {
  const className = variant === "detail" ? "nearby-detail-photo" : "nearby-photo";
  return `
    <div class="${className} nearby-photo-placeholder" data-photo-target data-photo-index="${index}" aria-hidden="true">
      <span></span>
    </div>
  `;
}

function loadNearbyPlacePhotos(places) {
  places.forEach((place, index) => {
    const target = panelContent?.querySelector(`[data-photo-index="${index}"]`);
    loadPlacePhoto(place, target, "list");
  });
}

function loadNearbyAccessibility(places) {
  places.forEach((place, index) => {
    const target = panelContent?.querySelector(`[data-accessibility-index="${index}"]`);
    loadPlaceAccessibility(place, target);
  });
}

async function loadPlaceAccessibility(place, target) {
  if (!target || !place) return;

  const params = new URLSearchParams({
    name: place.place_name || place.name || "",
    address: place.road_address_name || place.address_name || place.address || "",
    lat: place.y || place.lat || "",
    lng: place.x || place.lng || "",
  });

  try {
    const response = await fetch(`/api/place-accessibility?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || !data.ok) return;

    place.accessibilityStatus = data.status;
    target.textContent = data.label || accessibilityTextFromStatus(data.status);
    target.classList.toggle("is-verified", Boolean(data.verified));
  } catch (error) {
    console.warn("Failed to load accessibility status:", error);
  }
}

async function loadPlacePhoto(place, target, variant = "list") {
  if (!target || !place) return;

  const params = new URLSearchParams({
    id: place.id || "",
    name: place.place_name || "",
    address: place.road_address_name || place.address_name || "",
    lat: place.y || "",
    lng: place.x || "",
    maxWidthPx: variant === "detail" ? "720" : "360",
  });

  try {
    const response = await fetch(`/api/place-photo?${params.toString()}`);
    const data = await response.json();

    const photos = Array.isArray(data.photos) && data.photos.length
      ? data.photos
      : data.photoUri
        ? [{ photoUri: data.photoUri, attributions: data.attributions || [] }]
        : [];

    if (!response.ok || !data.ok || !photos.length) {
      target.classList.add("no-photo");
      return;
    }

    const gallery = document.createElement("div");
    gallery.className = "place-photo-gallery";
    photos.forEach((photo, index) => {
      const slide = document.createElement("figure");
      slide.className = "place-photo-slide";
      const img = document.createElement("img");
      img.src = photo.photoUri;
      img.alt = photo.label || `${place.place_name || "장소"} 사진 ${index + 1}`;
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      slide.appendChild(img);

      const attribution = googlePhotoAttribution(photo.attributions || []);
      if (photo.label || attribution) {
        slide.insertAdjacentHTML(
          "beforeend",
          `<figcaption>${escapeHTML(photo.label || "")}${attribution}</figcaption>`
        );
      }
      gallery.appendChild(slide);
    });

    target.replaceChildren(gallery);
    target.classList.remove("nearby-photo-placeholder", "no-photo");
    target.classList.add("has-photo");
  } catch (error) {
    console.warn("Failed to load place photo:", error);
    target.classList.add("no-photo");
  }
}

function googlePhotoAttribution(attributions = []) {
  const names = attributions
    .map((item) => item.displayName)
    .filter(Boolean)
    .slice(0, 2);

  if (!names.length) return "";

  return `<span class="photo-attribution">${escapeHTML(names.join(", "))}</span>`;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function openPlaceSheet() {
  placeSheet.classList.remove("hidden");
  placeSheet.classList.remove("collapsed");
  placeSheet.classList.add("expanded");
  document.body.classList.add("sheet-open");
}

function collapsePlaceSheet() {
  placeSheet.classList.remove("hidden");
  placeSheet.classList.remove("expanded");
  placeSheet.classList.add("collapsed");
  document.body.classList.remove("sheet-open");
}

function updateStartMarker(place) {
  const position = new kakao.maps.LatLng(place.y, place.x);

  if (startMarker) {
    startMarker.setMap(null);
  }

  startMarker = new kakao.maps.Marker({
    map,
    position,
    title: "출발지",
  });
}

function updateEndMarker(place) {
  const position = new kakao.maps.LatLng(place.y, place.x);

  if (endMarker) {
    endMarker.setMap(null);
  }

  endMarker = new kakao.maps.Marker({
    map,
    position,
    title: "목적지",
  });
}

function drawRoute(data) {
  const routeNodes = data.path || [];
  const path = routeNodes.map((p) => new kakao.maps.LatLng(p.lat, p.lng));

  if (!path.length) {
    alert("경로 좌표가 없습니다.");
    return;
  }

  clearRoutePolylines();

  if (data.colored && routeNodes.length > 1) {
    for (let i = 0; i < routeNodes.length - 1; i += 1) {
      const segment = new kakao.maps.Polyline({
        path: [path[i], path[i + 1]],
        strokeWeight: 7,
        strokeColor: routeSegmentColor(routeNodes[i], routeNodes[i + 1]),
        strokeOpacity: 0.95,
        strokeStyle: "solid",
        zIndex: 10,
      });

      segment.setMap(map);
      currentRoutePolylines.push(segment);
    }
  } else {
    currentPolyline = new kakao.maps.Polyline({
      path,
      strokeWeight: 5,
      strokeColor: "#48d10f",
      strokeOpacity: 0.9,
      strokeStyle: "solid",
    });

    currentPolyline.setMap(map);
  }

  const bounds = new kakao.maps.LatLngBounds();
  path.forEach((point) => bounds.extend(point));
  map.setBounds(bounds);

  if (data.colored) {
    updateSafetyRatio({ path: routeNodes });
  }
}

function clearRoutePolylines() {
  if (currentPolyline) {
    currentPolyline.setMap(null);
    currentPolyline = null;
  }

  currentRoutePolylines.forEach((polyline) => polyline.setMap(null));
  currentRoutePolylines = [];
}

function routeSegmentColor(fromNode, toNode) {
  const types = [fromNode?.type, toNode?.type];

  if (types.includes("stair") || types.includes("danger")) {
    return "#f26a6a";
  }

  if (
    types.includes("crosswalk") ||
    types.includes("ramp") ||
    types.includes("elevator")
  ) {
    return "#f4c20d";
  }

  return "#48d10f";
}

function routeDangerZones(route) {
  if (Array.isArray(route?.dangerZones) && route.dangerZones.length) {
    return route.dangerZones;
  }

  return dangerZonesFromRoute(route?.path || []);
}

function dangerZonesFromRoute(path) {
  const zones = new Map();

  for (let i = 0; i < path.length - 1; i += 1) {
    const fromNode = path[i];
    const toNode = path[i + 1];

    if (routeSegmentColor(fromNode, toNode) !== "#f26a6a") {
      continue;
    }

    [fromNode, toNode].forEach((node) => {
      zones.set(node.id || `${node.lat},${node.lng}`, {
        lat: node.lat,
        lng: node.lng,
        radius: 13,
      });
    });
  }

  return [...zones.values()];
}

function drawDangerZones(zones) {
  clearDangerZones();

  zones.forEach((zone) => {
    const circle = new kakao.maps.Circle({
      center: new kakao.maps.LatLng(zone.lat, zone.lng),
      radius: zone.radius || 25,
      strokeWeight: 2,
      strokeColor: "#ff4d4f",
      strokeOpacity: 0.9,
      fillColor: "#ff4d4f",
      fillOpacity: 0.25,
    });

    circle.setMap(map);
    dangerCircles.push(circle);
  });
}

//키오스크 API 관련
async function loadBarrierFreeKiosks() {
  try {
    const res = await fetch(
  "/api/barrier-free-kiosks?query=서울특별시&page=1&size=100"
);
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "키오스크 정보를 불러오지 못했습니다.");
    }

    drawKioskMarkers(data.items || []);
  } catch (error) {
    console.error("키오스크 마커 로딩 실패:", error);
    alert(error.message);
  }
}

function drawKioskMarkers(items) {
  clearKioskMarkers();

  items.forEach((item) => {
    const position = new kakao.maps.LatLng(item.lat, item.lng);

    const marker = new kakao.maps.Marker({
      map,
      position,
      title: item.name,
    });

    const infoWindow = new kakao.maps.InfoWindow({
      content: `
        <div style="padding:8px 10px; font-size:13px; line-height:1.4;">
          <strong>${item.name}</strong><br />
          <span>${item.address || "주소 정보 없음"}</span>
        </div>
      `,
    });

    kakao.maps.event.addListener(marker, "click", () => {
      infoWindow.open(map, marker);
    });

    kioskMarkers.push(marker);
  });
}

function clearKioskMarkers() {
  kioskMarkers.forEach((marker) => marker.setMap(null));
  kioskMarkers = [];
}


function updateRouteInfo(summary) {
  const distance = Number(summary.distance || 0);
  const duration = Number(summary.duration || 0);

  const distanceText =
    distance < 1000
      ? `${Math.round(distance)}m`
      : `${(distance / 1000).toFixed(1)}km`;

  const minutes = Math.ceil(duration / 60);
  const timeText = minutes > 0 ? `${minutes}\uBD84` : "-";

  const timeCard = document.querySelector(".info-card:nth-child(1) strong");
  const distanceCard = document.querySelector(".info-card:nth-child(2) strong");

  if (timeCard) timeCard.innerText = timeText;
  if (distanceCard) distanceCard.innerText = distanceText;
}

function updateDangerCount(count) {
  const dangerCard = document.querySelector(".info-card:nth-child(3) strong");

  if (dangerCard) {
    dangerCard.innerText = `${count}\uACF3`;
  }
}

function clearSearchMarkers() {
  if (nearbyInfoWindow) {
    nearbyInfoWindow.close();
    nearbyInfoWindow = null;
  }

  markers.forEach((marker) => marker.setMap(null));
  markers = [];
  clickedPlaceMarker = null;
}
