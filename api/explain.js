export default async function handler(req, res) {
  // CORS(모바일은 보통 필요 없지만 안전하게 허용)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const { model, reference, verse } = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    const prompt =
      `${reference}\n${verse}\n\n` +
      `위 말씀을 바탕으로 '현재 상황이 어떠한지'와 '앞으로 어떻게 하면 좋을지'를 ` +
      `현실적인 관점과 확신의 어조로 간결히 설명해줘. 신앙 일반론보다는 실천 조언 위주로.`;

    const oai = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'gpt-5-nano',
        messages: [
          { role: 'system', content: '너는 현실 중심의 멘토다. 단호하고 명확하게 조언한다.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 600
      })
    });

    if (!oai.ok) {
      const txt = await oai.text();
      return res.status(500).json({ error: `OpenAI error: ${txt}` });
    }

    const data = await oai.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ explanation: text });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
