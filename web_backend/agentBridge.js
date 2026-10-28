// Agent 질문 해석 모듈
//
// Go-Lego 서버가 /api/agent/chat 요청을 받았을 때
//   1) 길찾기 질문인지, 사진 질문인지, 그 외 시설 질문인지 구분하고
//   2) 길찾기라면 출발지/도착지 이름만 뽑아 지도 화면에 넘깁니다.
// 실제 경로 계산은 기존 /api/access-routes 가 그대로 담당하므로,
// MapService에 저장된 안전 경로가 있으면 그 경로를 쓰고 없으면 ORS 경로를 씁니다.
//
// OPENAI_API_KEY 가 있으면 OpenAI로 먼저 해석하고, 키가 없거나 호출이 실패하면
// 아래 규칙 기반 해석으로 처리하기 때문에 키가 만료되어도 동작합니다.

const CURRENT_LOCATION_WORDS = /^(현재\s*위치|내\s*위치|지금\s*위치|여기|지금\s*여기|이\s*위치)$/;

const SCHOOL_PREFIX = /한양여자대학교|한양여대/g;

// "가고 싶어", "가는 길", "안내해줘" 처럼 문장 뒤쪽의 요청 표현.
// 장소 이름 중간을 자르지 않도록 조사 또는 공백 바로 뒤에서만 시작하게 했습니다.
const TRAILING_REQUEST =
  /(?:(?:으로|로|까지|에|를|을)\s*|\s+)(?:가고|가려|가는|가야|갈래|갈게|갈\s*거|가자|가줘|가요|가\s*$|길|경로|안내|이동|데려|찾아|알려|어떻게|보내).*$/;

const ROUTE_HINT =
  /길\s*안내|길\s*찾|경로|가고\s*싶|가려|가는\s*(?:길|법|방법)|가야|어떻게\s*가|까지|(?:으로|로)\s*가|안내|데려다|이동|갈래|가자/;

const PHOTO_HINT = /사진|파노라마|전경|모습|어떻게\s*생겼|보여\s*줘|보여\s*주세요|보고\s*싶/;

