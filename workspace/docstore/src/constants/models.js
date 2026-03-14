// LLM 모델 카탈로그
export const GEMINI_CATALOG = [
  // Gemini 3.x (최신)
  { id:'gemini-3.1-pro-preview',        tier:'최신',   inputP:'$2.00~4.00', outputP:'$12.00~18.00', thinking:true,  desc:'Gemini 3세대 최고 성능 · 추론 특화' },
  { id:'gemini-3-flash-preview',        tier:'최신',   inputP:'$0.50',      outputP:'$3.00',        thinking:true,  desc:'Gemini 3 Flash · Pro급 추론 + Flash 속도' },
  { id:'gemini-3.1-flash-lite-preview', tier:'최신',   inputP:'$0.25~0.50', outputP:'$1.50',        thinking:true,  desc:'Gemini 3세대 경량 · 저비용 고속 모델' },
  // Gemini 2.5
  { id:'gemini-2.5-pro',        tier:'최고급', inputP:'$1.25~2.50', outputP:'$10.00', thinking:true,  desc:'Gemini 2.5 최고 성능 장문 멀티모달' },
  { id:'gemini-2.5-flash',      tier:'추천',   inputP:'$0.30~1.00', outputP:'$2.50',  thinking:true,  desc:'최고 가성비 · 기본 권장 모델' },
  { id:'gemini-2.5-flash-lite', tier:'저비용', inputP:'$0.10',      outputP:'$0.40',  thinking:false, desc:'2.5 계열 최저 비용 경량 모델' },
  // Gemini 2.0
  { id:'gemini-2.0-flash',      tier:'중간',   inputP:'$0.10',      outputP:'$0.40',  thinking:false, desc:'빠르고 효율적인 멀티모달' },
  { id:'gemini-2.0-flash-lite', tier:'저비용', inputP:'$0.075',     outputP:'$0.30',  thinking:false, desc:'최저 비용 · 간단한 작업용' },
];

export const OPENAI_CATALOG = [
  // GPT-5.4 / 5.3 (최신)
  { id:'gpt-5.4',              tier:'최신',   inputP:'$2.50',  outputP:'$15.00', reasoning:true,  desc:'GPT-5.4 플래그십 · 1.05M 컨텍스트 · 추론 모델' },
  { id:'gpt-5.3-chat-latest',  tier:'최신',   inputP:'$1.75',  outputP:'$14.00', reasoning:false, desc:'ChatGPT 최신 모델 · 환각 26.8% 감소' },
  // GPT-5.x
  { id:'gpt-5.2',      tier:'고성능', inputP:'$1.75',  outputP:'$14.00', reasoning:false, desc:'GPT-5 플래그십 안정 버전 (5.2)' },
  { id:'gpt-5.1',      tier:'고성능', inputP:'$1.25',  outputP:'$10.00', reasoning:false, desc:'GPT-5 안정 버전 (5.1)' },
  { id:'gpt-5',        tier:'고성능', inputP:'$1.25',  outputP:'$10.00', reasoning:false, desc:'GPT-5 기본 · 강력한 범용 성능' },
  { id:'gpt-5-mini',   tier:'추천',   inputP:'$0.25',  outputP:'$2.00',  reasoning:false, desc:'GPT-5 기반 빠르고 저렴한 모델' },
  { id:'gpt-5-nano',   tier:'저비용', inputP:'$0.05',  outputP:'$0.40',  reasoning:false, desc:'GPT-5 계열 최저 비용 경량 모델' },
  // o-시리즈 추론
  { id:'o3-pro',       tier:'최고급', inputP:'$20.00', outputP:'$80.00', reasoning:true,  desc:'최고 성능 추론 · 복잡한 데이터 분석' },
  { id:'o4-mini',      tier:'추론',   inputP:'$1.10',  outputP:'$4.40',  reasoning:true,  desc:'최신 경량 추론 모델 (o4 세대)' },
  { id:'o3',           tier:'추론',   inputP:'$2.00',  outputP:'$8.00',  reasoning:true,  desc:'강력한 추론 모델 · 복잡한 문제' },
  { id:'o3-mini',      tier:'추론',   inputP:'$1.10',  outputP:'$4.40',  reasoning:true,  desc:'경량 추론 특화 모델' },
  { id:'o1-mini',      tier:'추론',   inputP:'$3.00',  outputP:'$12.00', reasoning:true,  desc:'STEM·수학 특화 추론 모델' },
  { id:'o1',           tier:'최고급', inputP:'$15.00', outputP:'$60.00', reasoning:true,  desc:'최고 수준 추론 · 복잡한 문제' },
  // GPT-4.1 / GPT-4o
  { id:'gpt-4.1',      tier:'고성능', inputP:'$2.00',  outputP:'$8.00',  reasoning:false, desc:'GPT-4.1 플래그십 · 뛰어난 성능' },
  { id:'gpt-4.1-mini', tier:'중간',   inputP:'$0.40',  outputP:'$1.60',  reasoning:false, desc:'GPT-4.1 기반 빠르고 저렴' },
  { id:'gpt-4.1-nano', tier:'저비용', inputP:'$0.10',  outputP:'$0.40',  reasoning:false, desc:'GPT-4.1 계열 최저 비용' },
  { id:'gpt-4o',       tier:'고성능', inputP:'$2.50',  outputP:'$10.00', reasoning:false, desc:'강력한 멀티모달 · 영상 이해' },
  { id:'gpt-4o-mini',  tier:'중간',   inputP:'$0.15',  outputP:'$0.60',  reasoning:false, desc:'균형잡힌 가성비 모델' },
];

export const CLAUDE_CATALOG = [
  { id:'claude-sonnet-4-20250514', tier:'추천',   inputP:'$3.00', outputP:'$15.00', desc:'Claude Sonnet 4 · 균형잡힌 성능' },
  { id:'claude-haiku-4-5-20251001',tier:'저비용', inputP:'$0.80', outputP:'$4.00',  desc:'Claude Haiku 4.5 · 빠르고 저렴' },
];

export const TIER_COLORS = {
  '최신':'#e11d48',
  '추천':'#10b981',
  '저비용':'#06b6d4',
  '중간':'#6b7280',
  '고성능':'#3b82f6',
  '최고급':'#8b5cf6',
  '추론':'#f59e0b',
};
