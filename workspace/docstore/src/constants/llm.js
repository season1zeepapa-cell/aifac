// LLM 설정 전역 상태 (새로고침 시 localStorage에서 복원)
export const DEFAULT_LLM_SETTINGS = {
  gemini:  { model:'gemini-2.5-flash', temperature:0.3, maxTokens:2048, thinkingBudget:0 },
  openai:  { model:'gpt-4o-mini',      temperature:0.3, maxTokens:2048 },
  claude:  { model:'claude-sonnet-4-20250514', temperature:0.3, maxTokens:2048 },
};

// localStorage에서 LLM 설정 로드
export function loadLlmSettings() {
  try {
    const saved = localStorage.getItem('docstore_llm_settings');
    if (saved) return JSON.parse(saved);
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_LLM_SETTINGS));
}

// LLM 설정을 localStorage에 저장
export function saveLlmSettings(settings) {
  localStorage.setItem('docstore_llm_settings', JSON.stringify(settings));
}

// 전역 LLM 설정 인스턴스 (모듈 수준에서 초기화)
export let llmSettings = loadLlmSettings();

// llmSettings 전역 인스턴스 업데이트 (ESM import 재할당 우회)
export function updateLlmSettings(newSettings) {
  Object.assign(llmSettings, newSettings);
}
