// api/dict.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const q = (req.query.q || "").toString().trim();
  if (!q) {
    return res.status(400).json({ ok: false, error: "q required" });
  }

  const API_KEY = process.env.DICT_API_KEY; // 표준국어대사전 인증키
  const BASE_URL = "https://stdict.korean.go.kr/api/search.do";

  try {
    const url = new URL(BASE_URL);
    url.searchParams.set("key", API_KEY);
    url.searchParams.set("q", q);
    url.searchParams.set("req_type", "json");
    url.searchParams.set("num", "1");

    const response = await fetch(url.toString());
    if (!response.ok) {
      return res
        .status(502)
        .json({ ok: false, error: "Upstream error", status: response.status });
    }

    const data = await response.json();

    let headword = q;
    let definition = "";
    if (data.channel && data.channel.item && data.channel.item.length > 0) {
      const item = data.channel.item[0];
      headword = item.word || q;
      definition =
        (item.sense && item.sense.definition) || "정의를 찾지 못했습니다.";
    }

    return res.status(200).json({
      ok: true,
      headword,
      definition,
      source: "표준국어대사전",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
