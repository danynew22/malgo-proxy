// api/explain.js  (Serverless, Node 22)
export default async function handler(req, res) {
  // CORS 헤더 (프리플라이트/본요청 모두)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, route: '/api/explain', runtime: 'node22' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { model, reference, verse } = req.body || {};
    const prompt =
      `${reference}\n${verse}\n\n` +
      `위 말씀을 바탕으로 '현재 상황'과 '앞으로의 행동'을 현실적이고 확신의 어조로 간결히 조언해줘.`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-5-nano',
        messages: [
          { role: 'system', content: '너는 현실 중심 멘토. 단호하고 명확하게 조언.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 600,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(500).json({ error: `OpenAI error: ${txt}` });
    }

    const data = await resp.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    return res.status(200).json({ explanation: text });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
