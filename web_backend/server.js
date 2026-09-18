console.log("🔥 지금 실행 중인 파일:", __filename);

require("dotenv").config({ path: ".env" });

const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const mysql = require("mysql2/promise");
const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_NEARBY_ROUTE_TARGET_DISTANCE = 150;
const DATA_DIR = path.join(__dirname, "data");
const ACCESSIBILITY_REPORTS_FILE = path.join(DATA_DIR, "accessibility-reports.json");
const PLACE_ACCESSIBILITY_FILE = path.join(DATA_DIR, "place-accessibility.json");
const MAPSERVICE_PROJECT_DIR = path.resolve(
  process.env.MAPSERVICE_PROJECT_DIR || path.join(__dirname, "mapservice")
);
const MAPSERVICE_ADMIN_DIR = path.join(MAPSERVICE_PROJECT_DIR, "Test", "graphManager2");
const MAPSERVICE_IMAGES_DIR = path.join(MAPSERVICE_PROJECT_DIR, "Test", "images");
const MAPSERVICE_PANORAMAS_DIR = path.join(MAPSERVICE_PROJECT_DIR, "Test", "panoramas");
const KAKAO_MAP_JS_KEY =
  process.env.KAKAO_MAP_KEY ||
  process.env.KAKAO_JAVASCRIPT_KEY ||
  "";

const ORS_API_KEY = process.env.ORS_API_KEY;
const GOOGLE_PLACES_API_KEY =
  process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googlePhotoCache = new Map();
const AUTH_USERS_FILE = path.join(DATA_DIR, "auth-users.json");

app.use(express.json({ limit: "8mb" }));

app.use((req, res, next) => {
  console.log("요청 들어옴:", req.method, req.url);
  next();
});

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || process.env.DB_PASS,
  database: process.env.DB_NAME,
});

const mapServiceDb = mysql.createPool({
  host: process.env.MAPSERVICE_DB_HOST || process.env.DB_HOST,
  port: Number(process.env.MAPSERVICE_DB_PORT || process.env.DB_PORT || 3306),
  user: process.env.MAPSERVICE_DB_USER || process.env.DB_USER,
  password:
    process.env.MAPSERVICE_DB_PASSWORD ||
    process.env.MAPSERVICE_DB_PASS ||
    process.env.DB_PASSWORD ||
    process.env.DB_PASS,
  database: process.env.MAPSERVICE_DB_NAME || "barrier_free_db",
});

function uuidToBuffer(uuid) {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

async function sendConfiguredHtml(res, filename) {
  try {
    const html = await fs.readFile(path.join(__dirname, filename), "utf8");
    res.type("html").send(html.replace(/__KAKAO_KEY__/g, KAKAO_MAP_JS_KEY));
  } catch (error) {
    res.status(500).send(`Page load failed: ${error.message}`);
  }
}

app.get(["/", "/index.html"], (req, res) => sendConfiguredHtml(res, "index.html"));
app.get("/report.html", (req, res) => sendConfiguredHtml(res, "report.html"));

app.use(express.static(__dirname));

app.use("/map-admin", express.static(MAPSERVICE_ADMIN_DIR));
app.use("/images", express.static(MAPSERVICE_IMAGES_DIR));
app.use("/panoramas", express.static(MAPSERVICE_PANORAMAS_DIR));
app.use("/panoramas", express.static(path.join(MAPSERVICE_PROJECT_DIR, "Test", "panoramas")));

app.get("/admin", async (req, res) => {
  try {
    let html = await fs.readFile(
      path.join(MAPSERVICE_ADMIN_DIR, "graphManager2.html"),
      "utf-8"
    );

    html = html
      .replace(/href="graphManager2\.css"/g, 'href="/map-admin/graphManager2.css"')
      .replace(/src="graphManager2\.js"/g, 'src="/map-admin/graphManager2.js"')
      .replace(/src="adminPanel\.js"/g, 'src="/map-admin/adminPanel.js"')
      .replace(/__KAKAO_KEY__/g, KAKAO_MAP_JS_KEY);

    res.type("html").send(html);
  } catch (error) {
    res.status(500).send(`Admin page load failed: ${error.message}`);
  }
});

// ================= 테스트 API =================

app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    message: "API 연결 성공!",
  });
});