/** 문장 끝의 문장부호와 앞뒤 공백을 정리합니다. */
function cleanMessage(message) {
  return String(message || "")
    .replace(/[.!?~…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 장소 이름 뒤에 붙은 조사를 떼고 학교 이름 접두어도 정리합니다. */
function cleanPlaceName(value) {
  return String(value || "")
    .replace(SCHOOL_PREFIX, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*(?:으로|로|까지|에서|부터|에|를|을|은|는)$/, "")
    .trim();
}

/** 이름이 "현재 위치"를 뜻하는 말인지 확인합니다. */
function isCurrentLocationName(value) {
  return CURRENT_LOCATION_WORDS.test(String(value || "").replace(/\s+/g, " ").trim());
}

/**
 * 규칙 기반 문장 해석.
 * @returns {{intent: "route"|"photo"|"other", start: string|null, destination: string|null, keyword: string|null}}
 */
function parseMessageByRules(message) {
  // "여기서"는 "에서"가 줄어든 말이라 먼저 "현재 위치에서"로 풀어 둡니다.
  const text = cleanMessage(message).replace(/^(?:지금\s*)?여기서\s*/, "현재 위치에서 ");
  const result = { intent: "other", start: null, destination: null, keyword: null };
  if (!text) return result;

  const wantsRoute = ROUTE_HINT.test(text);
  const wantsPhoto = PHOTO_HINT.test(text);

  // "A에서 B(으로) 가고 싶어" / "A부터 B까지" 형태
  const pair = text.match(/^(.+?)(?:에서|부터)\s*(.+)$/);
  if (wantsRoute && pair) {
    const start = cleanPlaceName(pair[1]);
    const destination = cleanPlaceName(pair[2].replace(TRAILING_REQUEST, ""));
    if (destination) {
      return {
        ...result,
        intent: "route",
        start: !start || isCurrentLocationName(start) ? null : start,
        destination,
      };
    }
  }

  // "B 가는 길 알려줘" / "B까지 안내해줘" 처럼 도착지만 있는 형태
  if (wantsRoute && !wantsPhoto) {
    const destination = cleanPlaceName(text.replace(TRAILING_REQUEST, ""));
    if (destination && !isCurrentLocationName(destination)) {
      return { ...result, intent: "route", destination };
    }
  }

  if (wantsPhoto) {
    const keyword = cleanPlaceName(
      text
        .replace(/사진|파노라마|전경|모습|어떻게\s*생겼(?:어|는지|나요)?|보여\s*줘|보여\s*주세요|보고\s*싶(?:어|어요)?|알려\s*줘|좀|있어|있나요/g, " ")
        .replace(/\s+/g, " ")
    );
    return { ...result, intent: "photo", keyword: keyword || null };
  }

  return result;
}

/** OpenAI 응답 JSON을 검증해서 규칙 해석과 같은 형태로 맞춥니다. */
function normalizeLlmResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  const intent = ["route", "photo", "other"].includes(raw.intent) ? raw.intent : null;
  if (!intent) return null;

  const pick = (value) => {
    const text = cleanPlaceName(typeof value === "string" ? value : "");
    return text && text.length <= 40 ? text : null;
  };

  const start = pick(raw.start);
  const destination = pick(raw.destination);
  const keyword = pick(raw.keyword);

  if (intent === "route" && !destination) return null;
  return {
    intent,
    start: start && !isCurrentLocationName(start) ? start : null,
    destination: intent === "route" ? destination : null,
    keyword: intent === "photo" ? keyword : null,
  };
}

/**
 * OpenAI로 문장을 해석합니다. 실패하면 null을 돌려주고 호출한 쪽이 규칙 해석을 씁니다.
 * @param {string} message 사용자 문장
 * @param {{apiKey?: string, model?: string, placeNames?: string[], fetchImpl?: Function, timeoutMs?: number}} options
 */
async function parseMessageWithLlm(message, options = {}) {
  const { apiKey, model = "gpt-4o-mini", placeNames = [], fetchImpl = globalThis.fetch, timeoutMs = 6000 } = options;
  if (!apiKey || typeof fetchImpl !== "function") return null;

  const system = [
    "한양여자대학교 캠퍼스 길 안내 서비스의 질문 분석기입니다.",
    "사용자 문장에서 의도와 장소 이름만 JSON으로 추출하세요.",
    '형식: {"intent":"route|photo|other","start":string|null,"destination":string|null,"keyword":string|null}',
    "route: 장소까지 가는 방법을 묻는 질문. 출발지를 말하지 않았거나 현재 위치라고 하면 start는 null.",
    "photo: 장소 사진을 보여달라는 질문. 장소 이름은 keyword에 넣습니다.",
    "other: 그 외 질문(화장실, 엘리베이터 위치 등).",
    "장소 이름은 사용자가 쓴 말을 그대로 쓰되, 아래 캠퍼스 장소 목록에 같은 곳이 있으면 목록의 이름을 쓰세요.",
    "목록에 없는 장소(역, 가게 등)도 사용자가 말한 이름 그대로 넣으세요. 이름을 지어내지 마세요.",
    placeNames.length ? `캠퍼스 장소 목록: ${placeNames.slice(0, 60).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: String(message || "") },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    return normalizeLlmResult(JSON.parse(content));
  } catch {
    return null;
  }
}

/** 질문을 해석합니다. OpenAI 결과가 있으면 그것을, 없으면 규칙 해석을 씁니다. */
async function parseAgentMessage(message, options = {}) {
  const llm = await parseMessageWithLlm(message, options);
  return llm || parseMessageByRules(message);
}

/** 지도에 경로를 띄우기 전 채팅창에 보여줄 한 줄 안내입니다. */
function buildRouteAnswer(start, destination) {
  return start
    ? `${start}에서 ${destination}까지 경로를 찾고 있습니다.`
    : `현재 위치에서 ${destination}까지 경로를 찾고 있습니다.`;
}

/**
 * MapService 사진 주소를 같은 서버가 서빙하는 상대경로로 바꿉니다.
 * 절대 주소(https://...)이거나 서버가 서빙하지 않는 경로는 그대로 둡니다.
 */
function toServedPhotoUrl(photoUri, mapServiceBaseUrl) {
  const value = String(photoUri || "").trim();
  if (!value) return null;
  const base = String(mapServiceBaseUrl || "").replace(/\/+$/, "");
  if (base && value.startsWith(`${base}/`)) {
    const relative = value.slice(base.length);
    if (/^\/(?:panoramas|images)\//.test(relative)) return relative;
  }
  return value;
}

module.exports = {
  parseMessageByRules,
  parseMessageWithLlm,
  parseAgentMessage,
  normalizeLlmResult,
  buildRouteAnswer,
  toServedPhotoUrl,
  isCurrentLocationName,
};
