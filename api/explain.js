// api/explain.js
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  // 프리플라이트
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // 헬스체크(브라우저에서 바로 열어보기용)
  if (req.method === 'GET') {
    return json({ ok: true, route: '/api/explain', runtime: 'edge' });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const { model, reference, verse } = await req.json();
    const prompt =
      `${reference}\n${verse}\n\n` +
      `위 말씀을 바탕으로 '현재 상황'과 '앞으로의 행동'을 현실적이고 확신의 어조로 간결히 조언해줘.`;

    const oai = await fetch('https://api.openai.com/v1/chat/completions', {
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

    if (!oai.ok) {
      const txt = await oai.text();
      return json({ error: `OpenAI error: ${txt}` }, 500);
    }

    const data = await oai.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    return json({ explanation: text });
  } catch (e) {
    return json({ error: e?.message || 'unknown error' }, 500);
  }
}
