// 멀티포맷 텍스트 추출 엔진
// 지원 형식: TXT, MD, DOCX, XLSX, CSV, JSON, 이미지(JPG/PNG)
//
// 각 형식별로 텍스트를 추출하고 섹션으로 분할하여 반환
// 반환 형식: { sections: [{ sectionType, sectionIndex, text, metadata }], totalItems }

const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { parse: csvParse } = require('csv-parse/sync');

// ── 파일 확장자 → 형식 매핑 ──
const EXTENSION_MAP = {
  '.txt': 'text',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.csv': 'csv',
  '.json': 'json',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.pdf': 'pdf',
};

// 지원하는 MIME 타입
const MIME_MAP = {
  'text/plain': 'text',
  'text/markdown': 'markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'text/csv': 'csv',
  'application/json': 'json',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'application/pdf': 'pdf',
};

/**
 * 파일 형식 감지
 * @param {string} filename - 파일명
 * @param {string} mimetype - MIME 타입
 * @returns {string} 파일 형식 ('text'|'markdown'|'docx'|'xlsx'|'csv'|'json'|'image'|'pdf'|'unknown')
 */
function detectFileType(filename, mimetype) {
  // 확장자 기반 감지
  const ext = (filename || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  if (EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];

  // MIME 타입 기반 감지
  if (mimetype && MIME_MAP[mimetype]) return MIME_MAP[mimetype];

  return 'unknown';
}

/**
 * 파일 형식별 허용 확장자 목록 (프론트 accept 속성용)
 */
const ACCEPTED_EXTENSIONS = '.pdf,.txt,.md,.markdown,.docx,.xlsx,.xls,.csv,.json,.jpg,.jpeg,.png,.gif,.webp';

/**
 * 텍스트 파일 추출 (.txt)
 */
function extractText(buffer, options = {}) {
  const text = buffer.toString('utf-8');
  const { sectionType = 'full' } = options;

  if (sectionType === 'line') {
    // 줄 단위 (빈 줄 기준 단락 분할)
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    return {
      sections: paragraphs.map((p, i) => ({
        sectionType: 'paragraph',
        sectionIndex: i,
        text: p.trim(),
        metadata: { paragraphNumber: i + 1 },
      })),
      totalItems: paragraphs.length,
    };
  }

  if (sectionType === 'custom' && options.customDelimiter) {
    const parts = text.split(new RegExp(options.customDelimiter)).filter(p => p.trim());
    return {
      sections: parts.map((p, i) => ({
        sectionType: 'custom',
        sectionIndex: i,
        text: p.trim(),
        metadata: { delimiter: options.customDelimiter },
      })),
      totalItems: parts.length,
    };
  }

  // 전체를 하나의 섹션으로
  return {
    sections: [{
      sectionType: 'full',
      sectionIndex: 0,
      text: text.trim(),
      metadata: { charCount: text.length },
    }],
    totalItems: 1,
  };
}

/**
 * 마크다운 파일 추출 (.md)
 * 헤딩(#) 기준으로 섹션 분할
 */
function extractMarkdown(buffer, options = {}) {
  const text = buffer.toString('utf-8');
  const { sectionType = 'heading' } = options;

  if (sectionType === 'heading') {
    // # 헤딩 기준 분할
    const lines = text.split('\n');
    const sections = [];
    let currentSection = { title: '', lines: [] };

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        // 이전 섹션 저장
        if (currentSection.lines.length > 0 || currentSection.title) {
          sections.push({
            sectionType: 'heading',
            sectionIndex: sections.length,
            text: currentSection.lines.join('\n').trim(),
            metadata: {
              heading: currentSection.title,
              level: currentSection.level || 0,
            },
          });
        }
        currentSection = {
          title: headingMatch[2],
          level: headingMatch[1].length,
          lines: [line],
        };
      } else {
        currentSection.lines.push(line);
      }
    }
    // 마지막 섹션
    if (currentSection.lines.length > 0) {
      sections.push({
        sectionType: 'heading',
        sectionIndex: sections.length,
        text: currentSection.lines.join('\n').trim(),
        metadata: {
          heading: currentSection.title,
          level: currentSection.level || 0,
        },
      });
    }

    return { sections, totalItems: sections.length };
  }

  // 전체를 하나의 섹션으로
  return {
    sections: [{
      sectionType: 'full',
      sectionIndex: 0,
      text: text.trim(),
      metadata: { format: 'markdown' },
    }],
    totalItems: 1,
  };
}

