// api/explain.js  → Edge Runtime (vercel.json 필요 없음)
export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
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
      return new Response(JSON.stringify({ error: `OpenAI error: ${txt}` }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const data = await oai.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();

    return new Response(JSON.stringify({ explanation: text }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'unknown error' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}
