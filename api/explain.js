// api/explain.js  (Serverless on Vercel)
export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      route: '/api/explain',
      runtime: 'serverless',
      note: 'POST with {model, reference, verse, tone?, instructions?, length_limit?, prompt_version?}',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- 안전장치: API 키 확인 ---
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY on server' });
  }

  try {
    // 클라이언트에서 보낸 페이로드
    const {
      model = 'gpt-5-nano',
      reference,
      verse,
      tone = '공감형/확신형/현실중심',
      instructions = '',
      length_limit = 1000,
      prompt_version = 'v2',
    } = req.body || {};

    if (!reference || !verse) {
      return res.status(400).json({ error: 'Missing reference or verse' });
    }

    // === 프롬프트 조립 ===
    // 요구사항 반영:
    // 1) 첫 문단(두 문장)에서 현재/미래를 단정적으로 제시(예언처럼).
    // 2) 전체 어조는 공감형.
    // 3) 신앙/교리 최소화, 실천 팁은 간단히.
    // 4) 1000자 이내.
    const sysRole =
      '너는 사용자의 현재와 미래를 단정적으로 제시하되, 공감하는 어조로 현실적인 조언을 주는 해석자다. ' +
      '신앙적 설교/교리/추상적 표현은 최대한 배제하고, 실천은 간결하게 안내한다.';

    const userGuide = [
      `프롬프트 버전: ${prompt_version}`,
      `톤(참고): ${tone}`,
      `지시사항(추가): ${instructions}`.trim(),
      '',
      '출력 형식 지침:',
      '1) 첫 두 문장으로 현재는 어떠하다 / 미래는 어떨 것이다 를 단정적으로 제시(예언처럼 확실하게).',
      '2) 전반적인 말투는 공감형(위로/지지의 한두 문장 포함).',
      '3) 신앙/교리/설교체/추상적 미사여구 최소화. 실천 조언은 3~5문장 이내의 간단한 문장으로.',
      `4) 전체 분량은 ${length_limit}자 이내.`,
      '5) 한국어로만 작성.',
      '',
      `성경 구절: ${reference}`,
      `본문: ${verse}`,
    ].join('\n');

    const prompt = [
      // Responses API는 messages가 아니라 "input" 하나로 넣는 편이 호환이 좋습니다.
      // system 역할 지시 + 사용자 지시를 하나의 입력으로 합칩니다.
      `역할:\n${sysRole}\n\n요청:\n${userGuide}`,
    ].join('\n');

    // === OpenAI Responses API 호출 ===
    const oaResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: prompt, // Responses API는 input 사용
        // 필요시 온도/토큰 제한 추가 가능
        // temperature: 0.7,
        // max_output_tokens: 800, // 모델/플랜에 따라 파라미터명이 다를 수 있어 주석
      }),
    });

    if (!oaResp.ok) {
      const txt = await oaResp.text();
      return res.status(500).json({ error: `OpenAI error: ${txt}` });
    }

    const data = await oaResp.json();

    // === Responses API 응답 텍스트 추출 ===
    let explanation = '';
    if (data.output_text) {
      explanation = String(data.output_text).trim();
    } else if (Array.isArray(data.output) && data.output.length > 0) {
      explanation = data.output
        .map((p) => {
          if (!p?.content) return '';
          try {
            return p.content.map((c) => c?.text || '').join('');
          } catch {
            return '';
          }
        })
        .join('')
        .trim();
    } else {
      explanation = JSON.stringify(data);
    }

    // 서버 차원에서 길이 클램프(혹시 모델이 길게 줄 때 대비)
    if (explanation.length > Number(length_limit)) {
      explanation = explanation.slice(0, Number(length_limit));
    }

    return res.status(200).json({ explanation });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