/**
 * Word 문서 추출 (.docx)
 * mammoth 라이브러리로 텍스트 추출
 */
async function extractDocx(buffer, options = {}) {
  const { sectionType = 'paragraph' } = options;

  // mammoth로 텍스트 추출 (HTML이 아닌 순수 텍스트)
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;

  if (sectionType === 'paragraph') {
    // 빈 줄 기준으로 단락 분할
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    return {
      sections: paragraphs.map((p, i) => ({
        sectionType: 'paragraph',
        sectionIndex: i,
        text: p.trim(),
        metadata: { paragraphNumber: i + 1 },
      })),
      totalItems: paragraphs.length,
    };
  }

  // 전체
  return {
    sections: [{
      sectionType: 'full',
      sectionIndex: 0,
      text: text.trim(),
      metadata: { format: 'docx', charCount: text.length },
    }],
    totalItems: 1,
  };
}

/**
 * Excel 파일 추출 (.xlsx, .xls)
 * 지정 열의 데이터를 행별 섹션으로 분할
 */
function extractExcel(buffer, options = {}) {
  const { contentColumn = '', sheetIndex = 0 } = options;

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[sheetIndex] || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) {
    return { sections: [], totalItems: 0 };
  }

  // 열 이름 목록 (프론트에서 선택용)
  const columns = Object.keys(rows[0]);

  // 콘텐츠 열이 지정되어 있으면 해당 열 기준
  if (contentColumn && columns.includes(contentColumn)) {
    return {
      sections: rows.map((row, i) => ({
        sectionType: 'row',
        sectionIndex: i,
        text: String(row[contentColumn] || '').trim(),
        metadata: {
          rowNumber: i + 1,
          rowData: row,
          sheet: sheetName,
        },
      })).filter(s => s.text.length > 0),
      totalItems: rows.length,
      columns,
      sheetNames: workbook.SheetNames,
    };
  }

  // 열이 지정되지 않으면 모든 열을 합쳐서 텍스트로
  return {
    sections: rows.map((row, i) => {
      const text = columns.map(col => `${col}: ${row[col]}`).join('\n');
      return {
        sectionType: 'row',
        sectionIndex: i,
        text: text.trim(),
        metadata: {
          rowNumber: i + 1,
          rowData: row,
          sheet: sheetName,
        },
      };
    }).filter(s => s.text.length > 0),
    totalItems: rows.length,
    columns,
    sheetNames: workbook.SheetNames,
  };
}

/**
 * CSV 파일 추출
 */
function extractCsv(buffer, options = {}) {
  const { contentColumn = '' } = options;
  const text = buffer.toString('utf-8');

  const rows = csvParse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (rows.length === 0) {
    return { sections: [], totalItems: 0 };
  }

  const columns = Object.keys(rows[0]);

  if (contentColumn && columns.includes(contentColumn)) {
    return {
      sections: rows.map((row, i) => ({
        sectionType: 'row',
        sectionIndex: i,
        text: String(row[contentColumn] || '').trim(),
        metadata: { rowNumber: i + 1, rowData: row },
      })).filter(s => s.text.length > 0),
      totalItems: rows.length,
      columns,
    };
  }

  return {
    sections: rows.map((row, i) => {
      const rowText = columns.map(col => `${col}: ${row[col]}`).join('\n');
      return {
        sectionType: 'row',
        sectionIndex: i,
        text: rowText.trim(),
        metadata: { rowNumber: i + 1, rowData: row },
      };
    }).filter(s => s.text.length > 0),
    totalItems: rows.length,
    columns,
  };
}

/**
 * JSON 파일 추출
 * 배열이면 각 요소를 섹션으로, 객체면 키별로 섹션 분할
 */
function extractJson(buffer, options = {}) {
  const { contentField = '' } = options;
  const text = buffer.toString('utf-8');
  const data = JSON.parse(text);

  // 배열인 경우
  if (Array.isArray(data)) {
    const fields = data.length > 0 ? Object.keys(data[0]) : [];

    if (contentField && data.length > 0 && data[0][contentField] !== undefined) {
      return {
        sections: data.map((item, i) => ({
          sectionType: 'item',
          sectionIndex: i,
          text: String(item[contentField] || '').trim(),
          metadata: { itemIndex: i, itemData: item },
        })).filter(s => s.text.length > 0),
        totalItems: data.length,
        fields,
      };
    }

    return {
      sections: data.map((item, i) => ({
        sectionType: 'item',
        sectionIndex: i,
        text: typeof item === 'string' ? item : JSON.stringify(item, null, 2),
        metadata: { itemIndex: i },
      })),
      totalItems: data.length,
      fields,
    };
  }

  // 객체인 경우: 키별로 섹션
  const keys = Object.keys(data);
  return {
    sections: keys.map((key, i) => ({
      sectionType: 'key',
      sectionIndex: i,
      text: typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key], null, 2),
      metadata: { key },
    })),
    totalItems: keys.length,
    fields: keys,
  };
}

