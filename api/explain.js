// api/explain.js
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');            // ← 핵심
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCORS(res);

  // 프리플라이트(사전검사) 응답
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 바디 파싱(스트림 → JSON)
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const { model, reference, verse } = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    const prompt =
      `${reference}\n${verse}\n\n` +
      `위 말씀을 바탕으로 '현재 상황'과 '앞으로의 행동'을 현실적이고 확신의 어조로 간결히 조언해줘.`;

    const oai = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'gpt-5-nano',
        messages: [
          { role: 'system', content: '너는 현실 중심 멘토. 단호하고 명확하게 조언.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 600
      })
    });

    if (!oai.ok) {
      const txt = await oai.text();
      setCORS(res);
      return res.status(500).json({ error: `OpenAI error: ${txt}` });
    }

    const data = await oai.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();

    setCORS(res);
    return res.status(200).json({ explanation: text });
  } catch (e) {
    setCORS(res); // 에러에도 반드시!
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
