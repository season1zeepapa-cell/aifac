import { useState, useEffect, useCallback, useContext } from 'react';
import { ApiKeyStatusContext } from '../../contexts/ApiKeyStatusContext';
import { CategoriesContext } from '../../contexts/CategoriesContext';
import { API_BASE_URL, authFetch } from '../../lib/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import ChunkPresetPanel from './ChunkPresetPanel';
import CategoryPanel from './CategoryPanel';
import TuningTab, { DeidentifyPanel } from './TuningTab';
import LlmSettingsPanel from '../ChatTab/LlmSettingsPanel';
import EmbeddingModelPanel from '../ChatTab/EmbeddingModelPanel';


    function SettingsTab() {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [subTab, setSubTab] = useState('keys');
      const [actionLoading, setActionLoading] = useState(null);
      const [actionResult, setActionResult] = useState(null);
      const [editingLimit, setEditingLimit] = useState(null);
      // 드래그 앤 드롭
      const [dragIndex, setDragIndex] = useState(null);
      const [dragOverIndex, setDragOverIndex] = useState(null);
      // OCR 상태
      const [engines, setEngines] = useState([]);
      const [ocrLoading, setOcrLoading] = useState(true);

      const fetchData = useCallback(async () => {
        setLoading(true);
        try {
          const res = await authFetch(`${API_BASE_URL}/api-usage?range=today`);
          if (!res.ok) throw new Error('데이터 로드 실패');
          setData(await res.json());
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      }, []);

      const fetchEngines = useCallback(async () => {
        try {
          const res = await authFetch(`${API_BASE_URL}/api-usage?type=ocr`);
          if (res.ok) {
            const d = await res.json();
            setEngines(d.engines || []);
          }
        } catch (err) {
          console.error('[OCR]', err);
        } finally {
          setOcrLoading(false);
        }
      }, []);

      useEffect(() => { fetchData(); fetchEngines(); }, [fetchData, fetchEngines]);

      // ── API 키 액션 ──
      const handleTestKey = useCallback(async (provider) => {
        setActionLoading(`test-${provider}`);
        setActionResult(null);
        try {
          const res = await authFetch(`${API_BASE_URL}/api-usage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'testKey', provider }),
          });
          const result = await res.json();
          setActionResult({ id: `key-${provider}`, success: result.success, message: result.message });
          fetchData();
          setTimeout(() => setActionResult(prev => prev?.id === `key-${provider}` ? null : prev), 5000);
        } finally { setActionLoading(null); }
      }, [fetchData]);

      const { reload: reloadApiKeyStatus } = useContext(ApiKeyStatusContext);
      const handleToggleKey = useCallback(async (provider, currentActive) => {
        setActionLoading(`toggle-${provider}`);
        try {
          await authFetch(`${API_BASE_URL}/api-usage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'toggleKey', provider, isActive: !currentActive }),
          });
          fetchData();
          reloadApiKeyStatus(); // 전역 API 키 상태 갱신
        } finally { setActionLoading(null); }
      }, [fetchData, reloadApiKeyStatus]);

      const handleUpdateLimit = useCallback(async (provider, value) => {
        setActionLoading(`limit-${provider}`);
        try {
          await authFetch(`${API_BASE_URL}/api-usage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'updateLimit', provider, dailyLimit: parseInt(value) || 0 }),
          });
          setEditingLimit(null);
          fetchData();
        } finally { setActionLoading(null); }
      }, [fetchData]);

      // ── OCR 액션 ──
      const handleOcrMove = useCallback(async (index, direction) => {
        const ne = [...engines];
        const si = index + direction;
        if (si < 0 || si >= ne.length) return;
        [ne[index], ne[si]] = [ne[si], ne[index]];
        setEngines(ne);
        try {
          await authFetch(`${API_BASE_URL}/api-usage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ocrUpdatePriority', order: ne.map(e => e.engine_id) }),
          });
        } catch { fetchEngines(); }
      }, [engines, fetchEngines]);

      const handleDragEnd = useCallback(async () => {
        if (dragIndex === null || dragOverIndex === null || dragIndex === dragOverIndex) {
          setDragIndex(null);
          setDragOverIndex(null);
          return;
        }
        const ne = [...engines];
        const [moved] = ne.splice(dragIndex, 1);
        ne.splice(dragOverIndex, 0, moved);
        setEngines(ne);
        setDragIndex(null);
        setDragOverIndex(null);
        try {
          await authFetch(`${API_BASE_URL}/api-usage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ocrUpdatePriority', order: ne.map(e => e.engine_id) }),
          });
        } catch { fetchEngines(); }
      }, [dragIndex, dragOverIndex, engines, fetchEngines]);

      const handleOcrToggle = useCallback(async (engineId, currentEnabled) => {
        setActionLoading(`ocr-toggle-${engineId}`);
        try {
          await authFetch(`${API_BASE_URL}/api-usage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ocrToggleEngine', engineId, enabled: !currentEnabled }),
          });
          fetchEngines();
        } finally { setActionLoading(null); }
      }, [fetchEngines]);

      const handleOcrTest = useCallback(async (engineId) => {
        setActionLoading(`ocr-test-${engineId}`);
        setActionResult(null);
        try {
          const res = await authFetch(`${API_BASE_URL}/api-usage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ocrTestEngine', engineId }),
          });
          const result = await res.json();
          setActionResult({ id: `ocr-${engineId}`, success: result.success, message: result.message });
          setTimeout(() => setActionResult(prev => prev?.id === `ocr-${engineId}` ? null : prev), 5000);
        } finally { setActionLoading(null); }
      }, []);

      // 일괄 테스트 (API 키)
      const handleTestAllKeys = useCallback(async () => {
        const configured = data?.keys?.filter(k => k.configured) || [];
        if (configured.length === 0) return;
        setActionLoading('test-all');
        let ok = 0, fail = 0;
        for (const key of configured) {
          setActionResult({ id: 'test-all', success: true, message: `테스트 중... (${ok + fail + 1}/${configured.length}) ${key.provider}` });
          try {
            const res = await authFetch(`${API_BASE_URL}/api-usage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'testKey', provider: key.provider }),
            });
            const r = await res.json();
            r.success ? ok++ : fail++;
          } catch { fail++; }
        }
        setActionResult({ id: 'test-all', success: fail === 0, message: `완료: 성공 ${ok}개, 실패 ${fail}개` });
        fetchData();
        setTimeout(() => setActionResult(prev => prev?.id === 'test-all' ? null : prev), 5000);
        setActionLoading(null);
      }, [data, fetchData]);

      // 일괄 테스트 (OCR)
      const handleTestAllOcr = useCallback(async () => {
        const available = engines.filter(e => e.is_available && e.is_enabled);
        if (available.length === 0) return;
        setActionLoading('ocr-test-all');
        let ok = 0, fail = 0;
        for (const engine of available) {
          setActionResult({ id: 'ocr-test-all', success: true, message: `테스트 중... (${ok + fail + 1}/${available.length}) ${engine.name}` });
          try {
            const res = await authFetch(`${API_BASE_URL}/api-usage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'ocrTestEngine', engineId: engine.engine_id }),
            });
            const r = await res.json();
            r.success ? ok++ : fail++;
          } catch { fail++; }
        }
        setActionResult({ id: 'ocr-test-all', success: fail === 0, message: `완료: 성공 ${ok}개, 실패 ${fail}개` });
        setTimeout(() => setActionResult(prev => prev?.id === 'ocr-test-all' ? null : prev), 5000);
        setActionLoading(null);
      }, [engines]);

      const providerLabels = {
        openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini',
        cohere: 'Cohere', upstage: 'Upstage',
        'law-api': '국가법령정보센터', 'ocr-space': 'OCR.space',
        'google-vision': 'Google Vision', 'aws-textract': 'AWS Textract', 'naver-clova': '네이버 CLOVA',
        'naver-search': '네이버 검색 API',
      };
      const providerColors = {
        openai: 'green', anthropic: 'yellow', gemini: 'primary',
        cohere: 'blue', upstage: 'blue',
        'law-api': 'gray', 'ocr-space': 'gray',
        'google-vision': 'primary', 'aws-textract': 'yellow', 'naver-clova': 'green',
        'naver-search': 'green',
      };

      if (loading && !data) {
        return (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        );
      }

      if (!data) {
        return <EmptyState icon="&#9888;" title="데이터 로드 실패" description="API 사용량 테이블이 생성되지 않았을 수 있습니다." />;
      }

      const SUB_TABS = [
        { id: 'keys', label: 'API 키' },
        { id: 'llm', label: 'LLM 설정' },
        { id: 'embedding', label: '임베딩' },
        { id: 'ocr', label: 'OCR 설정' },
        { id: 'categories', label: '카테고리' },
        { id: 'deidentify', label: '비식별화' },
      ];

      const ocrStatusBadge = (engine) => {
        if (!engine.is_available) return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">미설정</span>;
        if (!engine.is_enabled) return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">비활성</span>;
        return <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-600">활성</span>;
      };

      return (
        <div className="space-y-4 fade-in">
          {/* 서브 탭 네비게이션 */}
          <div className="flex gap-1 bg-card-bg rounded-lg p-1 border border-border overflow-x-auto scrollbar-none" style={{WebkitOverflowScrolling:'touch'}}>
            {SUB_TABS.map(tab => (
              <button key={tab.id} onClick={() => setSubTab(tab.id)}
                className={`shrink-0 sm:flex-1 px-2.5 sm:px-2 py-2 rounded-md text-[11px] sm:text-xs font-medium transition-all whitespace-nowrap ${
                  subTab === tab.id
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-secondary hover:text-text hover:bg-border/50'
                }`}
              >{tab.label}{tab.id === 'ocr' && engines.filter(e => e.is_available && e.is_enabled).length > 0 ? ` (${engines.filter(e => e.is_available && e.is_enabled).length})` : ''}</button>
            ))}
          </div>

          {/* ════════ API 키 관리 탭 ════════ */}
          {subTab === 'keys' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-secondary">각 프로바이더의 API 키 상태를 확인하고, 테스트/한도를 관리합니다.</p>
                <button onClick={handleTestAllKeys}
                  disabled={!!actionLoading || !data?.keys?.some(k => k.configured)}
                  className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
                >{actionLoading === 'test-all' ? '테스트 중...' : '전체 테스트'}</button>
              </div>
              {actionResult?.id === 'test-all' && (
                <div className={`text-xs px-3 py-2 rounded-lg fade-in ${actionResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {actionResult.success ? '\u2713' : '\u2717'} {actionResult.message}
                </div>
              )}
              {data.keys?.map(key => {
                const usage = data.usageByProvider?.find(u => u.provider === key.provider);
                const callCount = parseInt(usage?.call_count || 0);
                const creditErrors = parseInt(usage?.credit_error_count || 0);

                return (
                  <Card key={key.provider}>
                    <div className="space-y-2 sm:space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
                          <span className="font-bold text-xs sm:text-sm text-text">{providerLabels[key.provider] || key.provider}</span>
                          {key.configured ? (
                            <Badge color={key.is_active ? 'green' : 'red'}>{key.is_active ? '활성' : '비활성'}</Badge>
                          ) : (
                            <Badge color="gray">미설정</Badge>
                          )}
                          {creditErrors > 0 && <Badge color="red">크레딧 소진</Badge>}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => handleTestKey(key.provider)}
                            disabled={!key.configured || actionLoading === `test-${key.provider}`}
                            className="px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs bg-primary/10 border border-primary/30 rounded-md hover:bg-primary/20 text-primary disabled:opacity-30 transition-colors"
                          >{actionLoading === `test-${key.provider}` ? '...' : '테스트'}</button>
                          <button onClick={() => handleToggleKey(key.provider, key.is_active)}
                            disabled={!key.configured}
                            className="px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs bg-border rounded-md hover:bg-card-bg-hover text-text-secondary disabled:opacity-30 transition-colors"
                          >{key.is_active ? '비활성화' : '활성화'}</button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] sm:text-xs text-text-secondary">
                        <div className="flex gap-2 sm:gap-4">
                          <span>호출: <span className="text-text font-medium">{callCount}</span></span>
                          <span>비용: <span className="text-primary font-medium">${parseFloat(usage?.total_cost || 0).toFixed(4)}</span></span>
                        </div>
                        {editingLimit?.provider === key.provider ? (
                          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); handleUpdateLimit(key.provider, editingLimit.value); }}>
                            <input type="number" min="0" value={editingLimit.value}
                              onChange={e => setEditingLimit({ ...editingLimit, value: e.target.value })}
                              className="w-16 px-1.5 py-0.5 text-xs border border-primary rounded text-text text-center bg-card-bg"
                              autoFocus onBlur={() => setTimeout(() => setEditingLimit(null), 200)} />
                            <button type="submit" className="text-[10px] px-1.5 py-0.5 bg-primary text-white rounded hover:bg-primary/90">저장</button>
                            <span className="text-[10px] text-text-secondary">(0=무제한)</span>
                          </form>
                        ) : (
                          <button onClick={() => setEditingLimit({ provider: key.provider, value: String(key.daily_limit || 0) })}
                            className="hover:text-primary transition-colors"
                          >한도: {key.daily_limit ? `${callCount}/${key.daily_limit}` : '무제한'}</button>
                        )}
                      </div>
                      {key.last_checked && (
                        <p className="text-[10px] text-text-secondary">마지막 확인: {new Date(key.last_checked).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      )}

                      {key.daily_limit > 0 && (
                        <div className="w-full bg-border rounded-full h-2">
                          <div className={`h-2 rounded-full transition-all ${
                            callCount / key.daily_limit > 0.9 ? 'bg-red-500' :
                            callCount / key.daily_limit > 0.7 ? 'bg-yellow-500' : 'bg-green-500'
                          }`} style={{ width: `${Math.min(100, (callCount / key.daily_limit) * 100)}%` }} />
                        </div>
                      )}

                      {!key.configured && (() => {
                        const envGuide = {
                          openai: { env: 'OPENAI_API_KEY', desc: '임베딩 + GPT-4o 퀴즈 파싱' },
                          anthropic: { env: 'ANTHROPIC_API_KEY', desc: 'Claude OCR (폴백)' },
                          gemini: { env: 'GEMINI_API_KEY', desc: 'RAG 질의응답 + AI 요약 + OCR' },
                          cohere: { env: 'COHERE_API_KEY', desc: '검색 Rerank (선택, 무료 1000회/월)' },
                          upstage: { env: 'UPSTAGE_API_KEY', desc: 'Upstage OCR (무료)' },
                          'law-api': { env: 'LAW_API_OC', desc: '국가법령정보센터 법령 검색/임포트' },
                          'ocr-space': { env: 'OCR_SPACE_API_KEY', desc: 'OCR.space 텍스트 추출 (무료 500회/월)' },
                          'google-vision': { env: 'GOOGLE_VISION_API_KEY', desc: 'Google Cloud Vision OCR' },
                          'aws-textract': { env: 'AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY', desc: 'AWS Textract 문서 OCR' },
                          'naver-clova': { env: 'CLOVA_OCR_SECRET + CLOVA_OCR_URL', desc: '네이버 CLOVA OCR' },
                          'naver-search': { env: 'NAVER_CLIENT_ID + NAVER_CLIENT_SECRET', desc: '네이버 뉴스 검색 크롤링' },
                        };
                        const g = envGuide[key.provider];
                        return g ? (
                          <div className="text-[11px] bg-blue-50 text-blue-700 px-2.5 py-2 rounded-md">
                            <p className="font-medium mb-0.5">환경변수 설정 필요</p>
                            <p>Vercel 대시보드 또는 <code className="bg-blue-100 px-1 rounded">.env</code>에 <code className="bg-blue-100 px-1 rounded">{g.env}</code> 추가</p>
                            <p className="text-blue-500 mt-0.5">용도: {g.desc}</p>
                          </div>
                        ) : null;
                      })()}
                      {key.last_error && (
                        <p className="text-xs text-red-500 bg-red-50 px-2.5 py-1.5 rounded-md">{key.last_error.length > 120 ? key.last_error.slice(0, 120) + '...' : key.last_error}</p>
                      )}
                      {actionResult?.id === `key-${key.provider}` && (
                        <p className={`text-xs px-2.5 py-1.5 rounded-md fade-in ${
                          actionResult.success ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50'
                        }`}>
                          {actionResult.success ? '\u2713' : '\u2717'} {actionResult.message}
                        </p>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ════════ LLM 설정 탭 ════════ */}
          {subTab === 'llm' && (
            <LlmSettingsPanel />
          )}

          {/* ════════ 임베딩 모델 설정 탭 ════════ */}
          {subTab === 'embedding' && (
            <EmbeddingModelPanel />
          )}

          {/* ════════ OCR 설정 탭 ════════ */}
          {subTab === 'ocr' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-secondary">이미지 업로드 시 위에서 아래 순서로 OCR 엔진을 시도합니다.</p>
                <button onClick={handleTestAllOcr}
                  disabled={!!actionLoading || !engines.some(e => e.is_available && e.is_enabled)}
                  className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
                >{actionLoading === 'ocr-test-all' ? '테스트 중...' : '전체 테스트'}</button>
              </div>
              {actionResult?.id === 'ocr-test-all' && (
                <div className={`text-xs px-3 py-2 rounded-lg fade-in ${actionResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {actionResult.success ? '\u2713' : '\u2717'} {actionResult.message}
                </div>
              )}
              {(() => {
                const active = engines.filter(e => e.is_available && e.is_enabled);
                return active.length > 0 ? (
                  <Card className="border-green-200 bg-green-50/50">
                    <p className="text-xs text-green-700 font-medium">
                      현재 사용 중: {active.map((e, i) => <span key={e.engine_id}>{i > 0 && ' → '}<span className="font-bold">{e.name}</span>{e.free && ' (무료)'}</span>)}
                    </p>
                  </Card>
                ) : (
                  <Card className="border-amber-200 bg-amber-50/50">
                    <p className="text-xs text-amber-700 font-medium">활성화된 OCR 엔진이 없습니다. 이미지 업로드 시 텍스트 추출이 불가합니다.</p>
                  </Card>
                );
              })()}

              {/* OCR 사용 통계 (최근 7일) */}
              {data?.ocrStats?.length > 0 && (
                <Card>
                  <h4 className="text-xs font-bold text-text mb-2">최근 7일 OCR 사용 현황</h4>
                  <div className="space-y-1.5">
                    {data.ocrStats.map(s => {
                      const total = parseInt(s.call_count);
                      const success = parseInt(s.success_count);
                      const rate = total > 0 ? Math.round((success / total) * 100) : 0;
                      return (
                        <div key={s.engine} className="flex items-center justify-between text-xs">
                          <span className="text-text">{s.engine}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-text-secondary">{total}회</span>
                            <span className={`font-medium ${rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-yellow-600' : 'text-red-500'}`}>성공률 {rate}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {ocrLoading ? (
                <div className="text-center py-8 text-text-secondary text-sm">로딩...</div>
              ) : (
                <>
                  <div className="space-y-2">
                    {engines.map((engine, index) => (
                      <div key={engine.engine_id}
                        draggable
                        onDragStart={() => setDragIndex(index)}
                        onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }}
                        onDragEnd={handleDragEnd}
                        onTouchStart={(e) => { setDragIndex(index); }}
                        className={`flex items-center gap-2 p-3 rounded-lg border transition-all ${
                          dragOverIndex === index && dragIndex !== null && dragIndex !== index
                            ? 'border-primary border-2 bg-blue-50/50'
                            : engine.is_enabled && engine.is_available
                              ? 'bg-card-bg border-border shadow-sm'
                              : !engine.is_available
                                ? 'bg-gray-50 border-dashed border-gray-300'
                                : 'bg-gray-50 border-border/50 opacity-70'
                        } ${dragIndex === index ? 'opacity-40 scale-95' : ''} cursor-grab active:cursor-grabbing`}
                      >
                        <span className={`text-sm font-bold w-6 text-center ${engine.is_available ? 'text-primary' : 'text-gray-300'}`} title="드래그하여 순서 변경">{index + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-sm font-medium truncate ${engine.is_available ? 'text-text' : 'text-text-secondary'}`}>{engine.name}</span>
                            {engine.free && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">무료</span>}
                            {ocrStatusBadge(engine)}
                          </div>
                          <p className="text-[11px] text-text-secondary truncate">{engine.description}</p>
                          {!engine.is_available && (
                            <p className="text-[10px] text-amber-600 mt-0.5">
                              <code className="bg-amber-50 px-1 py-0.5 rounded">{engine.envKey}</code> 환경변수 설정이 필요합니다
                            </p>
                          )}
                          {actionResult?.id === `ocr-${engine.engine_id}` && (
                            <p className={`text-[10px] mt-0.5 fade-in ${actionResult.success ? 'text-green-600' : 'text-red-500'}`}>
                              {actionResult.success ? '\u2713' : '\u2717'} {actionResult.message}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => handleOcrMove(index, -1)} disabled={index === 0}
                            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-primary hover:bg-gray-100 disabled:opacity-30 text-xs">&#9650;</button>
                          <button onClick={() => handleOcrMove(index, 1)} disabled={index === engines.length - 1}
                            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-primary hover:bg-gray-100 disabled:opacity-30 text-xs">&#9660;</button>
                          <button onClick={() => handleOcrToggle(engine.engine_id, engine.is_enabled)}
                            disabled={actionLoading === `ocr-toggle-${engine.engine_id}`}
                            className={`w-9 h-5 rounded-full transition-colors relative ${engine.is_enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                          ><span className={`absolute w-3.5 h-3.5 rounded-full bg-white top-[3px] transition-transform ${engine.is_enabled ? 'right-[3px]' : 'left-[3px]'}`} /></button>
                          {engine.is_available && (
                            <button onClick={() => handleOcrTest(engine.engine_id)} disabled={!!actionLoading}
                              className="text-[10px] px-2 py-1 rounded-md border border-primary/30 text-primary hover:bg-blue-50 transition-colors disabled:opacity-30"
                            >{actionLoading === `ocr-test-${engine.engine_id}` ? '...' : '테스트'}</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ════════ 카테고리 관리 탭 ════════ */}
          {subTab === 'categories' && (
            <CategoryPanel />
          )}

          {/* ════════ 비식별화 설정 탭 ════════ */}
          {subTab === 'deidentify' && (
            <DeidentifyPanel />
          )}
        </div>
      );
    }

    // ========================================
    // 튜닝 탭 (대시보드, 사용량, 프롬프트, 분할 설정, RAG 트레이싱, 관측성)
    // ========================================


export default SettingsTab;