/**
 * OCR 프롬프트 생성
 */
function getOcrPrompt(contentType) {
  if (contentType === 'table') {
    return '이 이미지에서 표(테이블) 데이터를 정확하게 추출해주세요. 행과 열을 구분하여 텍스트로 정리해주세요. 추가 설명 없이 추출된 내용만 반환해주세요.';
  } else if (contentType === 'quiz') {
    return '이 이미지에서 객관식 문제를 찾아 문제 번호, 본문, 보기를 정확히 추출해주세요. 추가 설명 없이 추출된 텍스트만 반환해주세요.';
  }
  return '이 이미지에 있는 모든 텍스트를 정확하게 추출해주세요. 구조(제목, 목록, 단락 등)를 유지하면서 텍스트만 반환해주세요. 추가 설명 없이 추출된 텍스트만 출력해주세요.';
}

/**
 * Gemini로 이미지 OCR (폴백용)
 */
async function ocrWithGemini(base64, mimetype, prompt) {
  const https = require('https');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: mimetype, data: base64 } },
        { text: prompt },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text.trim());
        } catch {
          reject(new Error('Gemini 응답 파싱 실패'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 이미지 OCR — Claude 우선, 실패 시 Gemini 자동 폴백
 * 토큰 소진 감지 + API 사용량 추적 포함
 */
async function extractImage(buffer, options = {}) {
  const { mimetype = 'image/jpeg', contentType = 'general' } = options;

  const base64 = buffer.toString('base64');
  const mediaType = mimetype.startsWith('image/') ? mimetype : 'image/jpeg';
  const prompt = getOcrPrompt(contentType);

  // 1차 시도: Claude Sonnet (전체를 try/catch로 감싸 어떤 에러든 Gemini로 넘어감)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
      const claude = new Anthropic({ apiKey: anthropicKey });
      const response = await claude.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      });
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (text) {
        return {
          sections: [{ sectionType: 'ocr', sectionIndex: 0, text, metadata: { method: 'claude-ocr', contentType } }],
          totalItems: 1,
        };
      }
    } catch (claudeErr) {
      console.warn('[OCR] Claude 실패 → Gemini 폴백:', claudeErr.message?.substring(0, 100));
    }
  }

  // 2차 시도: Gemini 폴백 (직접 호출 — tracker 의존성 제거)
  try {
    const text = await ocrWithGemini(base64, mediaType, prompt);
    if (text) {
      return {
        sections: [{ sectionType: 'ocr', sectionIndex: 0, text, metadata: { method: 'gemini-ocr', contentType, fallback: true } }],
        totalItems: 1,
      };
    }
  } catch (geminiErr) {
    console.error('[OCR] Gemini도 실패:', geminiErr.message);
  }

  throw new Error('이미지 OCR 실패: Claude, Gemini 모두 사용할 수 없습니다.');
}

/**
 * 메인 추출 함수 — 파일 형식에 따라 적절한 추출기 호출
 * @param {Buffer} buffer - 파일 버퍼
 * @param {string} fileType - 감지된 파일 형식
 * @param {Object} options - 형식별 옵션
 * @returns {Promise<Object>} { sections, totalItems, columns?, fields? }
 */
async function extractFromFile(buffer, fileType, options = {}) {
  switch (fileType) {
    case 'text':
      return extractText(buffer, options);
    case 'markdown':
      return extractMarkdown(buffer, options);
    case 'docx':
      return extractDocx(buffer, options);
    case 'xlsx':
      return extractExcel(buffer, options);
    case 'csv':
      return extractCsv(buffer, options);
    case 'json':
      return extractJson(buffer, options);
    case 'image':
      return extractImage(buffer, options);
    default:
      throw new Error(`지원하지 않는 파일 형식: ${fileType}`);
  }
}

module.exports = {
  detectFileType,
  extractFromFile,
  ACCEPTED_EXTENSIONS,
  EXTENSION_MAP,
  MIME_MAP,
};
