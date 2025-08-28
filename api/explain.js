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
      prompt_version = 'v3-kayo-structure', // 규칙 버전 명시
    } = req.body || {};

    if (!reference || !verse) {
      return res.status(400).json({ error: 'Missing reference or verse' });
    }

    // ===== 프롬프트 조립 =====
    // 규칙 요약:
    // - 말투: 해요체(구어체, 친근)
    // - 구성: 3블록
    //   1) 말씀의 맥락 설명 (짧게 2~3문장)
    //   2) 현재 상황 브리핑+공감 + (줄바꿈 없이 이어서) 미래 예언  → 한 줄 안에 기호(✔/⭐/🔹 중 택1)로 시작, 한 줄로 끝냄
    //   3) 행동 하나 추천  → 한 줄, 명확하고 단 하나
    // - 신앙/교리 최소화, 현실적인 표현
    // - 전체 1000자 이내
    const sysRole =
      '너는 주어진 성경 구절을 바탕으로 사용자의 상황을 친근한 해요체로 간결하게 풀어주는 해석자야. ' +
      '신앙적 설교/교리/추상적 미사여구는 최소화하고, 현실적인 표현과 간단한 실천을 제시해. ' +
      '말투는 항상 해요체(예: ~해요, ~해보세요)로 유지해.';

    // 출력 형식은 사용자에게 번호/소제목 없이 자연스럽게 보이지만,
    // 실제 생성은 아래 구조(단락/줄 수)와 제약을 반드시 지킴.
    const structureGuide = [
      `프롬프트 버전: ${prompt_version}`,
      `톤(참고): ${tone}`,
      `추가 지시: ${instructions}`.trim(),
      '',
      '출력 형식과 규칙(엄격):',
      '1) [단락1: 말씀의 맥락 설명] 2~3문장, 너무 장식적이지 않게, 해요체.',
      '2) [단락2: 한 줄] 기호(✔ 또는 ⭐ 또는 🔹 중 하나)로 시작하고,',
      '   같은 줄 안에서 "현재 상황 브리핑+공감" 다음에 바로 이어서 "미래 예언"까지 한 줄에 끝냄.',
      '   예: ✔ 지금은 ~해요. 앞으로는 ~하게 될 거예요.',
      '   (여기서는 실제로 한 줄만 사용. 중간 줄바꿈 금지.)',
      '3) [단락3: 한 줄] “이럴 땐 ○○ 해보는 거 어때요?”처럼 행동 하나만 명확히 추천(한 줄).',
      '추가 제약:',
      `- 전체 길이: ${length_limit}자 이내.`,
      '- 신앙/교리/설교체 최소화, 현실적인 단어 사용.',
      '- 한국어, 해요체 고정.',
      '- 불필요한 소제목/번호/인용부호/마크다운 금지.',
      '',
      `성경 구절: ${reference}`,
      `본문: ${verse}`,
    ].join('\n');

    // Responses API는 input 하나로 넣는 구성이 호환이 좋음
    const prompt = `역할:\n${sysRole}\n\n지시:\n${structureGuide}`;

    // ===== OpenAI Responses API 호출 =====
    const oaResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: prompt,
        // 필요하면 온도/토큰 제한(플랜/모델 지원 범위 확인 후 사용)
        // temperature: 0.7,
        // max_output_tokens: 800,
      }),
    });

    if (!oaResp.ok) {
      const txt = await oaResp.text();
      return res.status(500).json({ error: `OpenAI error: ${txt}` });
    }

    const data = await oaResp.json();

    // ===== 응답 텍스트 추출 =====
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

    // 서버 차원에서 길이 제한(혹시 초과 시)
    if (explanation.length > Number(length_limit)) {
      explanation = explanation.slice(0, Number(length_limit));
    }

    return res.status(200).json({ explanation });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
