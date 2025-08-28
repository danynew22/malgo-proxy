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
    // 내부 마커 사용 지시(서버에서 치환/제거):
    // ::P1:: ... ::/P1::
    // ::P2:: (현재) ::BR2:: (미래) ::/P2::
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
      '- 출력은 3개의 부분으로만 만들되, 번호/소제목/마크다운/대괄호 등 표시는 쓰지 마.',
      '- 1부분: 맥락을 2~3문장으로 간단히 설명. 종교 용어 남발 금지.',
      '- 2부분: (현재 상황 브리핑+공감) 다음 (미래에 대한 전망)을 생성하되, 두 내용을 마커(::BR2::)로 구분.',
      '- 3부분: 행동 하나만 명확히 추천(한 문장).',
      '- 내부 마커를 반드시 사용해: ::P1:: ... ::/P1::, ::P2:: 현재 ... ::BR2:: 미래 ... ::/P2::, ::P3:: ... ::/P3::',
      `- 전체 길이: ${length_limit}자 이내(한글 기준).`,
      '- 한국어 해요체 고정. 불필요한 장식(인용부호, 제목, 리스트 등) 금지.',
      '- “미래 예언/전망/단락/블록/규칙/형식” 같은 메타 표현은 내용으로 드러내지 마.',
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

    // ===== 유틸: 해시 기반 심볼 선택(호출/입력에 따라 다양화) =====
    const pickSymbols = (seed) => {
      const pool = ['✦','✧','❖','✷','✺','❇','☽','☼','✩','✪'];
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (h * 131 + seed.charCodeAt(i)) >>> 0;
      const i1 = h % pool.length;
      const i2 = (h >> 5) % pool.length;
      const a = pool[i1];
      const b = pool[i2 === i1 ? (i2 + 3) % pool.length : i2];
      return [a, b];
    };

    // ===== 1차 정리: 표식/번호/메타 용어/브라켓 제거 =====
    const basicSanitize = (text) => {
      let s = text;

      // 줄머리 번호/불릿 제거
      s = s.replace(/^[ \t]*(\d+[.)]\s+|[-*•]\s+)/gm, '');

      // 마크다운 제목 제거
      s = s.replace(/^[ \t]*#{1,6}\s+/gm, '');

      // [단락] 등 대괄호 표식 제거 + 각종 표시용 괄호 제거(설명 본문만 대상)
      s = s.replace(/\[[^\]]*\]/g, '');
      s = s.replace(/[<>{}]/g, ''); // 표시용 브라켓만 제거, 일반 괄호()는 유지

      // 메타 표현 제거
      s = s.replace(/미래\s*예언|전망|단락|블록|포맷|형식|포맷팅|출력\s*규칙/gi, '');

      // 과한 공백 정리
      s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

      return s.trim();
    };

    raw = basicSanitize(raw);

    // ===== 마커 파싱 → P1/P2/P3 분리 =====
    const extract = (tag, text) => {
      const re = new RegExp(`::${tag}::([\\s\\S]*?)::\\/${tag}::`, 'i');
      const m = text.match(re);
      return m ? m[1].trim() : null;
    };

    let p1 = extract('P1', raw);
    let p2 = extract('P2', raw);
    let p3 = extract('P3', raw);

    // ===== P2 현재/미래 분리(::BR2::), 문장/개행 규칙 적용 =====
    let p2Cur = '';
    let p2Fut = '';
    if (p2) {
      const parts = p2.split(/::BR2::/i).map((t) => t.trim()).filter(Boolean);
      if (parts.length >= 2) {
        p2Cur = parts[0].replace(/\n+/g, ' ').trim();
        p2Fut = parts.slice(1).join(' ').replace(/\n+/g, ' ').trim();
      } else {
        // BR2가 없으면 반반으로 나눌 수 없으니 한 줄로만 사용
        p2Cur = p2.replace(/\n+/g, ' ').trim();
      }
    }

    // ===== 1/3단락: 문장 끝마다 줄바꿈(빈 줄 없음) =====
    const sentenceBreak = (t) => {
      if (!t) return '';
      let s = t.replace(/\r\n/g, '\n').replace(/\n+/g, ' ').trim();
      // 문장 구분자 뒤에 줄바꿈: ., !, ?, 。, ！, ？
      s = s.replace(/([\.!?。！？])\s+/g, '$1\n');
      // 마지막 문장 뒤 공백 정리
      s = s.replace(/\n{2,}/g, '\n').trim();
      return s;
    };

    let p1Final = sentenceBreak(p1);
    let p3Final = sentenceBreak(p3);

    // ===== 2단락: 두 줄 고정 + 각 줄 맨앞에만 신비로운 기호 =====
    const [symA, symB] = pickSymbols(`${reference}||${verse}||${prompt_version}`);
    const p2Lines = [];
    if (p2Cur) p2Lines.push(`${symA} ${p2Cur}`);
    if (p2Fut) p2Lines.push(`${symB} ${p2Fut}`);
    let p2Final = p2Lines.join('\n'); // 딱 두 줄, 내부 추가 줄바꿈 없음

    // ===== 폴백: 마커가 없을 때(드물게) 3부분 강제 구성 =====
    if (!p1 && !p2 && !p3) {
      let s = raw.replace(/\r\n/g, '\n').trim();
      s = s.replace(/\n{3,}/g, '\n\n');
      const chunks = s.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
      p1Final = sentenceBreak(chunks[0] || '');
      // p2는 첫 문장/나머지로 분리해 2줄 구성
      const mid = (chunks[1] || '').replace(/\n+/g, ' ').trim();
      const m = mid.match(/^(.+?[\.!?。！？])(.*)$/);
      const cur = m ? m[1].trim() : mid;
      const fut = m && m[2] ? m[2].trim() : '';
      p2Final = [cur ? `${symA} ${cur}` : '', fut ? `${symB} ${fut}` : ''].filter(Boolean).join('\n');
      p3Final = sentenceBreak(chunks.slice(2).join(' ') || '');
    }

    // ===== 단락 결합: P1 + 빈 줄 + P2(2줄) + 빈 줄 + P3
    let explanation = [p1Final, p2Final, p3Final].filter(Boolean).join('\n\n');

    // ===== 마무리 살균: 남은 마커/브라켓/메타 단어 제거, 기호 오염 방지 =====
    explanation = explanation
      .replace(/::\/?P[123]::|::BR2::/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[<>{}]/g, '')
      .replace(/미래\s*예언|전망|단락|블록|포맷|형식|출력\s*규칙/gi, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // ===== 길이 제한(서버 보증) =====
    const limit = Number(length_limit) || 1000;
    if (explanation.length > limit) {
      explanation = explanation.slice(0, limit).trim();
    }

    // 좌측 정렬은 텍스트만 내려주면 클라 기본(TextAlign.start)으로 충족
    return res.status(200).json({ explanation });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
