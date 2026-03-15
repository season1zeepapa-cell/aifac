import { Fragment, useCallback, useContext, useEffect, useState } from 'react';
import { CategoriesContext, getCategoriesWithAll } from '../../contexts/CategoriesContext';
import { API_BASE_URL, authFetch } from '../../lib/api';
import { formatDate, formatFileSize } from '../../utils/format';
import { FILE_TYPE_CONFIG } from '../../constants/files';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import DocumentDetailModal from './DocumentDetailModal';


    function DocumentsTab({ initialDocInfo, onInitialDocConsumed }) {
      const { categories: catList } = useContext(CategoriesContext);
      const CATEGORIES = getCategoriesWithAll(catList);
      const [documents, setDocuments] = useState([]);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [categoryFilter, setCategoryFilter] = useState('');
      const [selectedDocId, setSelectedDocId] = useState(initialDocInfo?.docId || null);
      // 검색 결과에서 전달받은 섹션 정보 (해당 조문으로 스크롤용)
      const [initialSectionInfo, setInitialSectionInfo] = useState(
        initialDocInfo ? { sectionIndex: initialDocInfo.sectionIndex, label: initialDocInfo.label } : null
      );

      // 검색 탭에서 전달받은 initialDocInfo 처리
      useEffect(() => {
        if (initialDocInfo?.docId) {
          setSelectedDocId(initialDocInfo.docId);
          setInitialSectionInfo({ sectionIndex: initialDocInfo.sectionIndex, label: initialDocInfo.label });
          if (onInitialDocConsumed) onInitialDocConsumed();
        }
      }, [initialDocInfo]);
      const [deleting, setDeleting] = useState(null);
      // 휴지통 모드 토글
      const [showTrash, setShowTrash] = useState(false);
      const [trashCount, setTrashCount] = useState(0);
      // 페이징: 처음 5개만 보여주고 '더보기'로 추가 로드
      const [visibleCount, setVisibleCount] = useState(5);
      // 태그 필터
      const [allTags, setAllTags] = useState([]);
      const [tagFilter, setTagFilter] = useState('');
      const [showTagFilter, setShowTagFilter] = useState(false);

      // F18: 즐겨찾기 토글
      const handleToggleFavorite = useCallback(async (docId) => {
        try {
          const resp = await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'toggleFavorite', id: docId }),
          });
          const data = await resp.json();
          if (data.success) {
            setDocuments(prev => prev.map(d =>
              d.id === docId ? { ...d, is_favorited: data.is_favorited } : d
            ));
          }
        } catch (e) { console.warn('즐겨찾기 실패:', e.message); }
      }, []);

      // UX2: 임베딩 재생성 (목록에서 바로 실행)
      const [rebuildingEmbId, setRebuildingEmbId] = useState(null);
      const handleRebuildEmb = useCallback(async (docId, e) => {
        e.stopPropagation();
        setRebuildingEmbId(docId);
        try {
          const resp = await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rebuildEmbeddings', id: docId }),
          });
          if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d.error || '실패'); }
          setDocuments(prev => prev.map(d =>
            d.id === docId ? { ...d, embedding_status: 'done' } : d
          ));
        } catch (err) {
          alert(`임베딩 재생성 실패: ${err.message}`);
        } finally {
          setRebuildingEmbId(null);
        }
      }, []);

      // 태그 목록 불러오기 (필터용)
      useEffect(() => {
        authFetch(`${API_BASE_URL}/documents?tags=all`)
          .then(r => r.json())
          .then(data => setAllTags(data.tags || []))
          .catch(() => {});
      }, []);

      // 문서 목록 불러오기
      const fetchDocuments = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const params = new URLSearchParams();
          if (showTrash) {
            params.set('trash', 'true');
          } else {
            if (categoryFilter) params.set('category', categoryFilter);
            if (tagFilter) params.set('tag', tagFilter);
          }
          const qs = params.toString() ? `?${params}` : '';
          const res = await authFetch(`${API_BASE_URL}/documents${qs}`);
          if (!res.ok) throw new Error('문서 목록을 불러올 수 없습니다.');
          const data = await res.json();
          setDocuments(Array.isArray(data) ? data : data.documents || []);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      }, [categoryFilter, tagFilter, showTrash]);

      // 휴지통 개수 조회
      const fetchTrashCount = useCallback(async () => {
        try {
          const res = await authFetch(`${API_BASE_URL}/documents?trash=true`);
          if (res.ok) {
            const data = await res.json();
            const docs = Array.isArray(data) ? data : data.documents || [];
            setTrashCount(docs.length);
          }
        } catch {}
      }, []);

      useEffect(() => {
        setVisibleCount(5); // 필터/모드 변경 시 페이징 초기화
        fetchDocuments();
      }, [fetchDocuments]);

      useEffect(() => {
        if (!showTrash) fetchTrashCount();
      }, [showTrash, fetchTrashCount, documents]);

      // 소프트 삭제 (휴지통으로 이동)
      const handleDelete = useCallback(async (id, e) => {
        e.stopPropagation();
        if (!confirm('이 문서를 휴지통으로 이동하시겠습니까?')) return;
        setDeleting(id);
        try {
          const res = await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', id }),
          });
          if (!res.ok) throw new Error('삭제에 실패했습니다.');
          setDocuments(prev => prev.filter(d => d.id !== id));
        } catch (err) {
          alert(err.message);
        } finally {
          setDeleting(null);
        }
      }, []);

      // 복구
      const handleRestore = useCallback(async (id, e) => {
        e.stopPropagation();
        setDeleting(id);
        try {
          const res = await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'restore', id }),
          });
          if (!res.ok) throw new Error('복구에 실패했습니다.');
          setDocuments(prev => prev.filter(d => d.id !== id));
        } catch (err) {
          alert(err.message);
        } finally {
          setDeleting(null);
        }
      }, []);

      // 영구 삭제
      const handlePermanentDelete = useCallback(async (id, e) => {
        e.stopPropagation();
        if (!confirm('이 문서를 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
        setDeleting(id);
        try {
          const res = await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'permanentDelete', id }),
          });
          if (!res.ok) throw new Error('영구 삭제에 실패했습니다.');
          setDocuments(prev => prev.filter(d => d.id !== id));
        } catch (err) {
          alert(err.message);
        } finally {
          setDeleting(null);
        }
      }, []);

      // 휴지통 비우기
      const handleEmptyTrash = useCallback(async () => {
        if (!confirm(`휴지통의 모든 문서(${documents.length}개)를 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
        setLoading(true);
        try {
          const res = await authFetch(`${API_BASE_URL}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'emptyTrash' }),
          });
          if (!res.ok) throw new Error('휴지통 비우기에 실패했습니다.');
          setDocuments([]);
        } catch (err) {
          alert(err.message);
        } finally {
          setLoading(false);
        }
      }, [documents.length]);

      // 경과 시간 표시 (삭제 후 며칠 경과)
      const getDeletedAgo = (deletedAt) => {
        const diff = Date.now() - new Date(deletedAt).getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days === 0) return '오늘';
        if (days === 1) return '어제';
        return `${days}일 전`;
      };

      // 카테고리별 뱃지 색상
      const getCategoryColor = (cat) => {
        switch (cat) {
          case '법령': return 'primary';
          case '기출': return 'green';
          case '규정': return 'yellow';
          default: return 'gray';
        }
      };

      // 맨 위로 스크롤 버튼 표시 여부
      const [showScrollTop, setShowScrollTop] = useState(false);
      useEffect(() => {
        const onScroll = () => setShowScrollTop(window.scrollY > 300);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
      }, []);

      return (
        <div className="space-y-4 fade-in">
          {/* 카테고리 필터 + 태그 필터 + 휴지통 */}
          <div className="flex items-center gap-2">
            {!showTrash && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.value}
                    onClick={() => setCategoryFilter(cat.value)}
                    className={`px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                      categoryFilter === cat.value
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-card-bg border border-border text-text-secondary hover:text-text hover:border-primary/30'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
                {/* 태그 필터 토글 버튼 */}
                {allTags.length > 0 && (
                  <button
                    onClick={() => setShowTagFilter(!showTagFilter)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                      tagFilter
                        ? 'bg-blue-500 text-white shadow-sm'
                        : showTagFilter
                          ? 'bg-blue-100 text-blue-600 border border-blue-200'
                          : 'bg-card-bg border border-border text-text-secondary hover:text-text hover:border-blue-300'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>
                    {tagFilter ? `#${tagFilter}` : '태그'}
                  </button>
                )}
              </div>
            )}
            {showTrash && (
              <div className="flex-1">
                <span className="text-sm font-medium text-red-500">
                  휴지통 ({documents.length}개)
                </span>
              </div>
            )}
            {/* 휴지통 버튼 */}
            <button
              onClick={() => { setShowTrash(!showTrash); setCategoryFilter(''); setTagFilter(''); setShowTagFilter(false); }}
              className={`relative px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
                showTrash
                  ? 'bg-red-50 text-red-500 border border-red-200'
                  : 'bg-card-bg border border-border text-text-secondary hover:text-text'
              }`}
            >
              <svg className="w-4 h-4 inline-block mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              {showTrash ? '목록으로' : '휴지통'}
              {!showTrash && trashCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                  {trashCount}
                </span>
              )}
            </button>
            {/* 휴지통 비우기 */}
            {showTrash && documents.length > 0 && (
              <button
                onClick={handleEmptyTrash}
                className="px-3 py-1.5 rounded-full text-sm font-medium bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 transition-colors shrink-0"
              >
                비우기
              </button>
            )}
          </div>

          {/* 태그 필터 패널 (펼침) */}
          {showTagFilter && !showTrash && allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-3 bg-card-bg border border-border rounded-lg">
              <button
                onClick={() => setTagFilter('')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  !tagFilter ? 'bg-blue-500 text-white' : 'bg-bg border border-border text-text-secondary hover:text-text'
                }`}
              >전체</button>
              {allTags.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTagFilter(tagFilter === t.name ? '' : t.name)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    tagFilter === t.name
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'bg-bg border border-border text-text-secondary hover:text-text hover:border-blue-300'
                  }`}
                >
                  #{t.name}
                  {t.usage_count > 0 && (
                    <span className={`text-[10px] ${tagFilter === t.name ? 'text-blue-200' : 'text-text-secondary/60'}`}>
                      {t.usage_count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* 문서 개수 표시 (로딩 완료 후) */}
          {!loading && !error && !showTrash && documents.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">
                {categoryFilter ? `'${categoryFilter}' ` : '전체 '}{tagFilter ? `#${tagFilter} ` : ''}{documents.length}개 문서
              </span>
              <button onClick={fetchDocuments} className="text-xs text-text-secondary hover:text-primary transition-colors">
                &#x21BB; 새로고침
              </button>
            </div>
          )}

          {/* 로딩 */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <div className="flex items-center justify-between">
                <p className="text-sm text-red-500">{error}</p>
                <Button variant="ghost" size="sm" onClick={fetchDocuments}>재시도</Button>
              </div>
            </Card>
          ) : documents.length === 0 ? (
            <EmptyState
              icon={showTrash ? "🗑️" : "📄"}
              title={showTrash ? "휴지통이 비어 있습니다" : "문서가 없습니다"}
              description={showTrash
                ? '삭제된 문서가 없습니다.'
                : tagFilter ? `#${tagFilter} 태그가 붙은 문서가 없습니다.`
                : categoryFilter ? `'${categoryFilter}' 카테고리에 문서가 없습니다.` : '업로드 탭에서 PDF를 업로드하세요.'}
            />
          ) : (
            /* 문서 카드 목록 */
            <div className="space-y-3">
              {documents.slice(0, visibleCount).map(doc => (
                <Card key={doc.id} hoverable={!showTrash} onClick={() => !showTrash && setSelectedDocId(doc.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className={`font-medium truncate ${showTrash ? 'text-text-secondary' : 'text-text'}`}>{doc.title}</h3>
                        <Badge color={getCategoryColor(doc.category)} className="shrink-0">{doc.category}</Badge>
                      </div>
                      {/* 메타 정보 */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs text-text-secondary">
                        {FILE_TYPE_CONFIG[doc.file_type] && (
                          <span>{FILE_TYPE_CONFIG[doc.file_type].icon} {FILE_TYPE_CONFIG[doc.file_type].label}</span>
                        )}
                        {doc.file_type === 'law' && <span>법령</span>}
                        {showTrash && doc.deleted_at ? (
                          <span className="text-red-500">{getDeletedAgo(doc.deleted_at)} 삭제</span>
                        ) : (
                          <Fragment>
                            <span className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                doc.embedding_status === 'done' ? 'bg-green-400' : doc.embedding_status === 'failed' ? 'bg-red-400' : 'bg-yellow-400'
                              }`} />
                              {doc.embedding_status === 'done' ? '벡터화됨' : doc.embedding_status === 'failed' ? '벡터 실패' : '대기'}
                              {doc.embedding_status === 'failed' && (
                                <button
                                  onClick={(e) => handleRebuildEmb(doc.id, e)}
                                  disabled={rebuildingEmbId === doc.id}
                                  className="text-red-500 hover:text-red-600 underline text-[10px] ml-0.5"
                                >
                                  {rebuildingEmbId === doc.id ? '재생성중...' : '재시도'}
                                </button>
                              )}
                            </span>
                            <span>{formatDate(doc.created_at)}</span>
                          </Fragment>
                        )}
                        {doc.section_count != null && <span>{doc.section_count}개 섹션</span>}
                        {doc.file_size > 0 && <span>{formatFileSize(doc.file_size)}</span>}
                      </div>
                      {/* 태그 (클릭 시 태그 필터 적용) */}
                      {doc.tags && doc.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {doc.tags.map(tag => (
                            <button
                              key={tag.id}
                              onClick={(e) => { e.stopPropagation(); setTagFilter(tag.name); setShowTagFilter(true); }}
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                                tagFilter === tag.name
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100'
                              }`}
                            >
                              #{tag.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* 즐겨찾기 + 삭제 버튼 / 휴지통: 복구 + 영구삭제 */}
                    {showTrash ? (
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={(e) => handleRestore(doc.id, e)}
                          disabled={deleting === doc.id}
                          className="p-2 text-text-secondary hover:text-green-600 transition-colors"
                          title="복구"
                        >
                          {deleting === doc.id ? (
                            <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                          )}
                        </button>
                        <button
                          onClick={(e) => handlePermanentDelete(doc.id, e)}
                          disabled={deleting === doc.id}
                          className="p-2 text-text-secondary hover:text-red-500 transition-colors"
                          title="영구 삭제"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleFavorite(doc.id); }}
                        className={`p-2 transition-colors ${doc.is_favorited ? 'text-yellow-500' : 'text-text-secondary hover:text-yellow-500'}`}
                        aria-label="즐겨찾기"
                      >
                        <svg className="w-4 h-4" fill={doc.is_favorited ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                      </button>
                      <button
                        onClick={(e) => handleDelete(doc.id, e)}
                        disabled={deleting === doc.id}
                        className="p-2 text-text-secondary hover:text-red-500 transition-colors"
                        aria-label="삭제"
                      >
                        {deleting === doc.id ? (
                          <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        )}
                      </button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
              {/* 더보기 버튼 */}
              {documents.length > visibleCount && (
                <button
                  onClick={() => setVisibleCount(prev => prev + 5)}
                  className="w-full py-2.5 text-sm text-primary hover:text-primary-hover bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  더보기 ({visibleCount}/{documents.length}건)
                </button>
              )}
            </div>
          )}

          {/* 문서 상세 모달 (닫을 때 태그/문서 목록 새로고침) */}
          <DocumentDetailModal
            isOpen={selectedDocId !== null}
            onClose={() => {
              setSelectedDocId(null);
              setInitialSectionInfo(null);
              fetchDocuments();
              authFetch(`${API_BASE_URL}/documents?tags=all`)
                .then(r => r.json()).then(d => setAllTags(d.tags || [])).catch(() => {});
            }}
            documentId={selectedDocId}
            initialSectionInfo={initialSectionInfo}
          />

          {/* 맨 위로 스크롤 버튼 */}
          {showScrollTop && (
            <button
              className="scroll-top-btn"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              aria-label="맨 위로"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
            </button>
          )}
        </div>
      );
    }



export default DocumentsTab;
