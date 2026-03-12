// 멀티포맷 텍스트 추출 엔진
// 지원 형식: TXT, MD, DOCX, XLSX, CSV, JSON, HWP, HWPX, 이미지(JPG/PNG)
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
  '.hwp': 'hwp',
  '.hwpx': 'hwpx',
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
  'application/x-hwp': 'hwp',
  'application/haansofthwp': 'hwp',
  'application/vnd.hancom.hwp': 'hwp',
  'application/vnd.hancom.hwpx': 'hwpx',
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
const ACCEPTED_EXTENSIONS = '.pdf,.txt,.md,.markdown,.docx,.xlsx,.xls,.csv,.json,.hwp,.hwpx,.jpg,.jpeg,.png,.gif,.webp';

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
 * HWP 파일 추출 (.hwp)
 * hwp.js 라이브러리로 한글 문서 파싱
 * HWP는 한컴오피스에서 사용하는 한국 공공문서 표준 형식
 */
async function extractHwp(buffer, options = {}) {
  const { sectionType = 'paragraph' } = options;

  try {
    const { parse: hwpParse } = require('hwp.js');
    const doc = hwpParse(buffer);

    // HWPDocument 구조: doc.sections[].content[] (paragraph 배열)
    // paragraph.content[] = HWPChar 배열 (type: 'Char'|'Inline'|'Extened')
    const allParagraphs = [];

    for (let si = 0; si < doc.sections.length; si++) {
      const section = doc.sections[si];
      for (const paragraph of (section.content || [])) {
        // paragraph.content에서 텍스트 문자만 추출
        let text = '';
        for (const ch of (paragraph.content || [])) {
          if (ch.value !== undefined && ch.value !== null) {
            // 문자인 경우
            if (typeof ch.value === 'string') {
              text += ch.value;
            } else if (typeof ch.value === 'number') {
              // 제어 문자(10=줄바꿈, 13=캐리지리턴 등) 처리
              if (ch.value === 10 || ch.value === 13) {
                text += '\n';
              } else if (ch.value > 31) {
                text += String.fromCharCode(ch.value);
              }
            }
          }
        }
        text = text.trim();
        if (text.length > 0) {
          allParagraphs.push({ text, sectionNumber: si });
        }
      }
    }

    if (allParagraphs.length === 0) {
      // 텍스트 추출 실패 시 CFB PrvText 스트림에서 폴백 시도
      return extractHwpFallback(buffer, options);
    }

    if (sectionType === 'section') {
      // HWP 섹션(페이지) 단위로 분할
      const grouped = {};
      for (const p of allParagraphs) {
        if (!grouped[p.sectionNumber]) grouped[p.sectionNumber] = [];
        grouped[p.sectionNumber].push(p.text);
      }
      const sections = Object.entries(grouped).map(([num, texts], i) => ({
        sectionType: 'section',
        sectionIndex: i,
        text: texts.join('\n\n'),
        metadata: { hwpSection: parseInt(num, 10) + 1 },
      }));
      return { sections, totalItems: sections.length };
    }

    if (sectionType === 'paragraph') {
      return {
        sections: allParagraphs.map((p, i) => ({
          sectionType: 'paragraph',
          sectionIndex: i,
          text: p.text,
          metadata: { paragraphNumber: i + 1, hwpSection: p.sectionNumber + 1 },
        })),
        totalItems: allParagraphs.length,
      };
    }

    // 전체를 하나의 섹션으로
    const fullText = allParagraphs.map(p => p.text).join('\n\n');
    return {
      sections: [{
        sectionType: 'full',
        sectionIndex: 0,
        text: fullText,
        metadata: { format: 'hwp', charCount: fullText.length, paragraphCount: allParagraphs.length },
      }],
      totalItems: 1,
    };
  } catch (err) {
    console.warn('[HWP] hwp.js 파싱 실패, CFB 폴백 시도:', err.message);
    return extractHwpFallback(buffer, options);
  }
}

/**
 * HWP 폴백: CFB 컨테이너에서 PrvText 스트림 추출
 * PrvText는 HWP 파일에 포함된 텍스트 미리보기 (대부분의 HWP 파일에 존재)
 */
function extractHwpFallback(buffer, options = {}) {
  const CFB = require('cfb');
  const container = CFB.read(buffer);

  // PrvText 스트림 찾기 (UTF-16LE 인코딩)
  const prvText = CFB.find(container, 'PrvText');
  if (prvText && prvText.content && prvText.content.length > 0) {
    // PrvText는 UTF-16LE로 인코딩됨
    const textBuf = Buffer.from(prvText.content);
    let text = '';
    for (let i = 0; i < textBuf.length - 1; i += 2) {
      const code = textBuf.readUInt16LE(i);
      if (code === 0) break; // null 종료
      text += String.fromCharCode(code);
    }
    text = text.trim();

    if (text.length > 0) {
      const paragraphs = text.split(/\r?\n\s*\r?\n/).filter(p => p.trim());
      return {
        sections: paragraphs.map((p, i) => ({
          sectionType: 'paragraph',
          sectionIndex: i,
          text: p.trim(),
          metadata: { paragraphNumber: i + 1, method: 'prvtext-fallback' },
        })),
        totalItems: paragraphs.length,
      };
    }
  }

  throw new Error('HWP 파일에서 텍스트를 추출할 수 없습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.');
}

