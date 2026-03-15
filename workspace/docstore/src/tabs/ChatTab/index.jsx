import { createElement, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { API_BASE_URL, authFetch, getAuthToken } from '../../lib/api';
import { ApiKeyStatusContext } from '../../contexts/ApiKeyStatusContext';
import { llmSettings, loadLlmSettings, saveLlmSettings } from '../../constants/llm';
import { marked } from 'marked';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import MultiSelect from '../../components/ui/MultiSelect';
import DisabledApiBanner from '../../components/ui/DisabledApiBanner';
import EmbeddingModelPanel from './EmbeddingModelPanel';
import LlmSettingsPanel from './LlmSettingsPanel';
import ParsedAnswer from './ParsedAnswer';


    function ChatTab({ onNavigateToDoc }) {
      const [chatMessages, setChatMessages] = useState([]);
      // 각 메시지: { role: 'user'|'assistant', content, sources?, provider? }
      const [inputText, setInputText] = useState('');
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState(null);
      // LLM 프로바이더
      const [llmProvider, setLlmProvider] = useState('gemini');
      const [llmProviders, setLlmProviders] = useState([]);
      // 문서 범위 필터 (복수 선택)
      const [filterDocIds, setFilterDocIds] = useState([]);
      const [docList, setDocList] = useState([]);
      const [showSettings, setShowSettings] = useState(false);
      // 쿼리 강화 옵션
      const [useQueryRewrite, setUseQueryRewrite] = useState(true);
      const [useHyDE, setUseHyDE] = useState(true);
      const [useMorpheme, setUseMorpheme] = useState(false);
      const [useToolRouter, setUseToolRouter] = useState(false); // Tool Use (에이전틱 RAG)
      const [useVerify, setUseVerify] = useState(false); // Corrective RAG (검증+재검색)
      const [useParentRetriever, setUseParentRetriever] = useState(false); // Parent Document Retriever
      const [enhancementInfo, setEnhancementInfo] = useState(null);
      // 답변 가이드: 주제, 관점, 답변형식
      const [chatGuide, setChatGuide] = useState({ topic: '', perspective: '', format: '' });
      const [showGuide, setShowGuide] = useState(false);
      // Few-shot: 유사 과거 Q&A 제안 + 선택
      const [fewShotSuggestions, setFewShotSuggestions] = useState([]);
      const [selectedFewShots, setSelectedFewShots] = useState([]); // 사용자가 선택한 few-shot ID
      const [showFewShot, setShowFewShot] = useState(false);
      const fewShotTimer = useRef(null);
      // 근거자료 접기/펼치기 (메시지 인덱스별)
      const [expandedSources, setExpandedSources] = useState({});
      // F17: 대화 히스토리
      const [sessionId, setSessionId] = useState(null);
      const [sessions, setSessions] = useState([]);
      const [showHistory, setShowHistory] = useState(false);

      const chatEndRef = useRef(null);
      const inputRef = useRef(null);

      // 초기 데이터 로드
      useEffect(() => {
        authFetch(`${API_BASE_URL}/documents`)
          .then(r => r.json())
          .then(data => setDocList(Array.isArray(data) ? data : data.documents || []))
          .catch(() => {});
        authFetch(`${API_BASE_URL}/api-usage?type=llm`)
          .then(r => r.json())
          .then(data => { if (data.providers) setLlmProviders(data.providers); })
          .catch(() => {});
        // 대화 히스토리 목록 로드
        authFetch(`${API_BASE_URL}/chat-sessions`)
          .then(r => r.json())
          .then(data => { if (data.sessions) setSessions(data.sessions); })
          .catch(() => {});
      }, []);

      // Few-shot: 입력 변경 시 유사 질문 검색 (debounce 800ms)
      useEffect(() => {
        if (fewShotTimer.current) clearTimeout(fewShotTimer.current);
        if (!inputText || inputText.trim().length < 4) {
          setFewShotSuggestions([]);
          return;
        }
        fewShotTimer.current = setTimeout(async () => {
          try {
            const res = await authFetch(`${API_BASE_URL}/few-shot?q=${encodeURIComponent(inputText.trim())}&max=3`);
            const data = await res.json();
            if (data.similar && data.similar.length > 0) {
              setFewShotSuggestions(data.similar);
              setShowFewShot(true); // 자동으로 펼치기
            } else {
              setFewShotSuggestions([]);
            }
          } catch { setFewShotSuggestions([]); }
        }, 800);
        return () => { if (fewShotTimer.current) clearTimeout(fewShotTimer.current); };
      }, [inputText]);

      // 새 메시지 시 하단 자동 스크롤
      useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, [chatMessages, loading]);

      // SSE 스트리밍 파서: fetch 응답에서 SSE 이벤트를 추출
      const parseSSE = useCallback(async function* (response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try { yield JSON.parse(line.slice(6)); } catch {}
          }
        }
      }, []);

      // 메시지 전송 (SSE 스트리밍)
      const handleSend = useCallback(async () => {
        const text = inputText.trim();
        if (!text || loading) return;

        const userMsg = { role: 'user', content: text };
        setChatMessages(prev => [...prev, userMsg]);
        setInputText('');
        setLoading(true);
        setError(null);
        // 전송 후 few-shot 제안 초기화
        setFewShotSuggestions([]);
        setSelectedFewShots([]);

        try {
          // history: 이전 메시지에서 content만 추출 (sources 제외)
          const history = chatMessages.map(m => ({ role: m.role, content: m.content }));
          // llmSettings에서 현재 프로바이더 설정을 가져와 전달
          const providerSettings = llmSettings[llmProvider] || {};
          setEnhancementInfo(null);
          // 답변 가이드가 설정되어 있으면 질문에 지시문 추가
          let questionWithGuide = text;
          const guideLines = [];
          if (chatGuide.topic) guideLines.push(`[주제] ${chatGuide.topic}`);
          if (chatGuide.perspective) guideLines.push(`[관점] ${chatGuide.perspective}`);
          if (chatGuide.format) guideLines.push(`[답변형식] ${chatGuide.format}`);
          if (guideLines.length > 0) {
            questionWithGuide = `${guideLines.join(' | ')}\n\n${text}`;
          }

          // 선택된 few-shot 예시 준비
          const activeFewShots = selectedFewShots.length > 0
            ? fewShotSuggestions.filter(s => selectedFewShots.includes(s.id))
            : null;

          const body = {
            question: questionWithGuide, topK: 5, provider: llmProvider, history,
            stream: true,
            useQueryRewrite, useHyDE, useMorpheme,
            useToolRouter, useVerify, useParentRetriever,
            llmOptions: {
              model: providerSettings.model,
              temperature: providerSettings.temperature,
              maxTokens: providerSettings.maxTokens,
              ...(llmProvider === 'gemini' && providerSettings.thinkingBudget ? { thinkingBudget: providerSettings.thinkingBudget } : {}),
              ...(llmProvider === 'gemini' && providerSettings.thinkingLevel ? { thinkingLevel: providerSettings.thinkingLevel } : {}),
              ...(llmProvider === 'openai' && providerSettings.reasoningEffort ? { reasoningEffort: providerSettings.reasoningEffort } : {}),
            },
            ...(activeFewShots ? { userFewShots: activeFewShots } : {}),
          };
          if (filterDocIds.length > 0) body.docIds = filterDocIds.map(id => parseInt(id, 10));

          const res = await authFetch(`${API_BASE_URL}/rag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            let errMsg = `질의 실패 (${res.status})`;
            try { errMsg = JSON.parse(errText).error || errMsg; } catch { errMsg = errText || errMsg; }
            throw new Error(errMsg);
          }
          // Content-Type 확인: SSE가 아닌 경우 (Vercel 에러 페이지 등)
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('text/event-stream')) {
            const body = await res.text().catch(() => '');
            throw new Error(`서버가 SSE가 아닌 응답을 반환했습니다 (${contentType}): ${body.substring(0, 200)}`);
          }

          // SSE 스트리밍 응답 처리
          let streamSources = [];
          let streamProvider = llmProvider;
          let streamHops = 1;
          let streamCrossRefs = [];
          let accumulated = '';
          const debugMessages = [];

          // 스트리밍 중인 assistant 메시지를 먼저 추가
          const placeholderMsg = {
            role: 'assistant', content: '', sources: [],
            provider: llmProvider, hops: 1, crossRefs: [],
          };
          setChatMessages(prev => [...prev, placeholderMsg]);

          for await (const event of parseSSE(res)) {
            if (event.type === 'tools') {
              // Tool Use: 선택된 도구 정보 수신
              setChatMessages(prev => {
                const updated = [...prev];
                const last = { ...updated[updated.length - 1] };
                last.selectedTools = event.selectedTools;
                updated[updated.length - 1] = last;
                return updated;
              });
            } else if (event.type === 'corrective') {
              // Corrective RAG: 재검색 알림
              setChatMessages(prev => {
                const updated = [...prev];
                const last = { ...updated[updated.length - 1] };
                last.corrective = event;
                if (event.action === 'retry') {
                  last.content += `\n\n> 답변 품질 부족 (${event.score}/10) — "${event.retryQuery}"로 재검색 중... (${event.attempt}/2)\n\n`;
                }
                updated[updated.length - 1] = last;
                return updated;
              });
            } else if (event.type === 'enhancement') {
              // 쿼리 강화 과정 실시간 수신
              setEnhancementInfo(prev => ({ ...prev, [event.data?.type || event.type]: event.data || event }));
            } else if (event.type === 'sources') {
              // 검색 결과 수신
              streamSources = event.sources || [];
              streamProvider = event.provider || llmProvider;
              streamHops = event.hops || 1;
              streamCrossRefs = event.crossRefs || [];
              const streamKnowledgeGraph = event.knowledgeGraph || null;
              const streamEnhancement = event.enhancement || {};
              if (event.enhancement) setEnhancementInfo(prev => ({ ...prev, ...event.enhancement }));
              // sources 정보 업데이트
              setChatMessages(prev => {
                const updated = [...prev];
                const last = { ...updated[updated.length - 1] };
                last.sources = streamSources;
                last.provider = streamProvider;
                last.hops = streamHops;
                last.crossRefs = streamCrossRefs;
                last.knowledgeGraph = streamKnowledgeGraph;
                last.enhancement = streamEnhancement;
                updated[updated.length - 1] = last;
                return updated;
              });
            } else if (event.type === 'token') {
              // 토큰 도착 → 마지막 assistant 메시지에 추가
              accumulated += event.token;
              const currentText = accumulated;
              setChatMessages(prev => {
                const updated = [...prev];
                const last = { ...updated[updated.length - 1] };
                last.content = currentText;
                updated[updated.length - 1] = last;
                return updated;
              });
            } else if (event.type === 'parsed') {
              // 스트리밍 완료 후 구조화 파싱 결과 수신
              setChatMessages(prev => {
                const updated = [...prev];
                const last = { ...updated[updated.length - 1] };
                last.parsed = event.parsed;
                updated[updated.length - 1] = last;
                return updated;
              });
            } else if (event.type === 'stage') {
              // 상태 그래프 노드 진행 이벤트
              const stageMsg = `[${event.node}] ${event.status}${event.error ? ': ' + event.error : ''}`;
              console.log('[RAG Graph]', stageMsg);
              debugMessages.push(stageMsg);
            } else if (event.type === 'debug') {
              // 서버 디버깅 메시지 → 콘솔에 표시
              console.log('[RAG Debug]', event.message);
              debugMessages.push(event.message);
            } else if (event.type === 'error') {
              throw new Error(event.error || '스트리밍 오류');
            }
            // type === 'done' → 루프 종료
          }
          // 스트림이 끝났는데 토큰이 하나도 없으면 에러 표시
          if (!accumulated) {
            const debugInfo = debugMessages.length > 0 ? '\n[디버그] ' + debugMessages.join(' → ') : '';
            setError('답변이 생성되지 않았습니다.' + debugInfo);
          }
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
          setTimeout(() => inputRef.current?.focus(), 100);
        }
      }, [inputText, loading, chatMessages, llmProvider, filterDocIds, parseSSE, chatGuide]);

      const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      }, [handleSend]);

      // 새 대화
      const handleNewChat = useCallback(() => {
        setChatMessages([]);
        setSessionId(null);
        setError(null);
        setExpandedSources({});
        inputRef.current?.focus();
      }, []);

      // F17: 대화 저장
      const handleSaveChat = useCallback(async () => {
        if (chatMessages.length === 0) return;
        try {
          const resp = await authFetch(`${API_BASE_URL}/chat-sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: sessionId, messages: chatMessages, provider: llmProvider,
              docIds: filterDocIds.map(id => parseInt(id, 10)),
            }),
          });
          const data = await resp.json();
          if (data.success) {
            setSessionId(data.id);
            // 세션 목록 갱신
            const listResp = await authFetch(`${API_BASE_URL}/chat-sessions`);
            const listData = await listResp.json();
            if (listData.sessions) setSessions(listData.sessions);
          }
        } catch (e) { console.warn('대화 저장 실패:', e.message); }
      }, [chatMessages, sessionId, llmProvider, filterDocIds]);

      // F17: 대화 불러오기
      const handleLoadChat = useCallback(async (sid) => {
        try {
          const resp = await authFetch(`${API_BASE_URL}/chat-sessions?id=${sid}`);
          const data = await resp.json();
          if (data.messages) {
            setChatMessages(data.messages);
            setSessionId(data.id);
            setLlmProvider(data.provider || 'gemini');
            if (data.doc_ids?.length > 0) setFilterDocIds(data.doc_ids.map(String));
            setShowHistory(false);
            setExpandedSources({});
          }
        } catch (e) { console.warn('대화 로드 실패:', e.message); }
      }, []);

      // F17: 대화 삭제
      const handleDeleteSession = useCallback(async (sid, e) => {
        e.stopPropagation();
        if (!confirm('이 대화를 삭제하시겠습니까?')) return;
        try {
          await authFetch(`${API_BASE_URL}/chat-sessions?id=${sid}`, { method: 'DELETE' });
          setSessions(prev => prev.filter(s => s.id !== sid));
          if (sessionId === sid) { setSessionId(null); setChatMessages([]); }
        } catch (e) { console.warn('대화 삭제 실패:', e.message); }
      }, [sessionId]);

      // 근거자료 토글
      const toggleSources = useCallback((idx) => {
        setExpandedSources(prev => ({ ...prev, [idx]: !prev[idx] }));
      }, []);

      // 프로바이더 색상
      const providerColor = (id) => id === 'gemini' ? 'blue' : id === 'openai' ? 'green' : 'orange';
      const providerName = (id) => id === 'gemini' ? 'Gemini' : id === 'openai' ? 'OpenAI' : 'Claude';

      const { isApiDisabled } = useContext(ApiKeyStatusContext);
      const chatLlmDisabled = isApiDisabled(llmProvider);
      const chatEmbedDisabled = isApiDisabled('openai');

      return (
        <div className="flex flex-col fade-in" style={{ height: 'calc(100vh - 130px)' }}>
          <DisabledApiBanner providers={[llmProvider, 'openai']} featureName="AI 채팅" />
          {/* 상단 바: 새 대화 + 설정 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-text">AI 채팅</h2>
              {chatMessages.length > 0 && (
                <span className="text-xs text-text-secondary">{Math.floor(chatMessages.length / 2)}회 대화</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`text-xs border rounded-lg px-2.5 py-1.5 transition-colors ${
                  showHistory ? 'text-primary border-primary bg-primary/5' : 'text-text-secondary hover:text-text border-border'
                }`}
              >
                기록 {sessions.length > 0 ? `(${sessions.length})` : ''}
              </button>
              {chatMessages.length > 0 && (
                <button
                  onClick={handleSaveChat}
                  className="text-xs text-green-600 hover:text-green-700 border border-green-200 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-green-50"
                >
                  {sessionId ? '저장' : '새로 저장'}
                </button>
              )}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="text-xs text-text-secondary hover:text-text border border-border rounded-lg px-2.5 py-1.5 transition-colors"
              >
                설정
              </button>
              <button
                onClick={handleNewChat}
                className="text-xs text-primary hover:text-primary-hover border border-primary/30 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-primary/5"
              >
                새 대화
              </button>
            </div>
          </div>

          {/* 대화 히스토리 패널 */}
          {showHistory && (
            <Card className="mb-3">
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {sessions.length === 0 ? (
                  <p className="text-xs text-text-secondary text-center py-3">저장된 대화가 없습니다.</p>
                ) : sessions.map(s => (
                  <div
                    key={s.id}
                    onClick={() => handleLoadChat(s.id)}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                      sessionId === s.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-card-bg-hover'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text truncate">{s.title}</p>
                      <p className="text-[10px] text-text-secondary">{s.message_count}개 메시지 · {new Date(s.updated_at).toLocaleDateString('ko-KR')}</p>
                    </div>
                    <button
                      onClick={(e) => handleDeleteSession(s.id, e)}
                      className="ml-2 p-1 text-text-secondary hover:text-red-500 transition-colors shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 설정 패널 (접기/펼치기) */}
          {showSettings && (
            <Card className="mb-3">
              <div className="space-y-3">
                {/* LLM 프로바이더 선택 */}
                <div>
                  <p className="text-xs text-text-secondary mb-2">AI 모델</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {llmProviders.map(p => {
                      const active = llmProvider === p.id;
                      const modelId = llmSettings[p.id]?.model || '';
                      const shortModel = modelId.replace(/^(gemini-|gpt-|claude-)/, '').replace(/-\d{8}$/, '');
                      return (
                        <button key={p.id}
                          onClick={() => setLlmProvider(p.id)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                            active
                              ? `bg-${providerColor(p.id)}-500 text-white`
                              : 'bg-border text-text-secondary hover:text-text'
                          }`}
                          style={active ? {
                            backgroundColor: p.id === 'gemini' ? '#3b82f6' : p.id === 'openai' ? '#22c55e' : '#f97316'
                          } : {}}
                        >
                          {p.name}
                          {active && shortModel ? <span className="ml-1 opacity-80">({shortModel})</span>
                            : p.free && <span className="ml-1 opacity-70">(무료)</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* 문서 범위 필터 (복수 선택) */}
                <MultiSelect
                  label="문서 범위 (복수 선택 가능)"
                  selectedIds={filterDocIds}
                  onChange={setFilterDocIds}
                  options={docList.map(d => ({ value: String(d.id), label: d.title }))}
                  placeholder="전체 문서"
                />
                {/* 쿼리 강화 옵션 */}
                <div>
                  <p className="text-xs text-text-secondary mb-2">검색 강화</p>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${useQueryRewrite ? 'bg-primary' : 'bg-border'}`}
                        onClick={() => setUseQueryRewrite(v => !v)}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useQueryRewrite ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-xs text-text">쿼리 리라이팅</span>
                      <span className="text-[10px] text-text-secondary">(질문을 검색에 최적화)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${useHyDE ? 'bg-primary' : 'bg-border'}`}
                        onClick={() => setUseHyDE(v => !v)}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useHyDE ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-xs text-text">HyDE</span>
                      <span className="text-[10px] text-text-secondary">(가상 답변으로 검색 정확도 향상)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${useMorpheme ? 'bg-primary' : 'bg-border'}`}
                        onClick={() => setUseMorpheme(v => !v)}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useMorpheme ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-xs text-text">형태소 분석</span>
                      <span className="text-[10px] text-text-secondary">(한국어 FTS 정확도 향상)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${useToolRouter ? 'bg-violet-500' : 'bg-border'}`}
                        onClick={() => setUseToolRouter(v => !v)}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useToolRouter ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-xs text-text">Tool Use</span>
                      <span className="text-[10px] text-text-secondary">(AI가 도구 자동 선택)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${useVerify ? 'bg-amber-500' : 'bg-border'}`}
                        onClick={() => setUseVerify(v => !v)}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useVerify ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-xs text-text">Corrective RAG</span>
                      <span className="text-[10px] text-text-secondary">(답변 불충분 시 자동 재검색)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div className={`relative w-9 h-5 rounded-full transition-colors ${useParentRetriever ? 'bg-emerald-500' : 'bg-border'}`}
                        onClick={() => setUseParentRetriever(v => !v)}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useParentRetriever ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-xs text-text">Parent Doc</span>
                      <span className="text-[10px] text-text-secondary">(정밀 검색 + 부모 컨텍스트)</span>
                    </label>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* 채팅 영역 */}
          <div className="flex-1 overflow-y-auto space-y-4 pb-2 min-h-0">
            {/* 빈 상태 */}
            {chatMessages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <p className="text-text font-medium mb-1">문서 기반 AI 채팅</p>
                <p className="text-sm text-text-secondary max-w-xs">
                  등록된 문서를 기반으로 AI가 답변합니다. 후속 질문도 이전 대화 맥락을 이해합니다.
                </p>
                <div className="flex flex-wrap gap-2 mt-4 justify-center">
                  {['CCTV 설치 기준은?', '개인정보 보호 원칙은?', '영상정보 보관 기간은?'].map(q => (
                    <button key={q}
                      onClick={() => { setInputText(q); inputRef.current?.focus(); }}
                      className="text-xs px-3 py-1.5 rounded-full border border-border text-text-secondary hover:text-primary hover:border-primary/30 transition-colors"
                    >{q}</button>
                  ))}
                </div>
                {/* 가이드 기능 안내 */}
                <button
                  onClick={() => setShowGuide(true)}
                  className="mt-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 hover:border-primary/30 transition-all group"
                >
                  <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  <div className="text-left">
                    <span className="text-xs font-medium text-primary">답변 가이드</span>
                    <p className="text-[10px] text-text-secondary group-hover:text-text transition-colors">주제/관점/형식을 지정하면 AI가 맞춤 답변을 합니다</p>
                  </div>
                </button>
              </div>
            )}

            {/* 메시지 목록 */}
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-last' : ''}`}>
                  {/* 말풍선 */}
                  <div className={`rounded-2xl px-4 py-3 overflow-hidden break-words ${
                    msg.role === 'user'
                      ? 'bg-primary text-white rounded-br-md'
                      : 'bg-card-bg border border-border rounded-bl-md shadow-sm'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div>
                        {/* 프로바이더 뱃지 + 멀티홉 표시 */}
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: msg.provider === 'gemini' ? '#3b82f6' : msg.provider === 'openai' ? '#22c55e' : '#f97316' }}
                          >{providerName(msg.provider)}</span>
                          {msg.hops > 1 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
                              {msg.hops}홉 검색
                            </span>
                          )}
                          {msg.crossRefs && msg.crossRefs.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                              교차참조 {msg.crossRefs.length}건
                            </span>
                          )}
                          {msg.knowledgeGraph && msg.knowledgeGraph.count > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium"
                              title={msg.knowledgeGraph.triples.map(t => `${t.subject} →[${t.predicate}]→ ${t.object}`).join('\n')}>
                              지식그래프 {msg.knowledgeGraph.count}건
                            </span>
                          )}
                          {msg.enhancement?.queryRewrite && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium"
                              title={`리라이팅: ${(msg.enhancement.queryRewrite.queries || []).join(', ')}`}>
                              리라이팅 {msg.enhancement.queryRewrite.timing}ms
                            </span>
                          )}
                          {msg.enhancement?.hyde && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium"
                              title={msg.enhancement.hyde.hypotheticalDoc ? `가상문서: ${msg.enhancement.hyde.hypotheticalDoc.substring(0, 100)}...` : ''}>
                              HyDE {msg.enhancement.hyde.timing}ms
                            </span>
                          )}
                          {msg.selectedTools && msg.selectedTools.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium"
                              title={`선택된 도구: ${msg.selectedTools.join(', ')}`}>
                              Tool: {msg.selectedTools.join(', ')}
                            </span>
                          )}
                          {msg.corrective && msg.corrective.action === 'retry' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium"
                              title={`재검색 사유: ${msg.corrective.reason}`}>
                              Corrective {msg.corrective.attempt}/2
                            </span>
                          )}
                        </div>
                        {createElement(ParsedAnswer, {
                          parsed: msg.parsed,
                          raw: msg.content,
                          sources: msg.sources,
                          isStreaming: loading && idx === chatMessages.length - 1
                        })}
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                    )}
                  </div>

                  {/* 근거자료 (AI 메시지만) */}
                  {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-1.5 ml-1">
                      <button
                        onClick={() => toggleSources(idx)}
                        className="text-xs text-text-secondary hover:text-primary transition-colors flex items-center gap-1"
                      >
                        <svg className={`w-3 h-3 transition-transform ${expandedSources[idx] ? 'rotate-90' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        근거자료 {msg.sources.length}건
                        {(() => {
                          const docSet = new Set(msg.sources.map(s => s.documentTitle));
                          return docSet.size > 1 ? ` (${docSet.size}개 문서)` : '';
                        })()}
                      </button>
                      {expandedSources[idx] && (
                        <div className="mt-2 space-y-1.5">
                          {msg.sources.map((src, si) => {
                            const simPercent = (src.similarity * 100).toFixed(1);
                            const simColor = simPercent >= 80 ? 'text-green-600' : simPercent >= 60 ? 'text-yellow-600' : 'text-text-secondary';
                            return (
                              <div key={si}
                                className="text-xs bg-bg border border-border rounded-lg p-2.5 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors group"
                                onClick={() => {
                                  if (src.documentId && onNavigateToDoc) {
                                    onNavigateToDoc(src.documentId, {
                                      sectionIndex: src.sectionIndex,
                                      label: src.label || src.articleTitle || src.chapter,
                                    });
                                  }
                                }}
                                title="클릭하면 문서 상세로 이동하여 해당 조문을 펼칩니다"
                              >
                                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                  <span className="font-medium text-primary">근거 {si + 1}</span>
                                  <span className="text-text font-medium">{src.documentTitle}</span>
                                  {src.label && <span className="text-text-secondary">({src.label})</span>}
                                  {src.chapter && !src.label && <span className="text-text-secondary">{src.chapter}</span>}
                                  <span className={`${simColor} font-medium`}>{simPercent}%</span>
                                  {src.documentId && (
                                    <svg className="w-3 h-3 text-primary opacity-0 group-hover:opacity-100 transition-opacity ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                  )}
                                </div>
                                <p className="text-text-secondary leading-relaxed">{src.excerpt}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* 로딩 인디케이터 */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-card-bg border border-border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs text-text-secondary">답변 생성 중...</span>
                  </div>
                  {enhancementInfo && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {enhancementInfo.queryRewrite && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">
                          리라이팅 완료 ({enhancementInfo.queryRewrite.timing}ms)
                          {enhancementInfo.queryRewrite.queries && `: ${enhancementInfo.queryRewrite.queries.slice(0, 2).join(', ')}`}
                        </span>
                      )}
                      {enhancementInfo.hyde && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
                          HyDE 완료 ({enhancementInfo.hyde.timing}ms)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 에러 */}
            {error && (
              <div className="flex justify-start">
                <div className="bg-red-50 border border-red-200 rounded-2xl rounded-bl-md px-4 py-3">
                  <p className="text-sm text-red-500">{error}</p>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* 하단 입력 영역 */}
          <div className="border-t border-border pt-3 mt-2">
            {/* 답변 가이드 (주제/관점/형식) */}
            {showGuide && (
              <div className="mb-2 p-3 bg-card-bg border border-border rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text">답변 가이드</span>
                  <button onClick={() => setChatGuide({ topic: '', perspective: '', format: '' })}
                    className="text-[10px] text-text-secondary hover:text-red-400 transition-colors">초기화</button>
                </div>
                {/* 주제 */}
                <div>
                  <label className="text-[10px] text-text-secondary mb-0.5 block">주제 — 어떤 분야/범위로 답변할지</label>
                  <div className="flex gap-1 flex-wrap mb-1">
                    {['개인정보보호', 'CCTV/영상정보', '정보보안', '법률 해석', '실무 적용'].map(t => (
                      <button key={t} onClick={() => setChatGuide(g => ({ ...g, topic: g.topic === t ? '' : t }))}
                        className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                          chatGuide.topic === t ? 'bg-blue-500 text-white' : 'bg-border text-text-secondary hover:text-text'
                        }`}>{t}</button>
                    ))}
                  </div>
                  <input type="text" value={chatGuide.topic} onChange={e => setChatGuide(g => ({ ...g, topic: e.target.value }))}
                    placeholder="직접 입력 (예: 의료정보 보호, 금융데이터 규제)"
                    className="w-full px-2.5 py-1.5 bg-background border border-border/50 rounded-lg text-xs text-text placeholder-text-secondary/40" />
                </div>
                {/* 관점 */}
                <div>
                  <label className="text-[10px] text-text-secondary mb-0.5 block">관점 — 누구의 시각으로 답변할지</label>
                  <div className="flex gap-1 flex-wrap mb-1">
                    {['법률 전문가', '실무 담당자', '감사/감독관', '초보자 눈높이', '비교 분석'].map(p => (
                      <button key={p} onClick={() => setChatGuide(g => ({ ...g, perspective: g.perspective === p ? '' : p }))}
                        className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                          chatGuide.perspective === p ? 'bg-purple-500 text-white' : 'bg-border text-text-secondary hover:text-text'
                        }`}>{p}</button>
                    ))}
                  </div>
                  <input type="text" value={chatGuide.perspective} onChange={e => setChatGuide(g => ({ ...g, perspective: e.target.value }))}
                    placeholder="직접 입력 (예: CPO 관점, 정보보호 컨설턴트)"
                    className="w-full px-2.5 py-1.5 bg-background border border-border/50 rounded-lg text-xs text-text placeholder-text-secondary/40" />
                </div>
                {/* 답변형식 */}
                <div>
                  <label className="text-[10px] text-text-secondary mb-0.5 block">답변형식 — 어떤 구조로 답변받을지</label>
                  <div className="flex gap-1 flex-wrap mb-1">
                    {['요약 (3줄)', '상세 해설', '표/비교표', '체크리스트', 'Q&A 형식', '단계별 절차'].map(f => (
                      <button key={f} onClick={() => setChatGuide(g => ({ ...g, format: g.format === f ? '' : f }))}
                        className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                          chatGuide.format === f ? 'bg-green-500 text-white' : 'bg-border text-text-secondary hover:text-text'
                        }`}>{f}</button>
                    ))}
                  </div>
                  <input type="text" value={chatGuide.format} onChange={e => setChatGuide(g => ({ ...g, format: e.target.value }))}
                    placeholder="직접 입력 (예: 법조문 인용 포함, 사례 중심)"
                    className="w-full px-2.5 py-1.5 bg-background border border-border/50 rounded-lg text-xs text-text placeholder-text-secondary/40" />
                </div>
              </div>
            )}
            {/* 활성 가이드 뱃지 (접혀 있을 때) */}
            {!showGuide && (chatGuide.topic || chatGuide.perspective || chatGuide.format) && (
              <div className="flex items-center gap-1.5 mb-2 flex-wrap cursor-pointer" onClick={() => setShowGuide(true)}>
                <span className="text-[10px] text-text-secondary font-medium">적용 중:</span>
                {chatGuide.topic && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/20 text-blue-500 border border-blue-500/30">
                    주제: {chatGuide.topic}
                  </span>
                )}
                {chatGuide.perspective && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/20 text-purple-500 border border-purple-500/30">
                    관점: {chatGuide.perspective}
                  </span>
                )}
                {chatGuide.format && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/20 text-green-500 border border-green-500/30">
                    형식: {chatGuide.format}
                  </span>
                )}
                <button onClick={(e) => { e.stopPropagation(); setChatGuide({ topic: '', perspective: '', format: '' }); }}
                  className="text-[10px] text-text-secondary hover:text-red-400 transition-colors ml-1">x 해제</button>
              </div>
            )}
            {/* Few-shot: 유사 과거 질문 제안 (체크박스로 선택/제거) */}
            {fewShotSuggestions.length > 0 && (
              <div className="mb-2 p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                <div className="flex items-center justify-between mb-1.5">
                  <button onClick={() => setShowFewShot(v => !v)}
                    className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    <span>참고 예시</span>
                    {selectedFewShots.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-bold">
                        {selectedFewShots.length}개 선택
                      </span>
                    )}
                    <svg className={`w-3 h-3 transition-transform ${showFewShot ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div className="flex items-center gap-2">
                    {selectedFewShots.length > 0 && (
                      <button onClick={() => setSelectedFewShots([])}
                        className="text-[10px] text-text-secondary hover:text-amber-400 transition-colors">선택 해제</button>
                    )}
                    <button onClick={() => { setFewShotSuggestions([]); setSelectedFewShots([]); }}
                      className="text-[10px] text-text-secondary hover:text-red-400 transition-colors">닫기</button>
                  </div>
                </div>

                {/* 접혀 있을 때: 선택된 항목만 뱃지로 표시 */}
                {!showFewShot && selectedFewShots.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {fewShotSuggestions.filter(s => selectedFewShots.includes(s.id)).map(s => (
                      <span key={s.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-500/20 text-amber-300">
                        {s.question.length > 25 ? s.question.substring(0, 25) + '...' : s.question}
                        <button onClick={(e) => { e.stopPropagation(); setSelectedFewShots(prev => prev.filter(id => id !== s.id)); }}
                          className="hover:text-red-400 transition-colors ml-0.5">x</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* 펼쳤을 때: 체크박스 리스트 */}
                {showFewShot && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {fewShotSuggestions.map((s, i) => {
                      const isSelected = selectedFewShots.includes(s.id);
                      return (
                        <div key={s.id || i}
                          className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                            isSelected ? 'bg-amber-500/15 border border-amber-500/30' : 'bg-background/50 border border-transparent hover:bg-amber-500/5'
                          }`}
                          onClick={() => {
                            setSelectedFewShots(prev =>
                              isSelected ? prev.filter(id => id !== s.id) : [...prev, s.id]
                            );
                          }}>
                          {/* 체크박스 */}
                          <div className={`flex-shrink-0 w-4 h-4 mt-0.5 rounded border-2 flex items-center justify-center transition-colors ${
                            isSelected ? 'bg-amber-500 border-amber-500' : 'border-text-secondary/30'
                          }`}>
                            {isSelected && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          {/* 내용 */}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-text">{s.question}</div>
                            {s.conclusion && (
                              <div className="text-[10px] text-text-secondary mt-0.5 line-clamp-2">{s.conclusion}</div>
                            )}
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[9px] text-amber-500/70">유사도 {(s.score * 100).toFixed(0)}%</span>
                              {s.category && s.category !== 'default' && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-border/50 text-text-secondary">{s.category}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[9px] text-text-secondary/50 text-center pt-1">
                      선택한 예시가 AI 답변의 참고자료로 포함됩니다
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="질문을 입력하세요..."
                  rows={1}
                  className="w-full px-4 py-2.5 bg-bg border border-border rounded-xl text-text text-sm placeholder-text-secondary/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none"
                  style={{ minHeight: '42px', maxHeight: '120px' }}
                  onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                />
              </div>
              {/* 답변 가이드 토글 버튼 */}
              <button
                onClick={() => setShowGuide(v => !v)}
                className={`flex-shrink-0 h-10 px-2.5 rounded-xl flex items-center gap-1.5 transition-all ${
                  showGuide
                    ? 'bg-primary text-white border border-primary shadow-sm'
                    : (chatGuide.topic || chatGuide.perspective || chatGuide.format)
                      ? 'bg-primary/15 text-primary border border-primary/40 shadow-sm'
                      : 'bg-border/50 text-text-secondary hover:text-primary hover:bg-primary/10 hover:border-primary/30 border border-border'
                }`}
                title="답변 가이드: 주제/관점/형식을 지정하면 AI가 맞춤 답변을 합니다"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <span className="text-[11px] font-medium whitespace-nowrap">가이드</span>
                {(chatGuide.topic || chatGuide.perspective || chatGuide.format) && !showGuide && (
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                )}
              </button>
              <button
                onClick={handleSend}
                disabled={loading || !inputText.trim() || chatLlmDisabled || chatEmbedDisabled}
                title={chatLlmDisabled ? `${llmProvider} API 비활성` : chatEmbedDisabled ? 'OpenAI(임베딩) API 비활성' : ''}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
                </svg>
              </button>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-text-secondary">
                {providerName(llmProvider)} ({llmSettings[llmProvider]?.model || '기본'}) {filterDocIds.length > 0 ? `| ${filterDocIds.length}개 문서 선택` : '| 전체 문서'}
              </span>
              <span className="text-[10px] text-text-secondary">Shift+Enter로 줄바꿈</span>
            </div>
          </div>
        </div>
      );
    }



export default ChatTab;
