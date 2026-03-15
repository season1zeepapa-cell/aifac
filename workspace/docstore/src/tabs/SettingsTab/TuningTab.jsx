import { Fragment, createElement, useCallback, useContext, useEffect, useState } from 'react';
import { ApiKeyStatusContext } from '../../contexts/ApiKeyStatusContext';
import { API_BASE_URL, authFetch } from '../../lib/api';
import { GEMINI_CATALOG, OPENAI_CATALOG, CLAUDE_CATALOG, TIER_COLORS } from '../../constants/models';
import { DEFAULT_LLM_SETTINGS, loadLlmSettings, saveLlmSettings } from '../../constants/llm';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import Select from '../../components/ui/Select';
import ChunkPresetPanel from './ChunkPresetPanel';


    function TuningTab() {
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [range, setRange] = useState('today');
      const [subTab, setSubTab] = useState('dashboard');
      const [errorFilter, setErrorFilter] = useState('all');

      const fetchData = useCallback(async () => {
        setLoading(true);
        try {
          const res = await authFetch(`${API_BASE_URL}/api-usage?range=${range}`);
          if (!res.ok) throw new Error('데이터 로드 실패');
          setData(await res.json());
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      }, [range]);

      useEffect(() => { fetchData(); }, [fetchData]);

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

      const totalCost = data.usageByProvider?.reduce((sum, p) => sum + parseFloat(p.total_cost || 0), 0) || 0;
      const totalCalls = data.usageByProvider?.reduce((sum, p) => sum + parseInt(p.call_count || 0), 0) || 0;
      const totalErrors = data.usageByProvider?.reduce((sum, p) => sum + parseInt(p.error_count || 0), 0) || 0;

      const SUB_TABS = [
        { id: 'dashboard', label: '대시보드' },
        { id: 'usage', label: '사용량' },
        { id: 'prompts', label: '프롬프트' },
        { id: 'chunk-presets', label: '분할 설정' },
        { id: 'communities', label: '커뮤니티' },
        { id: 'rag-traces', label: 'RAG 트레이싱' },
        { id: 'observability', label: '관측성' },
      ];

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
              >{tab.label}</button>
            ))}
          </div>

          {/* ════════ 대시보드 탭 ════════ */}
          {subTab === 'dashboard' && (
            <div className="space-y-4">
              {/* 기간 선택 + 새로고침 */}
              <div className="flex gap-2">
                {[{ v: 'today', l: '오늘' }, { v: 'week', l: '7일' }, { v: 'month', l: '30일' }].map(r => (
                  <button key={r.v} onClick={() => setRange(r.v)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      range === r.v ? 'bg-primary text-white' : 'bg-border text-text-secondary hover:text-text'
                    }`}
                  >{r.l}</button>
                ))}
                <button onClick={fetchData}
                  className="ml-auto px-3 py-1.5 rounded-full text-xs bg-border text-text-secondary hover:text-text"
                >&#x21BB; 새로고침</button>
              </div>

              {/* 요약 카드 + 전일 비교 */}
              {(() => {
                const today = data.prevComparison?.find(r => r.period === 'today');
                const yesterday = data.prevComparison?.find(r => r.period === 'yesterday');
                const diffBadge = (todayVal, yesterdayVal) => {
                  if (!yesterday || parseInt(yesterdayVal) === 0) return null;
                  const pct = Math.round(((todayVal - yesterdayVal) / yesterdayVal) * 100);
                  if (pct === 0) return null;
                  return <span className={`text-[10px] font-medium ${pct > 0 ? 'text-red-400' : 'text-green-500'}`}>{pct > 0 ? '\u2191' : '\u2193'}{Math.abs(pct)}%</span>;
                };
                return (
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <Card>
                      <p className="text-[10px] text-text-secondary uppercase tracking-wider">총 호출</p>
                      <div className="flex items-end gap-1 mt-1">
                        <p className="text-base sm:text-2xl font-bold text-text">{totalCalls.toLocaleString()}</p>
                        {today && yesterday && diffBadge(parseInt(today.call_count), parseInt(yesterday.call_count))}
                      </div>
                    </Card>
                    <Card>
                      <p className="text-[10px] text-text-secondary uppercase tracking-wider">예상 비용</p>
                      <div className="flex items-end gap-1 mt-1">
                        <p className="text-base sm:text-2xl font-bold text-primary truncate">${totalCost.toFixed(4)}</p>
                        {today && yesterday && diffBadge(parseFloat(today.total_cost), parseFloat(yesterday.total_cost))}
                      </div>
                    </Card>
                    <Card>
                      <p className="text-[10px] text-text-secondary uppercase tracking-wider">에러</p>
                      <div className="flex items-end gap-1 mt-1">
                        <p className={`text-base sm:text-2xl font-bold ${totalErrors > 0 ? 'text-red-500' : 'text-green-500'}`}>{totalErrors}</p>
                        {today && yesterday && diffBadge(parseInt(today.error_count), parseInt(yesterday.error_count))}
                      </div>
                    </Card>
                  </div>
                );
              })()}

              {/* 프로바이더별 요약 */}
              <Card>
                <h4 className="text-xs font-bold text-text mb-3">프로바이더별 현황</h4>
                <div className="space-y-3">
                  {data.usageByProvider?.map(p => {
                    const cost = parseFloat(p.total_cost || 0);
                    const calls = parseInt(p.call_count || 0);
                    const errors = parseInt(p.error_count || 0);
                    const maxCalls = Math.max(...(data.usageByProvider?.map(x => parseInt(x.call_count || 0)) || [1]));
                    return (
                      <div key={p.provider}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Badge color={providerColors[p.provider] || 'gray'}>{providerLabels[p.provider] || p.provider}</Badge>
                            <span className="text-xs text-text">{calls}회</span>
                            {errors > 0 && <span className="text-xs text-red-500">({errors} 에러)</span>}
                          </div>
                          <span className="text-xs text-primary font-medium">${cost.toFixed(4)}</span>
                        </div>
                        <div className="w-full bg-border rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-primary/70 transition-all" style={{ width: `${maxCalls > 0 ? (calls / maxCalls) * 100 : 0}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {(!data.usageByProvider || data.usageByProvider.length === 0) && (
                    <p className="text-xs text-text-secondary text-center py-4">선택한 기간에 사용 기록이 없습니다.</p>
                  )}
                </div>
              </Card>

              {/* 일별 추이 (최근 7일) */}
              {data.dailyTrend?.length > 0 && (() => {
                const byDate = {};
                data.dailyTrend.forEach(d => {
                  const date = d.date?.slice(0, 10) || d.date;
                  if (!byDate[date]) byDate[date] = { calls: 0, cost: 0, providers: {} };
                  byDate[date].calls += parseInt(d.call_count);
                  byDate[date].cost += parseFloat(d.total_cost || 0);
                  byDate[date].providers[d.provider] = (byDate[date].providers[d.provider] || 0) + parseInt(d.call_count);
                });
                const dates = Object.keys(byDate).sort();
                const maxCalls = Math.max(...dates.map(d => byDate[d].calls), 1);
                const pColors = { openai: '#22c55e', anthropic: '#eab308', gemini: '#3b82f6', upstage: '#60a5fa' };
                return (
                  <Card>
                    <h4 className="text-xs font-bold text-text mb-3">일별 추이 (최근 7일)</h4>
                    <div className="space-y-2">
                      {dates.map(date => {
                        const d = byDate[date];
                        const pct = (d.calls / maxCalls) * 100;
                        const pList = Object.entries(d.providers);
                        return (
                          <div key={date} className="flex items-center gap-1.5 sm:gap-2 text-xs">
                            <span className="w-9 sm:w-10 text-text-secondary text-[10px] shrink-0">{date.slice(5)}</span>
                            <div className="flex-1 h-4 bg-border/50 rounded overflow-hidden flex">
                              {pList.map(([prov, cnt]) => (
                                <div key={prov} style={{ width: `${(cnt / maxCalls) * 100}%`, backgroundColor: pColors[prov] || '#9ca3af' }}
                                  className="h-full transition-all" title={`${providerLabels[prov] || prov}: ${cnt}회`} />
                              ))}
                            </div>
                            <span className="w-7 sm:w-8 text-right text-text shrink-0 text-[10px] sm:text-xs">{d.calls}</span>
                            <span className="w-12 sm:w-14 text-right text-primary text-[10px] shrink-0">${d.cost.toFixed(3)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-3 mt-2 pt-2 border-t border-border/50">
                      {Object.entries(pColors).filter(([p]) => data.dailyTrend.some(d => d.provider === p)).map(([p, c]) => (
                        <div key={p} className="flex items-center gap-1 text-[10px] text-text-secondary">
                          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: c }} />
                          {providerLabels[p] || p}
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })()}

              {/* 최근 에러 (있을 때만) */}
              {data.recentErrors?.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-text mb-2">최근 에러 ({data.recentErrors.length}건)</h4>
                  <div className="space-y-1.5">
                    {data.recentErrors.slice(0, 5).map((e, i) => (
                      <Card key={i} className="border-red-200">
                        <div className="flex items-center gap-2 text-xs">
                          <Badge color={e.status === 'credit_exhausted' ? 'red' : 'yellow'}>{e.status}</Badge>
                          <span className="text-text-secondary">{e.provider}</span>
                          <span className="text-text-secondary ml-auto text-[10px]">{formatDate(e.created_at)}</span>
                        </div>
                        <p className="text-[11px] text-red-500 mt-1 line-clamp-1">{e.error_message}</p>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════════ 사용량 상세 탭 ════════ */}
          {subTab === 'usage' && (
            <div className="space-y-4">
              {/* 기간 선택 + CSV 내보내기 */}
              <div className="flex gap-2 items-center">
                {[{ v: 'today', l: '오늘' }, { v: 'week', l: '7일' }, { v: 'month', l: '30일' }].map(r => (
                  <button key={r.v} onClick={() => setRange(r.v)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      range === r.v ? 'bg-primary text-white' : 'bg-border text-text-secondary hover:text-text'
                    }`}
                  >{r.l}</button>
                ))}
                {data.usageByModel?.length > 0 && (
                  <button onClick={() => {
                    const rows = [['프로바이더','모델','엔드포인트','호출수','토큰(입력)','토큰(출력)','비용($)']];
                    data.usageByModel.forEach(m => rows.push([m.provider, m.model, m.endpoint, m.call_count, m.total_tokens_in, m.total_tokens_out, parseFloat(m.total_cost).toFixed(4)]));
                    const totals = data.usageByModel.reduce((a, m) => ({ calls: a.calls + parseInt(m.call_count), tIn: a.tIn + parseInt(m.total_tokens_in || 0), tOut: a.tOut + parseInt(m.total_tokens_out || 0), cost: a.cost + parseFloat(m.total_cost) }), { calls: 0, tIn: 0, tOut: 0, cost: 0 });
                    rows.push(['합계', '', '', totals.calls, totals.tIn, totals.tOut, totals.cost.toFixed(4)]);
                    const csv = rows.map(r => r.join(',')).join('\n');
                    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
                    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                    a.download = `docstore-usage-${range}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
                  }} className="ml-auto px-2.5 py-1.5 rounded-full text-xs bg-border text-text-secondary hover:text-text transition-colors">
                    CSV 내보내기
                  </button>
                )}
              </div>

              {/* 모델별 사용량 + 합계 */}
              {data.usageByModel?.length > 0 ? (
                <Card>
                  <h4 className="text-xs font-bold text-text mb-3">모델별 사용량</h4>
                  <div className="space-y-1">
                    {data.usageByModel.map((m, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-2 border-b border-border/50 gap-2">
                        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                          <Badge color={providerColors[m.provider] || 'gray'}>{m.provider}</Badge>
                          <span className="text-text truncate text-[11px] sm:text-xs">{m.model}</span>
                          <span className="text-text-secondary text-[10px] hidden sm:inline">({m.endpoint})</span>
                        </div>
                        <div className="flex gap-2 sm:gap-3 text-text-secondary shrink-0">
                          <span className="text-[11px] sm:text-xs">{m.call_count}회</span>
                          <span className="text-primary font-medium text-[11px] sm:text-xs">${parseFloat(m.total_cost).toFixed(4)}</span>
                        </div>
                      </div>
                    ))}
                    {/* 합계 행 */}
                    {(() => {
                      const t = data.usageByModel.reduce((a, m) => ({
                        calls: a.calls + parseInt(m.call_count),
                        tIn: a.tIn + parseInt(m.total_tokens_in || 0),
                        tOut: a.tOut + parseInt(m.total_tokens_out || 0),
                        cost: a.cost + parseFloat(m.total_cost)
                      }), { calls: 0, tIn: 0, tOut: 0, cost: 0 });
                      return (
                        <div className="flex items-center justify-between text-xs py-2.5 mt-1 border-t-2 border-border">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-text shrink-0">합계</span>
                            <span className="text-text-secondary text-[10px] hidden sm:inline">토큰: 입력 {t.tIn.toLocaleString()} / 출력 {t.tOut.toLocaleString()}</span>
                          </div>
                          <div className="flex gap-2 sm:gap-3 shrink-0">
                            <span className="font-bold text-text">{t.calls}회</span>
                            <span className="text-primary font-bold">${t.cost.toFixed(4)}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </Card>
              ) : (
                <Card><p className="text-xs text-text-secondary text-center py-6">선택한 기간에 사용 기록이 없습니다.</p></Card>
              )}

              {/* 에러 로그 + 필터 */}
              {data.recentErrors?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-text">에러 로그 ({data.recentErrors.length}건)</h4>
                    <div className="flex gap-1">
                      {['all', ...new Set(data.recentErrors.map(e => e.provider))].map(f => (
                        <button key={f} onClick={() => setErrorFilter(f)}
                          className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                            errorFilter === f ? 'bg-primary text-white' : 'bg-border text-text-secondary hover:text-text'
                          }`}
                        >{f === 'all' ? '전체' : f}</button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {data.recentErrors
                      .filter(e => errorFilter === 'all' || e.provider === errorFilter)
                      .map((e, i) => (
                      <Card key={i} className="border-red-200">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs">
                            <Badge color={e.status === 'credit_exhausted' ? 'red' : 'yellow'}>{e.status}</Badge>
                            <span className="text-text-secondary">{e.provider} / {e.model}</span>
                            <span className="text-text-secondary ml-auto text-[10px]">{formatDate(e.created_at)}</span>
                          </div>
                          <p className="text-[11px] text-red-500">{e.error_message?.length > 200 ? e.error_message.slice(0, 200) + '...' : e.error_message}</p>
                        </div>
                      </Card>
                    ))}
                    {data.recentErrors.filter(e => errorFilter === 'all' || e.provider === errorFilter).length === 0 && (
                      <p className="text-xs text-text-secondary text-center py-3">필터 조건에 맞는 에러가 없습니다.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════════ 프롬프트 관리 탭 ════════ */}
          {subTab === 'prompts' && (
            <PromptManagerPanel />
          )}

          {/* ════════ 분할 설정 탭 ════════ */}
          {subTab === 'chunk-presets' && (
            <ChunkPresetPanel />
          )}

          {/* ════════ RAG 트레이싱 탭 ════════ */}
          {/* ════════ 커뮤니티 탭 ════════ */}
          {subTab === 'communities' && (
            <CommunitiesPanel />
          )}

          {subTab === 'rag-traces' && (
            <RagTracesPanel />
          )}

          {/* ════════ 관측성 (LangFuse) 탭 ════════ */}
          {subTab === 'observability' && (
            <ObservabilityPanel />
          )}
        </div>
      );
    }

    // ========================================
    // 커뮤니티 탐지 패널
    // ========================================
    function CommunitiesPanel() {
      const [documents, setDocuments] = useState([]);
      const [selectedDocId, setSelectedDocId] = useState('');
      const [algorithm, setAlgorithm] = useState('auto');
      const [communities, setCommunities] = useState([]);
      const [loading, setLoading] = useState(false);
      const [detecting, setDetecting] = useState(false);
      const [summarizing, setSummarizing] = useState(false);
      const [result, setResult] = useState(null);
      const [globalQuery, setGlobalQuery] = useState('');
      const [globalResult, setGlobalResult] = useState(null);
      const [globalLoading, setGlobalLoading] = useState(false);
      const [useReduce, setUseReduce] = useState(false); // Map-Reduce Reduce 단계

      // 문서 목록 로드
      useEffect(() => {
        authFetch(`${API_BASE_URL}/documents`)
          .then(r => r.json())
          .then(data => setDocuments(data.documents || []))
          .catch(() => {});
      }, []);

      // 선택된 문서의 커뮤니티 로드
      useEffect(() => {
        if (!selectedDocId) { setCommunities([]); setResult(null); return; }
        setLoading(true);
        authFetch(`${API_BASE_URL}/communities?docId=${selectedDocId}`)
          .then(r => r.json())
          .then(data => {
            setCommunities(data.communities || []);
            setLoading(false);
          })
          .catch(() => setLoading(false));
      }, [selectedDocId]);

      // 커뮤니티 탐지 실행
      const handleDetect = async () => {
        if (!selectedDocId) return;
        setDetecting(true);
        setResult(null);
        try {
          const res = await authFetch(`${API_BASE_URL}/communities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId: parseInt(selectedDocId), algorithm }),
          });
          const data = await res.json();
          setResult(data);
          // 결과 다시 로드
          const listRes = await authFetch(`${API_BASE_URL}/communities?docId=${selectedDocId}`);
          const listData = await listRes.json();
          setCommunities(listData.communities || []);
        } catch (err) {
          alert('커뮤니티 탐지 실패: ' + err.message);
        } finally {
          setDetecting(false);
        }
      };

      // 요약 생성
      const handleSummarize = async () => {
        if (!selectedDocId || communities.length === 0) return;
        setSummarizing(true);
        try {
          const res = await authFetch(`${API_BASE_URL}/communities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId: parseInt(selectedDocId), summarize: true }),
          });
          const data = await res.json();
          alert(`요약 생성 완료: ${data.generated}개 생성, ${data.errors}개 오류`);
          // 다시 로드
          const listRes = await authFetch(`${API_BASE_URL}/communities?docId=${selectedDocId}`);
          const listData = await listRes.json();
          setCommunities(listData.communities || []);
        } catch (err) {
          alert('요약 생성 실패: ' + err.message);
        } finally {
          setSummarizing(false);
        }
      };

      // 글로벌 검색
      const handleGlobalSearch = async () => {
        if (!globalQuery.trim()) return;
        setGlobalLoading(true);
        setGlobalResult(null);
        try {
          const res = await authFetch(`${API_BASE_URL}/communities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ globalSearch: true, question: globalQuery.trim(), useReduce }),
          });
          setGlobalResult(await res.json());
        } catch (err) {
          alert('글로벌 검색 실패: ' + err.message);
        } finally {
          setGlobalLoading(false);
        }
      };

      // 엔티티 타입별 색상
      const typeColors = {
        law: 'bg-blue-500/20 text-blue-400',
        article: 'bg-green-500/20 text-green-400',
        organization: 'bg-yellow-500/20 text-yellow-400',
        concept: 'bg-purple-500/20 text-purple-400',
        duty: 'bg-red-500/20 text-red-400',
      };

      return (
        <div className="space-y-4">
          {/* 상단: 문서 선택 + 알고리즘 + 실행 */}
          <Card>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">커뮤니티 탐지</h3>
              <p className="text-xs text-text-secondary">지식 그래프의 엔티티를 의미적 그룹(커뮤니티)으로 분류합니다. 법령 문서는 Leiden, 일반 문서는 Louvain 알고리즘을 자동 선택합니다.</p>
              <div className="flex flex-wrap gap-2">
                {/* 문서 선택 */}
                <select value={selectedDocId} onChange={e => setSelectedDocId(e.target.value)}
                  className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-background border border-border text-sm">
                  <option value="">문서 선택...</option>
                  {documents.map(d => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
                {/* 알고리즘 선택 */}
                <select value={algorithm} onChange={e => setAlgorithm(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-background border border-border text-sm">
                  <option value="auto">자동 선택</option>
                  <option value="leiden">Leiden (정밀)</option>
                  <option value="louvain">Louvain (빠름)</option>
                </select>
                {/* 탐지 버튼 */}
                <button onClick={handleDetect} disabled={!selectedDocId || detecting}
                  className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50">
                  {detecting ? '탐지 중...' : '탐지 실행'}
                </button>
                {/* 요약 생성 버튼 */}
                <button onClick={handleSummarize} disabled={communities.length === 0 || summarizing}
                  className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-50">
                  {summarizing ? '생성 중...' : '요약 생성'}
                </button>
              </div>
            </div>
          </Card>

          {/* 탐지 결과 요약 */}
          {result && (
            <Card>
              <div className="flex flex-wrap gap-4 text-sm">
                <div><span className="text-text-secondary">알고리즘:</span> <span className="font-medium">{result.algorithm}</span></div>
                <div><span className="text-text-secondary">문서 유형:</span> <span className="font-medium">{result.documentType}</span></div>
                <div><span className="text-text-secondary">노드:</span> <span className="font-medium">{result.stats?.nodes}</span></div>
                <div><span className="text-text-secondary">엣지:</span> <span className="font-medium">{result.stats?.edges}</span></div>
                <div><span className="text-text-secondary">커뮤니티:</span> <span className="font-medium">{result.stats?.communities}</span></div>
                <div><span className="text-text-secondary">Modularity:</span> <span className="font-medium">{result.modularity}</span></div>
                <div><span className="text-text-secondary">소요:</span> <span className="font-medium">{result.elapsed}ms</span></div>
              </div>
            </Card>
          )}

          {/* 로딩 */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* 커뮤니티 목록 */}
          {communities.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">커뮤니티 ({communities.length}개)</h3>
              {communities.map((comm, idx) => {
                const meta = typeof comm.metadata === 'string' ? JSON.parse(comm.metadata) : (comm.metadata || {});
                const nodes = meta.nodes || [];
                return (
                  <Card key={comm.id || idx}>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium">
                            #{comm.community_index}
                          </span>
                          <span className="text-sm font-medium">{comm.size}개 엔티티</span>
                          <span className="text-xs text-text-secondary">{comm.algorithm}</span>
                        </div>
                      </div>
                      {/* 엔티티 태그 */}
                      <div className="flex flex-wrap gap-1">
                        {nodes.slice(0, 15).map((n, i) => (
                          <span key={i} className={`px-2 py-0.5 rounded-full text-xs ${typeColors[n.type] || 'bg-gray-500/20 text-gray-400'}`}>
                            {n.name}
                          </span>
                        ))}
                        {nodes.length > 15 && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-border text-text-secondary">
                            +{nodes.length - 15}개
                          </span>
                        )}
                      </div>
                      {/* 요약 */}
                      {comm.summary && (
                        <div className="text-xs text-text-secondary bg-background rounded-lg p-3 border border-border/50">
                          {comm.summary}
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* 글로벌 검색 */}
          <Card>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">글로벌 검색 (Map-Reduce)</h3>
              <p className="text-xs text-text-secondary">커뮤니티 요약을 벡터+키워드 검색하고, Reduce 시 LLM이 종합 답변을 생성합니다.</p>
              <div className="flex gap-2">
                <input type="text" value={globalQuery} onChange={e => setGlobalQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGlobalSearch()}
                  placeholder="질문을 입력하세요..."
                  className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm" />
                <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                  <div className={`relative w-9 h-5 rounded-full transition-colors ${useReduce ? 'bg-violet-500' : 'bg-border'}`}
                    onClick={() => setUseReduce(v => !v)}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useReduce ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                  <span className="text-[11px] text-text-secondary">Reduce</span>
                </label>
                <button onClick={handleGlobalSearch} disabled={globalLoading || !globalQuery.trim()}
                  className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50">
                  {globalLoading ? '검색 중...' : '검색'}
                </button>
              </div>
              {/* 글로벌 검색 결과 */}
              {globalResult && (
                <div className="space-y-3">
                  {/* Reduce 종합 답변 (있으면 최상단에 표시) */}
                  {globalResult.reducedAnswer && (
                    <div className="p-4 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-800 dark:text-violet-200">Reduce 종합 답변</span>
                        <span className="text-[10px] text-text-secondary">{globalResult.communities?.length}개 커뮤니티 합성</span>
                      </div>
                      <div className="text-sm text-text whitespace-pre-wrap leading-relaxed">{globalResult.reducedAnswer}</div>
                    </div>
                  )}
                  {globalResult.communities?.length === 0 ? (
                    <p className="text-xs text-text-secondary">관련 커뮤니티를 찾지 못했습니다. 먼저 커뮤니티 탐지와 요약을 실행하세요.</p>
                  ) : (
                    <details open={!globalResult.reducedAnswer}>
                      <summary className="text-xs font-medium text-text-secondary cursor-pointer hover:text-text">
                        Map 결과: {globalResult.communities?.length}개 커뮤니티 요약
                      </summary>
                      <div className="space-y-2 mt-2">
                        {globalResult.communities?.map((c, i) => (
                          <div key={i} className="p-3 rounded-lg bg-background border border-border/50 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium">{c.docTitle}</span>
                              <div className="flex items-center gap-2">
                                {c.vectorScore > 0 && <span className="text-[10px] text-emerald-600">벡터: {c.vectorScore?.toFixed(2)}</span>}
                                <span className="text-xs text-text-secondary">관련도: {c.relevanceScore?.toFixed(1)}</span>
                              </div>
                            </div>
                            <p className="text-xs text-text-secondary">{c.summary}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      );
    }

    // ========================================
    // RAG 트레이싱 패널
    // ========================================
    function RagTracesPanel() {
      const [traces, setTraces] = useState([]);
      const [total, setTotal] = useState(0);
      const [loading, setLoading] = useState(true);
      const [page, setPage] = useState(0);
      const [statusFilter, setStatusFilter] = useState('');
      const [selectedTrace, setSelectedTrace] = useState(null);
      const [detailLoading, setDetailLoading] = useState(false);
      const limit = 20;

      // 목록 로드
      const loadTraces = useCallback(async () => {
        setLoading(true);
        try {
          let url = `${API_BASE_URL}/rag-traces?limit=${limit}&offset=${page * limit}`;
          if (statusFilter) url += `&status=${statusFilter}`;
          const res = await authFetch(url);
          const data = await res.json();
          setTraces(data.traces || []);
          setTotal(data.total || 0);
        } catch (err) {
          console.error('트레이스 로드 실패:', err);
        } finally {
          setLoading(false);
        }
      }, [page, statusFilter]);

      useEffect(() => { loadTraces(); }, [loadTraces]);

      // 상세 로드
      const loadDetail = async (id) => {
        setDetailLoading(true);
        try {
          const res = await authFetch(`${API_BASE_URL}/rag-traces?id=${id}`);
          const data = await res.json();
          setSelectedTrace(data);
        } catch (err) {
          console.error('트레이스 상세 로드 실패:', err);
        } finally {
          setDetailLoading(false);
        }
      };

      // 삭제
      const deleteTrace = async (id) => {
        if (!confirm('이 트레이스를 삭제하시겠습니까?')) return;
        try {
          await authFetch(`${API_BASE_URL}/rag-traces?id=${id}`, { method: 'DELETE' });
          setSelectedTrace(null);
          loadTraces();
        } catch (err) {
          alert('삭제 실패: ' + err.message);
        }
      };

      // 전체 삭제
      const deleteAll = async () => {
        if (!confirm('전체 트레이스를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
        try {
          await authFetch(`${API_BASE_URL}/rag-traces`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ all: true }),
          });
          setSelectedTrace(null);
          loadTraces();
        } catch (err) {
          alert('전체 삭제 실패: ' + err.message);
        }
      };

      const totalPages = Math.ceil(total / limit);

      // 상세 보기 모드
      if (selectedTrace) {
        const t = selectedTrace;
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <button onClick={() => setSelectedTrace(null)}
                className="text-sm text-primary hover:underline">← 목록으로</button>
              <button onClick={() => deleteTrace(t.id)}
                className="text-xs px-3 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">삭제</button>
            </div>

            {/* 기본 정보 */}
            <div className="bg-card-bg border border-border rounded-lg p-4 space-y-3">
              <h4 className="font-semibold text-sm">질문</h4>
              <p className="text-sm bg-bg p-3 rounded">{t.question}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div><span className="text-text-secondary">상태</span>
                  <div className={`font-medium ${t.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>{t.status}</div></div>
                <div><span className="text-text-secondary">Provider</span><div className="font-medium">{t.provider} {t.model && `/ ${t.model}`}</div></div>
                <div><span className="text-text-secondary">카테고리</span><div className="font-medium">{t.category}</div></div>
                <div><span className="text-text-secondary">시간</span><div className="font-medium">{new Date(t.created_at).toLocaleString('ko-KR')}</div></div>
              </div>
            </div>

            {/* 타이밍 */}
            <div className="bg-card-bg border border-border rounded-lg p-4">
              <h4 className="font-semibold text-sm mb-3">실행 시간</h4>
              <div className="grid grid-cols-3 gap-2 sm:gap-3 text-xs text-center">
                <div className="bg-blue-50 rounded-lg p-2 sm:p-3">
                  <div className="text-blue-600 font-bold text-sm sm:text-lg">{(t.total_duration_ms / 1000).toFixed(1)}s</div>
                  <div className="text-text-secondary text-[10px] sm:text-xs">전체</div>
                </div>
                <div className="bg-green-50 rounded-lg p-2 sm:p-3">
                  <div className="text-green-600 font-bold text-sm sm:text-lg">{(t.search_duration_ms / 1000).toFixed(1)}s</div>
                  <div className="text-text-secondary text-[10px] sm:text-xs">검색</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-2 sm:p-3">
                  <div className="text-purple-600 font-bold text-sm sm:text-lg">{(t.llm_duration_ms / 1000).toFixed(1)}s</div>
                  <div className="text-text-secondary text-[10px] sm:text-xs">LLM</div>
                </div>
              </div>
            </div>

            {/* 토큰 / 비용 */}
            <div className="bg-card-bg border border-border rounded-lg p-4">
              <h4 className="font-semibold text-sm mb-3">토큰 & 비용</h4>
              <div className="grid grid-cols-3 gap-2 sm:gap-3 text-xs text-center">
                <div className="min-w-0"><span className="text-text-secondary text-[10px] sm:text-xs">입력 토큰</span><div className="font-bold truncate text-[11px] sm:text-xs">{(t.tokens_in || 0).toLocaleString()}</div></div>
                <div className="min-w-0"><span className="text-text-secondary text-[10px] sm:text-xs">출력 토큰</span><div className="font-bold truncate text-[11px] sm:text-xs">{(t.tokens_out || 0).toLocaleString()}</div></div>
                <div className="min-w-0"><span className="text-text-secondary text-[10px] sm:text-xs">추정 비용</span><div className="font-bold truncate text-[11px] sm:text-xs">${parseFloat(t.cost_estimate || 0).toFixed(4)}</div></div>
              </div>
            </div>

            {/* 검색 결과 */}
            {t.search_results && (
              <div className="bg-card-bg border border-border rounded-lg p-4">
                <h4 className="font-semibold text-sm mb-3">검색 결과 ({t.sources_count}건, {t.hops}홉)</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {(typeof t.search_results === 'string' ? JSON.parse(t.search_results) : t.search_results).map((s, i) => (
                    <div key={i} className="text-xs bg-bg rounded p-2">
                      <div className="font-medium">[{s.index}] {s.documentTitle} - {s.label || s.category}</div>
                      <div className="text-text-secondary mt-1">유사도: {Number(s.similarity || 0).toFixed(3)} | 길이: {s.textLength}자</div>
                      {s.excerpt && <div className="text-text-secondary mt-1 truncate">{s.excerpt}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 쿼리 강화 */}
            {(t.query_rewrite || t.hyde) && (
              <div className="bg-card-bg border border-border rounded-lg p-4">
                <h4 className="font-semibold text-sm mb-3">쿼리 강화</h4>
                {t.query_rewrite && (() => {
                  const qr = typeof t.query_rewrite === 'string' ? JSON.parse(t.query_rewrite) : t.query_rewrite;
                  return (
                    <div className="text-xs mb-2">
                      <span className="font-medium">리라이팅</span> ({qr.timing}ms)
                      {qr.intent && <span className="ml-2 text-text-secondary">의도: {qr.intent}</span>}
                      {qr.queries && <div className="mt-1 text-text-secondary">쿼리: {qr.queries.join(', ')}</div>}
                    </div>
                  );
                })()}
                {t.hyde && (() => {
                  const h = typeof t.hyde === 'string' ? JSON.parse(t.hyde) : t.hyde;
                  return (
                    <div className="text-xs">
                      <span className="font-medium">HyDE</span> ({h.timing}ms, {h.docLength}자)
                      {h.excerpt && <div className="mt-1 text-text-secondary truncate">{h.excerpt}</div>}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 파싱 결과 */}
            {t.parsed_output && (
              <div className="bg-card-bg border border-border rounded-lg p-4">
                <h4 className="font-semibold text-sm mb-3">파싱 결과</h4>
                {(() => {
                  const p = typeof t.parsed_output === 'string' ? JSON.parse(t.parsed_output) : t.parsed_output;
                  return (
                    <div className="text-xs space-y-1">
                      <div>형식: <span className="font-medium">{p.format}</span></div>
                      <div>근거 체인: {p.evidenceCount}건 | 교차참조: {p.crossRefCount}건 | 경고: {p.warningCount}건</div>
                      {p.hasCaveats && <div className="text-amber-600">주의사항 포함</div>}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 결론 */}
            {t.conclusion && (
              <div className="bg-card-bg border border-border rounded-lg p-4">
                <h4 className="font-semibold text-sm mb-3">결론</h4>
                <p className="text-xs text-text-secondary">{t.conclusion}</p>
              </div>
            )}

            {/* 에러 */}
            {t.error_message && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-red-600 mb-2">에러</h4>
                <p className="text-xs text-red-600">{t.error_message}</p>
              </div>
            )}
          </div>
        );
      }

      // 목록 보기
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">RAG 파이프라인 트레이싱</h3>
            <div className="flex gap-2">
              <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
                className="text-xs border border-border rounded px-2 py-1 bg-card-bg">
                <option value="">전체 상태</option>
                <option value="success">성공</option>
                <option value="error">에러</option>
              </select>
              <button onClick={loadTraces} className="text-xs px-3 py-1 bg-primary text-white rounded hover:opacity-90">새로고침</button>
              {total > 0 && (
                <button onClick={deleteAll} className="text-xs px-3 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">전체 삭제</button>
              )}
            </div>
          </div>

          <p className="text-xs text-text-secondary">
            RAG 질의응답의 전체 과정(질문 → 검색 → LLM → 파싱)을 자동 기록합니다. 총 {total}건
          </p>

          {loading ? (
            <div className="text-center py-8 text-text-secondary text-sm">로딩 중...</div>
          ) : traces.length === 0 ? (
            <div className="text-center py-8 text-text-secondary text-sm">기록된 트레이스가 없습니다. RAG 질문을 하면 자동으로 기록됩니다.</div>
          ) : (
            <div className="space-y-2">
              {traces.map(t => (
                <div key={t.id} onClick={() => loadDetail(t.id)}
                  className="bg-card-bg border border-border rounded-lg p-3 cursor-pointer hover:border-primary/50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{t.question}</div>
                      <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-text-secondary">
                        <span className={`px-1.5 py-0.5 rounded ${t.status === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                          {t.status}
                        </span>
                        <span>{t.provider}{t.model ? `/${t.model}` : ''}</span>
                        <span>{t.sources_count}건 검색</span>
                        <span>{(t.total_duration_ms / 1000).toFixed(1)}s</span>
                        {t.cost_estimate > 0 && <span>${parseFloat(t.cost_estimate).toFixed(4)}</span>}
                        <span>{t.parse_format || '-'}</span>
                      </div>
                    </div>
                    <div className="text-xs text-text-secondary whitespace-nowrap">
                      {new Date(t.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    className="text-xs px-3 py-1 border border-border rounded disabled:opacity-30">이전</button>
                  <span className="text-xs text-text-secondary">{page + 1} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    className="text-xs px-3 py-1 border border-border rounded disabled:opacity-30">다음</button>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // ========================================
    // 프롬프트 템플릿 관리 패널
    // ========================================
    function PromptManagerPanel() {
      const [templates, setTemplates] = useState([]);
      const [loading, setLoading] = useState(true);
      const [editing, setEditing] = useState(null); // 편집 중인 템플릿
      const [message, setMessage] = useState(null);

      // 템플릿 목록 로드
      const fetchTemplates = useCallback(async () => {
        try {
          const res = await authFetch(`${API_BASE_URL}/prompts`);
          if (res.ok) {
            const data = await res.json();
            setTemplates(data.templates || []);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

      // 편집할 템플릿 전체 로드
      const handleEdit = useCallback(async (t) => {
        try {
          const res = await authFetch(`${API_BASE_URL}/prompts?name=${encodeURIComponent(t.name)}&category=${encodeURIComponent(t.category)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.template) {
              setEditing({
                ...data.template,
                few_shot_examples: data.template.few_shot_examples || [],
                model_params: data.template.model_params || {},
              });
            }
          }
        } catch (err) {
          setMessage({ type: 'error', text: err.message });
        }
      }, []);

      // 저장
      const handleSave = useCallback(async () => {
        if (!editing) return;
        try {
          const res = await authFetch(`${API_BASE_URL}/prompts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: editing.id,
              name: editing.name,
              category: editing.category,
              stage: editing.stage,
              template: editing.template,
              few_shot_examples: editing.few_shot_examples,
              model_params: editing.model_params,
              description: editing.description,
            }),
          });
          if (res.ok) {
            setMessage({ type: 'success', text: '저장 완료! 캐시가 초기화되어 즉시 반영됩니다.' });
            setEditing(null);
            fetchTemplates();
            setTimeout(() => setMessage(null), 3000);
          }
        } catch (err) {
          setMessage({ type: 'error', text: err.message });
        }
      }, [editing, fetchTemplates]);

      // 삭제
      const handleDelete = useCallback(async (id) => {
        if (!confirm('이 템플릿을 삭제하시겠습니까? 기본 폴백 프롬프트로 대체됩니다.')) return;
        try {
          await authFetch(`${API_BASE_URL}/prompts`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          });
          setMessage({ type: 'success', text: '삭제 완료' });
          fetchTemplates();
          setTimeout(() => setMessage(null), 2000);
        } catch (err) {
          setMessage({ type: 'error', text: err.message });
        }
      }, [fetchTemplates]);

      // DB 기본 템플릿 초기화
      const handleInitDefaults = useCallback(async () => {
        setMessage({ type: 'info', text: '기본 템플릿 초기화는 서버에서 마이그레이션 스크립트를 실행하세요: node scripts/add-prompt-templates-table.js' });
        setTimeout(() => setMessage(null), 5000);
      }, []);

      // 카테고리 색상
      const catColor = (cat) => {
        const colors = { '법령': 'blue', '규정': 'green', '기출': 'amber', 'default': 'gray' };
        const c = colors[cat] || 'gray';
        return `bg-${c}-50 text-${c}-700 border-${c}-200`;
      };

      // 스테이지 라벨
      const stageLabel = (stage) => {
        const labels = { 'main': '메인', 'query-analysis': '쿼리 분석', 'verify': '검증' };
        return labels[stage] || stage;
      };

      if (loading) return <div className="text-center py-8 text-text-secondary text-sm">로딩 중...</div>;

      // 편집 모드
      if (editing) {
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text">
                프롬프트 편집: {editing.name} ({editing.category})
              </h3>
              <button onClick={() => setEditing(null)}
                className="text-xs px-2 py-1 rounded bg-border/50 hover:bg-border text-text-secondary">
                ← 목록으로
              </button>
            </div>

            {message && (
              <div className={`p-2 rounded text-xs ${message.type === 'success' ? 'bg-green-50 text-green-700' : message.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                {message.text}
              </div>
            )}

            <Card>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-text-secondary block mb-1">이름</label>
                    <input value={editing.name} readOnly
                      className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg text-text-secondary" />
                  </div>
                  <div>
                    <label className="text-[11px] text-text-secondary block mb-1">카테고리</label>
                    <input value={editing.category} readOnly
                      className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg text-text-secondary" />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-text-secondary block mb-1">설명</label>
                  <input value={editing.description || ''}
                    onChange={e => setEditing({...editing, description: e.target.value})}
                    className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg text-text" />
                </div>
              </div>
            </Card>

            {/* 프롬프트 텍스트 편집 */}
            <Card>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-text">프롬프트 템플릿</label>
                  <span className="text-[10px] text-text-secondary">
                    변수: {'{{question}} {{contextText}} {{historyText}} {{sourceCount}} {{fewShotBlock}} {{answer}}'}
                  </span>
                </div>
                <textarea value={editing.template}
                  onChange={e => setEditing({...editing, template: e.target.value})}
                  rows={18}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-border bg-bg text-text resize-y leading-relaxed"
                  placeholder="프롬프트 템플릿을 입력하세요..." />
                <p className="text-[10px] text-text-secondary">
                  {'{{변수명}}'} 형식으로 동적 값을 삽입합니다. 저장하면 캐시가 초기화되어 즉시 반영됩니다.
                </p>
              </div>
            </Card>

            {/* Few-shot 예시 편집 */}
            <Card>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-text">Few-shot 예시</label>
                  <button onClick={() => {
                    const examples = [...(editing.few_shot_examples || []), { input: '', output: '' }];
                    setEditing({...editing, few_shot_examples: examples});
                  }}
                    className="text-xs px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20">
                    + 예시 추가
                  </button>
                </div>
                {(editing.few_shot_examples || []).length === 0 && (
                  <p className="text-[11px] text-text-secondary py-2">
                    Few-shot 예시가 없습니다. 예시를 추가하면 LLM이 출력 형식을 더 잘 따릅니다.
                  </p>
                )}
                {(editing.few_shot_examples || []).map((ex, idx) => (
                  <div key={idx} className="p-2 rounded-lg border border-border bg-bg space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-text-secondary">예시 {idx + 1}</span>
                      <button onClick={() => {
                        const examples = editing.few_shot_examples.filter((_, i) => i !== idx);
                        setEditing({...editing, few_shot_examples: examples});
                      }}
                        className="text-[10px] text-red-500 hover:text-red-700">삭제</button>
                    </div>
                    <div>
                      <label className="text-[10px] text-text-secondary">입력 (질문)</label>
                      <input value={ex.input}
                        onChange={e => {
                          const examples = [...editing.few_shot_examples];
                          examples[idx] = {...examples[idx], input: e.target.value};
                          setEditing({...editing, few_shot_examples: examples});
                        }}
                        className="w-full px-2 py-1 text-xs rounded border border-border bg-card-bg text-text" />
                    </div>
                    <div>
                      <label className="text-[10px] text-text-secondary">출력 (기대 답변)</label>
                      <textarea value={ex.output}
                        onChange={e => {
                          const examples = [...editing.few_shot_examples];
                          examples[idx] = {...examples[idx], output: e.target.value};
                          setEditing({...editing, few_shot_examples: examples});
                        }}
                        rows={3}
                        className="w-full px-2 py-1 text-xs font-mono rounded border border-border bg-card-bg text-text resize-y" />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* 모델 파라미터 */}
            <Card>
              <div className="space-y-2">
                <label className="text-xs font-bold text-text">모델 파라미터</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-text-secondary">Temperature</label>
                    <input type="number" step="0.1" min="0" max="1"
                      value={editing.model_params?.temperature ?? 0.3}
                      onChange={e => setEditing({...editing, model_params: {...editing.model_params, temperature: parseFloat(e.target.value)}})}
                      className="w-full px-2 py-1 text-xs rounded border border-border bg-bg text-text" />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-secondary">Max Tokens</label>
                    <input type="number" step="256" min="256" max="8192"
                      value={editing.model_params?.maxTokens ?? 3072}
                      onChange={e => setEditing({...editing, model_params: {...editing.model_params, maxTokens: parseInt(e.target.value)}})}
                      className="w-full px-2 py-1 text-xs rounded border border-border bg-bg text-text" />
                  </div>
                </div>
              </div>
            </Card>

            {/* 저장 버튼 */}
            <div className="flex gap-2">
              <button onClick={handleSave}
                className="flex-1 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90">
                저장 (즉시 반영)
              </button>
              <button onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm text-text-secondary border border-border rounded-lg hover:bg-border/50">
                취소
              </button>
            </div>
          </div>
        );
      }

      // 목록 모드
      return (
        <div className="space-y-4">
          {message && (
            <div className={`p-2 rounded text-xs ${message.type === 'success' ? 'bg-green-50 text-green-700' : message.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
              {message.text}
            </div>
          )}

          <Card>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-text">프롬프트 템플릿</h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    DB에 저장된 프롬프트를 수정하면 재배포 없이 즉시 반영됩니다.
                  </p>
                </div>
                <button onClick={handleInitDefaults}
                  className="text-xs px-2 py-1 rounded bg-border/50 hover:bg-border text-text-secondary">
                  초기화 안내
                </button>
              </div>

              {templates.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-sm text-text-secondary mb-2">등록된 템플릿이 없습니다.</p>
                  <p className="text-xs text-text-secondary">
                    서버에서 <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">node scripts/add-prompt-templates-table.js</code>를 실행하세요.
                  </p>
                  <p className="text-xs text-text-secondary mt-1">
                    DB 없이도 코드 내장 폴백 프롬프트로 동작합니다.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {templates.map(t => (
                  <div key={t.id} className="p-3 rounded-lg border border-border bg-bg hover:border-primary/30 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-text">{t.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            t.category === '법령' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            t.category === '규정' ? 'bg-green-50 text-green-700 border-green-200' :
                            t.category === '기출' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-gray-50 text-gray-600 border-gray-200'
                          }`}>{t.category}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-200">
                            {stageLabel(t.stage)}
                          </span>
                          {!t.is_active && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">비활성</span>
                          )}
                        </div>
                        {t.description && (
                          <p className="text-[11px] text-text-secondary mt-1 truncate">{t.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-text-secondary">
                          <span>v{t.version}</span>
                          <span>{t.template_length}자</span>
                          {t.example_count > 0 && <span>예시 {t.example_count}개</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 ml-2">
                        <button onClick={() => handleEdit(t)}
                          className="text-[11px] px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20">
                          편집
                        </button>
                        <button onClick={() => handleDelete(t.id)}
                          className="text-[11px] px-2 py-1 rounded bg-red-50 text-red-500 hover:bg-red-100">
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* 프롬프트 체인 설명 */}
          <Card>
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-text">프롬프트 체인 구조</h3>
              <p className="text-xs text-text-secondary">
                RAG 질의응답은 아래 단계별 프롬프트를 순서대로 실행합니다.
                각 단계의 프롬프트를 독립적으로 최적화할 수 있습니다.
              </p>
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { name: 'query-rewrite', label: '쿼리 리라이팅', color: 'indigo' },
                  { name: 'hyde', label: 'HyDE 가상문서', color: 'violet' },
                  { name: 'rag-answer', label: 'RAG 답변', color: 'blue' },
                  { name: 'rag-verify', label: '답변 검증', color: 'emerald' },
                ].map((stage, i) => (
                  <Fragment key={stage.name}>
                    {i > 0 && <span className="text-text-secondary text-xs">→</span>}
                    <span className={`text-[10px] px-2 py-1 rounded-md border bg-${stage.color}-50 text-${stage.color}-700 border-${stage.color}-200`}>
                      {stage.label}
                    </span>
                  </Fragment>
                ))}
              </div>
              <div className="space-y-1.5">
                {[
                  { stage: '쿼리 리라이팅', desc: '사용자 질문을 법률 용어로 변환 + 하위 질문 분해' },
                  { stage: 'HyDE 가상문서', desc: '가상 답변 문서 생성으로 벡터 검색 품질 향상' },
                  { stage: 'RAG 답변 (카테고리별)', desc: '법령/규정/기출/일반 각각 최적화된 프롬프트로 답변' },
                  { stage: '답변 검증 (선택)', desc: '근거 정확성 + 논리 일관성 자동 검증' },
                ].map(item => (
                  <div key={item.stage} className="flex items-start gap-2 text-[11px]">
                    <span className="text-primary font-medium min-w-[100px]">{item.stage}</span>
                    <span className="text-text-secondary">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      );
    }

    // ========================================
    // 관측성 (LangFuse) 패널
    // ========================================
    function ObservabilityPanel() {
      // LangFuse 상태 확인
      const [status, setStatus] = useState(null);
      const [loading, setLoading] = useState(true);

      // 상태 조회
      const checkStatus = useCallback(async () => {
        setLoading(true);
        try {
          const res = await authFetch(`${API_BASE_URL}/observability`);
          if (res.ok) {
            const data = await res.json();
            setStatus(data);
          } else {
            setStatus({ enabled: false, error: '상태 조회 실패' });
          }
        } catch (err) {
          setStatus({ enabled: false, error: err.message });
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => { checkStatus(); }, [checkStatus]);

      return (
        <div className="space-y-4">
          {/* LangFuse 연동 상태 */}
          <Card>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-text">LangFuse 관측성</h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    LLM 호출을 추적하고 시각화하는 외부 관측성 도구입니다.
                  </p>
                </div>
                <button onClick={checkStatus} disabled={loading}
                  className="text-xs px-2 py-1 rounded bg-border/50 hover:bg-border text-text-secondary">
                  {loading ? '확인 중...' : '새로고침'}
                </button>
              </div>

              {/* 연동 상태 표시 */}
              {status && (
                <div className={`p-3 rounded-lg border ${
                  status.enabled
                    ? 'bg-green-50 border-green-200'
                    : 'bg-amber-50 border-amber-200'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${status.enabled ? 'bg-green-500' : 'bg-amber-500'}`}></span>
                    <span className={`text-sm font-medium ${status.enabled ? 'text-green-700' : 'text-amber-700'}`}>
                      {status.enabled ? 'LangFuse 연동 활성' : 'LangFuse 미연동'}
                    </span>
                  </div>
                  {status.enabled && status.baseUrl && (
                    <p className="text-xs text-green-600 mt-1 ml-4">
                      서버: {status.baseUrl}
                    </p>
                  )}
                  {!status.enabled && (
                    <p className="text-xs text-amber-600 mt-1 ml-4">
                      환경변수를 설정하면 자동으로 활성화됩니다.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* 환경변수 안내 */}
          <Card>
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-text">환경변수 설정</h3>
              <p className="text-xs text-text-secondary">
                Vercel 또는 .env 파일에 아래 환경변수를 추가하세요.
                LangFuse Cloud(무료)는 <a href="https://cloud.langfuse.com" target="_blank"
                  className="text-primary underline">cloud.langfuse.com</a>에서 가입 후 키를 발급받을 수 있습니다.
              </p>
              <div className="bg-gray-900 rounded-lg p-3 text-xs font-mono space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-green-400">LANGFUSE_PUBLIC_KEY</span>
                  <span className="text-gray-500">=</span>
                  <span className="text-amber-300">pk-lf-...</span>
                  {status?.keys?.public && <span className="text-green-500 text-[10px]">(설정됨)</span>}
                  {!status?.keys?.public && <span className="text-red-400 text-[10px]">(미설정)</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-green-400">LANGFUSE_SECRET_KEY</span>
                  <span className="text-gray-500">=</span>
                  <span className="text-amber-300">sk-lf-...</span>
                  {status?.keys?.secret && <span className="text-green-500 text-[10px]">(설정됨)</span>}
                  {!status?.keys?.secret && <span className="text-red-400 text-[10px]">(미설정)</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-green-400">LANGFUSE_BASE_URL</span>
                  <span className="text-gray-500">=</span>
                  <span className="text-amber-300">https://cloud.langfuse.com</span>
                  <span className="text-gray-500 text-[10px]">(선택, 기본값)</span>
                </div>
              </div>
            </div>
          </Card>

          {/* 추적 대상 안내 */}
          <Card>
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-text">추적 대상</h3>
              <p className="text-xs text-text-secondary">
                LangFuse가 활성화되면 아래 AI 호출이 자동으로 추적됩니다.
              </p>
              <div className="space-y-2">
                {[
                  { name: 'RAG 질의응답', desc: '검색 → LLM 답변 전체 파이프라인', icon: '🔍' },
                  { name: 'LLM 호출', desc: 'Gemini, OpenAI, Claude 모든 프로바이더', icon: '🤖' },
                  { name: '임베딩 생성', desc: 'OpenAI, Upstage, Cohere 임베딩', icon: '📊' },
                  { name: '쿼리 강화', desc: '쿼리 리라이팅 + HyDE 가상 문서 생성', icon: '✨' },
                ].map(item => (
                  <div key={item.name} className="flex items-start gap-2 p-2 rounded-lg bg-bg">
                    <span className="text-sm mt-0.5">{item.icon}</span>
                    <div>
                      <p className="text-xs font-medium text-text">{item.name}</p>
                      <p className="text-[11px] text-text-secondary">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* LangFuse 대시보드 링크 */}
          {status?.enabled && (
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-text">LangFuse 대시보드</h3>
                  <p className="text-xs text-text-secondary">트레이스, 비용, 지연시간을 시각적으로 확인하세요.</p>
                </div>
                <a href={status.baseUrl || 'https://cloud.langfuse.com'}
                  target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90">
                  대시보드 열기 →
                </a>
              </div>
            </Card>
          )}
        </div>
      );
    }

    // ========================================
    // 비식별화 키워드 관리 패널
    // ========================================
    function DeidentifyPanel() {
      const [words, setWords] = useState([]);
      const [loading, setLoading] = useState(true);
      const [newKeyword, setNewKeyword] = useState('');
      const [newReplacement, setNewReplacement] = useState('***');
      const [bulkInput, setBulkInput] = useState('');
      const [showBulk, setShowBulk] = useState(false);
      const [message, setMessage] = useState(null);

      const fetchWords = useCallback(async () => {
        try {
          const res = await authFetch(`${API_BASE_URL}/deidentify`);
          if (res.ok) {
            const data = await res.json();
            setWords(data.words || []);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => { fetchWords(); }, [fetchWords]);

      const handleAdd = useCallback(async () => {
        if (!newKeyword.trim()) return;
        try {
          const res = await authFetch(`${API_BASE_URL}/deidentify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', keyword: newKeyword.trim(), replacement: newReplacement }),
          });
          if (res.ok) {
            setNewKeyword('');
            setMessage({ type: 'success', text: `"${newKeyword.trim()}" 추가됨` });
            fetchWords();
            setTimeout(() => setMessage(null), 2000);
          }
        } catch (err) {
          setMessage({ type: 'error', text: err.message });
        }
      }, [newKeyword, newReplacement, fetchWords]);

      const handleDelete = useCallback(async (id, keyword) => {
        try {
          await authFetch(`${API_BASE_URL}/deidentify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', id }),
          });
          setMessage({ type: 'success', text: `"${keyword}" 삭제됨` });
          fetchWords();
          setTimeout(() => setMessage(null), 2000);
        } catch (err) {
          setMessage({ type: 'error', text: err.message });
        }
      }, [fetchWords]);

      const handleBulkAdd = useCallback(async () => {
        const keywords = bulkInput.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        if (keywords.length === 0) return;
        try {
          const res = await authFetch(`${API_BASE_URL}/deidentify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'bulkAdd', keyword: keywords, replacement: newReplacement }),
          });
          if (res.ok) {
            const data = await res.json();
            setBulkInput('');
            setShowBulk(false);
            setMessage({ type: 'success', text: `${data.added}개 키워드 추가됨` });
            fetchWords();
            setTimeout(() => setMessage(null), 2000);
          }
        } catch (err) {
          setMessage({ type: 'error', text: err.message });
        }
      }, [bulkInput, newReplacement, fetchWords]);

      return (
        <div className="space-y-4">
          <Card>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-text">비식별화 키워드 관리</h3>
              <p className="text-xs text-text-secondary">
                등록된 키워드는 파일 업로드 시 텍스트에서 자동으로 치환됩니다.
                업로드 화면에서 "비식별화" 옵션을 켜야 적용됩니다.
              </p>
            </div>
          </Card>

          {message && (
            <div className={`text-xs px-3 py-2 rounded-lg fade-in ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {message.text}
            </div>
          )}

          {/* 키워드 추가 */}
          <Card>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={e => setNewKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  placeholder="비식별화할 키워드 입력"
                  className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-text text-sm placeholder-text-secondary/50 focus:outline-none focus:border-primary"
                />
                <input
                  type="text"
                  value={newReplacement}
                  onChange={e => setNewReplacement(e.target.value)}
                  placeholder="치환 텍스트"
                  className="w-20 px-2 py-2 bg-bg border border-border rounded-lg text-text text-sm text-center focus:outline-none focus:border-primary"
                />
                <Button onClick={handleAdd} disabled={!newKeyword.trim()}>추가</Button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowBulk(!showBulk)}
                  className="text-xs text-primary hover:underline"
                >{showBulk ? '일괄 입력 닫기' : '일괄 입력'}</button>
              </div>
              {showBulk && (
                <div className="space-y-2">
                  <textarea
                    value={bulkInput}
                    onChange={e => setBulkInput(e.target.value)}
                    placeholder="한 줄에 하나씩 키워드를 입력하세요&#10;예:&#10;홍길동&#10;010-1234-5678&#10;서울시 강남구"
                    className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text text-sm placeholder-text-secondary/50 focus:outline-none focus:border-primary h-32 resize-none"
                  />
                  <Button onClick={handleBulkAdd} disabled={!bulkInput.trim()}>일괄 추가</Button>
                </div>
              )}
            </div>
          </Card>

          {/* 등록된 키워드 목록 */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-text">등록된 키워드 ({words.length}개)</h4>
            </div>
            {loading ? (
              <p className="text-xs text-text-secondary text-center py-4">로딩...</p>
            ) : words.length === 0 ? (
              <p className="text-xs text-text-secondary text-center py-4">등록된 키워드가 없습니다.</p>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {words.map(w => (
                  <div key={w.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-card-bg-hover group">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-text font-medium truncate">{w.keyword}</span>
                      <span className="text-xs text-text-secondary shrink-0">
                        &rarr; <span className="font-mono bg-badge-bg px-1.5 py-0.5 rounded">{w.replacement}</span>
                      </span>
                    </div>
                    <button
                      onClick={() => handleDelete(w.id, w.keyword)}
                      className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2"
                    >삭제</button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      );
    }

    // ========================================
    // App 컴포넌트
    // ========================================
    // ========================================
    // 로그인 화면
    // ========================================
    function LoginScreen({ onLogin, theme, onToggleTheme }) {
      const [id, setId] = useState('');
      const [password, setPassword] = useState('');
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(false);

      const handleSubmit = async (e) => {
        e.preventDefault();
        if (!id || !password) { setError('아이디와 비밀번호를 입력해주세요.'); return; }
        setLoading(true);
        setError('');
        try {
          const res = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, password }),
          });
          const data = await res.json();
          if (!res.ok) { setError(data.error || '로그인에 실패했습니다.'); return; }
          setAuthToken(data.token);
          setAuthUser({ name: data.name, admin: data.admin, orgId: data.orgId, orgName: data.orgName });
          onLogin();
        } catch (err) {
          setError('서버 연결에 실패했습니다.');
        } finally {
          setLoading(false);
        }
      };

      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-sm">
            {/* 테마 토글 */}
            <div className="flex justify-end mb-4">
              <button onClick={onToggleTheme} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-text transition-colors" title={theme === 'light' ? '다크모드' : '라이트모드'}>
                {theme === 'light' ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                )}
              </button>
            </div>
            {/* 로고 영역 */}
            <div className="text-center mb-8">
              <div className="text-4xl mb-2">&#128218;</div>
              <h1 className="text-2xl font-bold text-text">DocStore</h1>
              <p className="text-text-secondary text-sm mt-1">지식 관리 시스템</p>
            </div>

            {/* 로그인 폼 */}
            <form onSubmit={handleSubmit} className="bg-card-bg rounded-xl p-6 border border-border shadow-lg">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                  {error}
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm text-text-secondary mb-1">아이디</label>
                <input
                  type="text"
                  value={id}
                  onChange={e => setId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-card-bg border border-border rounded-lg text-text text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  placeholder="아이디를 입력하세요"
                  autoFocus
                  autoComplete="username"
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm text-text-secondary mb-1">비밀번호</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 bg-card-bg border border-border rounded-lg text-text text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  placeholder="비밀번호를 입력하세요"
                  autoComplete="current-password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {loading ? '로그인 중...' : '로그인'}
              </button>
            </form>
          </div>
        </div>
      );
    }



export default TuningTab;
export { DeidentifyPanel };
