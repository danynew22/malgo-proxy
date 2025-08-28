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
    // 클라이언트 페이로드
    const {
      model = 'gpt-5-nano',
      reference,
      verse,
      // 예: '공감형/확신형/현실중심'
      tone = '공감형/확신형/현실중심',
      instructions = '',
      length_limit = 1000,
      prompt_version = 'v4-heyoche-4blocks-2025-08-28',
    } = req.body || {};

    if (!reference || !verse) {
      return res.status(400).json({ error: 'Missing reference or verse' });
    }

    // ===== 프롬프트 구성 =====
    // ✅ 새 규칙 요약 (모델에게만 보이는 지시)
    // - 말투: 한국어 "해요체" 고정 (예: ~해요, ~해보세요)
    // - 신앙/교리/설교체 최소화, 현실적인 어휘와 조언
    // - 구조: 총 3단락(문단)로 출력 (번호/소제목/마크다운/대괄호 표식 사용 금지)
    //   1단락) 말씀의 맥락 설명: 2~3문장, 간결하고 현실적으로
    //   2단락) 현재 상황 브리핑+공감 → "줄바꿈 없이 이어서" → 미래 예언
    //          * 하나의 "단락(문단)" 안에서 이어 쓰기 (중간에 빈 줄 금지)
    //          * 문장 맨 앞에 ✔/⭐/🔹 중 하나를 선택적으로 붙여도 됨
    //   3단락) 행동 하나만 추천: “이럴 땐 ○○ 해보는 거 어때요?” 형태의 한 문장
    // - 전체 1000자(한글 기준) 이내
    // - 불필요한 장식(번호, [단락], 인용부호, 마크다운 제목 등) 금지

    const sysRole =
      '너는 주어진 성경 구절을 바탕으로 사용자의 상황을 친근한 해요체로 간결하게 풀어주는 해석자야. ' +
      '설교체나 교리 설명은 최소화하고, 현실적인 표현과 구체적인 실천을 제시해. ' +
      '항상 한국어 해요체(예: ~해요, ~해보세요)로 답해.';

    const formatRules = [
      `프롬프트 버전: ${prompt_version}`,
      `톤(참고): ${tone}`,
      instructions ? `추가 지시: ${instructions}` : '',
      '',
      '출력 규칙(엄격):',
      '- 출력은 총 3개의 단락(문단)으로만 구성하고, 번호/소제목/[단락]/마크다운은 절대 쓰지 마.',
      '- 1단락: 말씀의 맥락을 2~3문장으로 간단히 설명해요.',
      '- 2단락: 같은 단락 안에서 "현재 상황 브리핑+공감"을 말한 뒤 곧바로 "미래 예언"을 이어서 써요. 문단 내부에 빈 줄을 만들지 말고, 필요하면 ✔/⭐/🔹 중 하나로 문장을 시작해도 돼요.',
      '- 3단락: 행동 하나만 딱 추천해요. “이럴 땐 ○○ 해보는 거 어때요?”처럼 한 문장으로 마무리해요.',
      `- 전체 길이: ${length_limit}자 이내(한글 기준).`,
      '- 신앙/교리/설교체 최소화, 현실적/일상적 어휘 사용.',
      '- 한국어 해요체 고정. 불필요한 장식(인용부호, 제목, 리스트 등) 금지.',
      '',
      `성경 구절: ${reference}`,
      `본문: ${verse}`,
    ]
      .filter(Boolean)
      .join('\n');

    const prompt = `역할\n${sysRole}\n\n지시\n${formatRules}`;

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
        // 필요시 조정 가능
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
    } else if (typeof data === 'string') {
      explanation = data;
    } else {
      // 백업: models가 다른 구조로 줄 수 있으므로 전체를 문자열화
      explanation = JSON.stringify(data);
    }

    // ===== 후처리(안전장치): 번호/소제목/[단락] 제거 =====
    const sanitize = (text) => {
      let s = text;

      // 줄 머리 번호/불릿 제거: "1. ", "1) ", "- ", "* ", "• "
      s = s.replace(/^[ \t]*(\d+[.)]\s+|[-*•]\s+)/gm, '');

      // 마크다운 제목 기호 제거: "#", "##", ...
      s = s.replace(/^[ \t]*#{1,6}\s+/gm, '');

      // [단락], [단락1: ...] 등 섹션 표식 제거
      s = s.replace(/\[단락[^\]]*\]\s*/g, '');

      // 섹션 명칭이 노출되는 경우 제거
      s = s.replace(
        /^[ \t]*(말씀의\s*맥락\s*설명|현재\s*상황\s*브리핑\s*\+\s*공감|미래\s*예언|행동\s*하나\s*추천)\s*:?\s*/gim,
        ''
      );

      // 과한 공백 정리
      s = s.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

      return s.trim();
    };

    explanation = sanitize(explanation);

    // ===== 길이 제한(서버 보증) =====
    const limit = Number(length_limit) || 1000;
    if (explanation.length > limit) {
      explanation = explanation.slice(0, limit).trim();
    }

    return res.status(200).json({ explanation });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