async function readAuthUsers() {
  try {
    const raw = await fs.readFile(AUTH_USERS_FILE, "utf8");
    const users = JSON.parse(raw);
    return Array.isArray(users) ? users : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeAuthUsers(users) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(AUTH_USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function publicAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname || user.email.split("@")[0],
    userType: user.userType || "Requester",
    provider: user.provider || "email",
  };
}

function createAuthResult(user) {
  return {
    ok: true,
    token: randomBytes(32).toString("hex"),
    user: publicAuthUser(user),
  };
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return {
    salt,
    passwordHash: scryptSync(password, salt, 64).toString("hex"),
  };
}

function passwordMatches(password, user) {
  if (!user.salt || !user.passwordHash) return false;
  const actual = scryptSync(password, user.salt, 64);
  const expected = Buffer.from(user.passwordHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

app.post("/api/auth/signup", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const nickname = String(req.body.nickname || "").trim();

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "올바른 이메일 주소를 입력해주세요." });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: "비밀번호는 6자 이상이어야 합니다." });
    }
    if (!nickname) {
      return res.status(400).json({ ok: false, error: "닉네임을 입력해주세요." });
    }

    const users = await readAuthUsers();
    if (users.some((user) => user.email === email)) {
      return res.status(409).json({ ok: false, error: "이미 가입된 이메일입니다." });
    }

    const user = {
      id: randomUUID(),
      email,
      nickname,
      userType: req.body.userType || "Requester",
      provider: "email",
      ...hashPassword(password),
    };
    users.push(user);
    await writeAuthUsers(users);
    return res.status(201).json(createAuthResult(user));
  } catch (error) {
    console.error("회원가입 실패:", error);
    return res.status(500).json({ ok: false, error: "회원가입 처리 중 오류가 발생했습니다." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const users = await readAuthUsers();
    const user = users.find((item) => item.email === email && item.provider === "email");

    if (!user || !passwordMatches(password, user)) {
      return res.status(401).json({ ok: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }
    return res.json(createAuthResult(user));
  } catch (error) {
    console.error("로그인 실패:", error);
    return res.status(500).json({ ok: false, error: "로그인 처리 중 오류가 발생했습니다." });
  }
});

app.get("/api/auth/google-client-id", (req, res) => {
  res.json({ ok: true, clientId: GOOGLE_CLIENT_ID });
});

app.post("/api/auth/google", async (req, res) => {
  try {
    const accessToken = String(req.body.accessToken || "");
    const idToken = String(req.body.idToken || "");
    if (!GOOGLE_CLIENT_ID || (!accessToken && !idToken)) {
      return res.status(503).json({ ok: false, error: "Google 로그인이 설정되지 않았습니다." });
    }

    const response = idToken
      ? await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`)
      : await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
    const profile = await response.json();
    if (
      !response.ok ||
      !profile.email ||
      (idToken && profile.aud !== GOOGLE_CLIENT_ID) ||
      (idToken && String(profile.email_verified) !== "true")
    ) {
      return res.status(401).json({ ok: false, error: "Google 계정을 확인할 수 없습니다." });
    }

    const email = String(profile.email).toLowerCase();
    const users = await readAuthUsers();
    let user = users.find((item) => item.email === email);
    if (!user) {
      user = {
        id: randomUUID(),
        email,
        nickname: profile.name || email.split("@")[0],
        userType: req.body.userType || "Requester",
        provider: "google",
        providerUserId: profile.sub,
      };
      users.push(user);
      await writeAuthUsers(users);
    }
    return res.json(createAuthResult(user));
  } catch (error) {
    console.error("Google 로그인 실패:", error);
    return res.status(500).json({ ok: false, error: "Google 로그인 처리 중 오류가 발생했습니다." });
  }
});

// ================= 테스트 사용자 생성 API =================

app.post("/api/test-users", async (req, res) => {
  try {
    const { email, nickname, provider, providerUserId } = req.body;

    if (!email || !provider || !providerUserId) {
      return res.status(400).json({
        ok: false,
        error: "email, provider, providerUserId가 필요합니다.",
      });
    }

    const userId = randomUUID();

    await db.execute(
      `
      INSERT INTO users (id, email, nickname)
      VALUES (?, ?, ?)
      `,
      [uuidToBuffer(userId), email, nickname || null]
    );

    await db.execute(
      `
      INSERT INTO user_auth_providers
        (user_id, provider, provider_user_id, provider_email)
      VALUES (?, ?, ?, ?)
      `,
      [uuidToBuffer(userId), provider, providerUserId, email]
    );

    res.json({
      ok: true,
      user: {
        id: userId,
        email,
        nickname,
        provider,
      },
    });
  } catch (error) {
    console.error("사용자 생성 실패:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ================= ORS 경로 API =================

app.get("/api/walking-route", async (req, res) => {
  try {
    const origin = {
      x: req.query.ox,
      y: req.query.oy,
    };

    const destination = {
      x: req.query.dx,
      y: req.query.dy,
    };

    if (!origin.x || !origin.y || !destination.x || !destination.y) {
      return res.status(400).json({
        ok: false,
        error: "ox, oy, dx, dy 값이 필요합니다.",
      });
    }

    const routeData = await fetchWalkingRouteFromORS(origin, destination);
    const coords = routeData.features[0].geometry.coordinates;

    const routePath = coords.map(([lng, lat]) => ({
      lat,
      lng,
    }));

    let hitZones = [];

    try {
      const rawReports = await fetchDangerReportsFromMapService();
      const dangerZones = normalizeDangerZones(rawReports);
      hitZones = findDangerZonesOnRoute(routePath, dangerZones);
    } catch (err) {
      console.warn("MapService 생략:", err.message);
    }

    res.json({
      ok: true,
      summary: {
        distance: routeData.features[0].properties.summary.distance,
        duration: routeData.features[0].properties.summary.duration,
      },
      path: routePath,
      dangerZones: hitZones,
      dangerCount: hitZones.length,
    });
  } catch (err) {
    console.error("ORS 경로 오류:", err);

    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

app.get("/api/weather", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({
        ok: false,
        error: "lat, lng 값이 필요합니다.",
      });
    }

    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.searchParams.set("latitude", String(lat));
    weatherUrl.searchParams.set("longitude", String(lng));
    weatherUrl.searchParams.set(
      "current",
      [
        "temperature_2m",
        "apparent_temperature",
        "precipitation",
        "rain",
        "snowfall",
        "weather_code",
        "wind_speed_10m",
      ].join(",")
    );
    weatherUrl.searchParams.set(
      "daily",
      [
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_probability_max",
        "precipitation_sum",
      ].join(",")
    );
    weatherUrl.searchParams.set("forecast_days", "1");
    weatherUrl.searchParams.set("timezone", "auto");

    const response = await fetch(weatherUrl);
    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: text,
      });
    }

    const data = JSON.parse(text);
    const current = data.current || {};
    const daily = data.daily || {};
    const code = Number(current.weather_code);

    res.json({
      ok: true,
      weather: {
        temperature: roundWeatherValue(current.temperature_2m),
        apparentTemperature: roundWeatherValue(current.apparent_temperature),
        windSpeed: roundWeatherValue(current.wind_speed_10m),
        precipitation: roundWeatherValue(current.precipitation),
        rain: roundWeatherValue(current.rain),
        snowfall: roundWeatherValue(current.snowfall),
        precipitationProbability: daily.precipitation_probability_max?.[0] ?? null,
        temperatureMax: roundWeatherValue(daily.temperature_2m_max?.[0]),
        temperatureMin: roundWeatherValue(daily.temperature_2m_min?.[0]),
        code,
        label: weatherCodeLabel(code),
        icon: weatherCodeIcon(code),
        time: current.time || null,
      },
    });
  } catch (err) {
    console.error("Open-Meteo weather error:", err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

async function fetchWalkingRouteFromORS(origin, destination) {
  if (!ORS_API_KEY) {
    throw new Error("ORS_API_KEY가 .env에 설정되지 않았습니다.");
  }

  const response = await fetch(
    "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
    {
      method: "POST",
      headers: {
        Authorization: ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: [
          [Number(origin.x), Number(origin.y)],
          [Number(destination.x), Number(destination.y)],
        ],
      }),
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text);
  }

  return JSON.parse(text);
}

// ================= 배리어프리 키오스크 API =================

async function buildOrsAccessRoute(startName, destinationName, startPoint, destinationPoint) {
  const routeData = await fetchWalkingRouteFromORS(
    { x: startPoint.lng, y: startPoint.lat },
    { x: destinationPoint.lng, y: destinationPoint.lat }
  );
  const feature = routeData.features?.[0];
  const coords = feature?.geometry?.coordinates || [];
  const summary = feature?.properties?.summary || {};
  const routePath = coords.map(([lng, lat], index) => ({
    id: `ors-${index}`,
    name:
      index === 0
        ? startName || "출발지"
        : index === coords.length - 1
          ? destinationName || "목적지"
          : "도보 경로",
    lat,
    lng,
    type: "path",
  }));

  let hitZones = [];

  try {
    const rawReports = await fetchDangerReportsFromMapService();
    const dangerZones = normalizeDangerZones(rawReports);
    hitZones = findDangerZonesOnRoute(routePath, dangerZones);
  } catch (err) {
    console.warn("MapService 위험 구간 조회 실패:", err.message);
  }

  let routeFeatures = {
    stairs: 0,
    ramps: 0,
    elevators: 0,
    crosswalks: 0,
  };

  try {
    const graphData = await loadMapServiceGraph();
    routeFeatures = estimateRouteFeaturesFromGraph(routePath, graphData);
  } catch (err) {
    console.warn("MapService 경로 시설 개수 조회 실패:", err.message);
  }

  const dangerPath = routePath.map((point) => ({
    ...point,
    type: hitZones.some(
      (zone) => getDistance(point.lat, point.lng, zone.lat, zone.lng) <= zone.radius
    )
      ? "danger"
      : point.type,
  }));

  return {
    ok: true,
    source: "ors",
    start: {
      id: "ors-start",
      name: startName || "출발지",
      lat: startPoint.lat,
      lng: startPoint.lng,
    },
    destination: {
      id: "ors-destination",
      name: destinationName || "목적지",
      lat: destinationPoint.lat,
      lng: destinationPoint.lng,
    },
    routes: [
      {
        id: "walking",
        title: "도보 경로",
        distance: Math.round(Number(summary.distance || 0)),
        duration: Math.max(1, Math.ceil(Number(summary.duration || 0) / 60)),
        dangerCount: routeFeatures.stairs + hitZones.length,
        dangerZones: hitZones,
        features: routeFeatures,
        path: dangerPath,
      },
    ],
  };
}


app.get("/api/barrier-free-kiosks", async (req, res) => {
  try {
    const apiUrl = process.env.KIOSK_API_URL;
    const apiKey = process.env.KIOSK_API_KEY;

    if (!apiUrl || !apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KIOSK_API_URL 또는 KIOSK_API_KEY가 .env에 설정되지 않았습니다.",
      });
    }

    const url = new URL(apiUrl);
    url.searchParams.set("query", req.query.query || "서울특별시");
    url.searchParams.set("keyword", req.query.keyword || "");
    url.searchParams.set("page", req.query.page || "1");
    url.searchParams.set("size", req.query.size || "100");

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json;charset=UTF-8",
      },
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: text,
      });
    }

    const raw = JSON.parse(text);

    res.json({
      ok: true,
      totalCount: raw.kioskTotalCount || 0,
      items: normalizeKioskItems(raw.kioskList || []),
    });
  } catch (error) {
    console.error("배리어프리 키오스크 API 오류:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

function normalizeKioskItems(list) {
  return list
    .map((item) => ({
      name: item.kioskName || "배리어프리 키오스크",
      locationName: item.locationName || "",
      categoryMain: item.categoryMain || item.catergoryMain || "",
      categorySub: item.categorySub || "",
      address: item.roadFullAddr || "",
      lng: Number(item.xLong),
      lat: Number(item.yLat),
      accessType: item.accessType || "",
      raw: item,
    }))
    .filter((item) => !Number.isNaN(item.lat) && !Number.isNaN(item.lng));
}

// ================= 택시 승강장 API =================

app.get("/api/taxi-stands", async (req, res) => {
  try {
    const apiUrl = process.env.TAXI_STAND_API_URL;
    const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;

    if (!apiUrl || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error: "TAXI_STAND_API_URL 또는 DATA_GO_KR_SERVICE_KEY가 .env에 없습니다.",
      });
    }

    const url = new URL(apiUrl);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("pageNo", req.query.pageNo || "1");
    url.searchParams.set("numOfRows", req.query.numOfRows || "100");
    url.searchParams.set("type", "json");

    if (req.query.ctpv) {
      url.searchParams.set("CTPV_NM", req.query.ctpv);
    }

    if (req.query.sgg) {
      url.searchParams.set("SGG_NM", req.query.sgg);
    }

    const response = await fetch(url);
    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: text,
      });
    }

    const raw = JSON.parse(text);
    const items = raw.response?.body?.items?.item || [];

    res.json({
      ok: true,
      totalCount: raw.response?.body?.totalCount || 0,
      items: normalizeTaxiStandItems(Array.isArray(items) ? items : [items]),
    });
  } catch (error) {
    console.error("택시 승강장 API 오류:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

function normalizeTaxiStandItems(items) {
  return items.map((item) => ({
    id: item.MNG_NO || "",
    name: item.DTL_PSTN || "택시 승강장",
    sido: item.CTPV_NM || "",
    sigungu: item.SGG_NM || "",
    roadAddress: item.LCTN_ROAD_NM_ADDR || "",
    lotAddress: item.LCTN_LOTNO_ADDR || "",
    parkingCount: item.TAX_EXCLS_SCPLC_CNT || "",
    date: item.DATA_CRTR_YMD || "",
    raw: item,
  }));
}

// ================= 위험구간 옵션 기능 =================

const MAPSERVICE_BASE_URL =
  process.env.MAPSERVICE_BASE_URL || "http://localhost:8080";

const MAPSERVICE_REPORTS_ENDPOINT =
  process.env.MAPSERVICE_REPORTS_ENDPOINT || "/api/reports";

const MAPSERVICE_ACCESSIBILITY_REPORTS_ENDPOINT =
  process.env.MAPSERVICE_ACCESSIBILITY_REPORTS_ENDPOINT || "";

const MAPSERVICE_PLACE_ACCESSIBILITY_ENDPOINT =
  process.env.MAPSERVICE_PLACE_ACCESSIBILITY_ENDPOINT || "";

async function handlePlacePhoto(req, res) {
  try {
    const id = String(req.query.id || "").trim();
    const name = String(req.query.name || "").trim();
    const address = String(req.query.address || "").trim();
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const maxWidthPx = clampNumber(req.query.maxWidthPx, 160, 800, 360);

    if (!name) {
      return res.status(400).json({
        ok: false,
        error: "name is required.",
      });
    }

    const databasePhotos = await findMapServicePlacePhotos(id, name);
    if (!GOOGLE_PLACES_API_KEY) {
      return res.json({
        ok: true,
        photoUri: databasePhotos[0]?.photoUri || null,
        photos: databasePhotos,
        attributions: [],
      });
    }

    const cacheKey = [
      name,
      address,
      Number.isNaN(lat) ? "" : lat.toFixed(5),
      Number.isNaN(lng) ? "" : lng.toFixed(5),
      maxWidthPx,
    ].join("|");

    if (googlePhotoCache.has(cacheKey)) {
      const cached = googlePhotoCache.get(cacheKey);
      return res.json({
        ...cached,
        photoUri: databasePhotos[0]?.photoUri || cached.photoUri || null,
        photos: [...databasePhotos, ...(cached.photos || [])],
      });
    }

    // 정확한 POI 사진이 없을 때는 Google에서도 세부 노드명(예: 횡단보도_1_B)
    // 자체를 검색하지 않고, 건물/장소의 대표명으로 검색해 관련 대표 사진을 찾는다.
    const googleFallbackName = String(name || "")
      .split("_")[0]
      .replace(/한양여자대학교|한양여대/g, "")
      .trim() || name;
    const textQuery = [googleFallbackName, address].filter(Boolean).join(" ");
    const searchBody = {
      textQuery,
      languageCode: "ko",
      maxResultCount: 1,
    };

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      searchBody.locationBias = {
        circle: {
          center: {
            latitude: lat,
            longitude: lng,
          },
          radius: 120,
        },
      };
    }

    const searchResponse = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.photos,places.formattedAddress",
        },
        body: JSON.stringify(searchBody),
      }
    );
    const searchText = await searchResponse.text();

    if (!searchResponse.ok) {
      return res.status(searchResponse.status).json({
        ok: false,
        error: searchText,
      });
    }

    const searchData = JSON.parse(searchText);
    const place = searchData.places?.[0];
    const googlePhotos = place?.photos?.slice(0, 5) || [];

    if (!googlePhotos.length) {
      const emptyResult = { ok: true, photoUri: null, photos: [], attributions: [] };
      googlePhotoCache.set(cacheKey, emptyResult);
      return res.json({
        ...emptyResult,
        photoUri: databasePhotos[0]?.photoUri || null,
        photos: databasePhotos,
      });
    }

    const resolvedGooglePhotos = (
      await Promise.all(googlePhotos.map(async (photo) => {
        const photoUrl = new URL(`https://places.googleapis.com/v1/${photo.name}/media`);
        photoUrl.searchParams.set("maxWidthPx", String(maxWidthPx));
        photoUrl.searchParams.set("skipHttpRedirect", "true");
        photoUrl.searchParams.set("key", GOOGLE_PLACES_API_KEY);
        const photoResponse = await fetch(photoUrl);
        if (!photoResponse.ok) return null;
        const photoData = await photoResponse.json();
        return {
          photoUri: photoData.photoUri || null,
          source: "google",
          label: "Google 장소 사진",
          attributions: photo.authorAttributions || [],
        };
      }))
    ).filter((photo) => photo?.photoUri);

    const result = {
      ok: true,
      photoUri: resolvedGooglePhotos[0]?.photoUri || null,
      photos: resolvedGooglePhotos,
      attributions: resolvedGooglePhotos[0]?.attributions || [],
      place: {
        id: place.id,
        name: place.displayName?.text || name,
        address: place.formattedAddress || address,
      },
    };

    googlePhotoCache.set(cacheKey, result);
    return res.json({
      ...result,
      photoUri: databasePhotos[0]?.photoUri || result.photoUri || null,
      photos: [...databasePhotos, ...resolvedGooglePhotos],
    });
  } catch (error) {
    console.error("Google place photo error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

async function findMapServicePlacePhotos(id, rawName) {
  try {
    const poiId = String(id || "").trim();

    // MapService POI 사진은 이름이 아니라 정확한 poi_id를 기준으로 매칭한다.
    // 이름 일부 검색은 "정보문화관_횡단보도_1_A"가 "정보문화관" 건물 사진으로
    // 잘못 연결되는 문제를 만들 수 있으므로, ID가 전달된 경우에는 이름 검색을 하지 않는다.
    if (poiId) {
      const [rows] = await mapServiceDb.execute(
        `
        SELECT poi_id, poi_name, poi_type, photo_url
        FROM poi
        WHERE poi_id = ?
        LIMIT 1
        `,
        [poiId]
      );

      const row = rows[0];
      if (row) {
        let photoUri = normalizeMapServicePhotoUrl(row.photo_url);

        // DB photo_url이 아직 없는 기존 데이터는
        // node_<poi_id> 파일명 규칙으로 같은 POI의 사진을 찾는다.
        if (!photoUri) {
          const inferredName = `node_${row.poi_id}.jpg`;
          try {
            await fs.access(path.join(MAPSERVICE_PANORAMAS_DIR, inferredName));
            photoUri = `/panoramas/${inferredName}`;
          } catch {
            photoUri = null;
          }
        }

        if (photoUri) {
          return [
            {
              photoUri: resolveMapServicePhotoUrl(photoUri),
              source: "mapservice",
              label:
                row.poi_type === "entrance"
                  ? `${row.poi_name} 입구`
                  : row.poi_name,
              attributions: [],
            },
          ];
        }

        // 건물 자체에 사진이 없으면, building_entrance 관계로 연결된
        // 출입구 중 사진이 있는 것을 대표 사진으로 사용한다.
        const [entranceRows] = await mapServiceDb.execute(
          `
          SELECT e.poi_id, e.poi_name, e.poi_type, e.photo_url
          FROM building_entrance be
          JOIN poi e ON e.poi_id = be.entrance_poi_id
          WHERE be.building_poi_id = ?
            AND e.photo_url IS NOT NULL
            AND TRIM(e.photo_url) <> ''
          ORDER BY CASE WHEN e.poi_type = 'entrance' THEN 0 ELSE 1 END, e.poi_name
          LIMIT 1
          `,
          [row.poi_id]
        );

        const entranceRow = entranceRows[0];
        if (entranceRow) {
          let entrancePhotoUri = normalizeMapServicePhotoUrl(entranceRow.photo_url);
          if (entrancePhotoUri) {
            return [
              {
                photoUri: resolveMapServicePhotoUrl(entrancePhotoUri),
                source: "mapservice-building-fallback",
                label: `${entranceRow.poi_name} 입구`,
                attributions: [],
              },
            ];
          }
        }
      }

      // 정확한 poi_id에 사진이 없는 경우 다른 POI의 DB 사진을 이름으로
      // 가져오지 않는다. 잘못된 건물 사진이 섞이는 것을 막고 Google fallback으로 넘긴다.
      return [];
    }

    // poi_id가 없는 레거시/외부 요청만 정확한 이름 기준으로 제한적으로 fallback한다.
    const rawPoiName = String(rawName || "").trim();
    const normalizedName = normalizePlaceName(rawPoiName);
    if (!rawPoiName || !normalizedName) return [];

    const [rows] = await mapServiceDb.execute(
      `
      SELECT poi_id, poi_name, poi_type, photo_url
      FROM poi
      WHERE poi_name = ?
         OR REPLACE(REPLACE(REPLACE(poi_name, '_', ''), ' ', ''), '-', '') = ?
      ORDER BY poi_name = ? DESC
      LIMIT 1
      `,
      [rawPoiName, normalizedName, rawPoiName]
    );

    const row = rows[0];
    if (!row) return [];

    let photoUri = normalizeMapServicePhotoUrl(row.photo_url);
    if (!photoUri) {
      const inferredName = `node_${row.poi_id}.jpg`;
      try {
        await fs.access(path.join(MAPSERVICE_PANORAMAS_DIR, inferredName));
        photoUri = `/panoramas/${inferredName}`;
      } catch {
        return [];
      }
    }

    return [
      {
        photoUri: resolveMapServicePhotoUrl(photoUri),
        source: "mapservice",
        label:
          row.poi_type === "entrance"
            ? `${row.poi_name} 입구`
            : row.poi_name,
        attributions: [],
      },
    ];
  } catch (error) {
    console.warn("MapService place photo lookup failed:", error.message);
    return [];
  }
}

function normalizeMapServicePhotoUrl(value) {
  const photoUrl = String(value || "").trim().replaceAll("\\\\", "/");
  if (!photoUrl) return null;
  if (/^https?:\/\//i.test(photoUrl) || photoUrl.startsWith("data:")) return photoUrl;
  if (photoUrl.startsWith("/")) return photoUrl;
  if (photoUrl.startsWith("panoramas/") || photoUrl.startsWith("images/")) return `/${photoUrl}`;
  return `/panoramas/${path.basename(photoUrl)}`;
}

function resolveMapServicePhotoUrl(photoUrl) {
  if (!photoUrl) return null;
  if (/^https?:\/\//i.test(photoUrl) || photoUrl.startsWith("data:")) {
    return photoUrl;
  }
  return `${MAPSERVICE_BASE_URL}${photoUrl.startsWith("/") ? "" : "/"}${photoUrl}`;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function roundWeatherValue(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return Math.round(parsed * 10) / 10;
}

function weatherCodeLabel(code) {
  if (code === 0) return "맑음";
  if ([1, 2].includes(code)) return "구름 조금";
  if (code === 3) return "흐림";
  if ([45, 48].includes(code)) return "안개";
  if ([51, 53, 55, 56, 57].includes(code)) return "이슬비";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "비";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "눈";
  if ([95, 96, 99].includes(code)) return "뇌우";
  return "날씨";
}

function weatherCodeIcon(code) {
  if (code === 0) return "맑음";
  if ([1, 2, 3].includes(code)) return "구름";
  if ([45, 48].includes(code)) return "안개";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return "비";
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "눈";
  if ([95, 96, 99].includes(code)) return "번개";
  return "날씨";
}

async function readJsonFile(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizePlaceKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function placeKeyFromPayload(payload = {}) {
  const name = normalizePlaceKeyPart(payload.placeName || payload.name);
  const address = normalizePlaceKeyPart(payload.address);

  if (name || address) {
    return `${name}|${address}`;
  }

  const lat = Number(payload.y ?? payload.lat);
  const lng = Number(payload.x ?? payload.lng);
  if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
    return `coord:${lat.toFixed(5)},${lng.toFixed(5)}`;
  }

  return "";
}

function accessibilityLabelFromStatus(status) {
  if (status === "accessible") return "휠체어 진입 가능";
  if (status === "not_accessible") return "휠체어 진입 어려움";
  return "휠체어 진입 정보 확인 필요";
}

function normalizeAccessibilityStatus(status) {
  const value = String(status || "").trim();
  if (["accessible", "not_accessible", "unknown"].includes(value)) return value;
  return "unknown";
}

function mapServiceUrl(endpoint) {
  if (!endpoint) return null;
  return new URL(endpoint, MAPSERVICE_BASE_URL).toString();
}

async function fetchMapServiceJson(endpoint, options = {}) {
  const url = mapServiceUrl(endpoint);
  if (!url) return null;

  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || data?.message || text || "MapService 요청에 실패했습니다.");
  }

  return data;
}

async function handlePlaceAccessibility(req, res) {
  try {
    const key = placeKeyFromPayload(req.query);
    if (!key) {
      return res.status(400).json({ ok: false, error: "place name or coordinate is required." });
    }

    if (!MAPSERVICE_PLACE_ACCESSIBILITY_ENDPOINT) {
      return res.status(503).json({
        ok: false,
        error: "MapService place accessibility endpoint is not configured.",
      });
    }

    if (MAPSERVICE_PLACE_ACCESSIBILITY_ENDPOINT) {
      const url = new URL(mapServiceUrl(MAPSERVICE_PLACE_ACCESSIBILITY_ENDPOINT));
      url.searchParams.set("name", req.query.name || req.query.placeName || "");
      url.searchParams.set("address", req.query.address || "");
      url.searchParams.set("lat", req.query.lat || req.query.y || "");
      url.searchParams.set("lng", req.query.lng || req.query.x || "");

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || "MapService 접근성 조회에 실패했습니다.");
      }

      const status = normalizeAccessibilityStatus(data.status || data.wheelchairAccess);
      return res.json({
        ok: true,
        status,
        label: data.label || accessibilityLabelFromStatus(status),
        verified: Boolean(data.verified ?? data.record),
        record: data.record || data,
        source: "mapservice",
      });
    }

    const places = await readJsonFile(PLACE_ACCESSIBILITY_FILE, {});
    const record = places[key] || null;

    return res.json({
      ok: true,
      status: record?.status || "unknown",
      label: accessibilityLabelFromStatus(record?.status),
      verified: Boolean(record),
      record,
      source: "local",
    });
  } catch (error) {
    console.error("Accessibility lookup error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

async function handleCreateAccessibilityReport(req, res) {
  try {
    const placeName = String(req.body.placeName || req.body.name || "").trim();
    const address = String(req.body.address || "").trim();
    const key = placeKeyFromPayload(req.body);

    if (!key) {
      return res.status(400).json({ ok: false, error: "placeName 또는 위치 정보가 필요합니다." });
    }

    const report = {
      id: randomUUID(),
      placeKey: key,
      placeName,
      address,
      x: req.body.x ?? req.body.lng ?? null,
      y: req.body.y ?? req.body.lat ?? null,
      type: String(req.body.type || "").trim(),
      slope: req.body.slope || "",
      wheelchairAccess: normalizeAccessibilityStatus(req.body.wheelchairAccess),
      detail: String(req.body.detail || "").trim(),
      imageData: typeof req.body.imageData === "string" ? req.body.imageData : "",
      status: "pending",
      createdAt: new Date().toISOString(),
      reviewedAt: null,
    };

    if (!MAPSERVICE_ACCESSIBILITY_REPORTS_ENDPOINT) {
      return res.status(503).json({
        ok: false,
        error: "MapService accessibility reports endpoint is not configured.",
      });
    }

    if (MAPSERVICE_ACCESSIBILITY_REPORTS_ENDPOINT) {
      const data = await fetchMapServiceJson(MAPSERVICE_ACCESSIBILITY_REPORTS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(report),
      });

      return res.status(201).json({
        ok: true,
        report: data?.report || data || report,
        source: "mapservice",
      });
    }

    const reports = await readJsonFile(ACCESSIBILITY_REPORTS_FILE, []);

    reports.unshift(report);
    await writeJsonFile(ACCESSIBILITY_REPORTS_FILE, reports);

    return res.status(201).json({ ok: true, report, source: "local" });
  } catch (error) {
    console.error("Accessibility report create error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}


async function fetchDangerReportsFromMapService() {
  const url = `${MAPSERVICE_BASE_URL}${MAPSERVICE_REPORTS_ENDPOINT}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    return Array.isArray(data) ? data : data.data || [];
  } catch {
    return [];
  }
}

function normalizeDangerZones(rawReports) {
  return rawReports
    .map((r) => ({
      lat: Number(r.latitude ?? r.lat),
      lng: Number(r.longitude ?? r.lng),
      radius: 25,
    }))
    .filter((z) => !Number.isNaN(z.lat) && !Number.isNaN(z.lng));
}

function findDangerZonesOnRoute(routePath, zones) {
  return zones.filter((zone) =>
    routePath.some(
      (p) => getDistance(p.lat, p.lng, zone.lat, zone.lng) <= zone.radius
    )
  );
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

// ================= 정적 파일 제공 =================
// API 라우트들을 먼저 등록한 뒤 HTML/CSS/JS 파일을 제공함

app.use(express.static(__dirname));

// ================= API 404 처리 =================
// API 주소가 잘못됐을 때 HTML 대신 JSON으로 응답

app.get("/api/access-routes", handleAccessRoutes);
app.get("/api/access-places", handleAccessPlaces);
app.get("/api/place-photo", handlePlacePhoto);
app.get("/api/place-accessibility", handlePlaceAccessibility);
app.post("/api/accessibility-reports", handleCreateAccessibilityReport);

app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    error: `API 라우트를 찾을 수 없습니다: ${req.method} ${req.originalUrl}`,
  });
});

// ================= 서버 실행 =================

app.listen(PORT, () => {
  console.log("=== 새 서버 실행 성공 ===");
  console.log(`AccessNav backend running on http://localhost:${PORT}`);
  console.log("등록 확인: GET  /api/test");
  console.log("등록 확인: POST /api/test-users");
});

async function handleAccessRoutes(req, res) {
  const startName = req.query.startName || req.query.from || "";
  const destinationName = req.query.name || req.query.to || "";
  const startPoint = toPoint(req.query.startY, req.query.startX);
  const destinationPoint = toPoint(req.query.y, req.query.x);
  const mobilityType = normalizeMobilityType(req.query.mobilityType);

  try {
    if (
      startPoint &&
      destinationPoint &&
      ["현재위치", "내위치"].includes(normalizePlaceName(startName))
    ) {
      return res.json(
        await buildOrsAccessRoute(startName, destinationName, startPoint, destinationPoint)
      );
    }
    let graphData;
    try {
      graphData = await loadMapServiceGraph();
    } catch (databaseError) {
      console.error("MapService route database error:", databaseError);
      if (startPoint && destinationPoint) {
        return res.json(
          await buildOrsAccessRoute(
            startName,
            destinationName,
            startPoint,
            destinationPoint
          )
        );
      }
      return res.status(503).json({
        ok: false,
        error: "경로 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
    }
    const startTarget = findRouteTarget(graphData, startName, startPoint);
    const destinationTarget = findRouteTarget(
      graphData,
      destinationName,
      destinationPoint
    );

    if (!startTarget || !destinationTarget) {
      if (startPoint && destinationPoint) {
        const orsRoute = await buildOrsAccessRoute(
          startName,
          destinationName,
          startPoint,
          destinationPoint
        );
        return res.json(orsRoute);
      }

      return res.status(404).json({
        ok: false,
        error: "출발지 또는 목적지를 MapService POI 데이터에서 찾을 수 없습니다.",
        candidates: [
          ...graphData.buildings.map((building) => building.name),
          ...graphData.nodes.map((node) => node.name),
        ],
      });
    }
    if (startTarget.id === destinationTarget.id) {
      if (
        startPoint &&
        destinationPoint &&
        getDistance(
          startPoint.lat,
          startPoint.lng,
          destinationPoint.lat,
          destinationPoint.lng
        ) > 15
      ) {
        const orsRoute = await buildOrsAccessRoute(
          startName,
          destinationName,
          startPoint,
          destinationPoint
        );
        return res.json(orsRoute);
      }

      return res.status(400).json({
        ok: false,
        error: "출발지와 목적지가 같습니다.",
      });
    }
    const shortest = findTargetPath(
      startTarget,
      destinationTarget,
      graphData,
      { mobilityType, optimize: "distance" }
    );
    const accessible = findTargetPath(
      startTarget,
      destinationTarget,
      graphData,
      { mobilityType, optimize: "accessible" }
    );

    const routes = [
      formatAccessRoute("accessible", "추천 경로", accessible, graphData),
      formatAccessRoute("shortest", "조건 내 최단 경로", shortest, graphData),
    ].filter((route, index, items) =>
      route && items.findIndex((item) =>
        item?.path?.map((point) => point.id).join("|") ===
        route.path.map((point) => point.id).join("|")
      ) === index
    );

    if (!routes.length) {
      if (startPoint && destinationPoint) {
        return res.json(
          await buildOrsAccessRoute(
            startName,
            destinationName,
            startPoint,
            destinationPoint
          )
        );
      }
      return res.status(404).json({
        ok: false,
        error: "사용 가능한 도보 경로가 없습니다.",
      });
    }

    res.json({
      ok: true,
      source: "mapservice",
      mobilityType,
      start: summarizeRouteTarget(startTarget, graphData),
      destination: summarizeRouteTarget(destinationTarget, graphData),
      routes,
    });
  } catch (error) {
    console.error("Access route error:", error);
    res.status(500).json({
      ok: false,
      error: "경로 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
}

async function handleAccessPlaces(req, res) {
  try {
    const query = normalizePlaceName(req.query.query || "");
    const searchPoint = toPoint(req.query.lat, req.query.lng);
    const entranceSearch = ["입구", "출입구", "정문", "후문", "쪽문"]
      .map(normalizePlaceName)
      .includes(query);
    if (!query) {
      return res.json({ ok: true, items: [] });
    }

    const graphData = await loadMapServiceGraph();
    const items = [
      ...graphData.buildings.map((building) => ({
        id: building.id,
        place_name: building.name,
        address_name: "MapService 건물",
        road_address_name: "",
        x: building.lng,
        y: building.lat,
        source: "mapservice",
      })),
      ...graphData.nodes.map((node) => ({
        id: node.id,
        place_name: node.name,
        address_name: `MapService POI · ${node.type}`,
        road_address_name: "",
        x: node.lng,
        y: node.lat,
        source: "mapservice",
        poi_type: node.type,
      })),
    ]
      .filter((item) => {
        return (
          placeMatchesQuery(item, query) ||
          (entranceSearch && item.poi_type === "entrance")
        );
      })
      .sort((a, b) => {
        if (entranceSearch && searchPoint) {
          return (
            getDistance(searchPoint.lat, searchPoint.lng, Number(a.y), Number(a.x)) -
            getDistance(searchPoint.lat, searchPoint.lng, Number(b.y), Number(b.x))
          );
        }
        return placeSearchScore(b, query) - placeSearchScore(a, query);
      });

    res.json({
      ok: true,
      items: items.slice(0, entranceSearch ? 100 : 20),
    });
  } catch (error) {
    console.error("Access places error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

function placeSearchScore(item, query) {
  const names = searchNamesForPlace(item);
  let score = 0;

  if (names.some((name) => name === query)) score += 100;
  if (names.some((name) => name.startsWith(query))) score += 50;
  if (String(item.id).startsWith("virtual-building:") && names.some((name) => name === query)) {
    score += 40;
  }
  if (item.source === "mapservice" && !String(item.id).startsWith("virtual-building:")) {
    score += 20;
  }
  if (names.some((name) => name.includes(query))) score += 10;

  return score;
}

function placeMatchesQuery(item, query) {
  return searchNamesForPlace(item).some(
    (name) =>
      name.includes(query) || (!isGenericEntranceQuery(name) && query.includes(name))
  );
}

function isGenericEntranceQuery(value) {
  return ["정문", "쪽문", "후문", "입구", "출입구"].includes(
    String(value || "")
  );
}

function searchNamesForPlace(item) {
  const rawName = String(item.place_name || "");
  const baseName = rawName.split("_")[0];
  const names = new Set([
    normalizePlaceName(rawName),
    normalizePlaceName(baseName),
  ]);

  if (item.address_name?.includes("entrance") || /정문|쪽문|입구|출입구/.test(rawName)) {
    names.add(normalizePlaceName(`${baseName} 입구`));
    names.add(normalizePlaceName(`${baseName} 출입구`));
    names.add(normalizePlaceName(`한양여자대학교 ${baseName} 입구`));
    names.add(normalizePlaceName(`한양여대 ${baseName} 입구`));
  }

  return [...names].filter(Boolean);
}

async function loadMapServiceGraph() {
  const [nodes] = await mapServiceDb.execute(
    `
    SELECT poi_id as id, poi_name as name,
      latitude as lat, longitude as lng, poi_type as type
    FROM poi
    WHERE poi_type != 'building'
    `
  );

  const [buildingRows] = await mapServiceDb.execute(
    `
    SELECT p.poi_id as id, p.poi_name as name,
      p.latitude as lat, p.longitude as lng, p.poi_type as type,
      be.entrance_poi_id
    FROM poi p
    JOIN building_entrance be
      ON p.poi_id COLLATE utf8mb4_unicode_ci = be.building_poi_id
    WHERE p.poi_type = 'building'
    `
  );

  const [edges] = await mapServiceDb.execute(
    `
    SELECT start_poi_id as \`from\`, end_poi_id as \`to\`,
      distance as weight, slope_degree as slope,
      effort_level as effort, path_width as pathWidth,
      is_active as isActive
    FROM path_connection
    `
  );

  const parsedNodes = nodes.map(parsePoiRow);
  const nodeMap = Object.fromEntries(parsedNodes.map((node) => [node.id, node]));
  const buildingMap = {};

  buildingRows.forEach((row) => {
    const id = String(row.id);
    if (!buildingMap[id]) {
      buildingMap[id] = {
        id,
        name: row.name,
        lat: Number(row.lat),
        lng: Number(row.lng),
        type: row.type,
        entrances: [],
      };
    }
    buildingMap[id].entrances.push(String(row.entrance_poi_id));
  });

  if (!Object.keys(buildingMap).length) {
    parsedNodes
      .filter((node) => node.type === "entrance")
      .forEach((node) => {
        const name = node.name.split("_")[0];
        const id = `virtual-building:${name}`;

        if (!buildingMap[id]) {
          buildingMap[id] = {
            id,
            name,
            lat: node.lat,
            lng: node.lng,
            type: "building",
            entrances: [],
          };
        }

        buildingMap[id].entrances.push(node.id);
      });

    Object.values(buildingMap).forEach((building) => {
      const entrances = building.entrances
        .map((id) => nodeMap[id])
        .filter(Boolean);

      if (!entrances.length) return;

      building.lat =
        entrances.reduce((sum, node) => sum + node.lat, 0) / entrances.length;
      building.lng =
        entrances.reduce((sum, node) => sum + node.lng, 0) / entrances.length;
    });
  }

  return {
    nodes: parsedNodes,
    nodeMap,
    buildings: Object.values(buildingMap),
    edges: edges.map((edge) => ({
      from: String(edge.from),
      to: String(edge.to),
      weight: Number(edge.weight),
      slope: edge.slope === null ? null : Number(edge.slope),
      effort: edge.effort === null ? null : Number(edge.effort),
      pathWidth: edge.pathWidth === null ? null : Number(edge.pathWidth),
      isActive: edge.isActive === null ? true : Boolean(edge.isActive),
    })),
  };
}

function parsePoiRow(row) {
  return {
    id: String(row.id),
    name: row.name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    type: row.type,
  };
}

function findBuilding(buildings, rawName, point) {
  const name = normalizePlaceName(rawName);
  const byName = buildings.find((building) => {
    const buildingName = normalizePlaceName(building.name);
    return name.includes(buildingName) || buildingName.includes(name);
  });

  if (byName) return byName;
  if (!point) return null;

  const nearest = buildings
    .map((building) => ({
      building,
      distance: getDistance(point.lat, point.lng, building.lat, building.lng),
    }))
    .sort((a, b) => a.distance - b.distance)[0];

  if (!nearest || nearest.distance > MAX_NEARBY_ROUTE_TARGET_DISTANCE) {
    return null;
  }

  return nearest.building;
}

function findRouteTarget(graphData, rawName, point) {
  if (!hasEntranceQualifier(rawName)) {
    const building = findBuilding(graphData.buildings, rawName, point);
    if (building) {
      return {
        ...building,
        nodeIds: preferredBuildingEntrances(building, graphData),
        queryPoint: point,
        type: "building",
      };
    }
  }

  const exactPoi = findPoiNode(graphData.nodes, rawName);
  if (exactPoi) {
    return {
      id: exactPoi.id,
      name: exactPoi.name,
      lat: exactPoi.lat,
      lng: exactPoi.lng,
      nodeIds: [exactPoi.id],
      queryPoint: point,
      type: "poi",
    };
  }

  const building = findBuilding(graphData.buildings, rawName, point);
  if (!building) return null;

  return {
    ...building,
    nodeIds: preferredBuildingEntrances(building, graphData),
    queryPoint: point,
    type: "building",
  };
}

function preferredBuildingEntrances(building, graphData) {
  return (building.entrances || []).filter((id) => graphData.nodeMap[id]);
}

function normalizeMobilityType(value) {
  return ["walking", "wheelchair", "stroller", "senior"].includes(value)
    ? value
    : "walking";
}

function mobilityProfile(type) {
  return {
    walking: { blockStairs: false, maxSlope: Infinity, minWidth: 0, slopePenalty: 0, effortPenalty: 0 },
    wheelchair: { blockStairs: true, maxSlope: 8.3, minWidth: 0.8, slopePenalty: 5, effortPenalty: 12 },
    stroller: { blockStairs: true, maxSlope: 12, minWidth: 0.75, slopePenalty: 3, effortPenalty: 7 },
    senior: { blockStairs: true, maxSlope: 10, minWidth: 0.7, slopePenalty: 4, effortPenalty: 10 },
  }[normalizeMobilityType(type)];
}

function hasEntranceQualifier(value) {
  return /정문|쪽문|후문|입구|출입구|경사로|계단|엘리베이터|횡단보도/.test(
    String(value || "")
  );
}

function findPoiNode(nodes, rawName) {
  const name = normalizePlaceName(rawName);
  if (!name) return null;

  const exact = nodes.find((node) => normalizePlaceName(node.name) === name);
  if (exact) return exact;

  return (
    nodes
      .map((node) => {
        const item = {
          id: node.id,
          place_name: node.name,
          address_name: `MapService POI · ${node.type}`,
          source: "mapservice",
        };

        return {
          node,
          score: placeMatchesQuery(item, name) ? placeSearchScore(item, name) : 0,
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.node || null
  );
}

function normalizePlaceName(value) {
  return String(value || "")
    .replace(/한양여자대학교|한양여대|서울특별시|성동구/g, "")
    .replace(/[\s_()\-]/g, "")
    .toLowerCase();
}

function toPoint(lat, lng) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) return null;
  return { lat: parsedLat, lng: parsedLng };
}

function findTargetPath(startTarget, destinationTarget, graphData, options) {
  let best = null;

  startTarget.nodeIds.forEach((startId) => {
    destinationTarget.nodeIds.forEach((endId) => {
      const route = dijkstra(startId, endId, graphData, options);
      const approachDistance = route
        ? distanceToQueryPoint(startTarget.queryPoint, graphData.nodeMap[startId]) +
          distanceToQueryPoint(destinationTarget.queryPoint, graphData.nodeMap[endId])
        : Infinity;
      const candidateScore = route ? route.score + approachDistance : Infinity;
      if (route && (!best || candidateScore < best.score)) {
        best = {
          ...route,
          score: candidateScore,
          approachDistance,
          fromEntrance: startId,
          toEntrance: endId,
        };
      }
    });
  });

  return best;
}

function distanceToQueryPoint(point, node) {
  if (!point || !node) return 0;
  return getDistance(point.lat, point.lng, node.lat, node.lng);
}

function dijkstra(startId, endId, graphData, options = {}) {
  const graph = {};
  const profile = mobilityProfile(options.mobilityType);
  const isBlocked = (nodeId) =>
    profile.blockStairs && /stair|계단/i.test(graphData.nodeMap[nodeId]?.type || "");

  graphData.edges.forEach((edge) => {
    if (!edge.isActive || isBlocked(edge.from) || isBlocked(edge.to)) return;
    if (edge.slope !== null && Math.abs(edge.slope) > profile.maxSlope) return;
    if (edge.pathWidth !== null && edge.pathWidth > 0 && edge.pathWidth < profile.minWidth) return;
    if (!graph[edge.from]) graph[edge.from] = [];
    if (!graph[edge.to]) graph[edge.to] = [];
    const penalty = options.optimize === "accessible"
      ? Math.abs(edge.slope || 0) * profile.slopePenalty +
        Math.max(0, (edge.effort || 1) - 1) * profile.effortPenalty
      : 0;
    graph[edge.from].push({ node: edge.to, weight: edge.weight, cost: edge.weight + penalty });
    graph[edge.to].push({ node: edge.from, weight: edge.weight, cost: edge.weight + penalty });
  });

  const dist = {};
  const actualDistance = {};
  const prev = {};
  const visited = new Set();
  const queue = [[0, startId]];

  dist[startId] = 0;
  actualDistance[startId] = 0;

  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [distance, current] = queue.shift();

    if (visited.has(current)) continue;
    visited.add(current);
    if (current === endId) break;

    (graph[current] || []).forEach(({ node, weight, cost }) => {
      const nextDistance = distance + cost;
      if (nextDistance < (dist[node] ?? Infinity)) {
        dist[node] = nextDistance;
        actualDistance[node] = actualDistance[current] + weight;
        prev[node] = current;
        queue.push([nextDistance, node]);
      }
    });
  }

  if (!Number.isFinite(dist[endId])) return null;

  const path = [];
  let current = endId;
  while (current !== undefined) {
    path.unshift(current);
    current = prev[current];
  }

  return {
    path,
    distance: Math.round(actualDistance[endId]),
    score: dist[endId],
  };
}

function formatAccessRoute(id, title, route, graphData) {
  if (!route) return null;

  const path = route.path
    .map((nodeId) => graphData.nodeMap[nodeId])
    .filter(Boolean);
  const stairCount = path.filter((node) => node.type === "stair").length;
  const rampCount = path.filter((node) => node.type === "ramp").length;
  const elevatorCount = path.filter((node) => node.type === "elevator").length;
  const crosswalkCount = path.filter((node) => node.type === "crosswalk").length;

  return {
    id,
    title,
    distance: route.distance,
    duration: Math.max(1, Math.ceil(route.distance / 60)),
    dangerCount: stairCount,
    features: {
      stairs: stairCount,
      ramps: rampCount,
      elevators: elevatorCount,
      crosswalks: crosswalkCount,
    },
    path,
  };
}

function estimateRouteFeaturesFromGraph(routePath, graphData, thresholdMeters = 25) {
  const features = {
    stairs: 0,
    ramps: 0,
    elevators: 0,
    crosswalks: 0,
  };

  if (!Array.isArray(routePath) || routePath.length < 2 || !graphData?.nodes?.length) {
    return features;
  }

  const typeToKey = {
    stair: "stairs",
    ramp: "ramps",
    elevator: "elevators",
    crosswalk: "crosswalks",
  };
  const countedNodeIds = new Set();

  graphData.nodes.forEach((node) => {
    const key = typeToKey[node.type];
    if (!key || countedNodeIds.has(node.id)) return;

    const distance = distanceFromPointToRoute(node, routePath);
    if (distance <= thresholdMeters) {
      countedNodeIds.add(node.id);
      features[key] += 1;
    }
  });

  return features;
}

function distanceFromPointToRoute(point, routePath) {
  let minDistance = Infinity;

  for (let i = 0; i < routePath.length - 1; i += 1) {
    const distance = distanceFromPointToSegment(point, routePath[i], routePath[i + 1]);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  return minDistance;
}

function distanceFromPointToSegment(point, start, end) {
  const latScale = 111320;
  const lngScale = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const px = point.lng * lngScale;
  const py = point.lat * latScale;
  const ax = start.lng * lngScale;
  const ay = start.lat * latScale;
  const bx = end.lng * lngScale;
  const by = end.lat * latScale;
  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;

  return Math.hypot(px - closestX, py - closestY);
}

function summarizeBuilding(building) {
  return {
    id: building.id,
    name: building.name,
    lat: building.lat,
    lng: building.lng,
  };
}

function summarizeRouteTarget(target, graphData) {
  if (target.type === "poi") {
    const node = graphData.nodeMap[target.id] || target;
    return {
      id: node.id,
      name: node.name,
      lat: node.lat,
      lng: node.lng,
      type: node.type,
    };
  }

  return summarizeBuilding(target);
}
