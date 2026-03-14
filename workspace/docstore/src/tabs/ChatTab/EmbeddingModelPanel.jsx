import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL, authFetch } from '../../lib/api';
import Select from '../../components/ui/Select';
import Card from '../../components/ui/Card';


    function EmbeddingModelPanel() {
      const [currentModel, setCurrentModel] = useState('openai');
      const [availableModels, setAvailableModels] = useState([]);
      const [loading, setLoading] = useState(true);
      const [saving, setSaving] = useState(false);
      const [saved, setSaved] = useState(false);

      // 모델별 아이콘/색상
      const MODEL_STYLES = {
        openai: { color: '#10a37f', icon: 'O', label: 'OpenAI' },
        upstage: { color: '#ff6b35', icon: 'U', label: 'Upstage Solar' },
        cohere: { color: '#39594d', icon: 'C', label: 'Cohere' },
      };

      // 설정 로드
      useEffect(() => {
        (async () => {
          try {
            const res = await authFetch(`${API_BASE_URL}/settings?key=embeddingModel`);
            if (res.ok) {
              const data = await res.json();
              setCurrentModel(data.value || 'openai');
              setAvailableModels(data.availableModels || []);
            }
          } catch (err) {
            console.error('[임베딩 설정]', err);
          } finally {
            setLoading(false);
          }
        })();
      }, []);

      // 모델 변경 저장
      const handleSave = useCallback(async (modelId) => {
        // 차원이 다르면 경고
        const currentDim = availableModels.find(m => m.id === currentModel)?.dimensions;
        const newDim = availableModels.find(m => m.id === modelId)?.dimensions;
        if (currentDim && newDim && currentDim !== newDim) {
          const ok = confirm(
            `벡터 차원이 ${currentDim} → ${newDim}으로 변경됩니다.\n` +
            `기존 문서의 임베딩이 초기화되며, 모든 문서의 임베딩을 재생성해야 합니다.\n\n계속하시겠습니까?`
          );
          if (!ok) return;
        }

        setSaving(true);
        try {
          const res = await authFetch(`${API_BASE_URL}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'embeddingModel', value: modelId }),
          });
          if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || '저장 실패');
          }
          setCurrentModel(modelId);
          setSaved(true);
          setTimeout(() => setSaved(false), 5000);
        } catch (err) {
          alert(`임베딩 모델 변경 실패: ${err.message}`);
        } finally {
          setSaving(false);
        }
      }, [currentModel, availableModels]);

      if (loading) {
        return <div className="text-center py-8 text-sm text-text-secondary">로딩 중...</div>;
      }

      return (
        <div className="space-y-4">
          {/* 안내 */}
          <Card>
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-text">임베딩 모델 선택</h3>
              <p className="text-xs text-text-secondary leading-relaxed">
                문서 인덱싱과 검색에 사용할 임베딩 모델을 선택합니다.
                모델 변경 후에는 기존 문서의 <strong>임베딩을 재생성</strong>해야 검색이 정상 동작합니다.
                (차원 수가 달라 기존 벡터와 호환되지 않습니다)
              </p>
            </div>
          </Card>

          {/* 모델 카드 */}
          {availableModels.map(m => {
            const style = MODEL_STYLES[m.id] || MODEL_STYLES.openai;
            const isSelected = currentModel === m.id;
            return (
              <Card key={m.id}>
                <div className={`relative ${isSelected ? 'ring-2 ring-primary rounded-lg -m-4 p-4' : ''}`}>
                  {/* 선택 표시 */}
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    {/* 아이콘 */}
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
                      style={{ backgroundColor: style.color }}>
                      {style.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* 이름 + 뱃지 */}
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-bold text-text">{style.label}</h4>
                        {m.id === 'upstage' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">한국어 1위</span>
                        )}
                        {m.id === 'cohere' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-medium">검색 최적화</span>
                        )}
                        {!m.available && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">API 키 없음</span>
                        )}
                      </div>

                      {/* 모델명 + 차원 */}
                      <p className="text-xs text-text-secondary mb-1">
                        <code className="bg-bg px-1 py-0.5 rounded text-[11px]">{m.model}</code>
                        <span className="mx-1.5">·</span>
                        <span>{m.dimensions.toLocaleString()}차원</span>
                      </p>

                      {/* 설명 */}
                      <p className="text-xs text-text-secondary">{m.description}</p>

                      {/* 선택 버튼 */}
                      {!isSelected && m.available && (
                        <button
                          onClick={() => handleSave(m.id)}
                          disabled={saving}
                          className="mt-2 px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
                        >
                          {saving ? '변경 중...' : '이 모델 사용'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}

          {/* 저장 완료 알림 */}
          {saved && (
            <div className="text-center text-xs text-green-600 bg-green-50 rounded-lg py-3 space-y-1">
              <p className="font-medium">임베딩 모델이 변경되었습니다.</p>
              <p>기존 문서는 문서 목록에서 "임베딩 재생성"을 실행해주세요.</p>
            </div>
          )}

          {/* 주의사항 */}
          <Card>
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-amber-600">모델 변경 시 주의사항</h4>
              <ul className="text-xs text-text-secondary space-y-1 list-disc list-inside">
                <li>모델마다 벡터 차원이 다릅니다 (1024 / 1536 / 4096)</li>
                <li>모델 변경 후 기존 문서는 검색 정확도가 떨어질 수 있습니다</li>
                <li>문서 상세 페이지에서 "임베딩 재생성" 버튼으로 업데이트하세요</li>
                <li>Upstage Solar는 한국어 법률 문서에 가장 높은 정확도를 제공합니다</li>
              </ul>
            </div>
          </Card>
        </div>
      );
    }

    // LLM 설정 패널 컴포넌트 (관리 탭 내 서브탭)


export default EmbeddingModelPanel;
