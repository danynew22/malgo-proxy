// api/explain.js  (Serverless on Vercel)
export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, route: '/api/explain', runtime: 'serverless' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { model = 'gpt-5-nano', reference, verse } = req.body || {};

    // 프롬프트 (현실적 + 확신의 어조)
    const prompt =
      `다음 성경 구절을 바탕으로, 현재 상황이 어떠한지와 앞으로의 현실적인 행동 가이드를 확신의 어조로 간결하게 제시해줘.\n\n` +
      `구절: ${reference}\n본문: ${verse}`;

    // === Responses API 사용 ===
    const oaResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: prompt, // Responses API는 input 사용
        // 필요하면 temperature 등 추가 가능 (모델 지원 범위 내)
        // temperature: 0.7,
      }),
    });

    if (!oaResp.ok) {
      const txt = await oaResp.text();
      return res.status(500).json({ error: `OpenAI error: ${txt}` });
    }

    const data = await oaResp.json();
    // Responses API 출력에서 텍스트 추출
    let explanation = '';
    // 1) output_text가 있으면 가장 깔끔
    if (data.output_text) {
      explanation = String(data.output_text).trim();
    } else if (Array.isArray(data.output) && data.output.length > 0) {
      // 2) output 배열 내부 텍스트 파트 찾아서 합치기
      explanation = data.output
        .map((p) => (p?.content ? p.content.map((c) => c?.text || '').join('') : ''))
        .join('')
        .trim();
    } else {
      explanation = JSON.stringify(data); // 폴백
    }

    return res.status(200).json({ explanation });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
