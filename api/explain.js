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
      tone = '공감형/확신형/현실중심',
      instructions = '',
      length_limit = 1000,
      prompt_version = 'v4-heyoche-4blocks-2025-08-28',
    } = req.body || {};

    if (!reference || !verse) {
      return res.status(400).json({ error: 'Missing reference or verse' });
    }

    // ===== 프롬프트 구성 =====
    // 마커 4종 강제:
    // ::P1:: [말씀 맥락(2~3문장, 문장마다 \n)] ::/P1::
    // ::P2C:: [현재(사실 서술, 이미 알고 있듯 단정적·구체적/말끝은 조심스럽게), 문장 끝 \n] ::/P2C::
    // ::P2F:: [미래(사실 서술, 일어날 일을 아는 듯 단정적·구체적/말끝은 조심스럽게), 문장 끝 \n] ::/P2F::
    // ::P3:: [행동 하나 제안(맥락에 맞는 구체적 행동 1개, 자연스럽게 이어지는 한두 문장)] ::/P3::
    const sysRole =
      '너는 주어진 성경 구절을 비종교 독자도 편하게 읽을 수 있게, 현실적이고 일상적인 언어로 풀어주는 해석자야. ' +
      '설교체/교리 전개/전도성 권유/축복 선언/기도 강요는 피하고, 생활 맥락과 감정에 공감하는 설명을 해. ' +
      '항상 한국어 해요체로 답해.';

    const formatRules = [
      `프롬프트 버전: ${prompt_version}`,
      `톤(참고): ${tone}`,
      instructions ? `추가 지시: ${instructions}` : '',
      '',
      '출력 규칙(엄격):',
      '- 반드시 다음 내부 마커만 사용해서 생성하고(사용자에게는 보이지 않음), 그 외 표식/번호/소제목/마크다운은 사용하지 마.',
      '  ::P1:: [맥락 2~3문장, 각 문장 끝에는 실제 줄바꿈(\\n)을 넣기] ::/P1::',
      '  ::P2C:: [현재 상황: 사용자가 이미 겪고 있는 문제를 아는 듯 단정적으로, 구체적으로 서술. 말끝은 조심스럽고 다정하게. 마지막에 \\n] ::/P2C::',
      '  ::P2F:: [미래 전망: 사용자가 맞닥뜨릴 일을 아는 듯 단정적으로, 구체적으로 서술. 말끝은 조심스럽고 다정하게. 마지막에 \\n] ::/P2F::',
      '  ::P3:: [행동 하나 제안: 맥락에 맞는 구체적 행동 1개를 자연스럽게 제시. 한두 문장, 특정 문구/형식 강제 금지] ::/P3::',
      '- 각 단락은 서버가 조합하며, 단락 사이에는 빈 줄 1칸(\\n\\n)이 보이도록 구성된다.',
      `- 전체 길이: ${length_limit}자 이내(한글 기준).`,
      '- 종교 용어 남발 금지. 구절 언급은 가능하되 해석은 생활 중심, 세속적·실용적 관점.',
      '- 한국어 해요체 고정. 불필요한 장식(인용부호, 제목, 리스트, 괄호 안 설명 등) 및 지시 문구 노출 금지.',
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
    let raw = '';
    if (data.output_text) {
      raw = String(data.output_text).trim();
    } else if (Array.isArray(data.output) && data.output.length > 0) {
      raw = data.output
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
      raw = data;
    } else {
      raw = JSON.stringify(data);
    }

    // ===== 후처리(0): 개행 이스케이프/오타 교정 =====
    // - "\\n\\n" , "\\n"  → 실제 개행
    // - "/n"            → 실제 개행   (모델/중간 처리 오타 대비)
    const normalizeEscapedBreaks = (text) =>
      String(text)
        .replace(/\\n\\n/g, '\n\n')
        .replace(/\\n/g, '\n')
        .replace(/\/n/g, '\n');

    raw = normalizeEscapedBreaks(raw);

    // ===== 후처리(1): 표시 금지 요소 제거 =====
    const basicSanitize = (text) => {
      let s = text;

      // 줄머리 번호/불릿 제거
      s = s.replace(/^[ \t]*(\d+[.)]\s+|[-*•]\s+)/gm, '');
      // 마크다운 제목 기호 제거
      s = s.replace(/^[ \t]*#{1,6}\s+/gm, '');
      // 대괄호 표식/내용 제거 (사용자에게 괄호가 보이지 않도록)
      s = s.replace(/\[[^\]]*\]/g, '');
      // 섹션 레이블성 문구 제거
      s = s.replace(
        /^[ \t]*(말씀의\s*맥락\s*설명|현재\s*상황\s*브리핑\s*\+\s*공감|미래\s*(예언|전망)|행동\s*하나\s*추천|지시|출력\s*규칙|프롬프트\s*버전)\s*:?\s*/gim,
        ''
      );
      // 과한 공백
      s = s.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

      return s.trim();
    };

    raw = basicSanitize(raw);

    // ===== 후처리(2): 마커 파싱 =====
    const extract = (tag, t) => {
      const re = new RegExp(`::${tag}::([\\s\\S]*?)::\\/${tag}::`, 'i');
      const m = t.match(re);
      return m ? m[1].trim() : null;
    };

    const p1 = extract('P1', raw);
    const p2c = extract('P2C', raw); // 현재
    const p2f = extract('P2F', raw); // 미래
    const p3 = extract('P3', raw);

    // ===== 후처리(3): 문장 줄바꿈/정리 =====
    const cleanInnerKeepBreaks = (t) =>
      (t || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // P1, P3 내부: 문장 끝 줄바꿈 유지, 과잉 개행 축소
    const p1Clean = cleanInnerKeepBreaks(p1);
    const p3Clean = cleanInnerKeepBreaks(p3);

    // 2단락 현재/미래는 한 줄만 남기고 내부 개행 제거(문장 끝 개행은 서버 조립에서 넣음)
    const oneLine = (t) =>
      (t || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    const p2cLine = oneLine(p2c);
    const p2fLine = oneLine(p2f);

    // ===== 기호 선정: 신비로운 느낌의 기호 (두 줄 서로 다르게 보장) =====
    const mystic = ['✦', '✧', '❖', '◆', '◇', '✼', '✺', '✹', '✷', '✵', '✸', '✴︎', '✪', '✫', '✬', '✯', '✰', '✨'];
    const pick = () => mystic[Math.floor(Math.random() * mystic.length)];
    let sym1 = pick();
    let sym2 = pick();
    if (sym2 === sym1) {
      sym2 = pick();
    }

    // ===== 최종 조합 =====
    // - P1: 여러 문장 → 줄마다 개행, 단락 끝에는 \n\n
    // - P2: 정확히 2줄  → "기호 현재\n기호 미래"  (맨 앞에서만 기호 사용)
    // - P3: 자연스러운 한두 문장 (문장 끝 줄바꿈 보정, 마지막에 개행 없음)
    const parts = [];

    if (p1Clean) {
      let p1Final = p1Clean
        .replace(/([.?!…])\s+(?=[가-힣A-Za-z0-9“"'])/g, '$1\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
      p1Final = normalizeEscapedBreaks(p1Final);
      parts.push(p1Final);
    }

    if (p2cLine || p2fLine) {
      let line1 = p2cLine ? `${sym1} ${p2cLine}` : '';
      let line2 = p2fLine ? `${sym2} ${p2fLine}` : '';
      line1 = normalizeEscapedBreaks(line1);
      line2 = normalizeEscapedBreaks(line2);
      const p2Block = [line1, line2].filter(Boolean).join('\n');
      parts.push(p2Block);
    }

    if (p3Clean) {
      // P3도 자연스럽게 문장 끝 줄바꿈 보정
      let p3Final = p3Clean
        .replace(/([.?!…])\s+(?=[가-힣A-Za-z0-9“"'])/g, '$1\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
      p3Final = normalizeEscapedBreaks(p3Final);
      parts.push(p3Final);
    }

    // 단락 사이 빈 줄 1칸
    let explanation = parts.filter(Boolean).join('\n\n').trim();

    // 최종 방어: "/n" 혹은 남은 이스케이프가 있으면 모두 실제 개행으로
    explanation = normalizeEscapedBreaks(explanation);

    // ===== 길이 제한(서버 보증) =====
    const limit = Number(length_limit) || 1000;
    if (explanation.length > limit) {
      explanation = explanation.slice(0, limit).trim();
    }

    // 좌측 정렬은 클라이언트 Text 기본값(Left)으로 표시됨.
    return res.status(200).json({ explanation });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
