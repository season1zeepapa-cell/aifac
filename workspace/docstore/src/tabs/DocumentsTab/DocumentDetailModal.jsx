import { createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CategoriesContext } from '../../contexts/CategoriesContext';
import { ApiKeyStatusContext } from '../../contexts/ApiKeyStatusContext';
import { API_BASE_URL, authFetch } from '../../lib/api';
import { formatDate } from '../../utils/format';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import ProgressBar from '../../components/ui/ProgressBar';
import EmptyState from '../../components/ui/EmptyState';
import LawGraphView from './LawGraphView';
import CrossRefView from './CrossRefView';
import KnowledgeGraphView from './KnowledgeGraphView';
import { marked } from 'marked';


    function DocumentDetailModal({ isOpen, onClose, documentId, initialSectionInfo }) {
      const { isApiDisabled } = useContext(ApiKeyStatusContext);
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState(null);
      const [expandedChapters, setExpandedChapters] = useState({}); // 장별 펼침 상태
      const [allExpanded, setAllExpanded] = useState(false);
      const [summaries, setSummaries] = useState({}); // sectionId → summary
      const [summarizing, setSummarizing] = useState({}); // sectionId → true (로딩)
      const [bulkSummarizing, setBulkSummarizing] = useState(false);
      const [summaryProvider, setSummaryProvider] = useState('gemini');
      const [summaryProviders, setSummaryProviders] = useState([]);
      const [useCoD, setUseCoD] = useState(false); // Chain of Density 모드
      const [codSteps, setCodSteps] = useState({}); // sectionId → steps 배열
      const [showCodSteps, setShowCodSteps] = useState({}); // sectionId → 펼침 여부
      // 태그 관리
      const [newTagName, setNewTagName] = useState('');
      const [tagLoading, setTagLoading] = useState(false);
      // AI 분석
      const [analyzing, setAnalyzing] = useState(false);
      // UX1: 인라인 메타 편집 (제목/카테고리 각각 독립)
      const [editingTitle, setEditingTitle] = useState(false);
      const [editingCategory, setEditingCategory] = useState(false);
      const [editTitle, setEditTitle] = useState('');
      const [editCategory, setEditCategory] = useState('');
      const [savingMeta, setSavingMeta] = useState(false);
      // 하위 호환용 (기존 editingMeta 플래그)
      const editingMeta = editingTitle || editingCategory;
      const setEditingMeta = (v) => { setEditingTitle(v); setEditingCategory(v); };
      // UX2: 임베딩 재생성
      const [rebuildingEmb, setRebuildingEmb] = useState(false);
      // 법령 문서: 조문 목록 / 참조 그래프 탭
      const [detailTab, setDetailTab] = useState('sections');
      // 원본 이미지 미리보기 Blob URL
      const [previewUrl, setPreviewUrl] = useState(null);

      useEffect(() => {
        if (!isOpen || !documentId) return;
        setLoading(true);
        setError(null);
        setExpandedChapters({});
        setAllExpanded(false);
        setPreviewUrl(null);
        authFetch(`${API_BASE_URL}/documents?id=${documentId}`)
          .then(res => {
            if (!res.ok) throw new Error('문서를 불러올 수 없습니다.');
            return res.json();
          })
          .then(setData)
          .catch(err => setError(err.message))
          .finally(() => setLoading(false));
        // LLM 프로바이더 목록 로드
        authFetch(`${API_BASE_URL}/api-usage?type=llm`)
          .then(r => r.json())
          .then(d => { if (d.providers) setSummaryProviders(d.providers); })
          .catch(() => {});
      }, [isOpen, documentId]);

      // 이미지 미리보기 로드 (인증 헤더 포함)
      useEffect(() => {
        const doc = data?.document;
        if (!doc?.original_mimetype?.startsWith('image/')) return;
        let cancelled = false;
        authFetch(`${API_BASE_URL}/documents?id=${doc.id}&download=preview`, {
          headers: { 'Accept': 'application/json' },
        })
          .then(res => {
            if (!res.ok) throw new Error('이미지 로드 실패');
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              // Supabase Signed URL 반환 → 직접 표시
              return res.json().then(j => { if (!cancelled && j.url) setPreviewUrl(j.url); });
            }
            // BYTEA 폴백 → Blob으로 변환
            return res.blob().then(blob => { if (!cancelled) setPreviewUrl(URL.createObjectURL(blob)); });
          })
          .catch(() => {});
        return () => { cancelled = true; };
      }, [data]);

      const doc = data?.document;
      const sections = data?.sections || [];

      // 장(chapter) 기준으로 섹션 그룹핑
      const groupedSections = useMemo(() => {
        if (sections.length === 0) return [];

        // 법령 문서(article 타입)만 그룹핑
        const hasChapters = sections.some(s => s.metadata?.chapter);
        if (!hasChapters) return [{ chapter: null, sections }];

        const groups = [];
        let currentChapter = null;
        let currentGroup = [];

        for (const section of sections) {
          const chapter = section.metadata?.chapter || null;
          if (chapter !== currentChapter) {
            if (currentGroup.length > 0) {
              groups.push({ chapter: currentChapter, sections: currentGroup });
            }
            currentChapter = chapter;
            currentGroup = [section];
          } else {
            currentGroup.push(section);
          }
        }
        if (currentGroup.length > 0) {
          groups.push({ chapter: currentChapter, sections: currentGroup });
        }
        return groups;
      }, [sections]);

      // 장 토글
      const toggleChapter = useCallback((chapter) => {
        setExpandedChapters(prev => ({ ...prev, [chapter]: !prev[chapter] }));
      }, []);

      // 전체 펼치기/접기
      const toggleAll = useCallback(() => {
        if (allExpanded) {
          setExpandedChapters({});
          setAllExpanded(false);
        } else {
          const all = {};
          groupedSections.forEach(g => { if (g.chapter) all[g.chapter] = true; });
          setExpandedChapters(all);
          setAllExpanded(true);
        }
      }, [allExpanded, groupedSections]);

      // 단일 섹션 AI 요약 (기본 or CoD)
      const handleSummarize = useCallback(async (sectionId, forceCoD) => {
        const cod = forceCoD !== undefined ? forceCoD : useCoD;
        setSummarizing(prev => ({ ...prev, [sectionId]: true }));
        try {
          const body = { sectionId, provider: summaryProvider };
          if (cod) {
            body.useCoD = true;
            body.forceRegenerate = true;
          }
          const res = await authFetch(`${API_BASE_URL}/summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '요약 실패');
          setSummaries(prev => ({ ...prev, [sectionId]: data.summary }));
          // CoD 단계 데이터 저장
          if (data.codSteps) {
            setCodSteps(prev => ({ ...prev, [sectionId]: data.codSteps }));
          }
        } catch (err) {
          setSummaries(prev => ({ ...prev, [sectionId]: `요약 실패: ${err.message}` }));
        } finally {
          setSummarizing(prev => ({ ...prev, [sectionId]: false }));
        }
      }, [useCoD, summaryProvider]);

      // 문서 전체 일괄 요약 (기본 or CoD)
      const handleBulkSummarize = useCallback(async () => {
        if (!documentId) return;
        if (useCoD && !confirm('Chain of Density 모드는 섹션당 AI를 약 10회 호출합니다.\n전체 요약을 진행하시겠습니까?')) return;
        setBulkSummarizing(true);
        try {
          const body = { documentId, provider: summaryProvider };
          if (useCoD) body.useCoD = true;
          const res = await authFetch(`${API_BASE_URL}/summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '일괄 요약 실패');
          // 완료 후 문서 데이터 새로고침 (캐싱된 요약 포함)
          const docRes = await authFetch(`${API_BASE_URL}/documents?id=${documentId}`);
          if (docRes.ok) {
            const docData = await docRes.json();
            setData(docData);
            // 요약 state 업데이트
            const newSummaries = {};
            (docData.sections || []).forEach(s => {
              if (s.summary || s.metadata?.summary) newSummaries[s.id] = s.summary || s.metadata.summary;
            });
            setSummaries(newSummaries);
          }
        } catch (err) {
          alert(`일괄 요약 실패: ${err.message}`);
        } finally {
          setBulkSummarizing(false);
        }
      }, [documentId, summaryProvider, useCoD]);

      // 데이터 로드 시 기존 요약 캐시 반영
      useEffect(() => {
        if (!data?.sections) return;
        const cached = {};
        data.sections.forEach(s => {
          if (s.summary || s.metadata?.summary) cached[s.id] = s.summary || s.metadata.summary;
        });
        setSummaries(cached);
      }, [data]);

      // 태그 추가
      const handleAddTag = useCallback(async () => {
        if (!newTagName.trim() || !documentId) return;
        setTagLoading(true);
        try {
          const res = await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'addTag', id: documentId, tagName: newTagName.trim() }),
          });
          if (!res.ok) throw new Error('태그 추가 실패');
          setNewTagName('');
          // 문서 데이터 리로드
          const docRes = await authFetch(`${API_BASE_URL}/documents?id=${documentId}`);
          if (docRes.ok) setData(await docRes.json());
        } catch (err) {
          alert(err.message);
        } finally {
          setTagLoading(false);
        }
      }, [newTagName, documentId]);

      // 태그 삭제
      const handleRemoveTag = useCallback(async (tagId) => {
        if (!documentId) return;
        try {
          await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'removeTag', id: documentId, tagId }),
          });
          const docRes = await authFetch(`${API_BASE_URL}/documents?id=${documentId}`);
          if (docRes.ok) setData(await docRes.json());
        } catch (err) {
          alert(err.message);
        }
      }, [documentId]);

      // AI 분석 진행 단계 시뮬레이션 (대용량 문서 기준 총 ~120초)
      const analyzeSteps = useMemo(() => [
        { message: 'AI 문서 분석 중 (요약/키워드)...', progress: 10, duration: 8000 },
        { message: '태그 생성 중...', progress: 20, duration: 5000 },
        { message: '섹션별 요약 생성 중...', progress: 35, duration: 15000 },
        { message: '섹션 요약 처리 중...', progress: 50, duration: 15000 },
        { message: 'Enriched 임베딩 생성 중...', progress: 65, duration: 20000 },
        { message: '임베딩 처리 중...', progress: 78, duration: 20000 },
        { message: '임베딩 마무리 중...', progress: 88, duration: 20000 },
        { message: '최종 저장 중...', progress: 95, duration: 15000 },
      ], []);
      const analyzeProgress2 = useSimulatedProgress(analyzeSteps);

      const handleAnalyze = useCallback(async () => {
        if (!documentId) return;
        setAnalyzing(true);
        analyzeProgress2.start();
        try {
          const res = await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'analyze', id: documentId }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            let errMsg = 'AI 분석 실패';
            try {
              const errData = JSON.parse(errText);
              errMsg = errData.error || errMsg;
            } catch {
              errMsg = errText || `HTTP ${res.status}`;
            }
            throw new Error(errMsg);
          }
          analyzeProgress2.finish('분석 완료!');
          // 분석 완료 후 문서 데이터 리로드
          const docRes = await authFetch(`${API_BASE_URL}/documents?id=${documentId}`);
          if (docRes.ok) setData(await docRes.json());
        } catch (err) {
          console.error('[AI 분석 에러]', err);
          alert(`AI 분석 실패: ${err.message}`);
          analyzeProgress2.reset();
        } finally {
          setTimeout(() => analyzeProgress2.reset(), 2000);
          setAnalyzing(false);
        }
      }, [documentId]);

      // UX1: 메타 수정 저장 (field: 'title' | 'category' | 'both')
      const handleSaveMeta = useCallback(async (field = 'both') => {
        if (!documentId) return;
        setSavingMeta(true);
        try {
          const body = { action: 'updateMeta', id: documentId };
          if (field === 'title' || field === 'both') {
            if (editTitle.trim()) body.title = editTitle.trim();
          }
          if (field === 'category' || field === 'both') {
            if (editCategory.trim()) body.category = editCategory.trim();
          }
          if (!body.title && !body.category) { setSavingMeta(false); return; }
          const res = await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '수정 실패'); }
          const docRes = await authFetch(`${API_BASE_URL}/documents?id=${documentId}`);
          if (docRes.ok) setData(await docRes.json());
          if (field === 'title' || field === 'both') setEditingTitle(false);
          if (field === 'category' || field === 'both') setEditingCategory(false);
        } catch (err) {
          alert(`수정 실패: ${err.message}`);
        } finally {
          setSavingMeta(false);
        }
      }, [documentId, editTitle, editCategory]);

      // UX2: 임베딩 재생성
      const handleRebuildEmbeddings = useCallback(async () => {
        if (!documentId) return;
        setRebuildingEmb(true);
        try {
          const res = await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rebuildEmbeddings', id: documentId }),
          });
          if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '임베딩 재생성 실패'); }
          const result = await res.json();
          // 데이터 리로드
          const docRes = await authFetch(`${API_BASE_URL}/documents?id=${documentId}`);
          if (docRes.ok) setData(await docRes.json());
          alert(`임베딩 재생성 완료: ${result.totalChunks}개 청크`);
        } catch (err) {
          alert(`임베딩 재생성 실패: ${err.message}`);
        } finally {
          setRebuildingEmb(false);
        }
      }, [documentId]);

      // 조문 ID로 스크롤 이동
      const scrollToArticle = useCallback((refId) => {
        // refId: "제10조", "제3조의2" 등
        // 해당 조문이 속한 장을 펼치고 스크롤
        const target = sections.find(s => {
          const m = s.metadata || {};
          let artId = m.articleNumber ? `제${m.articleNumber}조` : '';
          if (m.branchNumber) artId += `의${m.branchNumber}`;
          return artId === refId;
        });
        if (target) {
          const chapter = target.metadata?.chapter;
          if (chapter) {
            setExpandedChapters(prev => ({ ...prev, [chapter]: true }));
          }
          // DOM 스크롤 (약간 딜레이 후)
          setTimeout(() => {
            const el = document.getElementById(`section-${target.id}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      }, [sections]);

      // 검색 결과에서 전달받은 섹션으로 자동 스크롤
      useEffect(() => {
        if (!initialSectionInfo || !sections.length) return;
        const { sectionIndex, label } = initialSectionInfo;

        // 1) label(예: "제2조(용어의 정의)")로 매칭 시도
        let target = null;
        if (label) {
          // label에서 "제N조" 패턴 추출
          const artMatch = label.match(/제(\d+)조(?:의(\d+))?/);
          if (artMatch) {
            const artNum = artMatch[1];
            const branchNum = artMatch[2] || null;
            target = sections.find(s => {
              const m = s.metadata || {};
              return String(m.articleNumber) === artNum &&
                (branchNum ? String(m.branchNumber) === branchNum : !m.branchNumber);
            });
          }
          // label 텍스트로 직접 매칭 (heading, section_title 등)
          if (!target) {
            target = sections.find(s => {
              const m = s.metadata || {};
              const titles = [m.label, m.heading, s.section_title, s.title].filter(Boolean);
              return titles.some(t => t.includes(label) || label.includes(t));
            });
          }
        }
        // 2) sectionIndex로 폴백
        if (!target && sectionIndex != null && sections[sectionIndex]) {
          target = sections[sectionIndex];
        }

        if (target) {
          // 해당 섹션이 속한 장을 펼침
          const chapter = target.metadata?.chapter;
          if (chapter) {
            setExpandedChapters(prev => ({ ...prev, [chapter]: true }));
          }
          // DOM 스크롤 + 하이라이트
          setTimeout(() => {
            const el = document.getElementById(`section-${target.id}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
              setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2'), 3000);
            }
          }, 300);
        }
      }, [sections, initialSectionInfo]);

      // 단일 섹션 렌더링
      const renderSection = (section, idx) => {
        const meta = section.metadata || {};
        const isQuiz = section.section_type === 'quiz' && meta.body;
        const references = meta.references || [];
        const referencedBy = meta.referencedBy || [];

        return (
          <div key={section.id || idx} id={`section-${section.id}`} className="bg-bg border border-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {isQuiz ? (
                <>
                  <Badge color="primary">문제 {meta.number}</Badge>
                  {meta.subject && <Badge color="yellow">{meta.subject}</Badge>}
                </>
              ) : section.section_type === 'article' && meta.label ? (
                <>
                  {meta.section && <Badge color="yellow">{meta.section}</Badge>}
                  <Badge color="gray">
                    제{meta.articleNumber}조{meta.branchNumber ? `의${meta.branchNumber}` : ''}{meta.articleTitle ? `(${meta.articleTitle})` : ''}
                  </Badge>
                </>
              ) : (
                <Badge color="gray">
                  {meta.heading || section.section_title || section.title || `섹션 ${idx + 1}`}
                </Badge>
              )}
            </div>

            {isQuiz ? (
              <div className="space-y-2">
                <p className="text-sm text-text font-medium leading-relaxed">{meta.body}</p>
                <div className="space-y-1 pl-2">
                  {(meta.choices || []).map((choice, ci) => (
                    <p key={ci} className="text-sm leading-relaxed text-text/80">{choice}</p>
                  ))}
                </div>
              </div>
            ) : (
              <pre className="text-sm text-text whitespace-pre-wrap break-words leading-relaxed font-[inherit]">
                {section.content || section.text || '(내용 없음)'}
              </pre>
            )}

            {/* AI 요약 */}
            {section.id && (
              <div className="mt-2">
                {(summaries[section.id] || section.summary) ? (
                  <div className="p-2 bg-primary/10 rounded-md border border-primary/20">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs text-primary font-medium">
                        AI 요약
                        {codSteps[section.id] && (
                          <span className="ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">CoD {codSteps[section.id].length}단계</span>
                        )}
                      </p>
                      <div className="flex items-center gap-1">
                        {codSteps[section.id] && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowCodSteps(prev => ({ ...prev, [section.id]: !prev[section.id] })); }}
                            className="text-[10px] text-amber-600 hover:text-amber-700 underline"
                          >
                            {showCodSteps[section.id] ? '단계 접기' : '단계 보기'}
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSummarize(section.id, true); }}
                          disabled={summarizing[section.id]}
                          className="text-[10px] text-primary/60 hover:text-primary underline disabled:opacity-50"
                        >
                          {summarizing[section.id] ? '재생성 중...' : 'CoD 재생성'}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-text leading-relaxed">{summaries[section.id] || section.summary}</p>
                    {/* CoD 단계별 과정 표시 */}
                    {showCodSteps[section.id] && codSteps[section.id] && (
                      <div className="mt-2 pt-2 border-t border-primary/20 space-y-1.5">
                        {codSteps[section.id].map((step, si) => (
                          <div key={si} className="text-[11px]">
                            <div className="flex items-center gap-1 mb-0.5">
                              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold ${
                                si === codSteps[section.id].length - 1
                                  ? 'bg-amber-500 text-white'
                                  : 'bg-amber-100 text-amber-700'
                              }`}>{step.step}</span>
                              {step.addedEntities?.length > 0 && (
                                <span className="text-amber-600">
                                  +{step.addedEntities.join(', ')}
                                </span>
                              )}
                            </div>
                            <p className="text-text-secondary leading-relaxed pl-5">{step.summary}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSummarize(section.id); }}
                      disabled={summarizing[section.id]}
                      className="text-xs text-primary hover:text-primary-hover underline disabled:opacity-50"
                    >
                      {summarizing[section.id] ? (useCoD ? 'CoD 요약 중...' : '요약 생성 중...') : (useCoD ? 'CoD 요약' : 'AI 요약')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 참조 관계 표시 */}
            {(references.length > 0 || referencedBy.length > 0) && (
              <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap gap-1.5">
                {references.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-text-secondary">참조:</span>
                    {references.map((ref, ri) => (
                      <button
                        key={ri}
                        onClick={() => scrollToArticle(ref)}
                        className="text-xs text-primary hover:text-primary-hover underline"
                      >{ref}</button>
                    ))}
                  </div>
                )}
                {referencedBy.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-text-secondary ml-2">역참조:</span>
                    {referencedBy.map((ref, ri) => (
                      <button
                        key={ri}
                        onClick={() => scrollToArticle(ref)}
                        className="text-xs text-yellow-400 hover:text-yellow-300 underline"
                      >{ref}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      };

      const hasGroups = groupedSections.some(g => g.chapter);

      return (
        <Modal isOpen={isOpen} onClose={onClose} title={
          /* 인라인 제목 편집: 클릭하면 input으로 전환 */
          doc ? (editingTitle
            ? createElement('div', { className: 'flex items-center gap-2 flex-1 min-w-0' },
                createElement('input', {
                  autoFocus: true,
                  value: editTitle,
                  onChange: e => setEditTitle(e.target.value),
                  onKeyDown: e => {
                    if (e.key === 'Enter') handleSaveMeta('title');
                    if (e.key === 'Escape') setEditingTitle(false);
                  },
                  className: 'flex-1 px-2 py-1 bg-bg border-2 border-primary rounded-lg text-lg font-semibold text-text focus:outline-none min-w-0',
                  placeholder: '문서 제목',
                }),
                createElement('button', {
                  onClick: () => handleSaveMeta('title'),
                  disabled: savingMeta,
                  className: 'px-2 py-1 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 whitespace-nowrap',
                }, savingMeta ? '...' : '저장'),
                createElement('button', {
                  onClick: () => setEditingTitle(false),
                  className: 'px-2 py-1 text-xs text-text-secondary hover:text-text whitespace-nowrap',
                }, '취소'),
              )
            : createElement('span', {
                onClick: () => { setEditTitle(doc.title); setEditingTitle(true); },
                className: 'cursor-pointer hover:text-primary transition-colors border-b border-transparent hover:border-primary/30',
                title: '클릭하여 제목 편집',
              }, doc.title)
          ) : '문서 상세'
        } size="lg">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-500 py-8 text-center">{error}</p>
          ) : doc ? (
            <div className="space-y-4">
              {/* 문서 정보 + 버튼 영역 */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex flex-wrap gap-2 items-center text-sm text-text-secondary">
                  {/* 카테고리: 클릭하면 인라인 드롭다운 */}
                  {editingCategory ? (
                    <div className="flex items-center gap-1">
                      <select
                        autoFocus
                        value={editCategory}
                        onChange={e => { setEditCategory(e.target.value); }}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setEditingCategory(false);
                        }}
                        onBlur={() => {
                          // 값이 변경되었으면 자동 저장
                          if (editCategory && editCategory !== doc.category) {
                            handleSaveMeta('category');
                          } else {
                            setEditingCategory(false);
                          }
                        }}
                        className="px-2 py-0.5 bg-bg border-2 border-primary rounded-lg text-sm text-text font-medium focus:outline-none"
                      >
                        {CATEGORIES.filter(c => c.value).map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                      <button
                        onMouseDown={e => { e.preventDefault(); handleSaveMeta('category'); }}
                        className="text-xs text-primary hover:text-primary-hover font-medium"
                      >저장</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditCategory(doc.category || ''); setEditingCategory(true); }}
                      title="클릭하여 카테고리 변경"
                      className="group"
                    >
                      <Badge color={doc.category === '법령' ? 'primary' : doc.category === '행정규칙' ? 'purple' : doc.category === '자치법규' ? 'purple' : doc.category === '기출' ? 'green' : doc.category === '규정' ? 'yellow' : 'gray'}>
                        {doc.category}
                        <svg className="w-2.5 h-2.5 ml-0.5 inline opacity-0 group-hover:opacity-60 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </Badge>
                    </button>
                  )}
                  <span>{formatDate(doc.created_at)}</span>
                  <span>{sections.length}개 섹션</span>
                  {doc.file_size > 0 && <span>{formatFileSize(doc.file_size)}</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* LLM 프로바이더 선택 */}
                  {summaryProviders.length > 0 && (
                    <div className="flex items-center gap-1 mr-1">
                      {summaryProviders.map(p => {
                        const colors = { gemini: 'blue', openai: 'emerald', claude: 'orange' };
                        const c = colors[p.id] || 'gray';
                        const active = summaryProvider === p.id;
                        const modelId = llmSettings[p.id]?.model || '';
                        const shortModel = modelId.replace(/^(gemini-|gpt-|claude-)/, '').replace(/-\d{8}$/, '');
                        return (
                          <button key={p.id} onClick={() => setSummaryProvider(p.id)}
                            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${active
                              ? `bg-${c}-500 text-white shadow-sm`
                              : `bg-${c}-50 text-${c}-600 hover:bg-${c}-100`}`}>
                            {p.name}
                            {active && shortModel && <span className="ml-1 opacity-80">({shortModel})</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {hasGroups && (
                    <Button variant="ghost" size="sm" onClick={toggleAll}>
                      {allExpanded ? '전체 접기' : '전체 펼치기'}
                    </Button>
                  )}
                  {/* CoD 토글 */}
                  <button
                    onClick={() => setUseCoD(!useCoD)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                      useCoD
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'bg-surface-alt text-text-secondary hover:bg-amber-50 hover:text-amber-600'
                    }`}
                    title="Chain of Density: 5회 반복으로 정보 밀도 높은 요약 생성"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/></svg>
                    CoD
                  </button>
                  <Button variant="ghost" size="sm" onClick={handleBulkSummarize} disabled={bulkSummarizing || isApiDisabled('gemini')}
                    title={isApiDisabled('gemini') ? 'Gemini API 비활성' : ''}>
                    {isApiDisabled('gemini') ? 'API 비활성' : bulkSummarizing ? (useCoD ? 'CoD 요약 중...' : '요약 중...') : (useCoD ? '전체 CoD 요약' : '전체 요약')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleAnalyze} disabled={analyzing || isApiDisabled('gemini')}
                    title={isApiDisabled('gemini') ? 'Gemini API 비활성' : ''}>
                    {isApiDisabled('gemini') ? 'API 비활성' : analyzing ? 'AI 분석 중...' : 'AI 분석'}
                  </Button>
                  {/* UX2: 임베딩 상태 + 재생성 버튼 */}
                  {(doc.embedding_status === 'failed' || doc.embedding_status === 'pending') && (
                    <Button variant="ghost" size="sm" onClick={handleRebuildEmbeddings} disabled={rebuildingEmb || isApiDisabled('openai')}
                      className="text-red-500 hover:text-red-600"
                      title={isApiDisabled('openai') ? 'OpenAI API 비활성' : ''}>
                      {isApiDisabled('openai') ? 'API 비활성' : rebuildingEmb ? '재생성 중...' : '임베딩 재시도'}
                    </Button>
                  )}
                </div>
              </div>

              {/* AI 분석 진행률 */}
              {analyzeProgress2.progress > 0 && (
                <div className="space-y-2">
                  <ProgressBar value={analyzeProgress2.progress} />
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-text-secondary">{analyzeProgress2.message || '분석 중...'}</p>
                    <span className="text-xs text-primary font-medium">{Math.round(analyzeProgress2.progress)}%</span>
                  </div>
                </div>
              )}

              {/* AI 요약 / 키워드 (분석 완료 시 표시) */}
              {(doc.summary || doc.keywords) && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
                  {doc.summary && (
                    <div>
                      <p className="text-xs text-primary font-medium mb-1">AI 요약</p>
                      <p className="text-sm text-text leading-relaxed">{doc.summary}</p>
                    </div>
                  )}
                  {doc.keywords && (
                    <div className="flex flex-wrap gap-1">
                      {(typeof doc.keywords === 'string' ? doc.keywords.split(',') : doc.keywords).map((kw, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-primary/15 text-primary/80">{kw.trim()}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 태그 관리 */}
              <div className="border border-border rounded-lg p-3 space-y-2">
                <p className="text-xs text-text-secondary font-medium">태그</p>
                <div className="flex flex-wrap gap-1.5">
                  {(data.tags || []).map(tag => (
                    <span key={tag.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/15 text-primary">
                      #{tag.name}
                      <button
                        onClick={() => handleRemoveTag(tag.id)}
                        className="ml-0.5 hover:text-red-500 transition-colors"
                        title="태그 삭제"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </span>
                  ))}
                  {(data.tags || []).length === 0 && !analyzing && (
                    <span className="text-xs text-text-secondary">태그 없음 (AI 분석으로 자동 생성 가능)</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                    placeholder="태그 입력 후 Enter"
                    className="flex-1 px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text placeholder-text-secondary/50 focus:outline-none focus:border-primary transition-colors"
                  />
                  <Button variant="ghost" size="sm" onClick={handleAddTag} disabled={tagLoading || !newTagName.trim()}>
                    {tagLoading ? '...' : '추가'}
                  </Button>
                </div>
              </div>

              {/* 원본 파일 관리 영역 */}
              {doc.original_filename && (
                <div className="border border-border rounded-lg p-4 bg-card-bg space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-text-secondary">원본 파일:</span>
                      <span className="text-text font-medium">{doc.original_filename}</span>
                      {doc.file_size > 0 && (
                        <span className="text-text-secondary">({formatFileSize(doc.file_size)})</span>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const res = await authFetch(`${API_BASE_URL}/documents?id=${doc.id}&download=true`, {
                            headers: { 'Accept': 'application/json' },
                          });
                          if (!res.ok) throw new Error('다운로드 실패');
                          const ct = res.headers.get('content-type') || '';
                          if (ct.includes('application/json')) {
                            // Signed URL → 새 탭에서 다운로드
                            const j = await res.json();
                            if (j.url) window.open(j.url, '_blank');
                          } else {
                            // BYTEA → Blob 다운로드
                            const blob = await res.blob();
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = doc.original_filename || 'download';
                            a.click();
                            URL.revokeObjectURL(a.href);
                          }
                        } catch (err) { console.error(err); }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      다운로드
                    </button>
                  </div>
                  {/* 이미지 미리보기 */}
                  {doc.original_mimetype && doc.original_mimetype.startsWith('image/') && (
                    <div className="border border-border rounded-lg overflow-hidden bg-bg">
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={doc.original_filename}
                          className="max-w-full max-h-96 mx-auto object-contain"
                        />
                      ) : (
                        <div className="flex items-center justify-center py-8 text-text-secondary text-sm">
                          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                          이미지 로딩 중...
                        </div>
                      )}
                    </div>
                  )}
                  {/* PDF 안내 */}
                  {doc.original_mimetype === 'application/pdf' && (
                    <p className="text-xs text-text-secondary">
                      PDF 파일은 다운로드 버튼을 클릭하여 확인할 수 있습니다.
                    </p>
                  )}
                </div>
              )}

              {/* 법령 문서: 탭 전환 (조문 목록 / 참조 그래프) */}
              {doc.file_type === 'law' && (
                <div className="flex border-b border-border">
                  {[
                    { id: 'sections', label: '조문 목록' },
                    { id: 'graph', label: '참조 그래프' },
                    { id: 'crossref', label: '교차 참조' },
                    { id: 'triples', label: '지식 그래프' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setDetailTab(tab.id)}
                      className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
                        detailTab === tab.id
                          ? 'text-primary border-b-2 border-primary'
                          : 'text-text-secondary hover:text-text'
                      }`}
                    >{tab.label}</button>
                  ))}
                </div>
              )}

              {/* 참조 그래프 탭 */}
              {doc.file_type === 'law' && detailTab === 'graph' && (
                <LawGraphView documentId={documentId} scrollToArticle={(ref) => { setDetailTab('sections'); scrollToArticle(ref); }} />
              )}

              {/* 교차 참조 탭 */}
              {doc.file_type === 'law' && detailTab === 'crossref' && (
                <CrossRefView documentId={documentId} docTitle={doc.title} />
              )}

              {/* 지식 그래프 탭 */}
              {doc.file_type === 'law' && detailTab === 'triples' && (
                <KnowledgeGraphView documentId={documentId} docTitle={doc.title} />
              )}

              {/* 섹션 목록 */}
              {(doc.file_type !== 'law' || detailTab === 'sections') && (
              <div className="space-y-2">
                {sections.length === 0 ? (
                  <p className="text-sm text-text-secondary text-center py-4">추출된 섹션이 없습니다.</p>
                ) : hasGroups ? (
                  // 장별 그룹핑 표시 (접기/펼치기)
                  groupedSections.map((group, gi) => {
                    if (!group.chapter) {
                      // chapter 없는 섹션은 바로 표시
                      return group.sections.map((s, si) => renderSection(s, `${gi}-${si}`));
                    }
                    const isExpanded = expandedChapters[group.chapter] || false;
                    return (
                      <div key={gi} className="border border-border rounded-lg overflow-hidden">
                        {/* 장 헤더 (클릭으로 토글) */}
                        <button
                          onClick={() => toggleChapter(group.chapter)}
                          className="w-full flex items-center justify-between px-4 py-3 bg-card-bg hover:bg-card-bg-hover transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <Badge color="primary">{group.chapter}</Badge>
                            <span className="text-sm text-text-secondary">{group.sections.length}개 조문</span>
                          </div>
                          <svg
                            className={`w-4 h-4 text-text-secondary transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {/* 장 내 섹션 (펼침 시에만 표시) */}
                        {isExpanded && (
                          <div className="p-3 space-y-2 bg-bg/50">
                            {group.sections.map((s, si) => renderSection(s, `${gi}-${si}`))}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  // 그룹핑 없이 모두 표시
                  sections.map((section, idx) => renderSection(section, idx))
                )}
              </div>
              )}
            </div>
          ) : null}
        </Modal>
      );
    }



export default DocumentDetailModal;
