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
      prompt_version = 'v3-wayo-structured',
    } = req.body || {};

    if (!reference || !verse) {
      return res.status(400).json({ error: 'Missing reference or verse' });
    }

    // === 프롬프트 조립 ===
    // 요구사항 반영:
    // - 해요체 사용(반말/격식 아님, 공손하고 따뜻한 말투)
    // - 1) 맥락(간단히)
    // - 2) 현재 상황 브리핑 + 공감
    // - 3) 미래 예언(단정형)
    // - 4) 지금 해야 할 일(간단, 현실적)
    // - 출력에 번호/소제목 절대 넣지 않기
    // - 줄바꿈 패턴: [1 블록] + 빈줄 + [2 블록] + 줄바꿈 + [3 블록] + 빈줄 + [4 블록]
    //   (즉, 구분은 \n\n, \n, \n\n 순서)
    const sysRole =
      '너는 사용자의 현재와 미래를 단정적으로 제시하되, 공감하는 어조(해요체)로 현실적인 조언을 주는 해석자예요. ' +
      '신앙적 설교/교리/추상적 미사여구는 최대한 배제하고, 실천 조언은 간결하고 실행 가능하게 안내해요. ' +
      '항상 한국어 해요체로만 답해요. 번호, 소제목, 불릿 포인트는 절대로 쓰지 않아요.';

    const formatGuide = [
      '반드시 아래 4개 블록을 이 순서와 줄바꿈 규칙으로 출력해요. 숫자/소제목/불릿은 절대 표시하지 않아요.',
      '',
      '블록1: 이 말씀의 맥락을 아주 간단히 요약해요. (해요체, 1~2문장)',
      '(그 다음 한 줄을 완전히 비워요)  ← "\\n\\n"',
      '블록2: "지금은 ~을 겪고 있어요"처럼 현재 상황을 브리핑하고 공감해요. (2~4문장)',
      '(그 다음 줄바꿈만 한 번 해요)  ← "\\n"',
      '블록3: "앞으로 ~을 맞이하게 돼요/일어날 거예요"처럼 미래를 단정적으로 예언해요. (1~3문장)',
      '(그 다음 한 줄을 완전히 비워요)  ← "\\n\\n"',
      '블록4: "지금 해야 할 일은 ~예요"처럼 아주 간단하고 현실적인 행동을 제안해요. (3~5문장, 체크리스트 말투 금지)',
      '',
      '전체 길이는 반드시 ' + length_limit + '자 이내예요.',
      '말투는 끝까지 해요체로 유지해요.',
      '숫자/소제목/불릿/구분선/큰 따옴표 지시 텍스트 등은 출력에 포함하지 않아요.',
    ].join('\n');

    const userGuide = [
      `프롬프트 버전: ${prompt_version}`,
      `톤(참고): ${tone}`,
      `지시사항(추가): ${instructions}`.trim(),
      '',
      formatGuide,
      '',
      `성경 구절(표시용): ${reference}`,
      `본문(참고용): ${verse}`,
    ].join('\n');

    const prompt = `역할:\n${sysRole}\n\n요청:\n${userGuide}`;

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
        // 온도/토큰 제한은 모델/플랜 따라 상이하므로 생략
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

    // 서버 차원 길이 클램프
    if (explanation.length > Number(length_limit)) {
      explanation = explanation.slice(0, Number(length_limit));
    }

    // 혹시 모델이 번호/불릿 등을 넣었다면 가볍게 제거(보수적 정리)
    // - 줄머리 숫자/점/불릿 문자 최소 정리 (필요 시 확장 가능)
    explanation = explanation
      .replace(/^\s*[\d]+\.\s*/gm, '')
      .replace(/^\s*[-•]\s*/gm, '');

    return res.status(200).json({ explanation });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
