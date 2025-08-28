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
    // 내부 마커 사용 지시:
    // ::P1:: ... ::/P1::
    // ::P2:: (현재 브리핑+공감) ::BR2:: (미래 예측/전망) ::/P2::
    // ::P3:: ... ::/P3::
    const sysRole =
      '너는 주어진 성경 구절을 바탕으로, 비종교 독자도 편안히 읽을 수 있게 현실적이고 일상적인 언어로 풀어주는 해석자야. ' +
      '설교체/교리 설명/전도성 권유는 피하고, 신학적 단정 대신 생활 맥락과 감정에 공감하는 설명을 해. ' +
      '항상 한국어 해요체(예: ~해요, ~해보세요)로 답해.';

    const formatRules = [
      `프롬프트 버전: ${prompt_version}`,
      `톤(참고): ${tone}`,
      instructions ? `추가 지시: ${instructions}` : '',
      '',
      '출력 규칙(엄격):',
      '- 출력은 총 3개의 단락(문단)으로 구성하고, 번호/소제목/[단락]/마크다운은 절대 쓰지 마.',
      '- 각 단락 사이는 빈 줄 1칸(\\n\\n).',
      '- 단락 내부 줄바꿈은 금지하되, **2단락에 한해서 현재→미래 사이에만 한 번 줄바꿈**을 ::BR2::로 넣어.',
      '- 반드시 내부 마커를 사용해 생성해(사용자에게는 보이지 않음):',
      '  ::P1:: [말씀 맥락 2~3문장, 간결/현실적] ::/P1::',
      '  ::P2:: [현재 브리핑+공감] ::BR2:: [미래 전망] ::/P2::',
      '  ::P3:: [행동 하나만 추천: “이럴 땐 ○○ 해보는 거 어때요?” 한 문장] ::/P3::',
      `- 전체 길이: ${length_limit}자 이내(한글 기준).`,
      '- 종교 권유/교리 전개/축복·믿음·기도 강요 표현 금지. 구절 인용은 가능하되 해석은 생활 중심, 세속적·실용적 관점.',
      '- 한국어 해요체 고정. 불필요한 장식(인용부호, 제목, 리스트 등) 금지.',
      '',
      `성경 구절: ${reference}`,
      `본문: ${verse}`,
    ].filter(Boolean).join('\n');

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
      raw = data.output.map((p) => {
        if (!p?.content) return '';
        try { return p.content.map((c) => c?.text || '').join(''); } catch { return ''; }
      }).join('').trim();
    } else if (typeof data === 'string') {
      raw = data;
    } else {
      raw = JSON.stringify(data);
    }

    // ===== 공통 유틸 =====
    const BULLETS = '✔⭐🔹•▪▸➤→➡✦❖◦➔➜';
    const SYMBOLS = ['✔', '⭐', '🔹', '•', '▪', '▸', '➤', '→', '➡', '✦', '❖', '◦', '➔', '➜'];

    const stripLeadingSymbol = (line) =>
      String(line).replace(new RegExp(`^[ \\t]*[${BULLETS}\\-–—][ \\t]*`), '').trim();

    // 본문 내부(맨 앞 제외)의 불릿/이모지 제거
    const stripInnerSymbols = (line) =>
      String(line)
        // 줄 맨 앞 보존을 위해, 줄 시작 이후에 등장하는 불릿을 삭제
        .replace(new RegExp(`(?<!^)[ \\t]*[${BULLETS}][ \\t]*`, 'g'), ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

    // (요청/분류 노출 방지) 괄호/대괄호로 감싼 분류 힌트 제거
    const stripCategoryHintsAll = (text) =>
      String(text)
        // 줄 시작에서 [현재], (미래 예언), 등 제거
        .replace(/^[ \t]*[\(\[]\s*(현재|미래|예언|전망|브리핑)[^)\]]*[\)\]]\s*:?\s*/gim, '')
        // 본문 어딘가에 삽입된 분류 힌트도 제거
        .replace(/[\(\[]\s*(현재|미래|예언|전망|브리핑)[^)\]]*[\)\]]/gim, '')
        .trim();

    // 문장 끝에서 1줄 개행(단락 내부에서만 사용)
    const breakSentences = (text) =>
      String(text)
        .replace(/\r\n/g, '\n')
        // ., !, ?, …, 。, ！, ？ 뒤에 공백이 오면 1줄 개행으로
        .replace(/([.!?？！。…])(?!\n)\s+/g, '$1\n')
        // 중복 개행은 1줄로 축소
        .replace(/\n{2,}/g, '\n')
        .trim();

    // ===== 후처리(1): 번호/소제목/[단락]/헤더/분류라벨 제거 =====
    const basicSanitize = (text) => {
      let s = text;
      s = s.replace(/^[ \t]*(\d+[.)]\s+|[-*•]\s+)/gm, '');   // 줄머리 불릿/번호
      s = s.replace(/^[ \t]*#{1,6}\s+/gm, '');               // 마크다운 헤더
      s = s.replace(/\[단락[^\]]*\]\s*/g, '');               // [단락] 표식
      s = s.replace(
        /^[ \t]*(말씀의\s*맥락\s*설명|현재\s*상황\s*브리핑\s*\+\s*공감|미래\s*(예언|전망)|행동\s*하나\s*추천)\s*:?\s*/gim,
        ''
      );
      // 괄호로 된 분류/가이드 흔적 제거
      s = stripCategoryHintsAll(s);
      // 과한 공백 정리
      s = s.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      return s;
    };

    raw = basicSanitize(raw);

    // ===== 후처리(2): 마커 파싱 → 단락 조립(+ 2단락 기호/개행 규칙) =====
    const parseByMarkers = (text) => {
      const get = (tag) => {
        const re = new RegExp(`::${tag}::([\\s\\S]*?)::\\/${tag}::`, 'i');
        const m = text.match(re);
        return m ? m[1].trim() : null;
      };

      const p1 = get('P1');
      const p2 = get('P2');
      const p3 = get('P3');
      if (!p1 && !p2 && !p3) return null; // markers not present

      // P1, P3: 내부 문장 끝마다 개행 (가독성), 단락 밖은 \n\n
      const cleanPara = (t) => breakSentences(
        stripCategoryHintsAll(
          stripInnerSymbols(
            stripLeadingSymbol(t || '')
          )
        )
      );

      const p1Final = cleanPara(p1);

      // P2: 현재/미래 2줄, 각 줄 맨 앞에만 기호 1개, 본문 중간 기호 제거, 문장 끝마다 개행
      let p2Final = '';
      if (p2) {
        const parts = p2.split(/::BR2::/i).map((x) => x.trim());
        const [sym1, sym2] = (() => {
          const a = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
          let b = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
          if (b === a) b = SYMBOLS[(SYMBOLS.indexOf(b) + 1) % SYMBOLS.length];
          return [a, b];
        })();

        if (parts.length >= 2) {
          const current = breakSentences(stripInnerSymbols(stripLeadingSymbol(stripCategoryHintsAll(parts[0]))));
          const future  = breakSentences(stripInnerSymbols(stripLeadingSymbol(stripCategoryHintsAll(parts.slice(1).join(' ')))));
          p2Final = `${sym1} ${current}\n${sym2} ${future}`.replace(/\n{2,}/g, '\n'); // 2줄 사이는 1개행
        } else {
          const only = breakSentences(stripInnerSymbols(stripLeadingSymbol(stripCategoryHintsAll(p2))));
          p2Final = `${sym1} ${only}`;
        }
      }

      const p3Final = cleanPara(p3);

      // 최종 합치기: 단락 사이 빈 줄(\n\n)
      return [p1Final, p2Final, p3Final].filter(Boolean).join('\n\n').trim();
    };

    // 1차: 마커 파싱
    let explanation = parseByMarkers(raw);

    // 2차: 마커 없을 때의 보정(휴리스틱) — 3단락 유지 + P2 2줄화 + 기호·개행 규칙 적용
    if (!explanation) {
      let s = raw.replace(/\r\n/g, '\n').trim();
      s = stripCategoryHintsAll(s);
      s = s.replace(/\n{3,}/g, '\n\n');

      // 단락 분리 통일
      const MARK = '__<PBRK>__';
      s = s.replace(/\n{2,}/g, MARK).replace(/\n/g, ' ').replace(new RegExp(MARK, 'g'), '\n\n').trim();

      // 3단락으로 맞추기
      let parts = s.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
      if (parts.length > 3) parts = [parts[0], parts[1], parts.slice(2).join(' ')];
      if (parts.length < 3) while (parts.length < 3) parts.push('');

      const cleanPara = (t) => breakSentences(
        stripCategoryHintsAll(
          stripInnerSymbols(
            stripLeadingSymbol(t || '')
          )
        )
      );

      // P2 2줄 분리 시도
      let second = parts[1] || '';
      if (!/\n/.test(second)) {
        const before = second;
        // 신호어 앞에서 줄바꿈 시도
        second = second.replace(/(앞으로[는도]?\s*)/, (m) => `\n${m}`);
        if (second === before) {
          second = second.replace(/([.!?？！。…])\s+/, '$1\n');
        }
      }
      second = second.replace(/\n{2,}/g, '\n');

      // 현재/미래 라인별 기호 1회만
      const a = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      let b = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      if (b === a) b = SYMBOLS[(SYMBOLS.indexOf(b) + 1) % SYMBOLS.length];

      const lines = second.split('\n');
      if (lines.length >= 2) {
        const current = breakSentences(stripInnerSymbols(stripLeadingSymbol(stripCategoryHintsAll(lines[0]))));
        const future  = breakSentences(stripInnerSymbols(stripLeadingSymbol(stripCategoryHintsAll(lines.slice(1).join(' ')))));
        parts[1] = `${a} ${current}\n${b} ${future}`;
      } else {
        parts[1] = `${a} ${breakSentences(stripInnerSymbols(stripLeadingSymbol(stripCategoryHintsAll(second))))}`;
      }

      // P1, P3
      parts[0] = cleanPara(parts[0]);
      parts[2] = cleanPara(parts[2]);

      explanation = parts.join('\n\n').trim();
    }

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
