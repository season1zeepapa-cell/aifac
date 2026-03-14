// 파일 형식별 설정
export const FILE_TYPE_CONFIG = {
  pdf: {
    label: 'PDF',
    icon: '📄',
    color: 'red',
    accept: '.pdf',
    hasPdfLoaderSelect: true,
    sectionOptions: [
      { value: 'page', label: '페이지별' },
      { value: 'full', label: '문서 전체' },
      { value: 'quiz', label: '객관식 문제' },
      { value: 'custom', label: '구분자 기준' },
    ],
  },
  text: {
    label: '텍스트',
    icon: '📝',
    color: 'gray',
    accept: '.txt',
    sectionOptions: [
      { value: 'full', label: '문서 전체' },
      { value: 'line', label: '단락별 (빈 줄 기준)' },
      { value: 'custom', label: '구분자 기준' },
    ],
  },
  markdown: {
    label: '마크다운',
    icon: '📋',
    color: 'primary',
    accept: '.md,.markdown',
    sectionOptions: [
      { value: 'heading', label: '헤딩(#) 기준' },
      { value: 'full', label: '문서 전체' },
    ],
  },
  docx: {
    label: 'Word',
    icon: '📘',
    color: 'primary',
    accept: '.docx',
    sectionOptions: [
      { value: 'paragraph', label: '단락별' },
      { value: 'full', label: '문서 전체' },
    ],
  },
  xlsx: {
    label: 'Excel',
    icon: '📊',
    color: 'green',
    accept: '.xlsx,.xls',
    sectionOptions: [
      { value: 'row', label: '행별' },
    ],
    hasColumnSelect: true,
  },
  csv: {
    label: 'CSV',
    icon: '📊',
    color: 'green',
    accept: '.csv',
    sectionOptions: [
      { value: 'row', label: '행별' },
    ],
    hasColumnSelect: true,
  },
  json: {
    label: 'JSON',
    icon: '🔧',
    color: 'yellow',
    accept: '.json',
    sectionOptions: [
      { value: 'item', label: '항목별' },
    ],
    hasFieldSelect: true,
  },
  hwp: {
    label: 'HWP',
    icon: '📃',
    color: 'primary',
    accept: '.hwp',
    sectionOptions: [
      { value: 'paragraph', label: '단락별' },
      { value: 'section', label: '섹션(페이지)별' },
      { value: 'full', label: '문서 전체' },
    ],
  },
  hwpx: {
    label: 'HWPX',
    icon: '📃',
    color: 'primary',
    accept: '.hwpx',
    sectionOptions: [
      { value: 'paragraph', label: '단락별' },
      { value: 'section', label: '섹션(페이지)별' },
      { value: 'full', label: '문서 전체' },
    ],
  },
  image: {
    label: '이미지',
    icon: '🖼️',
    color: 'yellow',
    accept: '.jpg,.jpeg,.png,.gif,.webp',
    sectionOptions: [
      { value: 'ocr', label: 'OCR 추출' },
    ],
    hasContentType: true,
  },
};

// 확장자 → 파일 형식 매핑
export function detectClientFileType(filename) {
  const ext = (filename || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  const map = {
    '.pdf': 'pdf', '.txt': 'text', '.md': 'markdown', '.markdown': 'markdown',
    '.docx': 'docx', '.xlsx': 'xlsx', '.xls': 'xlsx', '.csv': 'csv',
    '.json': 'json', '.hwp': 'hwp', '.hwpx': 'hwpx',
    '.jpg': 'image', '.jpeg': 'image', '.png': 'image',
    '.gif': 'image', '.webp': 'image',
  };
  return map[ext] || 'unknown';
}

// 모든 지원 확장자
export const ALL_ACCEPTED = '.pdf,.txt,.md,.markdown,.docx,.xlsx,.xls,.csv,.json,.hwp,.hwpx,.jpg,.jpeg,.png,.gif,.webp';

export const SECTION_TYPES = [
  { value: 'page', label: '페이지별' },
  { value: 'full', label: '문서 전체' },
  { value: 'quiz', label: '객관식 문제' },
  { value: 'custom', label: '사용자 정의 (구분자)' },
];