/**
 * HWPX 파일 추출 (.hwpx)
 * HWPX는 ZIP 기반 XML 형식 (DOCX와 유사한 구조)
 * Contents/section0.xml, section1.xml ... 에서 텍스트 추출
 */
async function extractHwpx(buffer, options = {}) {
  const { sectionType = 'paragraph' } = options;

  // HWPX는 ZIP 파일 → JSZip이나 직접 ZIP 파싱
  // cfb 패키지는 ZIP도 읽을 수 있음 (cfb.read가 ZIP 감지)
  const CFB = require('cfb');
  const container = CFB.read(buffer);

  // HWPX 구조: Contents/section0.xml, Contents/section1.xml, ...
  const sectionFiles = [];
  for (const entry of container.FileIndex) {
    if (entry.name && /Contents\/section\d+\.xml/i.test(entry.name)) {
      sectionFiles.push(entry);
    }
  }

  // 섹션 번호순 정렬
  sectionFiles.sort((a, b) => {
    const numA = parseInt(a.name.match(/section(\d+)/)?.[1] || '0', 10);
    const numB = parseInt(b.name.match(/section(\d+)/)?.[1] || '0', 10);
    return numA - numB;
  });

  if (sectionFiles.length === 0) {
    throw new Error('HWPX 파일에서 섹션을 찾을 수 없습니다.');
  }

  const allParagraphs = [];

  for (let si = 0; si < sectionFiles.length; si++) {
    const entry = sectionFiles[si];
    const xml = Buffer.from(entry.content).toString('utf-8');

    // XML에서 텍스트 노드 추출 (정규식 방식 — 경량, 외부 라이브러리 불필요)
    // <hp:t>텍스트</hp:t> 또는 <t>텍스트</t> 패턴
    const textMatches = xml.match(/<(?:hp:)?t[^>]*>([^<]*)<\/(?:hp:)?t>/g) || [];
    let currentParagraph = '';

    for (const match of textMatches) {
      const text = match.replace(/<[^>]+>/g, '').trim();
      if (text) currentParagraph += text;
    }

    // <hp:p> 또는 <p> 태그 기준으로 단락 구분
    const paraMatches = xml.split(/<(?:hp:)?p[\s>]/);
    for (const paraXml of paraMatches) {
      const texts = (paraXml.match(/<(?:hp:)?t[^>]*>([^<]*)<\/(?:hp:)?t>/g) || [])
        .map(m => m.replace(/<[^>]+>/g, '').trim())
        .filter(t => t.length > 0);

      if (texts.length > 0) {
        allParagraphs.push({ text: texts.join(''), sectionNumber: si });
      }
    }
  }

  if (allParagraphs.length === 0) {
    throw new Error('HWPX 파일에서 텍스트를 추출할 수 없습니다.');
  }

  if (sectionType === 'section') {
    const grouped = {};
    for (const p of allParagraphs) {
      if (!grouped[p.sectionNumber]) grouped[p.sectionNumber] = [];
      grouped[p.sectionNumber].push(p.text);
    }
    const sections = Object.entries(grouped).map(([num, texts], i) => ({
      sectionType: 'section',
      sectionIndex: i,
      text: texts.join('\n\n'),
      metadata: { hwpxSection: parseInt(num, 10) + 1 },
    }));
    return { sections, totalItems: sections.length };
  }

  if (sectionType === 'paragraph') {
    return {
      sections: allParagraphs.map((p, i) => ({
        sectionType: 'paragraph',
        sectionIndex: i,
        text: p.text,
        metadata: { paragraphNumber: i + 1, hwpxSection: p.sectionNumber + 1 },
      })),
      totalItems: allParagraphs.length,
    };
  }

  // 전체
  const fullText = allParagraphs.map(p => p.text).join('\n\n');
  return {
    sections: [{
      sectionType: 'full',
      sectionIndex: 0,
      text: fullText,
      metadata: { format: 'hwpx', charCount: fullText.length, paragraphCount: allParagraphs.length },
    }],
    totalItems: 1,
  };
}

/**
 * OCR 프롬프트 생성 (플러그인에서도 사용)
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
 * 이미지 OCR — OCR 엔진 매니저에 위임
 * 우선순위대로 시도하고 실패 시 자동 폴백
 */
async function extractImage(buffer, options = {}) {
  const { mimetype = 'image/jpeg', contentType = 'general' } = options;
  const base64 = buffer.toString('base64');
  const mediaType = mimetype.startsWith('image/') ? mimetype : 'image/jpeg';
  const prompt = getOcrPrompt(contentType);

  const { runOcr } = require('./ocr');
  const { text, engine, fallbackUsed } = await runOcr(base64, mediaType, prompt);

  return {
    sections: [{
      sectionType: 'ocr',
      sectionIndex: 0,
      text,
      metadata: { method: `${engine}-ocr`, contentType, fallback: fallbackUsed },
    }],
    totalItems: 1,
  };
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
    case 'hwp':
      return extractHwp(buffer, options);
    case 'hwpx':
      return extractHwpx(buffer, options);
    case 'image':
      return extractImage(buffer, options);
    default:
      throw new Error(`지원하지 않는 파일 형식: ${fileType}`);
  }
}

module.exports = {
  detectFileType,
  extractFromFile,
  getOcrPrompt,
  ACCEPTED_EXTENSIONS,
  EXTENSION_MAP,
  MIME_MAP,
};
