// PDF 텍스트 추출 엔진
// - 텍스트 PDF: pdf-parse 라이브러리로 추출
// - 이미지/스캔 PDF: Claude Opus 4.6 비전 API로 OCR
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk').default;

// Claude 클라이언트 (OCR용)
function getClaudeClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  }
  return new Anthropic({ apiKey });
}

/**
 * PDF 버퍼에서 텍스트를 추출하는 메인 함수
 * @param {Buffer} pdfBuffer - PDF 파일 버퍼
 * @param {Object} options - 추출 옵션
 * @param {string} options.sectionType - 추출 단위: 'page' | 'full' | 'custom' | 'quiz'
 * @param {string} options.customDelimiter - sectionType이 'custom'일 때 구분자 (정규식 문자열)
 * @returns {Object} { pages: [...], sections: [...], totalPages, extractionMethod }
 */
async function extractFromPdf(pdfBuffer, options = {}) {
  const { sectionType = 'page', customDelimiter } = options;

  // 1단계: pdf-parse로 기본 추출
  const parsed = await pdfParse(pdfBuffer);
  const totalPages = parsed.numpages;

  // 2단계: 페이지별 텍스트 추출
  // pdf-parse는 전체 텍스트만 제공하므로, 페이지 구분을 위해 별도 처리
  const pageTexts = await extractPageTexts(pdfBuffer, parsed);

  // 3단계: 각 페이지의 텍스트 품질 확인 → 빈 페이지는 OCR 시도
  const processedPages = await processPages(pageTexts, pdfBuffer);

  // 4단계: 선택한 추출 단위로 섹션 분할
  // quiz 타입은 Claude AI로 객관식 문제를 파싱
  let sections;
  if (sectionType === 'quiz') {
    sections = await parseQuizWithClaude(processedPages, pdfBuffer);
  } else {
    sections = splitIntoSections(processedPages, sectionType, customDelimiter);
  }

  return {
    totalPages,
    fullText: parsed.text,
    pages: processedPages,
    sections,
    sectionType,
  };
}

/**
 * 페이지별 텍스트를 추출
 * pdf-parse는 전체 텍스트를 하나로 합치므로,
 * 페이지 나누기 문자(\f, form feed)를 기준으로 분리
 */
async function extractPageTexts(pdfBuffer, parsed) {
  // pdf-parse 결과에서 페이지 분리 (form feed 문자 기준)
  const rawPages = parsed.text.split('\f');

  return rawPages.map((text, index) => ({
    pageNumber: index + 1,
    text: text.trim(),
    // 텍스트가 너무 적으면 이미지 페이지로 판단 (50자 미만)
    isImagePage: text.trim().length < 50,
    method: 'pdf-parse',
  }));
}

/**
 * 각 페이지를 처리 — 이미지 페이지는 Claude OCR 시도
 */
async function processPages(pageTexts, pdfBuffer) {
  const results = [];

  for (const page of pageTexts) {
    if (page.isImagePage) {
      // 이미지 페이지 → Claude 비전 OCR 시도
      try {
        const ocrText = await ocrPageWithClaude(pdfBuffer, page.pageNumber);
        results.push({
          pageNumber: page.pageNumber,
          text: ocrText || page.text, // OCR 실패 시 원본 유지
          method: ocrText ? 'claude-ocr' : 'pdf-parse',
          isImagePage: true,
        });
      } catch (err) {
        console.error(`페이지 ${page.pageNumber} OCR 실패:`, err.message);
        // OCR 실패해도 기존 텍스트라도 유지
        results.push({ ...page, method: 'pdf-parse (OCR 실패)' });
      }
    } else {
      results.push(page);
    }
  }

  return results;
}

/**
 * Claude Opus 4.6 비전 API로 PDF 페이지 OCR
 * PDF를 직접 base64로 보내서 텍스트 추출 요청
 */
async function ocrPageWithClaude(pdfBuffer, pageNumber) {
  const claude = getClaudeClient();

  // PDF 전체를 base64로 인코딩하여 전송
  const base64Pdf = pdfBuffer.toString('base64');

  const response = await claude.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Pdf,
            },
          },
          {
            type: 'text',
            text: `이 PDF의 ${pageNumber}페이지에 있는 모든 텍스트를 정확하게 추출해주세요. 표, 목록, 제목 등의 구조를 유지하면서 텍스트만 반환해주세요. 추가 설명 없이 추출된 텍스트만 출력해주세요.`,
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  return text.trim();
}

/**
 * 추출된 페이지들을 선택한 단위로 섹션 분할
 * @param {Array} pages - 처리된 페이지 배열
 * @param {string} sectionType - 'page' | 'full' | 'custom'
 * @param {string} customDelimiter - 사용자 정의 구분자 (정규식 문자열)
 * @returns {Array} 섹션 배열
 */
