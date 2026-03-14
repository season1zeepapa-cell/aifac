import { createElement, useState, useCallback } from 'react';
import { GEMINI_CATALOG, OPENAI_CATALOG, CLAUDE_CATALOG, TIER_COLORS } from '../../constants/models';
import { DEFAULT_LLM_SETTINGS, loadLlmSettings, saveLlmSettings, updateLlmSettings } from '../../constants/llm';
import Select from '../../components/ui/Select';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';


    function LlmSettingsPanel() {
      const [settings, setSettings] = useState(() => loadLlmSettings());
      const [saved, setSaved] = useState(false);

      // 프로바이더별 설정 업데이트 헬퍼
      const updateProvider = useCallback((provider, key, value) => {
        setSettings(prev => ({
          ...prev,
          [provider]: { ...prev[provider], [key]: value },
        }));
        setSaved(false);
      }, []);

      // 모델 변경 시 해당 모델의 기본값 적용
      const handleModelChange = useCallback((provider, modelId) => {
        const catalogs = { gemini: GEMINI_CATALOG, openai: OPENAI_CATALOG, claude: CLAUDE_CATALOG };
        const info = catalogs[provider]?.find(m => m.id === modelId);
        const isG3 = provider === 'gemini' && modelId.startsWith('gemini-3');
        setSettings(prev => ({
          ...prev,
          [provider]: {
            ...prev[provider],
            model: modelId,
            temperature: 0.3,
            // Gemini 3.x: thinkingLevel (budget 초기화), 2.5: thinkingBudget (level 초기화)
            ...(provider === 'gemini' && info?.thinking && isG3 ? { thinkingLevel: 'medium', thinkingBudget: 0 } : {}),
            ...(provider === 'gemini' && info?.thinking && !isG3 ? { thinkingBudget: 4096, thinkingLevel: '' } : {}),
            ...(provider === 'gemini' && !info?.thinking ? { thinkingBudget: 0, thinkingLevel: '' } : {}),
            // OpenAI o-시리즈: reasoningEffort 기본값
            ...(provider === 'openai' && info?.reasoning ? { reasoningEffort: 'medium' } : {}),
          },
        }));
        setSaved(false);
      }, []);

      // 저장
      const handleSave = useCallback(() => {
        updateLlmSettings(JSON.parse(JSON.stringify(settings)));
        saveLlmSettings(settings);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }, [settings]);

      // 초기화
      const handleReset = useCallback(() => {
        const defaults = JSON.parse(JSON.stringify(DEFAULT_LLM_SETTINGS));
        setSettings(defaults);
        updateLlmSettings(defaults);
        saveLlmSettings(defaults);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }, []);

      // 가격 뱃지
      const TierBadge = ({ tier }) => (
        createElement('span', {
          className: 'text-[10px] font-bold text-white px-1.5 py-0.5 rounded',
          style: { backgroundColor: TIER_COLORS[tier] || '#6b7280' }
        }, tier)
      );

      // 프로바이더 섹션 렌더러
      const ProviderSection = ({ provider, label, catalog, icon }) => {
        const s = settings[provider];
        const selectedModel = catalog.find(m => m.id === s.model);
        const isGemini = provider === 'gemini';
        const isOpenai = provider === 'openai';
        const showThinking = isGemini && selectedModel?.thinking;
        const isGemini3 = isGemini && (s.model || '').startsWith('gemini-3');
        const showReasoning = isOpenai && selectedModel?.reasoning;

        return (
          <Card>
            <div className="space-y-4">
              {/* 헤더 */}
              <div className="flex items-center gap-2">
                <span className="text-base">{icon}</span>
                <h3 className="text-sm font-bold text-text">{label}</h3>
              </div>

              {/* 모델 선택 */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">모델</label>
                <select
                  value={s.model}
                  onChange={e => handleModelChange(provider, e.target.value)}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary transition-colors"
                >
                  {catalog.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.id} — {m.tier} · 입력 {m.inputP} · 출력 {m.outputP}
                    </option>
                  ))}
                </select>
                {/* 선택된 모델 정보 */}
                {selectedModel && (
                  <div className="mt-2 p-2.5 bg-bg rounded-lg border-l-3 border-primary text-xs space-y-1" style={{ borderLeftWidth: '3px' }}>
                    <div className="flex items-center gap-2">
                      <TierBadge tier={selectedModel.tier} />
                      <span className="text-text-secondary">입력 <strong className="text-text">{selectedModel.inputP}</strong> · 출력 <strong className="text-text">{selectedModel.outputP}</strong> / 1M tokens</span>
                    </div>
                    <p className="text-text-secondary">{selectedModel.desc}</p>
                  </div>
                )}
              </div>

              {/* Temperature 슬라이더 */}
              {!showReasoning && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-text-secondary">Temperature</label>
                    <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                      {(s.temperature ?? 0.3).toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-secondary">일관</span>
                    <input
                      type="range" min="0" max="2" step="0.1"
                      value={s.temperature ?? 0.3}
                      onChange={e => updateProvider(provider, 'temperature', parseFloat(e.target.value))}
                      className="flex-1 accent-primary h-1 cursor-pointer"
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <span className="text-[10px] text-text-secondary">창의</span>
                  </div>
                  <p className="text-[10px] text-text-secondary mt-1">0 = 항상 같은 답, 2 = 다양한 표현. RAG 권장값: 0.2~0.5</p>
                </div>
              )}

              {/* Max Tokens */}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Max Tokens (최대 응답 길이)</label>
                <select
                  value={s.maxTokens || 2048}
                  onChange={e => updateProvider(provider, 'maxTokens', parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary transition-colors"
                >
                  <option value={512}>512 — 짧은 답변</option>
                  <option value={1024}>1,024 — 보통</option>
                  <option value={2048}>2,048 — 상세 (기본)</option>
                  <option value={4096}>4,096 — 매우 상세</option>
                  <option value={8192}>8,192 — 최대</option>
                </select>
              </div>

              {/* Gemini 3.x Thinking Level */}
              {showThinking && isGemini3 && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Thinking Level (추론 강도)</label>
                  <select
                    value={s.thinkingLevel || 'medium'}
                    onChange={e => updateProvider(provider, 'thinkingLevel', e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary transition-colors"
                  >
                    <option value="low">low — 빠름 (최소 추론)</option>
                    <option value="medium">medium — 균형 (기본)</option>
                    <option value="high">high — 최고 정확 (심층 추론)</option>
                  </select>
                  <p className="text-[10px] text-text-secondary mt-1">Gemini 3.x 전용. 추론 강도가 높을수록 비용/시간 증가</p>
                </div>
              )}

              {/* Gemini 2.5 Thinking Budget */}
              {showThinking && !isGemini3 && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Thinking Budget (사고 토큰)</label>
                  <select
                    value={s.thinkingBudget || 0}
                    onChange={e => updateProvider(provider, 'thinkingBudget', parseInt(e.target.value))}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary transition-colors"
                  >
                    <option value={0}>OFF — 즉시 응답 (추론 없음)</option>
                    <option value={1024}>1,024 tokens — 가벼운 추론</option>
                    <option value={4096}>4,096 tokens — 일반 추론</option>
                    <option value={8192}>8,192 tokens — 심층 추론</option>
                    <option value={16384}>16,384 tokens — 최대 추론</option>
                  </select>
                  <p className="text-[10px] text-text-secondary mt-1">Gemini 2.5 전용. 사고 토큰 수만큼 비용이 추가됩니다</p>
                </div>
              )}

              {/* OpenAI Reasoning Effort */}
              {showReasoning && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">Reasoning Effort (추론 강도)</label>
                  <select
                    value={s.reasoningEffort || 'medium'}
                    onChange={e => updateProvider(provider, 'reasoningEffort', e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary transition-colors"
                  >
                    <option value="low">low — 빠름 (저비용)</option>
                    <option value="medium">medium — 균형 (기본)</option>
                    <option value="high">high — 최고 정확 (고비용)</option>
                  </select>
                  <p className="text-[10px] text-text-secondary mt-1">o-시리즈 전용. 추론 강도가 높을수록 비용/시간 증가</p>
                </div>
              )}
            </div>
          </Card>
        );
      };

      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary">AI 채팅에서 사용할 모델과 파라미터를 설정합니다.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                className="text-xs text-text-secondary hover:text-red-500 border border-border rounded-lg px-2.5 py-1.5 transition-colors"
              >기본값</button>
              <button
                onClick={handleSave}
                className={`text-xs font-medium rounded-lg px-3 py-1.5 transition-colors ${
                  saved
                    ? 'bg-green-500 text-white'
                    : 'bg-primary text-white hover:bg-primary-hover'
                }`}
              >{saved ? '저장됨' : '저장'}</button>
            </div>
          </div>

          <ProviderSection provider="gemini" label="Gemini" catalog={GEMINI_CATALOG} icon="G" />
          <ProviderSection provider="openai" label="OpenAI" catalog={OPENAI_CATALOG} icon="O" />
          <ProviderSection provider="claude" label="Claude" catalog={CLAUDE_CATALOG} icon="C" />

          {/* 현재 설정 요약 */}
          <Card className="bg-bg">
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-secondary">현재 적용 설정</p>
              {['gemini', 'openai', 'claude'].map(p => (
                <div key={p} className="flex items-center justify-between text-xs">
                  <span className="text-text font-medium capitalize">{p}</span>
                  <span className="text-text-secondary">
                    {settings[p].model} · temp {(settings[p].temperature ?? 0.3).toFixed(1)} · {settings[p].maxTokens || 2048} tokens
                    {p === 'gemini' && settings[p].thinkingLevel ? ` · think ${settings[p].thinkingLevel}` : ''}
                    {p === 'gemini' && !settings[p].thinkingLevel && settings[p].thinkingBudget > 0 ? ` · think ${settings[p].thinkingBudget}` : ''}
                    {p === 'openai' && settings[p].reasoningEffort ? ` · reason ${settings[p].reasoningEffort}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      );
    }

    // ========================================


export default LlmSettingsPanel;
