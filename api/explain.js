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
    // ::P2C:: [현재 브리핑+공감(한 문장 권장, 문장 끝 \n)] ::/P2C::
    // ::P2F:: [미래 전망(한 문장 권장, 문장 끝 \n)] ::/P2F::
    // ::P3:: [행동 하나 추천(한 문장)] ::/P3::
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
      '  ::P1:: [맥락 2~3문장, 문장마다 \\n으로 줄바꿈] ::/P1::',
      '  ::P2C:: [현재 브리핑+공감, 한 문장 권장, 마지막에 \\n] ::/P2C::',
      '  ::P2F:: [미래 전망, 한 문장 권장, 마지막에 \\n] ::/P2F::',
      '  ::P3:: [행동 하나만 추천: “이럴 땐 ○○ 해보는 거 어때요?” 한 문장] ::/P3::',
      '- 각 단락 사이에는 빈 줄 1칸(\\n\\n)이 보이도록 서버에서 조합한다.',
      `- 전체 길이: ${length_limit}자 이내(한글 기준).`,
      '- 종교 용어 남발 금지. 구절 언급은 가능하되 해석은 생활 중심, 세속적·실용적 관점.',
      '- 한국어 해요체 고정. 불필요한 장식(인용부호, 제목, 리스트, 괄호 안 설명 등) 금지.',
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

    // ===== 후처리(1): 표시 금지 요소 제거 =====
    const basicSanitize = (text) => {
      let s = text;

      // 줄머리 번호/불릿 제거
      s = s.replace(/^[ \t]*(\d+[.)]\s+|[-*•]\s+)/gm, '');
      // 마크다운 제목 기호 제거
      s = s.replace(/^[ \t]*#{1,6}\s+/gm, '');
      // [단락] 등 대괄호 표식/내용 제거 (사용자에게 괄호가 보이지 않도록)
      s = s.replace(/\[[^\]]*\]/g, '');
      // 섹션 레이블성 문구 제거
      s = s.replace(
        /^[ \t]*(말씀의\s*맥락\s*설명|현재\s*상황\s*브리핑\s*\+\s*공감|미래\s*(예언|전망)|행동\s*하나\s*추천)\s*:?\s*/gim,
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
    const cleanInnerNoBreaks = (t) =>
      (t || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // P1, P3 내부: 문장 끝에 줄바꿈이 들어올 수 있으므로 2개 이상 연속 개행을 1개로 축소, 끝 공백 제거
    const p1Clean = cleanInnerNoBreaks(p1);
    const p3Clean = cleanInnerNoBreaks(p3);

    // 2단락 현재/미래는 한 줄씩만 남기고 내부 개행 제거(문장 끝 개행은 서버에서 조합할 때 관리)
    const oneLine = (t) =>
      (t || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    const p2cLine = oneLine(p2c);
    const p2fLine = oneLine(p2f);

    // ===== 기호 선정: 신비로운 느낌의 기호들 중 무작위 선택 =====
    const mystic = ['✦', '✧', '❖', '◆', '◇', '✼', '✺', '✹', '✷', '✵', '✸', '✴︎', '✪', '✫', '✬', '✯', '✰', '✨'];
    const pick = () => mystic[Math.floor(Math.random() * mystic.length)];
    const sym1 = pick();
    const sym2 = pick();

    // ===== 최종 조합 =====
    // - P1 (여러 문장 -> 각 문장 끝 \n 유지, 단락 끝에는 \n\n)
    // - P2 (두 줄: "기호 현재\n기호 미래")
    // - P3 (문장 끝, 마지막에는 줄바꿈 없음)
    const parts = [];

    if (p1Clean) {
      // 문장 끝 줄바꿈이 없다면 문장 구분이 안 보일 수 있어서 구두점 기반 보정(과격하지 않게)
      let p1Final = p1Clean
        // 마커 누락 대비: 마침표 뒤 공백+한글 시작이면 줄바꿈(…/?! 포함)
        .replace(/([.?!…])\s+(?=[가-힣A-Za-z0-9“"'])/g, '$1\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
      parts.push(p1Final);
    }

    // 2단락(현재/미래) — 두 줄 모두 맨 앞에만 기호, 다른 곳엔 기호 삽입 금지
    if (p2cLine || p2fLine) {
      const line1 = p2cLine ? `${sym1} ${p2cLine}` : '';
      const line2 = p2fLine ? `${sym2} ${p2fLine}` : '';
      const p2Block = [line1, line2].filter(Boolean).join('\n');
      parts.push(p2Block);
    }

    if (p3Clean) {
      // P3도 문장 끝 줄바꿈 보정(필요 시 한 번)
      const p3Final = p3Clean.replace(/\n{2,}/g, '\n').trim();
      parts.push(p3Final);
    }

    // 단락 사이 빈 줄 1칸
    let explanation = parts.filter(Boolean).join('\n\n').trim();

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
