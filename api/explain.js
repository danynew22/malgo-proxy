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
    // 비종교인 대상 톤 강화 + 3단락 + 단락 사이 빈 줄 + 2단락 내부 줄바꿈(현재/미래 사이)
    // ⛳️ 내부 마커를 반드시 사용하게 하여 서버에서 치환/제거함:
    // ::P1:: ... ::/P1::
    // ::P2:: (현재 브리핑+공감) ::BR2:: (미래 예언) ::/P2::
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
      '- 각 단락 사이에는 빈 줄 1칸(\\n\\n)을 넣어 분리해요. (서버에서 보정함)',
      '- 단락 내부에서는 줄바꿈을 넣지 말되, **2단락에 한해서 현재→미래 사이에만 한 번 줄바꿈**을 넣어요.',
      '- 이 줄바꿈은 반드시 내부 마커(::BR2::)로 표기해요. 서버가 실제 개행으로 바꿔요.',
      '- 반드시 다음 내부 마커를 사용해서 생성해요(사용자에게는 보이지 않음):',
      '  ::P1:: [말씀 맥락 2~3문장, 간결/현실적] ::/P1::',
      '  ::P2:: [현재 브리핑+공감, 필요시 ✔/⭐/🔹로 시작] ::BR2:: [미래 예언(전망)] ::/P2::',
      '  ::P3:: [행동 하나만 추천: “이럴 땐 ○○ 해보는 거 어때요?” 한 문장] ::/P3::',
      `- 전체 길이: ${length_limit}자 이내(한글 기준).`,
      '- 종교 권유/교리 전개/축복 선언/믿음 강요/기도 강요 표현 금지. 구절 인용은 가능하되 해석은 생활 중심, 세속적·실용적 관점.',
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

    // ===== 후처리(1): 번호/소제목/[단락] 제거 등 1차 정리 =====
    const basicSanitize = (text) => {
      let s = text;

      // 줄머리 번호/불릿 제거: "1. ", "1) ", "- ", "* ", "• "
      s = s.replace(/^[ \t]*(\d+[.)]\s+|[-*•]\s+)/gm, '');

      // 마크다운 제목 기호 제거: "#", "##", ...
      s = s.replace(/^[ \t]*#{1,6}\s+/gm, '');

      // [단락] 표식 제거
      s = s.replace(/\[단락[^\]]*\]\s*/g, '');

      // 섹션 레이블 제거
      s = s.replace(
        /^[ \t]*(말씀의\s*맥락\s*설명|현재\s*상황\s*브리핑\s*\+\s*공감|미래\s*예언|행동\s*하나\s*추천)\s*:?\s*/gim,
        ''
      );

      // 과한 공백
      s = s.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

      return s.trim();
    };

    raw = basicSanitize(raw);

    // ===== 후처리(2): 내부 마커 기반 파싱 → 최종 문자열 구성 =====
    const parseByMarkers = (text) => {
      const get = (tag) => {
        const re = new RegExp(`::${tag}::([\\s\\S]*?)::\\/${tag}::`, 'i');
        const m = text.match(re);
        return m ? m[1].trim() : null;
        // [\s\S] to match across lines
      };

      const p1 = get('P1');
      const p2 = get('P2');
      const p3 = get('P3');

      if (!p1 && !p2 && !p3) return null; // markers not present

      // 2단락 내부: ::BR2:: 로 분리 (현재/미래)
      let p2Final = '';
      if (p2) {
        const parts = p2.split(/::BR2::/i).map((t) => t.trim());
        if (parts.length >= 2) {
          // 단락 내부에는 정확히 한 번의 줄바꿈 적용
          p2Final = `${parts[0]}\n${parts.slice(1).join(' ')}`.replace(/\n{2,}/g, '\n');
        } else {
          // BR2가 없으면 그냥 한 문단
          p2Final = p2.replace(/\n{2,}/g, '\n').replace(/\n/g, ' ');
        }
      }

      // 각 단락 내부의 불필요 개행/공백 정리 (단, p2는 위에서 한 줄 개행 유지)
      const cleanInner = (t) =>
        (t || '')
          .replace(/\r\n/g, '\n')
          .replace(/\n{2,}/g, '\n')
          .replace(/\n/g, ' ')
          .trim();

      const p1Final = cleanInner(p1);
      const p3Final = cleanInner(p3);

      // 최종 합치기: 단락 사이 빈 줄(\n\n)
      const paras = [p1Final, p2Final, p3Final].filter((x) => x && x.length > 0);
      return paras.join('\n\n').trim();
    };

    // 1차: 마커 파싱 시도
    let explanation = parseByMarkers(raw);

    // 2차: 마커가 없으면 기존 규칙으로 단락 보정 + 2단락 내부 줄바꿈 휴리스틱
    if (!explanation) {
      const normalizeParagraphs = (text) => {
        let s = text.replace(/\r\n/g, '\n').trim();
        // 3개 이상 개행 -> 2개
        s = s.replace(/\n{3,}/g, '\n\n');

        // 단락 구분 임시 토큰
        const MARK = '__<PBRK>__';
        s = s.replace(/\n{2,}/g, MARK);
        // 단락 내부 개행 제거
        s = s.replace(/\n/g, ' ');
        // 복구
        s = s.replace(new RegExp(MARK, 'g'), '\n\n').trim();

        // 3단락 강제
        const parts = s.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
        if (parts.length > 3) {
          s = [parts[0], parts[1], parts.slice(2).join(' ')].join('\n\n');
        } else if (parts.length < 3) {
          // 부족하면 최대한 3개에 맞춰 합성 (필요 시 빈 단락 제거)
          while (parts.length < 3) parts.push('');
          s = [parts[0], parts[1], parts[2]].join('\n\n').trim();
        } else {
          s = parts.join('\n\n');
        }

        // 2단락 내부 한 번 줄바꿈 휴리스틱: "앞으로", "미래" 같은 신호 앞에서 개행
        s = s.replace(/\n{3,}/g, '\n\n');
        const ps = s.split(/\n{2,}/);
        if (ps.length >= 2) {
          let p2 = ps[1];
          // 이미 개행이 없다면 신호어 앞에서 개행
          if (!/\n/.test(p2)) {
            p2 = p2.replace(
              /(앞으로[는도]?\s*)/,
              (m) => `\n${m}`
            );
            // 만약 신호어가 없었으면 그대로 두고, 혹시 개행이 2번 이상 생기면 1번으로 축소
            p2 = p2.replace(/\n{2,}/g, '\n');
          } else {
            // 개행이 2번 이상이면 1번으로 축소
            p2 = p2.replace(/\n{2,}/g, '\n');
          }
          ps[1] = p2;
          s = ps.join('\n\n').trim();
        }
        return s;
      };

      explanation = normalizeParagraphs(raw);
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