function splitIntoSections(pages, sectionType, customDelimiter) {
  switch (sectionType) {
    case 'page':
      // 페이지 단위: 각 페이지가 하나의 섹션
      return pages.map((page, index) => ({
        sectionType: 'page',
        sectionIndex: index,
        text: page.text,
        metadata: {
          pageNumber: page.pageNumber,
          method: page.method,
        },
      }));

    case 'full':
      // 문서 전체: 모든 페이지 텍스트를 하나로 합침
      return [{
        sectionType: 'full',
        sectionIndex: 0,
        text: pages.map(p => p.text).join('\n\n'),
        metadata: {
          pageCount: pages.length,
          methods: [...new Set(pages.map(p => p.method))],
        },
      }];

    case 'custom':
      // 사용자 정의 구분자로 분할
      if (!customDelimiter) {
        // 구분자 없으면 페이지 단위로 폴백
        return splitIntoSections(pages, 'page');
      }
      return splitByDelimiter(pages, customDelimiter);

    default:
      return splitIntoSections(pages, 'page');
  }
}

/**
 * 사용자 정의 구분자로 텍스트 분할
 * 예: "제\\d+조" → 법령의 조항 단위로 분할
 * 예: "문제\\s*\\d+" → 기출문제 번호 단위로 분할
 */
function splitByDelimiter(pages, delimiterPattern) {
  // 전체 텍스트를 합친 후 구분자로 분할
  const fullText = pages.map(p => p.text).join('\n\n');
  const regex = new RegExp(`(${delimiterPattern})`, 'g');
  const parts = fullText.split(regex);

  const sections = [];
  let currentText = '';
  let sectionIndex = 0;

  for (let i = 0; i < parts.length; i++) {
    if (regex.test(parts[i])) {
      // 이전 섹션 저장 (내용이 있으면)
      if (currentText.trim()) {
        sections.push({
          sectionType: 'custom',
          sectionIndex: sectionIndex++,
          text: currentText.trim(),
          metadata: { delimiter: delimiterPattern },
        });
      }
      // 구분자를 다음 섹션의 시작으로
      currentText = parts[i];
      // regex.lastIndex 리셋 (test가 lastIndex를 변경하므로)
      regex.lastIndex = 0;
    } else {
      currentText += parts[i];
    }
  }

  // 마지막 섹션 저장
  if (currentText.trim()) {
    sections.push({
      sectionType: 'custom',
      sectionIndex: sectionIndex,
      text: currentText.trim(),
      metadata: { delimiter: delimiterPattern },
    });
  }

  return sections;
}

/**
 * OpenAI GPT-4o로 객관식 문제를 자동 인식/파싱 (분할 요청 방식)
 *
 * 문제가 많으면 토큰 초과로 잘리는 문제를 방지하기 위해:
 * 1단계: 문서에서 총 문제 수와 번호 목록을 먼저 파악
 * 2단계: 10문제씩 나눠서 상세 파싱 요청
 * 3단계: 결과를 합쳐서 반환
 *
 * 반환 형식:
 * [{ sectionType: 'quiz', sectionIndex: 0, text: '...', metadata: { number, body, choices, answer, subject } }]
 */
