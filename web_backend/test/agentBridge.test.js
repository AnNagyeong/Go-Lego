// agentBridge 단위 테스트: node --test test/agentBridge.test.js
const test = require("node:test");
const assert = require("node:assert");
const {
  parseMessageByRules, parseAgentMessage, normalizeLlmResult, toServedPhotoUrl,
} = require("../agentBridge");

const routeCases = [
  ["한양여대 본관에서 정보문화관으로 가고 싶어", "본관", "정보문화관"],
  ["본관에서 정보문화관까지 안내해줘", "본관", "정보문화관"],
  ["정보문화관에서 도서관까지 길 안내해줘", "정보문화관", "도서관"],
  ["한양여자대학교 정문에서 디자인관 가는 길 알려줘", "정문", "디자인관"],
  ["본관에서 왕십리역으로 가는 방법", "본관", "왕십리역"],
  ["왕십리역에서 한양여대 정보문화관까지 경로", "왕십리역", "정보문화관"],
  ["정보문화관 가는 길 알려줘", null, "정보문화관"],
  ["도서관까지 안내해줘", null, "도서관"],
  ["운동장으로 가고 싶어요", null, "운동장"],
  ["현재 위치에서 교수회관까지 길 안내", null, "교수회관"],
  ["여기서 본관으로 갈래", null, "본관"],
  ["본관 → 정보문화관 길찾기".replace("→", "에서"), "본관", "정보문화관"],
];

for (const [message, start, destination] of routeCases) {
  test(`경로: ${message}`, () => {
    const r = parseMessageByRules(message);
    assert.strictEqual(r.intent, "route");
    assert.strictEqual(r.start, start);
    assert.strictEqual(r.destination, destination);
  });
}

test("사진 질문", () => {
  const r = parseMessageByRules("정보문화관 사진 보여줘");
  assert.strictEqual(r.intent, "photo");
  assert.strictEqual(r.keyword, "정보문화관");
  assert.strictEqual(parseMessageByRules("한양여대 본관 입구 사진").keyword, "본관 입구");
});

test("시설 질문은 other", () => {
  assert.strictEqual(parseMessageByRules("정보문화관 장애인 화장실 어디 있어?").intent, "other");
  assert.strictEqual(parseMessageByRules("").intent, "other");
});

test("LLM 결과 검증", () => {
  assert.deepStrictEqual(
    normalizeLlmResult({ intent: "route", start: "현재 위치", destination: "본관" }),
    { intent: "route", start: null, destination: "본관", keyword: null }
  );
  assert.strictEqual(normalizeLlmResult({ intent: "route", destination: "" }), null);
  assert.strictEqual(normalizeLlmResult({ intent: "weird" }), null);
  assert.strictEqual(normalizeLlmResult("x"), null);
});

test("키가 없으면 규칙으로 처리", async () => {
  const r = await parseAgentMessage("본관에서 도서관까지 안내해줘", {});
  assert.strictEqual(r.destination, "도서관");
});

test("LLM 호출 실패하면 규칙으로 처리", async () => {
  const failing = async () => { throw new Error("network"); };
  const r = await parseAgentMessage("본관에서 도서관까지 안내해줘", { apiKey: "k", fetchImpl: failing });
  assert.strictEqual(r.start, "본관");
  const notOk = async () => ({ ok: false });
  const r2 = await parseAgentMessage("도서관 가는 길", { apiKey: "k", fetchImpl: notOk });
  assert.strictEqual(r2.destination, "도서관");
});

test("LLM 정상 응답 사용", async () => {
  const ok = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ intent: "route", start: null, destination: "정보문화관" }) } }] }),
  });
  const r = await parseAgentMessage("정보관 가고싶어", { apiKey: "k", fetchImpl: ok });
  assert.strictEqual(r.destination, "정보문화관");
});

test("사진 주소 상대경로 변환", () => {
  assert.strictEqual(toServedPhotoUrl("http://localhost:3000/panoramas/a.jpg", "http://localhost:3000"), "/panoramas/a.jpg");
  assert.strictEqual(toServedPhotoUrl("https://x.com/a.jpg", "http://localhost:3000"), "https://x.com/a.jpg");
  assert.strictEqual(toServedPhotoUrl("", "x"), null);
});
