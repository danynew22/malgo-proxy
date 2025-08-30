// api/dict.js
/**
 * 표준국어대사전(OpenAPI) → 앱용 단일 JSON으로 정리해 반환하는 프록시
 * 요청:  GET /api/dict?q=의인
 * 응답:  { ok:true, headword:"의인", definition:"...", source:"표준국어대사전" }
 *
 * 필요 환경변수(Vercel Settings > Environment Variables)
 * - DICT_API_KEY : 국립국어원 표준국어대사전 API 키
 *
 * 참고: Production 캐시 헤더(s-maxage)로 Vercel CDN 캐시 가능
 */

const BASE_URL = "https://stdict.korean.go.kr/api/search.do";

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*"); // 필요 시 특정 도메인으로 제한
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const key = process.env.DICT_API_KEY;
  if (!key) return json(res, 500, { ok: false, error: "SERVER_MISCONFIG" });

  const rawQ = (req.query.q || "").toString().trim();
  if (!rawQ) return json(res, 400, { ok: false, error: "Q_REQUIRED" });

  // 간단 한국어 정규화(조사 꼬리 제거) — 실패시 원문 그대로도 함께 시도
  const norm = normalizeKorean(rawQ);

  // 먼저 정규화된 표기로 시도 → 실패 시 원문으로 한 번 더 시도
  const tried = new Set();
  const candidates = [norm, rawQ].filter((w) => w && !tried.has(w));

  for (const q of candidates) {
    tried.add(q);
    const result = await lookupStdDict({ key, q });
    if (result && result.definition) {
      // CDN 캐시: 7일, SWR 1일
      res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
      return json(res, 200, {
        ok: true,
        headword: result.headword || q,
        definition: result.definition,
        source: "표준국어대사전",
      });
    }
  }

  // 여기까지 오면 검색 실패
  return json(res, 200, { ok: false, error: "NOT_FOUND" });
}

// ------------------------ helpers ------------------------

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function normalizeKorean(word) {
  const w = word.trim();
  // 아주 단순한 조사/격조사 꼬리 제거
  const tails = [
    "은","는","이","가","을","를","과","와","의",
    "에서","에게","보다","마다","처럼","부터","까지","으로","로"
  ];
  for (const t of tails) {
    if (w.length > t.length && w.endsWith(t)) return w.slice(0, -t.length);
  }
  return w;
}

async function lookupStdDict({ key, q }) {
  const url = new URL(BASE_URL);
  url.searchParams.set("key", key);
  url.searchParams.set("q", q);
  url.searchParams.set("req_type", "json"); // 기본은 XML → JSON 강제
  url.searchParams.set("num", "1");         // 1건만 가져오기(속도/요금 절약)

  try {
    const upstream = await fetch(url.toString(), { method: "GET" });
    if (!upstream.ok) return null;

    // 응답은 JSON이거나(성공) 간혹 XML/텍스트(에러케이스)일 수 있음 → 안전하게 처리
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }

    // 기대형태:
    // { channel: { item: [ { word: "의인", sense: { definition: "..." } } ] } }
    const item = data?.channel?.item?.[0];
    if (!item) return null;

    // sense가 객체 또는 배열일 수 있어 방어적으로 처리
    const sense = Array.isArray(item.sense) ? item.sense[0] : item.sense;
    const definition = trimStr(sense?.definition);
    const headword = trimStr(item.word) || q;

    if (!definition) return null;
    return { headword, definition };
  } catch (e) {
    // 필요 시 로그 시스템을 붙이세요 (console.log 남발은 지양)
    return null;
  }
}

function trimStr(s) {
  return typeof s === "string" ? s.trim() : "";
}