async function parseQuizWithClaude(pages, pdfBuffer) {
  const OpenAI = require('openai');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  }
  const openai = new OpenAI({ apiKey });

  const fullText = pages.map(p => p.text).join('\n\n');

  // 텍스트가 충분하면 텍스트로, 부족하면 이미지(비전)로 분석
  const hasEnoughText = fullText.trim().length > 200;

  // 비전 분석용 PDF base64 (텍스트 부족 시 사용)
  const base64Pdf = hasEnoughText ? null : pdfBuffer.toString('base64');

  // ── 1단계: 총 문제 수와 번호 목록 파악 ──
  console.log('   [quiz] 1단계: 문제 수 파악 중...');
  const countPrompt = `이 문서에서 객관식 문제가 몇 개인지, 각 문제 번호를 JSON으로 알려주세요.

반환 형식 (JSON만, 설명 없이):
{ "total": 40, "numbers": [1, 2, 3, ..., 40] }`;

  let countContent;
  if (hasEnoughText) {
    countContent = fullText;
  } else {
    countContent = [
      { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
      { type: 'text', text: countPrompt },
    ];
  }

  const countCompletion = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: '시험 문서에서 문제 번호를 정확히 파악하는 전문가입니다. JSON만 반환하세요.' },
      { role: 'user', content: hasEnoughText ? `${countPrompt}\n\n---\n${fullText}` : countContent },
    ],
  });

  let questionNumbers;
  try {
    const countText = countCompletion.choices[0].message.content;
    const countJson = countText.match(/\{[\s\S]*\}/);
    const countData = JSON.parse(countJson[0]);
    questionNumbers = countData.numbers || [];
    console.log(`   [quiz] 총 ${questionNumbers.length}개 문제 발견: ${questionNumbers[0]}~${questionNumbers[questionNumbers.length - 1]}번`);
  } catch (err) {
    // 1단계 실패 시 기본 1~40번으로 가정
    console.error('   [quiz] 문제 수 파악 실패, 기본 범위 사용:', err.message);
    questionNumbers = Array.from({ length: 40 }, (_, i) => i + 1);
  }

  // ── 2단계: 10문제씩 분할하여 상세 파싱 ──
  const BATCH_SIZE = 10; // 한 번에 요청할 문제 수
  const batches = [];
  for (let i = 0; i < questionNumbers.length; i += BATCH_SIZE) {
    batches.push(questionNumbers.slice(i, i + BATCH_SIZE));
  }
  console.log(`   [quiz] 2단계: ${batches.length}개 배치로 분할 파싱 (배치당 ${BATCH_SIZE}문제)`);

  const systemPrompt = `당신은 시험 문제 파싱 전문가입니다. 주어진 문서에서 지정된 범위의 객관식 문제를 찾아 JSON 배열로 반환해주세요.

각 문제는 다음 형식으로:
{
  "number": 1,
  "subject": "과목명 (알 수 있으면)",
  "body": "문제 본문 텍스트",
  "choices": ["① 보기1", "② 보기2", "③ 보기3", "④ 보기4"],
  "answer": null
}

규칙:
- 문제 번호는 원본 그대로 유지
- 보기 번호는 ①②③④ 형식으로 통일
- 정답이 문서에 있으면 answer에 번호(숫자)를 넣고, 없으면 null
- 문제 본문에 보기는 포함하지 않기
- 과목명이 파악되면 subject에 넣기
- JSON 배열만 반환 (설명 없이)
- 지정된 범위의 문제만 추출할 것`;

  // 모든 배치 결과를 모을 배열
  const allQuestions = [];

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const rangeStr = `${batch[0]}번 ~ ${batch[batch.length - 1]}번`;
    console.log(`   [quiz] 배치 ${batchIdx + 1}/${batches.length}: ${rangeStr} 파싱 중...`);

    const batchRequest = `아래 문서에서 ${rangeStr} 문제만 찾아 JSON 배열로 반환해주세요.\n\n---\n${fullText}`;

    let userContent;
    if (hasEnoughText) {
      userContent = batchRequest;
    } else {
      userContent = [
        { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
        { type: 'text', text: `이 문서에서 ${rangeStr} 문제만 찾아 JSON으로 반환해주세요.` },
      ];
    }

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });

      const responseText = completion.choices[0].message.content;

      // JSON 파싱 (코드블록 감싸져 있을 수 있으므로 추출)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error(`   [quiz] 배치 ${batchIdx + 1} JSON 없음, 건너뜀`);
        continue;
      }
      const batchQuestions = JSON.parse(jsonMatch[0]);
      console.log(`   [quiz] 배치 ${batchIdx + 1}: ${batchQuestions.length}개 문제 파싱 완료`);
      allQuestions.push(...batchQuestions);
    } catch (batchErr) {
      console.error(`   [quiz] 배치 ${batchIdx + 1} 실패:`, batchErr.message);
      // 실패한 배치는 건너뛰고 계속 진행
    }
  }

  // ── 3단계: 결과 합치기 ──
  console.log(`   [quiz] 3단계: 총 ${allQuestions.length}개 문제 파싱 완료`);

  if (allQuestions.length === 0) {
    // 전체 실패 시 폴백
    return [{
      sectionType: 'quiz',
      sectionIndex: 0,
      text: fullText,
      metadata: { error: '객관식 문제 파싱 실패 (모든 배치 실패)' },
    }];
  }

  // 문제 번호 기준으로 정렬 (배치 간 중복 제거 포함)
  const seen = new Set();
  const uniqueQuestions = allQuestions.filter(q => {
    const num = q.number;
    if (seen.has(num)) return false;
    seen.add(num);
    return true;
  });
  uniqueQuestions.sort((a, b) => (a.number || 0) - (b.number || 0));

  // 파싱된 문제들을 섹션으로 변환
  return uniqueQuestions.map((q, index) => {
    // 문제 텍스트 조합 (검색/표시용)
    const choicesText = (q.choices || []).join('\n');
    const displayText = `${q.number || index + 1}. ${q.body}\n${choicesText}`;

    return {
      sectionType: 'quiz',
      sectionIndex: index,
      text: displayText,
      metadata: {
        number: q.number || index + 1,
        body: q.body,
        choices: q.choices || [],
        answer: q.answer,
        subject: q.subject || null,
      },
    };
  });
}

module.exports = { extractFromPdf, ocrPageWithClaude, parseQuizWithClaude };
