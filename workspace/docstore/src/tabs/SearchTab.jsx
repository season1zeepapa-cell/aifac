import { Fragment, createElement, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { API_BASE_URL, authFetch } from '../lib/api';
import { marked } from 'marked';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import MultiSelect from '../components/ui/MultiSelect';


    function SearchTab({ onNavigateToDoc }) {
      const [searchQuery, setSearchQuery] = useState('');
      const [searchType, setSearchType] = useState('hybrid');
      const [results, setResults] = useState(null);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState(null);
      const [useParentRetriever, setUseParentRetriever] = useState(false);
      // 필터
      const [filterDocIds, setFilterDocIds] = useState([]);
      const [filterChapter, setFilterChapter] = useState('');
      const [docList, setDocList] = useState([]); // 문서 목록 (필터용)
      const [showFilters, setShowFilters] = useState(false);
      // 검색 결과에서 문서 상세 이동
      const [selectedDocId, setSelectedDocId] = useState(null);
      // 페이징: 화면에 표시할 결과 수
      const PAGE_SIZE = 5;
      const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

      // Few-shot: 유사 과거 Q&A 제안 (검색 탭)
      const [searchFewShots, setSearchFewShots] = useState([]);
      const searchFewShotTimer = useRef(null);

      // F19: 자동완성
      const [suggestions, setSuggestions] = useState([]);
      const [showSuggestions, setShowSuggestions] = useState(false);
      const [activeIdx, setActiveIdx] = useState(-1); // 키보드 내비게이션용 활성 인덱스
      const suggestTimerRef = useRef(null);
      const suggestRef = useRef(null); // 드롭다운 DOM 참조

      // 최근 검색어 (localStorage 기반, 최대 10개)
      const RECENT_KEY = 'docstore_recent_searches';
      const MAX_RECENT = 10;
      const [recentSearches, setRecentSearches] = useState(() => {
        try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
        catch { return []; }
      });
      const [showRecent, setShowRecent] = useState(false);

      // 최근 검색어 저장
      const saveRecentSearch = useCallback((query) => {
        const q = query.trim();
        if (!q) return;
        setRecentSearches(prev => {
          // 중복 제거 후 맨 앞에 추가
          const next = [q, ...prev.filter(r => r !== q)].slice(0, MAX_RECENT);
          localStorage.setItem(RECENT_KEY, JSON.stringify(next));
          return next;
        });
      }, []);

      // Few-shot: 검색어 변경 시 유사 과거 Q&A 검색 (debounce)
      useEffect(() => {
        if (searchFewShotTimer.current) clearTimeout(searchFewShotTimer.current);
        if (!searchQuery || searchQuery.trim().length < 4) {
          setSearchFewShots([]);
          return;
        }
        searchFewShotTimer.current = setTimeout(async () => {
          try {
            const res = await authFetch(`${API_BASE_URL}/few-shot?q=${encodeURIComponent(searchQuery.trim())}&max=3`);
            const data = await res.json();
            setSearchFewShots(data.similar && data.similar.length > 0 ? data.similar : []);
          } catch { setSearchFewShots([]); }
        }, 800);
        return () => { if (searchFewShotTimer.current) clearTimeout(searchFewShotTimer.current); };
      }, [searchQuery]);

      // 최근 검색어 개별 삭제
      const removeRecentSearch = useCallback((query) => {
        setRecentSearches(prev => {
          const next = prev.filter(r => r !== query);
          localStorage.setItem(RECENT_KEY, JSON.stringify(next));
          return next;
        });
      }, []);

      // 최근 검색어 전체 삭제
      const clearRecentSearches = useCallback(() => {
        setRecentSearches([]);
        localStorage.removeItem(RECENT_KEY);
      }, []);

      // 문서 목록 불러오기 (필터용)
      useEffect(() => {
        authFetch(`${API_BASE_URL}/documents`)
          .then(r => r.json())
          .then(data => setDocList(Array.isArray(data) ? data : data.documents || []))
          .catch(() => {});
      }, []);

      // F19: 검색어 변경 시 자동완성 서제스트
      const handleQueryChange = useCallback((val) => {
        setSearchQuery(val);
        setActiveIdx(-1);
        if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
        // 입력이 비면 최근 검색어 표시, 입력 중이면 숨김
        if (!val.trim()) {
          setSuggestions([]); setShowSuggestions(false);
          if (recentSearches.length > 0) setShowRecent(true);
          return;
        }
        setShowRecent(false);
        if (val.trim().length < 2) { setSuggestions([]); setShowSuggestions(false); return; }
        suggestTimerRef.current = setTimeout(async () => {
          try {
            const resp = await authFetch(`${API_BASE_URL}/search?suggest=${encodeURIComponent(val.trim())}`);
            const data = await resp.json();
            if (data.suggestions?.length > 0) {
              setSuggestions(data.suggestions);
              setShowSuggestions(true);
            } else {
              setSuggestions([]);
              setShowSuggestions(false);
            }
          } catch { setShowSuggestions(false); }
        }, 250);
      }, []);

      // 제안 선택 시 검색어 세팅 + 즉시 검색 실행
      const handleSelectSuggestion = useCallback((text) => {
        setSearchQuery(text);
        setShowSuggestions(false);
        setActiveIdx(-1);
        // 다음 틱에서 검색 실행 (searchQuery가 업데이트된 후)
        setTimeout(() => {
          // handleSearch가 최신 searchQuery를 참조하도록 직접 fetch
          (async () => {
            setLoading(true); setError(null); setResults(null); setVisibleCount(PAGE_SIZE);
            try {
              const params = new URLSearchParams({ q: text.trim(), type: searchType, limit: '50' });
              if (filterDocIds.length > 0) params.set('docIds', filterDocIds.join(','));
              if (filterChapter) params.set('chapter', filterChapter);
              if (useParentRetriever) params.set('parentRetriever', 'true');
              const res = await authFetch(`${API_BASE_URL}/search?${params}`);
              if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `검색 실패`); }
              setResults(await res.json());
            } catch (err) { setError(err.message); }
            finally { setLoading(false); }
          })();
        }, 0);
      }, [searchType, filterDocIds, filterChapter, useParentRetriever]);

      // 자동완성 매칭 텍스트 하이라이트
      const highlightMatch = useCallback((text, query) => {
        if (!query || !text) return text;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx < 0) return text;
        return createElement(Fragment, null,
          text.slice(0, idx),
          createElement('span', { className: 'text-primary font-semibold' }, text.slice(idx, idx + query.length)),
          text.slice(idx + query.length)
        );
      }, []);

      // 검색 실행
      const handleSearch = useCallback(async () => {
        setShowSuggestions(false);
        setShowRecent(false);
        if (!searchQuery.trim()) return;
        setLoading(true);
        setError(null);
        setResults(null);
        setVisibleCount(PAGE_SIZE);
        saveRecentSearch(searchQuery);

        try {
          const params = new URLSearchParams({
            q: searchQuery.trim(),
            type: searchType,
            limit: '50',
          });
          if (filterDocIds.length > 0) params.set('docIds', filterDocIds.join(','));
          if (filterChapter) params.set('chapter', filterChapter);
          if (useParentRetriever) params.set('parentRetriever', 'true');
          const res = await authFetch(`${API_BASE_URL}/search?${params}`);
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `검색 실패 (${res.status})`);
          }
          setResults(await res.json());
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      }, [searchQuery, searchType, filterDocIds, filterChapter, useParentRetriever, saveRecentSearch]);

      const handleKeyDown = useCallback((e) => {
        // 자동완성 드롭다운이 열려 있으면 키보드 내비게이션 처리
        if (showSuggestions && suggestions.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
            return;
          }
          if (e.key === 'Enter' && activeIdx >= 0) {
            e.preventDefault();
            const selected = suggestions[activeIdx];
            handleSelectSuggestion(selected.text);
            return;
          }
          if (e.key === 'Escape') {
            setShowSuggestions(false);
            setActiveIdx(-1);
            return;
          }
        }
        if (e.key === 'Enter') handleSearch();
      }, [handleSearch, showSuggestions, suggestions, activeIdx, handleSelectSuggestion]);

      // 검색어 하이라이트
      // 검색어 하이라이트 — 다중 단어 각각 매칭 + 첫 매칭 위치 중심 발췌
      const highlightText = useCallback((text, query) => {
        if (!query || !text) return text;
        const maxLen = 350;

        // 검색어를 공백 기준으로 분리하여 각 단어별 매칭 (2글자 이상만)
        const terms = query.trim().split(/\s+/).filter(t => t.length >= 1);
        if (terms.length === 0) return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;

        // 정규식 구성: 모든 검색 단어를 OR로 묶어서 하나의 패턴으로 생성
        const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

        // 첫 번째 매칭 위치를 기준으로 발췌문 생성
        const firstMatch = text.search(pattern);
        let excerpt = text;
        if (text.length > maxLen) {
          if (firstMatch >= 0) {
            const start = Math.max(0, firstMatch - 60);
            const end = Math.min(text.length, start + maxLen);
            excerpt = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
          } else {
            excerpt = text.slice(0, maxLen) + '...';
          }
        }

        // 매칭 부분을 mark 엘리먼트로 변환
        const parts = excerpt.split(pattern);
        const lowerTerms = terms.map(t => t.toLowerCase());
        return parts.map((part, i) =>
          lowerTerms.includes(part.toLowerCase())
            ? createElement('mark', { key: i, className: 'search-mark' }, part)
            : part
        );
      }, []);

      // 검색 결과 카드 (클릭 시 문서 탭으로 이동하여 해당 섹션까지 스크롤)
      const ResultCard = ({ r, children }) => (
        <Card hoverable onClick={() => {
          const sectionInfo = { sectionIndex: r.sectionIndex, label: r.label };
          if (r.documentId && onNavigateToDoc) onNavigateToDoc(r.documentId, sectionInfo);
          else if (r.documentId) setSelectedDocId(r.documentId);
        }}>
          {children}
          {r.documentId && (
            <div className="flex justify-end mt-2 pt-2 border-t border-border/50">
              <span className="flex items-center gap-1 text-xs text-primary">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                클릭하면 문서 상세로 이동
              </span>
            </div>
          )}
        </Card>
      );

      const { isApiDisabled } = useContext(ApiKeyStatusContext);
      // vector 검색만 완전 차단, hybrid는 FTS fallback 가능하므로 허용
      const searchDisabled = searchType === 'vector' ? isApiDisabled('openai') : false;

      return (
        <div className="space-y-4 fade-in">
          <DisabledApiBanner providers={['openai', 'cohere']} featureName="검색" />
          {/* 검색 입력 */}
          <Card>
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => handleQueryChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => {
                      if (suggestions.length > 0) setShowSuggestions(true);
                      else if (!searchQuery.trim() && recentSearches.length > 0) setShowRecent(true);
                    }}
                    onBlur={() => setTimeout(() => { setShowSuggestions(false); setShowRecent(false); }, 200)}
                    placeholder="검색어를 입력하세요..."
                    className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text placeholder-text-secondary/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                    autoComplete="off"
                  />
                  {/* F19: 자동완성 드롭다운 (키보드 내비게이션 + 매칭 하이라이트) */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div ref={suggestRef} className="absolute z-20 top-full left-0 right-0 mt-1 bg-card-bg border border-border rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          onMouseDown={() => handleSelectSuggestion(s.text)}
                          onMouseEnter={() => setActiveIdx(i)}
                          className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-start gap-2.5 border-b border-border/30 last:border-b-0 ${
                            i === activeIdx ? 'bg-primary/10 text-text' : 'text-text hover:bg-card-bg-hover'
                          }`}
                        >
                          {/* 타입별 아이콘: 문서=파일, 섹션=텍스트 */}
                          {s.type === 'section' ? (
                            <svg className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
                          ) : (
                            <svg className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{highlightMatch(s.text, searchQuery)}</div>
                            {/* 섹션인 경우 출처 문서명 표시 */}
                            {s.type === 'section' && s.doc_title && (
                              <div className="text-xs text-text-secondary mt-0.5 truncate">
                                {s.doc_title}{s.label ? ` > ${s.label}` : ''}
                              </div>
                            )}
                            {/* 문서인 경우 카테고리 표시 */}
                            {s.type === 'document' && s.category && (
                              <div className="text-xs text-text-secondary mt-0.5">{s.category}</div>
                            )}
                          </div>
                          {/* 타입 뱃지 */}
                          <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${
                            s.type === 'section' ? 'bg-blue-500/15 text-blue-400' : 'bg-emerald-500/15 text-emerald-400'
                          }`}>{s.type === 'section' ? '본문' : '문서'}</span>
                        </button>
                      ))}
                      {/* 하단 안내 */}
                      <div className="px-3 py-1.5 text-xs text-text-secondary bg-bg/50 flex items-center gap-2">
                        <kbd className="px-1 py-0.5 bg-border rounded text-xs">↑↓</kbd> 이동
                        <kbd className="px-1 py-0.5 bg-border rounded text-xs">Enter</kbd> 선택
                        <kbd className="px-1 py-0.5 bg-border rounded text-xs">Esc</kbd> 닫기
                      </div>
                    </div>
                  )}
                  {/* 최근 검색어 드롭다운 (입력창이 비어있고 자동완성이 없을 때 표시) */}
                  {showRecent && !showSuggestions && recentSearches.length > 0 && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-card-bg border border-border rounded-lg shadow-lg overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
                        <span className="text-xs font-medium text-text-secondary">최근 검색어</span>
                        <button
                          onMouseDown={(e) => { e.preventDefault(); clearRecentSearches(); setShowRecent(false); }}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >전체 삭제</button>
                      </div>
                      {recentSearches.map((q, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 hover:bg-card-bg-hover transition-colors border-b border-border/20 last:border-b-0">
                          <svg className="w-3.5 h-3.5 text-text-secondary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <button
                            onMouseDown={() => { setSearchQuery(q); setShowRecent(false); setTimeout(() => handleSelectSuggestion(q), 0); }}
                            className="flex-1 text-left text-sm text-text truncate hover:text-primary transition-colors"
                          >{q}</button>
                          <button
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeRecentSearch(q); }}
                            className="text-text-secondary hover:text-red-400 transition-colors shrink-0 p-0.5"
                            title="삭제"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Button onClick={handleSearch} disabled={loading || !searchQuery.trim() || searchDisabled}>
                  {searchDisabled ? 'API 비활성' : loading ? '검색 중...' : '검색'}
                </Button>
              </div>
              {/* 검색 타입 선택 */}
              <div className="flex gap-2 flex-wrap">
                {[
                  { key: 'hybrid', label: '통합 검색' },
                  { key: 'text', label: '텍스트 검색' },
                  { key: 'vector', label: '의미 검색' },
                ].map(t => (
                  <button key={t.key}
                    onClick={() => { setSearchType(t.key); setResults(null); }}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      searchType === t.key ? 'bg-primary text-white' : 'bg-border text-text-secondary hover:text-text'
                    }`}
                  >{t.label}</button>
                ))}
                {/* Parent Retriever 토글 */}
                {searchType === 'hybrid' && (
                  <button
                    onClick={() => setUseParentRetriever(!useParentRetriever)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      useParentRetriever
                        ? 'bg-violet-500 text-white shadow-sm'
                        : 'bg-border text-text-secondary hover:bg-violet-50 hover:text-violet-600'
                    }`}
                    title="Parent Document Retriever: 작은 청크로 정밀 검색 후 부모 컨텍스트 반환"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                    PD
                  </button>
                )}
                {/* 필터 토글 */}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    showFilters || filterDocIds.length > 0 || filterChapter
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-border text-text-secondary hover:text-text'
                  }`}
                >
                  필터 {(filterDocIds.length > 0 || filterChapter) ? '(활성)' : ''}
                </button>
              </div>

              {/* 필터 패널 */}
              {showFilters && (
                <div className="space-y-2 p-3 bg-bg rounded-lg border border-border">
                  <MultiSelect
                    label="문서 범위 (복수 선택 가능)"
                    selectedIds={filterDocIds}
                    onChange={setFilterDocIds}
                    options={docList.map(d => ({ value: String(d.id), label: d.title }))}
                    placeholder="전체 문서"
                  />
                  <Input
                    label="장/절 필터"
                    value={filterChapter}
                    onChange={e => setFilterChapter(e.target.value)}
                    placeholder="예: 제1장, 총칙"
                  />
                  {(filterDocIds.length > 0 || filterChapter) && (
                    <button
                      onClick={() => { setFilterDocIds([]); setFilterChapter(''); }}
                      className="text-xs text-red-500 hover:text-red-300"
                    >필터 초기화</button>
                  )}
                </div>
              )}

              <p className="text-xs text-text-secondary">
                {searchType === 'hybrid'
                  ? '키워드 + 의미 검색을 RRF 알고리즘으로 합산하고, Rerank로 정밀 재순위화합니다. 최고 품질의 검색 결과를 제공합니다.'
                  : searchType === 'text'
                  ? '입력한 단어가 포함된 문서를 검색합니다. (FTS 전문검색 우선, 1글자는 ILIKE 폴백)'
                  : '입력한 내용과 의미가 유사한 문서를 벡터 임베딩으로 검색합니다.'}
              </p>
            </div>
          </Card>

          {/* 로딩 */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* 에러 */}
          {error && (
            <Card className="border-red-200 bg-red-50">
              <p className="text-sm text-red-500">{error}</p>
            </Card>
          )}

          {/* Few-shot: 유사 과거 질문 제안 (검색 탭) */}
          {searchFewShots.length > 0 && !loading && (
            <div className="mb-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
              <div className="flex items-center gap-1 mb-2">
                <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span className="text-xs font-semibold text-amber-400">유사한 과거 질문</span>
                <button onClick={() => setSearchFewShots([])} className="ml-auto text-[10px] text-text-secondary hover:text-red-400">닫기</button>
              </div>
              <div className="space-y-1.5">
                {searchFewShots.map((s, i) => (
                  <button key={s.id || i}
                    onClick={() => { setSearchQuery(s.question); setSearchFewShots([]); }}
                    className="w-full text-left p-2 bg-background/50 rounded-lg hover:bg-amber-500/10 transition-colors">
                    <div className="text-xs text-text">{s.question}</div>
                    {s.conclusion && <div className="text-[10px] text-text-secondary mt-0.5 line-clamp-1">{s.conclusion}</div>}
                    <span className="text-[9px] text-amber-500/70">유사도 {(s.score * 100).toFixed(0)}%</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 검색 결과 */}
          {results && !loading && (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                "{results.query}" 검색 결과: <span className="text-text font-medium">{results.count}건</span>
                <span className="text-xs ml-1">(클릭하면 문서 상세로 이동)</span>
              </p>

              {/* FN1: 확장 검색어 표시 — 동의어 사전으로 검색어가 확장된 경우 표시 */}
              {results.expandedTerms && results.expandedTerms.length > 0 && (
                <div className="flex items-start gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg">
                  <svg className="w-4 h-4 text-primary shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    <span className="font-medium text-primary">확장 검색어: </span>
                    {results.expandedTerms.map((term, i) => (
                      createElement(Fragment, { key: i },
                        i > 0 && ', ',
                        createElement('span', { className: 'text-text font-medium' }, term)
                      )
                    ))}
                  </p>
                </div>
              )}

              {results.warning && (
                <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                  {results.warning}
                </div>
              )}
              {results.count === 0 ? (
                <EmptyState icon="🔍" title="검색 결과가 없습니다" description={results.warning || "다른 검색어로 시도해보세요."} />
              ) : results.type === 'hybrid' ? (
                <>
                  {results.results.slice(0, visibleCount).map((r, idx) => {
                    /* 최고 점수 대비 상대 품질 계산 (0~100%) */
                    const topScore = results.results[0]?.rrfScore || 1;
                    const quality = Math.min(100, Math.round((r.rrfScore / topScore) * 100));
                    return (
                    <ResultCard key={idx} r={r}>
                      <div className="space-y-2">
                        {/* 상단: 제목 + 카테고리 + 매칭 방식 + 라벨 */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-text text-sm">{highlightText(r.documentTitle, results.query)}</span>
                          <Badge color={r.category === '법령' ? 'primary' : r.category === '기출' ? 'green' : r.category === '규정' ? 'yellow' : 'gray'}>{r.category}</Badge>
                          {r.vectorRank && r.ftsRank
                            ? <Badge color="green">양쪽 매칭</Badge>
                            : r.vectorRank
                            ? <Badge color="blue">의미 매칭</Badge>
                            : <Badge color="yellow">키워드 매칭</Badge>}
                          {r.label && <Badge color="gray">{r.label}</Badge>}
                        </div>
                        {/* 점수 바: RRF 품질 시각화 + 상세 점수 */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${quality}%`, background: quality >= 80 ? 'var(--primary)' : quality >= 50 ? '#f59e0b' : 'var(--text-secondary)' }} />
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-text-secondary shrink-0">
                            <span title="RRF 합산 점수">RRF {(r.rrfScore * 1000).toFixed(1)}</span>
                            {r.similarity && <span title="벡터 유사도">| 유사도 {(r.similarity * 100).toFixed(0)}%</span>}
                            {r.vectorRank && <span title="벡터 검색 순위">V{r.vectorRank}위</span>}
                            {r.ftsRank && <span title="키워드 검색 순위">K{r.ftsRank}위</span>}
                          </div>
                        </div>
                        {/* 본문 — headline(FTS 매칭)이 있으면 우선 표시 */}
                        {r.headline ? (
                          <p className="text-sm text-text/80 leading-relaxed whitespace-pre-wrap break-words fts-headline"
                            dangerouslySetInnerHTML={{ __html: r.headline }}
                          />
                        ) : (
                          <p className="text-sm text-text/80 leading-relaxed whitespace-pre-wrap break-words">
                            {highlightText(r.chunkText, results.query)}
                          </p>
                        )}
                      </div>
                    </ResultCard>
                    );
                  })}
                  {visibleCount < results.results.length && (
                    <button
                      onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                      className="w-full py-3 text-sm font-medium text-primary bg-card-bg border border-border rounded-xl hover:bg-card-bg-hover transition-colors"
                    >
                      더보기 ({visibleCount}/{results.results.length}건)
                    </button>
                  )}
                </>
              ) : results.type === 'fts' ? (
                /* FTS 전문 검색 결과 — ts_headline 하이라이팅 + FTS 점수 표시 */
                <>
                  {results.results.slice(0, visibleCount).map((r, idx) => (
                    <ResultCard key={idx} r={r}>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-text text-sm">{highlightText(r.documentTitle, results.query)}</span>
                          <Badge color={r.category === '법령' ? 'primary' : r.category === '기출' ? 'green' : r.category === '규정' ? 'yellow' : 'gray'}>{r.category}</Badge>
                          {r.label ? <Badge color="gray">{r.label}</Badge> : <Badge color="gray">섹션 {r.sectionIndex + 1}</Badge>}
                          <span className="text-xs text-text-secondary">FTS {(r.ftsScore * 1000).toFixed(1)}</span>
                        </div>
                        {/* ts_headline이 있으면 <mark> 태그가 포함된 하이라이팅 표시 */}
                        {r.headline ? (
                          <p className="text-sm text-text/80 leading-relaxed whitespace-pre-wrap break-words fts-headline"
                            dangerouslySetInnerHTML={{ __html: r.headline }}
                          />
                        ) : (
                          <p className="text-sm text-text/80 leading-relaxed whitespace-pre-wrap break-words">
                            {highlightText(r.rawText, results.query)}
                          </p>
                        )}
                      </div>
                    </ResultCard>
                  ))}
                  {visibleCount < results.results.length && (
                    <button
                      onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                      className="w-full py-3 text-sm font-medium text-primary bg-card-bg border border-border rounded-xl hover:bg-card-bg-hover transition-colors"
                    >
                      더보기 ({visibleCount}/{results.results.length}건)
                    </button>
                  )}
                </>
              ) : results.type === 'text' ? (
                /* ILIKE 폴백 (1글자 검색 등) */
                <>
                  {results.results.slice(0, visibleCount).map((r, idx) => (
                    <ResultCard key={idx} r={r}>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-text text-sm">{highlightText(r.documentTitle, results.query)}</span>
                          <Badge color={r.category === '법령' ? 'primary' : r.category === '기출' ? 'green' : r.category === '규정' ? 'yellow' : 'gray'}>{r.category}</Badge>
                          {r.label ? <Badge color="gray">{highlightText(r.label, results.query)}</Badge> : <Badge color="gray">섹션 {r.sectionIndex + 1}</Badge>}
                        </div>
                        <p className="text-sm text-text/80 leading-relaxed whitespace-pre-wrap break-words">
                          {highlightText(r.rawText, results.query)}
                        </p>
                      </div>
                    </ResultCard>
                  ))}
                  {visibleCount < results.results.length && (
                    <button
                      onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                      className="w-full py-3 text-sm font-medium text-primary bg-card-bg border border-border rounded-xl hover:bg-card-bg-hover transition-colors"
                    >
                      더보기 ({visibleCount}/{results.results.length}건)
                    </button>
                  )}
                </>
              ) : (
                <>
                  {results.results.slice(0, visibleCount).map((r, idx) => (
                    <ResultCard key={idx} r={r}>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-text text-sm">{highlightText(r.documentTitle, results.query)}</span>
                          <Badge color={r.category === '법령' ? 'primary' : r.category === '기출' ? 'green' : r.category === '규정' ? 'yellow' : 'gray'}>{r.category}</Badge>
                          <Badge color="green">유사도 {(r.similarity * 100).toFixed(1)}%</Badge>
                          {r.label && <Badge color="gray">{highlightText(r.label, results.query)}</Badge>}
                        </div>
                        <p className="text-sm text-text/80 leading-relaxed whitespace-pre-wrap break-words">
                          {highlightText(r.chunkText, results.query)}
                        </p>
                      </div>
                    </ResultCard>
                  ))}
                  {visibleCount < results.results.length && (
                    <button
                      onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                      className="w-full py-3 text-sm font-medium text-primary bg-card-bg border border-border rounded-xl hover:bg-card-bg-hover transition-colors"
                    >
                      더보기 ({visibleCount}/{results.results.length}건)
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* 검색 결과에서 문서 상세 모달 */}
          <DocumentDetailModal
            isOpen={selectedDocId !== null}
            onClose={() => setSelectedDocId(null)}
            documentId={selectedDocId}
          />
        </div>
      );
    }

    // ========================================
    // 임베딩 모델 설정 패널
    // ========================================


export default SearchTab;
