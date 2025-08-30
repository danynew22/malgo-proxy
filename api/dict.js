// api/dict.js
/**
 * 표준국어대사전(OpenAPI) 프록시
 * GET /api/dict?q=의인[&debug=1]
 *
 * 응답:
 *  - 성공: { ok:true, headword, definition, source:"표준국어대사전" }
 *  - 실패: { ok:false, error:"NOT_FOUND", ...(debug시 upstream 원문 일부 포함) }
 *
 * 필요 환경변수:
 *  - DICT_API_KEY : 표준국어대사전 API 키
 *
 * 참고: JSON 실패 시 XML 파싱으로 폴백
 */

const STD_BASE = "https://stdict.korean.go.kr/api/search.do";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return send(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const key = process.env.DICT_API_KEY;
  if (!key) return send(res, 500, { ok: false, error: "SERVER_MISCONFIG" });

  const rawQ = (req.query.q || "").toString().trim();
  const debug = req.query.debug === "1";
  if (!rawQ) return send(res, 400, { ok: false, error: "Q_REQUIRED" });

  // 간단 정규화(조사 제거) 후, 정규화/원문 두 번 시도
  const norm = normalizeKorean(rawQ);
  const tried = new Set();
  const candidates = [norm, rawQ].filter((w) => w && !tried.has(w));

  for (const q of candidates) {
    tried.add(q);
    const up = await callStdDict({ key, q });
    if (debug && up.raw) {
      // 디버그 요청이면 upstream 원문 300자만 함께 내려줌(개발용)
      up.debugRaw = up.raw.slice(0, 300);
      delete up.raw;
    }
    if (up.error) {
      // upstream 자체 에러 → 다음 후보 계속
      continue;
    }
    // JSON 또는 XML에서 headword/definition 뽑아오기
    const picked = pickStd(up.json, up.xml);
    if (picked && picked.definition) {
      res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
      return send(res, 200, {
        ok: true,
        headword: picked.headword || q,
        definition: picked.definition,
        source: "표준국어대사전",
        ...(debug ? { debug: up.debugRaw || undefined } : {}),
      });
    }
  }

  // 모두 실패
  return send(res, 200, {
    ok: false,
    error: "NOT_FOUND",
    ...(debug ? { note: "try /api/dict?q=단어&debug=1 로 원문 일부 확인" } : {}),
  });
}

// ================================= helpers =================================

function send(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function normalizeKorean(w) {
  const word = w.trim();
  const tails = [
    "은","는","이","가","을","를","과","와","의",
    "에서","에게","보다","마다","처럼","부터","까지","으로","로"
  ];
  for (const t of tails) {
    if (word.length > t.length && word.endsWith(t)) return word.slice(0, -t.length);
  }
  return word;
}

async function callStdDict({ key, q }) {
  const url = new URL(STD_BASE);
  url.searchParams.set("key", key);
  url.searchParams.set("q", q);
  url.searchParams.set("req_type", "json"); // JSON 우선 시도
  url.searchParams.set("num", "1");

  try {
    const res = await fetch(url.toString(), { method: "GET" });
    const raw = await res.text();

    // 먼저 JSON 파싱 시도
    let json = null, xml = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // JSON 아님 → XML일 가능성
      xml = raw;
    }
    return { json, xml, raw };
  } catch (e) {
    return { error: e.message };
  }
}

// 표준국어대사전 JSON/XML에서 공통 형태로 뽑기
function pickStd(json, xml) {
  // JSON 케이스
  if (json && json.channel) {
    const item = arr(json.channel.item)?.[0];
    if (item) {
      const headword = str(item.word);
      // sense가 배열/객체 모두 고려
      const sense = Array.isArray(item.sense) ? item.sense[0] : item.sense;
      const definition = str(sense?.definition);
      if (definition) return { headword, definition };
    }
  }

  // XML 케이스(아주 얕은 파서로 추출)
  if (xml && typeof xml === "string") {
    const getTag = (src, tag) => {
      const m = src.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? m[1].trim() : "";
    };
    // 가장 첫 번째 item 블록만 추출
    const itemMatch = xml.match(/<item[^>]*>([\s\S]*?)<\/item>/i);
    if (itemMatch) {
      const itemXml = itemMatch[1];
      const headword = getTag(itemXml, "word");
      const senseXmlMatch = itemXml.match(/<sense[^>]*>([\s\S]*?)<\/sense>/i);
      const senseXml = senseXmlMatch ? senseXmlMatch[1] : "";
      const definition = getTag(senseXml || itemXml, "definition");
      if (definition) return { headword, definition };
    }
  }
  return null;
}

function arr(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}
function str(x) {
  return typeof x === "string" ? x.trim() : "";
}
