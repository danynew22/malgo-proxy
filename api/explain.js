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
    // 비종교인 대상 톤 강화 + 3단락 + 단락 사이 빈 줄 보장
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
      '- 각 단락 사이에는 빈 줄 1칸(\\n\\n)을 넣어 분리해요.',
      '- 단락 내부에서는 줄바꿈을 넣지 말고 한 문단으로 이어서 써요.',
      '- 1단락: 말씀의 맥락을 2~3문장으로 간단히 설명해요. 종교 용어 남발 금지.',
      '- 2단락: 같은 단락 안에서 "현재 상황 브리핑+공감"을 말한 뒤, 곧바로 "미래 예언(전망)"을 이어서 써요. 문단 내부 빈 줄 금지. 필요하면 ✔/⭐/🔹 중 하나로 시작해도 돼요.',
      '- 3단락: 행동 하나만 딱 추천해요. “이럴 땐 ○○ 해보는 거 어때요?”처럼 한 문장으로 마무리해요.',
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

      // 섹션 레이블 제거
      s = s.replace(
        /^[ \t]*(말씀의\s*맥락\s*설명|현재\s*상황\s*브리핑\s*\+\s*공감|미래\s*예언|행동\s*하나\s*추천)\s*:?\s*/gim,
        ''
      );

      // 과한 공백 1차 정리
      s = s.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

      return s.trim();
    };

    explanation = sanitize(explanation);

    // ===== 단락 형식 보정: 단락 사이 빈 줄(\\n\\n), 단락 내부 줄바꿈 제거 =====
    const normalizeParagraphs = (text) => {
      let s = text.replace(/\r\n/g, '\n').trim();

      // 우선 2칸 이상의 연속 개행은 하나의 단락 구분자로 통일
      s = s.replace(/\n{2,}/g, '\n\n');

      // 단락 구분 임시 토큰으로 마킹
      const MARK = '__<PBRK>__';
      s = s.replace(/\n\n/g, MARK);

      // 남아있는 한 줄 개행은 단락 내부 개행으로 보고 공백으로 변환
      s = s.replace(/\n/g, ' ');

      // 임시 토큰을 실제 단락 구분(빈 줄)으로 복구
      s = s.replace(new RegExp(MARK, 'g'), '\n\n').trim();

      // 문장 앞뒤 불필요 공백 정리
      s = s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');

      // 3단락 강제(너무 많은 단락이 생기면 뒤를 3단락에 합침)
      const parts = s.split(/\n{2,}/);
      if (parts.length > 3) {
        s = [parts[0], parts[1], parts.slice(2).join(' ')].join('\n\n');
      }
      // 2단락 이하인 경우는 그대로 두지만, 앱에서 보여질 때 최소한 단락 구분은 유지됨
      return s;
    };

    explanation = normalizeParagraphs(explanation);

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
