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
    // ⛳️ 마커 기반 단락 강제: <<<P1>>>, <<<P2>>>, <<<P3>>>
    //   - 모델은 반드시 세 단락을 위 마커로 감싸서 출력
    //   - 서버는 마커를 제거하고 단락 사이에 \n\n을 넣어 반환
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
      '- 출력은 총 3개의 단락(문단)으로만 구성하고, 번호/소제목/[단락]/마크다운은 절대 쓰지 마.',
      '- 각 단락은 반드시 다음 마커로 감싸서 출력해:',
      '  <<<P1>>> ... <<</P1>>>, <<<P2>>> ... <<</P2>>>, <<<P3>>> ... <<</P3>>>',
      '- 1단락(P1): 말씀의 맥락을 2~3문장으로 간단히 설명해요. 종교 용어 남발 금지.',
      '- 2단락(P2): 같은 단락 안에서 "현재 상황 브리핑+공감"을 말한 뒤, 곧바로 "미래 예언(전망)"을 이어서 써요. 필요하면 ✔/⭐/🔹 중 하나로 시작해도 돼요.',
      '- 3단락(P3): 행동 하나만 딱 추천해요. “이럴 땐 ○○ 해보는 거 어때요?”처럼 한 문장으로 마무리해요.',
      `- 전체 길이: ${length_limit}자 이내(한글 기준).`,
      '- 종교 권유/교리 전개/축복 선언/믿음 강요/기도 강요 표현 금지. 해석은 생활 중심, 세속적·실용적 관점.',
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
      raw = data.trim();
    } else {
      raw = JSON.stringify(data);
    }

    // ===== 후처리 1: 번호/소제목/[단락] 제거 =====
    const stripDecorations = (text) => {
      let s = text;
      s = s.replace(/^[ \t]*(\d+[.)]\s+|[-*•]\s+)/gm, '');
      s = s.replace(/^[ \t]*#{1,6}\s+/gm, '');
      s = s.replace(/\[단락[^\]]*\]\s*/g, '');
      s = s.replace(
        /^[ \t]*(말씀의\s*맥락\s*설명|현재\s*상황\s*브리핑\s*\+\s*공감|미래\s*예언|행동\s*하나\s*추천)\s*:?\s*/gim,
        ''
      );
      return s.trim();
    };

    raw = stripDecorations(raw);

    // ===== 후처리 2: 마커 기반 3단락 추출 → \n\n로 합치기 =====
    const extractByMarkers = (text) => {
      // 허용할 마커 패턴
      const grab = (name) => {
        const re = new RegExp(`<<<${name}>>>([\\s\\S]*?)<<\\/${name}>>>`, 'i');
        const m = text.match(re);
        return (m && m[1] ? m[1] : '').trim();
      };
      let p1 = grab('P1');
      let p2 = grab('P2');
      let p3 = grab('P3');

      // 혹시 마커가 누락되면 폴백: 내용 전체를 단락 추정
      if (!p1 && !p2 && !p3) {
        return null; // 폴백 경로로 처리
      }

      // 단락 내부 개행은 공백으로 평탄화(문단 유지)
      const flatten = (s) =>
        s.replace(/\r\n/g, '\n').replace(/\n{2,}/g, ' ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();

      p1 = flatten(p1);
      p2 = flatten(p2);
      p3 = flatten(p3);

      // 비어있는 단락은 제외하되, 최소 2개의 \n\n은 보장
      const parts = [p1, p2, p3].filter((x) => x && x.length > 0);
      return parts.join('\n\n').trim();
    };

    let explanation = extractByMarkers(raw);

    // ===== 후처리 3: 마커가 없을 때의 폴백(normalize) =====
    if (!explanation) {
      const normalizeParagraphs = (text) => {
        let s = text.replace(/\r\n/g, '\n').trim();
        // 과도한 개행 정리
        s = s.replace(/\n{3,}/g, '\n\n');
        // 단락 구분 임시 토큰
        const MARK = '__<PBRK>__';
        s = s.replace(/\n{2,}/g, MARK);
        // 단락 내부 개행은 공백으로
        s = s.replace(/\n/g, ' ');
        // 임시 토큰 복구
        s = s.replace(new RegExp(MARK, 'g'), '\n\n').trim();
        // 3단락 초과 시 3번째에 합치기
        const parts = s.split(/\n{2,}/);
        if (parts.length > 3) {
          s = [parts[0], parts[1], parts.slice(2).join(' ')].join('\n\n');
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
