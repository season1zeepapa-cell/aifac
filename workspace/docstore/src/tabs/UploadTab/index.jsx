import { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { CategoriesContext } from '../../contexts/CategoriesContext';
import { ApiKeyStatusContext } from '../../contexts/ApiKeyStatusContext';
import { API_BASE_URL, authFetch, getAuthToken } from '../../lib/api';
import { FILE_TYPE_CONFIG, ALL_ACCEPTED, detectClientFileType } from '../../constants/files';
import { formatFileSize } from '../../utils/format';
import useSimulatedProgress from '../../hooks/useSimulatedProgress';
import useUploadProgress from '../../hooks/useUploadProgress';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import ProgressBar from '../../components/ui/ProgressBar';
import DisabledApiBanner from '../../components/ui/DisabledApiBanner';
import EmptyState from '../../components/ui/EmptyState';


    function UploadTab({ onUploadComplete }) {
      const { categories: catList } = useContext(CategoriesContext);
      // 모드 토글: 'file' / 'law' / 'url'
      const [uploadMode, setUploadMode] = useState('file');

      // ── 파일 모드 state ──
      const [file, setFile] = useState(null);
      const [fileType, setFileType] = useState(null); // 감지된 파일 형식
      const [title, setTitle] = useState('');
      const [category, setCategory] = useState('기타');
      const [sectionType, setSectionType] = useState('full');
      const [customDelimiter, setCustomDelimiter] = useState('');
      const [contentColumn, setContentColumn] = useState('');
      const [contentField, setContentField] = useState('');
      const [contentType, setContentType] = useState('general'); // 이미지 OCR 타입
      const [previewInfo, setPreviewInfo] = useState(null); // CSV/XLSX 열 목록, JSON 필드 미리보기
      const [uploading, setUploading] = useState(false);
      const [result, setResult] = useState(null);
      const [error, setError] = useState(null);
      const [dragOver, setDragOver] = useState(false);
      const [deidentify, setDeidentify] = useState(false); // 비식별화 토글
      const [chunkStrategy, setChunkStrategy] = useState('sentence'); // 청크 분할 전략
      const [chunkSize, setChunkSize] = useState(500); // 청크 크기 (자)
      const [chunkOverlap, setChunkOverlap] = useState(100); // 청크 겹침 (자)
      const [splitPreview, setSplitPreview] = useState(null); // 분할 미리보기 결과
      const [previewLoading, setPreviewLoading] = useState(false); // 미리보기 로딩
      const [pdfLoader, setPdfLoader] = useState('pdf-parse'); // PDF 로더 선택
      const [pdfLoaders, setPdfLoaders] = useState([]); // 사용 가능한 PDF 로더 목록
      const fileInputRef = useRef(null);

      // ── 카테고리별 청크 프리셋 ──
      const CHUNK_PRESETS = {
        '법령':   { strategy: 'law-article', chunkSize: 800, overlap: 0 },
        '규정':   { strategy: 'law-article', chunkSize: 800, overlap: 0 },
        '기출':   { strategy: 'sentence',    chunkSize: 400, overlap: 50 },
        '크롤링': { strategy: 'recursive',   chunkSize: 600, overlap: 100 },
        '기타':   { strategy: 'recursive',   chunkSize: 500, overlap: 100 },
      };

      // 파일 확장자별 프리셋
      const EXT_PRESETS = {
        '.md':  { strategy: 'markdown',  chunkSize: 600, overlap: 50 },
        '.csv': { strategy: 'sentence',  chunkSize: 300, overlap: 0 },
        '.json': { strategy: 'sentence', chunkSize: 400, overlap: 0 },
        '.xlsx': { strategy: 'sentence', chunkSize: 400, overlap: 0 },
      };

      // 카테고리 변경 시 프리셋 자동 적용
      const applyCategoryPreset = useCallback((cat) => {
        setCategory(cat);
        // 저장된 프리셋 확인 (관리 탭에서 설정한 것 우선)
        const saved = window.__chunkPresets?.[cat];
        const preset = saved || CHUNK_PRESETS[cat];
        if (preset) {
          setChunkStrategy(preset.strategy);
          setChunkSize(preset.chunkSize);
          setChunkOverlap(preset.overlap);
        }
      }, []);

      // 파일 변경 시 확장자별 프리셋 적용
      useEffect(() => {
        if (!file) return;
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        const extPreset = EXT_PRESETS[ext];
        if (extPreset) {
          setChunkStrategy(extPreset.strategy);
          setChunkSize(extPreset.chunkSize);
          setChunkOverlap(extPreset.overlap);
        }
      }, [file]);

      // ── 법령 검색 모드 state ──
      const [lawQuery, setLawQuery] = useState('');
      const [lawResults, setLawResults] = useState([]);
      const [lawSearching, setLawSearching] = useState(false);
      const [importing, setImporting] = useState(null);
      const [lawError, setLawError] = useState(null);
      const [lawResult, setLawResult] = useState(null);
      const [lawVisibleCount, setLawVisibleCount] = useState(5);
      const [lawImportedMap, setLawImportedMap] = useState({}); // lawId → { documentId, title, importedAt }
      const [lawTarget, setLawTarget] = useState('law'); // 'law' | 'admrul' | 'ordin'

      // ── URL 크롤링 모드 state ──
      const [urlInput, setUrlInput] = useState('');
      const [urlTitle, setUrlTitle] = useState('');
      const [urlCategory, setUrlCategory] = useState('기타');
      const [urlImporting, setUrlImporting] = useState(false);
      const [urlError, setUrlError] = useState(null);
      const [urlResult, setUrlResult] = useState(null);

      // ── 크롤링 수집 모드 state ──
      const [crawlSources, setCrawlSources] = useState([]);
      const [crawlKeywords, setCrawlKeywords] = useState([]);
      const [crawlExclusions, setCrawlExclusions] = useState([]);
      const [crawlResults, setCrawlResults] = useState([]);
      const [crawlLoading, setCrawlLoading] = useState(false);
      const [crawlError, setCrawlError] = useState(null);
      const [crawlSubTab, setCrawlSubTab] = useState('execute'); // 'execute' | 'sources' | 'keywords' | 'exclusions'
      // 실행 설정
      const [crawlSourceId, setCrawlSourceId] = useState('');
      const [crawlSelectedKeywordIds, setCrawlSelectedKeywordIds] = useState(new Set());
      const [crawlMode, setCrawlMode] = useState('naver'); // 'naver' | 'board'
      const [crawlRecentDays, setCrawlRecentDays] = useState(7);
      const [crawlTitleWeight, setCrawlTitleWeight] = useState(10);
      const [crawlContentWeight, setCrawlContentWeight] = useState(3);
      const [crawlMaxResults, setCrawlMaxResults] = useState(20);
      const [crawlExecuting, setCrawlExecuting] = useState(false);
      const [crawlIngesting, setCrawlIngesting] = useState(false);
      const [selectedCrawlIds, setSelectedCrawlIds] = useState(new Set());
      // 소스/키워드/제외 추가 폼
      const [newSourceName, setNewSourceName] = useState('');
      const [newSourceUrl, setNewSourceUrl] = useState('');
      const [newSourceImportance, setNewSourceImportance] = useState(1.0);
      const [newKeyword, setNewKeyword] = useState('');
      const [newExclusion, setNewExclusion] = useState('');
      // 인라인 편집 state
      const [editingSourceId, setEditingSourceId] = useState(null);
      const [editSourceName, setEditSourceName] = useState('');
      const [editSourceUrl, setEditSourceUrl] = useState('');
      const [editSourceImportance, setEditSourceImportance] = useState(1.0);
      const [editingKeywordId, setEditingKeywordId] = useState(null);
      const [editKeywordText, setEditKeywordText] = useState('');
      const [editKeywordTitleWeight, setEditKeywordTitleWeight] = useState(10);
      const [editKeywordContentWeight, setEditKeywordContentWeight] = useState(3);
      const [editingExclusionId, setEditingExclusionId] = useState(null);
      const [editExclusionPattern, setEditExclusionPattern] = useState('');
      const [editExclusionReason, setEditExclusionReason] = useState('');
      // 크롤링 결과 탭 필터 ('all' | 'naver' | 'board')
      const [crawlResultFilter, setCrawlResultFilter] = useState('all');
      const [crawlVisibleCount, setCrawlVisibleCount] = useState(10);

      // 크롤링 데이터 로드
      const loadCrawlData = useCallback(async () => {
        try {
          const [srcRes, kwRes, exRes, resRes] = await Promise.all([
            authFetch(`${API_BASE_URL}/crawl-sources`).then(r => r.json()),
            authFetch(`${API_BASE_URL}/crawl-keywords`).then(r => r.json()),
            authFetch(`${API_BASE_URL}/crawl-sources?exclusions=1`).then(r => r.json()),
            authFetch(`${API_BASE_URL}/crawl-ingest`).then(r => r.json()),
          ]);
          setCrawlSources(srcRes.sources || []);
          setCrawlKeywords(kwRes.keywords || []);
          setCrawlExclusions(exRes.exclusions || []);
          setCrawlResults(resRes.results || []);
        } catch (err) {
          console.error('[크롤링 데이터 로드]', err);
        }
      }, []);

      // 크롤링 모드 진입 시 데이터 로드
      useEffect(() => {
        if (uploadMode === 'crawl') loadCrawlData();
      }, [uploadMode, loadCrawlData]);

      // 크롤링 실행 (네이버 뉴스 / 사이트 게시판)
      const handleCrawlExecute = useCallback(async () => {
        // 멀티 키워드에서 선택된 것들 추출
        const selectedKws = crawlKeywords.filter(k => crawlSelectedKeywordIds.has(k.id));
        if (selectedKws.length === 0) { setCrawlError('키워드를 1개 이상 선택하세요.'); return; }

        setCrawlExecuting(true);
        setCrawlError(null);
        try {
          let data;
          const kwTexts = selectedKws.map(k => k.keyword);
          const kwIds = selectedKws.map(k => k.id);

          if (crawlMode === 'naver') {
            const res = await authFetch(`${API_BASE_URL}/naver-news`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                keywords: kwTexts,
                keywordIds: kwIds,
                maxResults: crawlMaxResults,
                titleWeight: crawlTitleWeight,
                contentWeight: crawlContentWeight,
                recentDays: crawlRecentDays,
              }),
            });
            data = await res.json();
            if (!res.ok) throw new Error(data.error || '네이버 검색 실패');
          } else {
            if (!crawlSourceId) { setCrawlError('크롤링 소스를 선택하세요.'); setCrawlExecuting(false); return; }
            const res = await authFetch(`${API_BASE_URL}/crawl`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sourceId: parseInt(crawlSourceId),
                keywords: kwTexts,
                maxResults: crawlMaxResults,
                recentDays: crawlRecentDays,
                titleWeight: crawlTitleWeight,
                contentWeight: crawlContentWeight,
              }),
            });
            data = await res.json();
            if (!res.ok) throw new Error(data.error || '크롤링 실패');
          }
          // 결과 목록 새로고침
          await loadCrawlData();
        } catch (err) {
          setCrawlError(err.message);
        } finally {
          setCrawlExecuting(false);
        }
      }, [crawlMode, crawlSelectedKeywordIds, crawlSourceId, crawlKeywords, crawlMaxResults, crawlTitleWeight, crawlContentWeight, crawlRecentDays, loadCrawlData]);

      // 선택한 결과 지식화
      const handleCrawlIngest = useCallback(async () => {
        if (selectedCrawlIds.size === 0) return;
        setCrawlIngesting(true);
        setCrawlError(null);
        try {
          const res = await authFetch(`${API_BASE_URL}/crawl-ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resultIds: [...selectedCrawlIds], category: '크롤링' }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '지식화 실패');
          setSelectedCrawlIds(new Set());
          await loadCrawlData();
          if (onUploadComplete) onUploadComplete();
        } catch (err) {
          setCrawlError(err.message);
        } finally {
          setCrawlIngesting(false);
        }
      }, [selectedCrawlIds, loadCrawlData, onUploadComplete]);

      // 크롤링 결과 개별 삭제
      const handleDeleteCrawlResult = useCallback(async (id) => {
        if (!confirm('이 크롤링 결과를 삭제하시겠습니까?')) return;
        try {
          const res = await authFetch(`${API_BASE_URL}/crawl-ingest?id=${id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('삭제 실패');
          setCrawlResults(prev => prev.filter(r => r.id !== id));
          setSelectedCrawlIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        } catch (err) {
          setCrawlError(err.message);
        }
      }, []);

      // 크롤링 결과 전체 삭제 (미지식화만)
      const handleClearAllCrawlResults = useCallback(async () => {
        if (!confirm('미지식화된 모든 크롤링 결과를 삭제하시겠습니까?\n(이미 저장된 결과는 유지됩니다)')) return;
        try {
          const res = await authFetch(`${API_BASE_URL}/crawl-ingest?clearAll=true`, { method: 'DELETE' });
          if (!res.ok) throw new Error('전체 삭제 실패');
          setCrawlResults(prev => prev.filter(r => r.is_ingested));
          setSelectedCrawlIds(new Set());
        } catch (err) {
          setCrawlError(err.message);
        }
      }, []);

      // 선택한 결과 일괄 삭제
      const handleDeleteSelectedCrawl = useCallback(async () => {
        if (selectedCrawlIds.size === 0) return;
        if (!confirm(`선택한 ${selectedCrawlIds.size}건을 삭제하시겠습니까?`)) return;
        try {
          for (const id of selectedCrawlIds) {
            await authFetch(`${API_BASE_URL}/crawl-ingest?id=${id}`, { method: 'DELETE' });
          }
          setCrawlResults(prev => prev.filter(r => !selectedCrawlIds.has(r.id)));
          setSelectedCrawlIds(new Set());
        } catch (err) {
          setCrawlError(err.message);
        }
      }, [selectedCrawlIds]);

      // 소스 추가
      const handleAddSource = useCallback(async () => {
        if (!newSourceName.trim() || !newSourceUrl.trim()) return;
        try {
          await authFetch(`${API_BASE_URL}/crawl-sources`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newSourceName, boardUrl: newSourceUrl, baseUrl: new URL(newSourceUrl).origin, importance: newSourceImportance }),
          });
          setNewSourceName(''); setNewSourceUrl(''); setNewSourceImportance(1.0);
          await loadCrawlData();
        } catch (err) { setCrawlError(err.message); }
      }, [newSourceName, newSourceUrl, newSourceImportance, loadCrawlData]);

      // 키워드 추가
      const handleAddKeyword = useCallback(async () => {
        if (!newKeyword.trim()) return;
        try {
          await authFetch(`${API_BASE_URL}/crawl-keywords`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword: newKeyword, titleWeight: crawlTitleWeight, contentWeight: crawlContentWeight }),
          });
          setNewKeyword('');
          await loadCrawlData();
        } catch (err) { setCrawlError(err.message); }
      }, [newKeyword, crawlMaxResults, crawlTitleWeight, crawlContentWeight, loadCrawlData]);

      // 제외 패턴 추가
      const handleAddExclusion = useCallback(async () => {
        if (!newExclusion.trim()) return;
        try {
          await authFetch(`${API_BASE_URL}/crawl-sources?exclusion=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urlPattern: newExclusion }),
          });
          setNewExclusion('');
          await loadCrawlData();
        } catch (err) { setCrawlError(err.message); }
      }, [newExclusion, loadCrawlData]);

      // ── PDF 로더 목록 로드 (컴포넌트 마운트 시 1회) ──
      useEffect(() => {
        const token = getAuthToken();
        if (!token) return;
        fetch(`${API_BASE_URL}/pdf-loaders`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
          .then(r => r.json())
          .then(data => {
            if (data.loaders) setPdfLoaders(data.loaders);
          })
          .catch(() => {}); // 실패해도 기본값(pdf-parse) 사용
      }, []);

      // ── 파일 선택 핸들러 (모든 형식 지원) ──
      const handleFileSelect = useCallback((selectedFile) => {
        if (!selectedFile) return;
        const detected = detectClientFileType(selectedFile.name);
        if (detected === 'unknown') {
          setError('지원하지 않는 파일 형식입니다. (PDF, TXT, MD, DOCX, XLSX, CSV, JSON, 이미지)');
          return;
        }
        setFile(selectedFile);
        setFileType(detected);
        setError(null);
        setResult(null);
        setPreviewInfo(null);

        // 파일명에서 제목 자동 추출
        const baseName = selectedFile.name.replace(/\.[^.]+$/, '');
        setTitle(baseName);

        // 형식별 기본 옵션 설정
        const config = FILE_TYPE_CONFIG[detected];
        if (config?.sectionOptions?.length > 0) {
          setSectionType(config.sectionOptions[0].value);
        }

        // CSV/XLSX: 클라이언트에서 열 목록 미리 읽기
        if (detected === 'csv' || detected === 'xlsx') {
          readSpreadsheetPreview(selectedFile, detected);
        }
        // JSON: 필드 목록 미리 읽기
        if (detected === 'json') {
          readJsonPreview(selectedFile);
        }
      }, []);

      // CSV/XLSX 열 목록 미리보기
      const readSpreadsheetPreview = useCallback((f, type) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            if (type === 'csv') {
              // CSV: 첫 줄에서 열 이름 추출
              const text = e.target.result;
              const firstLine = text.split('\n')[0];
              const cols = firstLine.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
              setPreviewInfo({ type: 'columns', columns: cols, rowCount: text.split('\n').filter(l => l.trim()).length - 1 });
            } else {
              // XLSX: 첫 시트 열 이름 추출 (간단 파싱)
              // 클라이언트에서는 열 이름만 표시, 실제 파싱은 서버에서
              setPreviewInfo({ type: 'columns', columns: [], note: '서버에서 열 정보를 읽습니다.' });
            }
          } catch { /* 미리보기 실패해도 무시 */ }
        };
        if (type === 'csv') reader.readAsText(f);
        else reader.readAsArrayBuffer(f);
      }, []);

      // JSON 필드 미리보기
      const readJsonPreview = useCallback((f) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            if (Array.isArray(data) && data.length > 0) {
              const fields = Object.keys(data[0]);
              setPreviewInfo({ type: 'fields', fields, itemCount: data.length });
            } else if (typeof data === 'object') {
              setPreviewInfo({ type: 'fields', fields: Object.keys(data), itemCount: Object.keys(data).length });
            }
          } catch { /* 미리보기 실패해도 무시 */ }
        };
        reader.readAsText(f);
      }, []);

      const handleDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
      const handleDragLeave = useCallback((e) => { e.preventDefault(); setDragOver(false); }, []);
      const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragOver(false);
        handleFileSelect(e.dataTransfer.files[0]);
      }, [handleFileSelect]);

      // ── 업로드 실행 (XHR 실시간 진행률) ──
      const uploadProgress = useUploadProgress();

      // Vercel 서버리스 body 크기 제한
      const MAX_DIRECT_UPLOAD = 4.5 * 1024 * 1024; // 4.5MB

      const handleUpload = useCallback(async () => {
        if (!file) return;
        setUploading(true);
        setError(null);
        setResult(null);
        try {
          const token = getAuthToken();
          const isLargeFile = file.size > MAX_DIRECT_UPLOAD;

          let data;
          if (isLargeFile) {
            // ── 대용량: Supabase Storage 경유 ──
            const metadata = {
              title: title || file.name.replace(/\.[^.]+$/, ''),
              category,
              sectionType,
            };
            if (sectionType === 'custom' && customDelimiter) metadata.customDelimiter = customDelimiter;
            if (contentColumn) metadata.contentColumn = contentColumn;
            if (contentField) metadata.contentField = contentField;
            if (contentType) metadata.contentType = contentType;
            if (deidentify) metadata.deidentify = 'true';
            if (chunkStrategy && chunkStrategy !== 'sentence') metadata.chunkStrategy = chunkStrategy;
            if (pdfLoader && pdfLoader !== 'pdf-parse') metadata.pdfLoader = pdfLoader;
            if (chunkSize !== 500) metadata.chunkSize = chunkSize;
            if (chunkOverlap !== 100) metadata.chunkOverlap = chunkOverlap;

            data = await uploadProgress.uploadLarge(file, metadata, token);
          } else {
            // ── 일반: 기존 multipart 방식 ──
            const formData = new FormData();
            formData.append('file', file);
            formData.append('title', title || file.name.replace(/\.[^.]+$/, ''));
            formData.append('category', category);
            formData.append('sectionType', sectionType);
            if (sectionType === 'custom' && customDelimiter) formData.append('customDelimiter', customDelimiter);
            if (contentColumn) formData.append('contentColumn', contentColumn);
            if (contentField) formData.append('contentField', contentField);
            if (contentType) formData.append('contentType', contentType);
            if (deidentify) formData.append('deidentify', 'true');
            if (chunkStrategy && chunkStrategy !== 'sentence') formData.append('chunkStrategy', chunkStrategy);
            if (pdfLoader && pdfLoader !== 'pdf-parse') formData.append('pdfLoader', pdfLoader);
            if (chunkSize !== 500) formData.append('chunkSize', String(chunkSize));
            if (chunkOverlap !== 100) formData.append('chunkOverlap', String(chunkOverlap));
            data = await uploadProgress.upload(`${API_BASE_URL}/upload`, formData, token);
          }

          uploadProgress.finish('업로드 완료!');
          setResult(data);
          setTimeout(() => {
            setFile(null); setFileType(null); setTitle('');
            uploadProgress.reset();
            setPreviewInfo(null); setContentColumn(''); setContentField('');
            if (fileInputRef.current) fileInputRef.current.value = '';
            if (onUploadComplete) onUploadComplete();
          }, 2000);
        } catch (err) {
          setError(err.message);
          uploadProgress.reset();
        } finally {
          setUploading(false);
        }
      }, [file, title, category, sectionType, customDelimiter, contentColumn, contentField, contentType, deidentify, chunkStrategy, chunkSize, chunkOverlap, pdfLoader, onUploadComplete]);

      const handleReset = useCallback(() => {
        setFile(null); setFileType(null); setTitle(''); setCategory('기타');
        setSectionType('full'); setCustomDelimiter(''); setContentColumn('');
        setContentField(''); setContentType('general'); setPreviewInfo(null);
        setDeidentify(false); setChunkStrategy('sentence'); setChunkSize(500); setChunkOverlap(100);
        setSplitPreview(null); setError(null); setResult(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }, []);

      // ── 법령 검색 핸들러 ──
      const handleLawSearch = useCallback(async () => {
        if (!lawQuery.trim()) return;
        setLawSearching(true);
        setLawError(null);
        setLawResults([]);
        setLawResult(null);
        setLawImportedMap({});
        setLawVisibleCount(5);
        try {
          const res = await authFetch(`${API_BASE_URL}/law`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'search', query: lawQuery.trim(), target: lawTarget }),
          });
          if (!res.ok) throw new Error('법령 검색에 실패했습니다.');
          const data = await res.json();
          setLawResults(data.results || []);
          setLawImportedMap(data.importedMap || {});
          if ((data.results || []).length === 0) {
            setLawError('검색 결과가 없습니다. 다른 법령명으로 시도해보세요.');
          }
        } catch (err) {
          setLawError(err.message);
        } finally {
          setLawSearching(false);
        }
      }, [lawQuery, lawTarget]);

      // 법령 임포트 진행 단계 시뮬레이션
      const lawSteps = useMemo(() => [
        { message: '법제처 API 조회 중...', progress: 10, duration: 3000 },
        { message: '조문 데이터 수신 중...', progress: 25, duration: 4000 },
        { message: '조문 저장 중...', progress: 40, duration: 3000 },
        { message: '참조 관계 분석 중...', progress: 55, duration: 2000 },
        { message: '임베딩 생성 중...', progress: 65, duration: 5000 },
        { message: '임베딩 처리 중...', progress: 80, duration: 5000 },
      ], []);
      const lawImportProgress = useSimulatedProgress(lawSteps);

      const handleLawImport = useCallback(async (law) => {
        setImporting(law.id);
        lawImportProgress.start();
        setLawError(null);
        setLawResult(null);
        try {
          const res = await authFetch(`${API_BASE_URL}/law-import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lawId: law.id, lawName: law.name, target: lawTarget }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `임포트 실패 (${res.status})`);
          lawImportProgress.finish('임포트 완료!');
          setLawResult(data);
          setLawImportedMap(prev => ({
            ...prev,
            [String(law.id)]: { documentId: data.documentId, title: data.title, importedAt: new Date().toISOString() },
          }));
          if (onUploadComplete) onUploadComplete();
        } catch (err) {
          setLawError(err.message);
          lawImportProgress.reset();
        } finally {
          setTimeout(() => {
            lawImportProgress.reset();
            setImporting(null);
          }, 2000);
        }
      }, [onUploadComplete, lawTarget]);

      // ── URL 크롤링 핸들러 ──
      const handleUrlImport = useCallback(async () => {
        if (!urlInput.trim()) return;
        setUrlImporting(true);
        setUrlError(null);
        setUrlResult(null);
        try {
          const res = await authFetch(`${API_BASE_URL}/url-import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: urlInput.trim(),
              title: urlTitle.trim() || undefined,
              category: urlCategory,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `임포트 실패 (${res.status})`);
          setUrlResult(data);
          if (onUploadComplete) onUploadComplete();
        } catch (err) {
          setUrlError(err.message);
        } finally {
          setUrlImporting(false);
        }
      }, [urlInput, urlTitle, urlCategory, onUploadComplete]);

      // 현재 파일 형식의 설정
      const currentConfig = fileType ? FILE_TYPE_CONFIG[fileType] : null;

      return (
        <div className="space-y-3 sm:space-y-5 fade-in">
          <DisabledApiBanner providers={['openai', 'gemini', 'law-api']} featureName="문서 등록/분석" />
          {/* 모드 토글 — 3개 균등 배분 */}
          <div className="grid grid-cols-3 gap-2 bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setUploadMode('file')}
              className={`py-2.5 rounded-lg text-sm font-medium transition-all ${
                uploadMode === 'file' ? 'bg-card-bg text-primary shadow-sm' : 'text-text-secondary hover:text-text'
              }`}
            >파일 업로드</button>
            <button
              onClick={() => setUploadMode('law')}
              className={`py-2.5 rounded-lg text-sm font-medium transition-all ${
                uploadMode === 'law' ? 'bg-card-bg text-primary shadow-sm' : 'text-text-secondary hover:text-text'
              }`}
            >법령 검색</button>
            <button
              onClick={() => setUploadMode('crawl')}
              className={`py-2.5 rounded-lg text-sm font-medium transition-all ${
                uploadMode === 'crawl' ? 'bg-card-bg text-primary shadow-sm' : 'text-text-secondary hover:text-text'
              }`}
            >크롤링</button>
          </div>

          {/* ── 파일 업로드 모드 ── */}
          {uploadMode === 'file' && (
            <>
              {/* 파일 드롭존 (모든 형식 허용) */}
              <label
                className={`drop-zone block ${dragOver ? 'drag-over' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input ref={fileInputRef} type="file" accept={ALL_ACCEPTED} style={{position:'absolute',width:0,height:0,opacity:0,overflow:'hidden',pointerEvents:'none'}} onChange={e => { if(e.target.files[0]) handleFileSelect(e.target.files[0]); }} />
                {file && currentConfig ? (
                  <div className="space-y-2">
                    <div className="text-4xl">{currentConfig.icon}</div>
                    <p className="text-text font-medium">{file.name}</p>
                    <div className="flex items-center justify-center gap-2">
                      <Badge color={currentConfig.color}>{currentConfig.label}</Badge>
                      <span className="text-sm text-text-secondary">{formatFileSize(file.size)}</span>
                      {file.size > 4.5 * 1024 * 1024 && (
                        <Badge color="blue">Storage 경유</Badge>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <svg className="w-10 h-10 mx-auto text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    <p className="text-text-secondary">터치하여 파일 선택</p>
                    <p className="text-xs text-text-secondary/60">PDF, TXT, MD, DOCX, XLSX, CSV, JSON, HWP, 이미지</p>
                  </div>
                )}
              </label>

              {/* 파일 감지 후 옵션 표시 */}
              {file && currentConfig && (
                <Card>
                  <div className="space-y-4">
                    {/* 제목 */}
                    <Input label="제목" value={title} onChange={e => setTitle(e.target.value)} placeholder="문서 제목을 입력하세요" />

                    {/* 카테고리 */}
                    <Select label="카테고리" value={category} onChange={e => applyCategoryPreset(e.target.value)} options={catList} />

                    {/* 형식별 추출 단위 (옵션이 2개 이상일 때만 표시) */}
                    {currentConfig.sectionOptions.length > 1 && (
                      <Select
                        label="추출 단위"
                        value={sectionType}
                        onChange={e => setSectionType(e.target.value)}
                        options={currentConfig.sectionOptions}
                      />
                    )}

                    {/* 구분자 입력 (custom일 때) */}
                    {sectionType === 'custom' && (
                      <Input label="구분자" value={customDelimiter} onChange={e => setCustomDelimiter(e.target.value)} placeholder="예: --- 또는 ## 등" />
                    )}

                    {/* PDF: 추출 엔진 선택 */}
                    {fileType === 'pdf' && pdfLoaders.length > 0 && (
                      <div className="space-y-2">
                        <Select
                          label="PDF 추출 엔진"
                          value={pdfLoader}
                          onChange={e => setPdfLoader(e.target.value)}
                          options={pdfLoaders.map(l => ({
                            value: l.id,
                            label: `${l.name}${!l.is_available ? ' (사용 불가)' : l.free ? '' : ' (유료)'}`,
                            disabled: !l.is_available,
                          }))}
                        />
                        {(() => {
                          const selected = pdfLoaders.find(l => l.id === pdfLoader);
                          return selected ? (
                            <div className="flex flex-wrap gap-1.5 items-center">
                              <span className="text-xs text-text-secondary">{selected.description}</span>
                              {selected.bestFor?.map(tag => (
                                <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full">{tag}</span>
                              ))}
                              {selected.type === 'python' && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded-full">Python</span>
                              )}
                              {selected.type === 'api' && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full">API</span>
                              )}
                            </div>
                          ) : null;
                        })()}
                      </div>
                    )}

                    {/* CSV/XLSX: 열 선택 */}
                    {currentConfig.hasColumnSelect && previewInfo?.columns?.length > 0 && (
                      <div className="space-y-2">
                        <Select
                          label={`본문 열 선택 (${previewInfo.rowCount || '?'}행)`}
                          value={contentColumn}
                          onChange={e => setContentColumn(e.target.value)}
                          options={[
                            { value: '', label: '전체 열 합치기' },
                            ...previewInfo.columns.map(c => ({ value: c, label: c })),
                          ]}
                        />
                        <p className="text-xs text-text-secondary">
                          본문으로 사용할 열을 선택하세요. 선택하지 않으면 모든 열을 합칩니다.
                        </p>
                      </div>
                    )}

                    {/* JSON: 필드 선택 */}
                    {currentConfig.hasFieldSelect && previewInfo?.fields?.length > 0 && (
                      <div className="space-y-2">
                        <Select
                          label={`본문 필드 선택 (${previewInfo.itemCount || '?'}개 항목)`}
                          value={contentField}
                          onChange={e => setContentField(e.target.value)}
                          options={[
                            { value: '', label: '전체 데이터' },
                            ...previewInfo.fields.map(f => ({ value: f, label: f })),
                          ]}
                        />
                        <p className="text-xs text-text-secondary">
                          본문으로 사용할 필드를 선택하세요.
                        </p>
                      </div>
                    )}

                    {/* 이미지: 콘텐츠 유형 선택 */}
                    {currentConfig.hasContentType && (
                      <Select
                        label="이미지 내용 유형"
                        value={contentType}
                        onChange={e => setContentType(e.target.value)}
                        options={[
                          { value: 'general', label: '일반 텍스트' },
                          { value: 'table', label: '표/테이블' },
                          { value: 'quiz', label: '시험 문제' },
                        ]}
                      />
                    )}
                  </div>
                </Card>
              )}

              {/* 청크 분할 전략 + 파라미터 설정 */}
              {file && (
                <Card>
                  <div className="space-y-3">
                    <Select
                      label="청크 분할 전략"
                      value={chunkStrategy}
                      onChange={e => setChunkStrategy(e.target.value)}
                      options={[
                        { value: 'sentence', label: '문장 단위 — 마침표 기준 분할 (기본)' },
                        { value: 'recursive', label: '재귀적 분할 — 문단→줄→문장 계층 분할 (범용)' },
                        { value: 'law-article', label: '법령 조문 — 제N조/항/호 단위 (법령용)' },
                        { value: 'markdown', label: 'Markdown 헤딩 — #/##/### 계층 분할 (MD용)' },
                        { value: 'semantic', label: '의미 분할 (임베딩) — 코사인 유사도 기반 (가장 정확)' },
                        { value: 'semantic-llm', label: 'AI 의미 분할 — LLM이 직접 판단 (비용 높음)' },
                        { value: 'parent-doc', label: 'Parent Document — 작은 청크 검색 + 부모 반환 (추천)' },
                      ]}
                    />
                    <div className="text-xs text-text-secondary">
                      {chunkStrategy === 'sentence' && '마침표·느낌표·물음표를 기준으로 문장을 묶어 분할합니다.'}
                      {chunkStrategy === 'recursive' && '문단 → 줄바꿈 → 문장 → 단어 순서로 계층적으로 분할합니다. 일반 문서에 가장 적합합니다.'}
                      {chunkStrategy === 'law-article' && '제N조, 제N조의N 패턴을 감지하여 조문 단위로 분할합니다. 법령/규정 문서에 최적화되어 있습니다.'}
                      {chunkStrategy === 'markdown' && '#, ##, ### 헤딩 계층을 파싱하여 분할합니다. 각 청크에 상위 헤딩 컨텍스트가 포함됩니다.'}
                      {chunkStrategy === 'semantic' && '문장별 임베딩 벡터를 생성하고, 인접 문장 간 코사인 유사도가 급격히 떨어지는 지점에서 분할합니다. 가장 정확한 의미 분할입니다.'}
                      {chunkStrategy === 'semantic-llm' && 'AI(Gemini Flash)가 텍스트의 주제 변화를 감지하여 의미 단위로 분할합니다. 처리 시간이 길고 API 비용이 발생합니다.'}
                      {chunkStrategy === 'parent-doc' && '200자 작은 청크로 정밀 검색하고, 결과는 800자 부모 청크로 반환합니다. 검색 정확도 + 충분한 컨텍스트를 동시에 확보합니다.'}
                    </div>

                    {/* 청크 크기 슬라이더 */}
                    <div>
                      <label className="block text-xs font-medium text-text-primary mb-1">
                        청크 크기: <span className="text-primary font-bold">{chunkSize}자</span>
                      </label>
                      <input type="range" min="200" max="2000" step="50" value={chunkSize}
                        onChange={e => setChunkSize(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-border rounded-full appearance-none cursor-pointer accent-primary" />
                      <div className="flex justify-between text-[10px] text-text-secondary mt-0.5">
                        <span>200</span><span>500</span><span>1000</span><span>2000</span>
                      </div>
                    </div>

                    {/* 겹침 크기 슬라이더 */}
                    <div>
                      <label className="block text-xs font-medium text-text-primary mb-1">
                        겹침(overlap): <span className="text-primary font-bold">{chunkOverlap}자</span>
                      </label>
                      <input type="range" min="0" max="500" step="25" value={chunkOverlap}
                        onChange={e => setChunkOverlap(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-border rounded-full appearance-none cursor-pointer accent-primary" />
                      <div className="flex justify-between text-[10px] text-text-secondary mt-0.5">
                        <span>0</span><span>100</span><span>250</span><span>500</span>
                      </div>
                    </div>

                    {/* 분할 미리보기 버튼 + 결과 */}
                    <div className="pt-1 border-t border-border">
                      <button
                        onClick={async () => {
                          if (!file) return;
                          setPreviewLoading(true);
                          setSplitPreview(null);
                          try {
                            const text = await file.text();
                            const res = await authFetch(`${API_BASE_URL}/split-preview`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                text: text.slice(0, 5000),
                                strategy: chunkStrategy,
                                chunkSize,
                                overlap: chunkOverlap,
                              }),
                            });
                            const data = await res.json();
                            setSplitPreview(data);
                          } catch (err) {
                            console.error('[미리보기]', err);
                          } finally {
                            setPreviewLoading(false);
                          }
                        }}
                        disabled={previewLoading}
                        className="text-xs px-3 py-1.5 rounded-full bg-border hover:bg-primary hover:text-white text-text-secondary transition-colors"
                      >
                        {previewLoading ? '분석 중...' : '&#128065; 분할 미리보기'}
                      </button>

                      {splitPreview && (
                        <div className="mt-2 space-y-2">
                          <div className="flex gap-3 text-xs">
                            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                              {splitPreview.totalChunks}개 청크
                            </span>
                            {splitPreview.distribution && (
                              <>
                                <span className="text-text-secondary">
                                  평균 {splitPreview.distribution.avg}자
                                </span>
                                <span className="text-text-secondary">
                                  {splitPreview.distribution.min}~{splitPreview.distribution.max}자
                                </span>
                              </>
                            )}
                          </div>
                          {splitPreview.preview?.map((p, i) => (
                            <div key={i} className="text-[11px] bg-bg p-2 rounded border border-border">
                              <span className="text-primary font-medium">#{p.index + 1}</span>
                              <span className="text-text-secondary ml-1">({p.length}자)</span>
                              <p className="text-text mt-1 whitespace-pre-wrap break-all">{p.text}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              )}

              {/* 비식별화 토글 */}
              {file && (
                <Card className="border-border">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="text-sm font-medium text-text-primary">비식별화 처리</p>
                      <p className="text-xs text-text-secondary">등록된 키워드를 마스킹(***) 처리 후 저장합니다</p>
                    </div>
                    <div className={`relative w-11 h-6 rounded-full transition-colors ${deidentify ? 'bg-primary' : 'bg-gray-300'}`}
                      onClick={() => setDeidentify(d => !d)}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${deidentify ? 'translate-x-5' : ''}`} />
                    </div>
                  </label>
                </Card>
              )}

              {uploadProgress.progress > 0 && (
                <div className="space-y-2">
                  <ProgressBar value={uploadProgress.progress} />
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-text-secondary">{uploadProgress.message}</p>
                    <span className="text-xs text-primary font-medium">{Math.round(uploadProgress.progress)}%</span>
                  </div>
                </div>
              )}

              {error && (
                <Card className="border-red-200 bg-red-50">
                  <p className="text-sm text-red-500">{error}</p>
                </Card>
              )}

              {result && (
                <Card className="border-green-200 bg-green-50">
                  <div className="space-y-2">
                    <p className="text-sm text-green-600 font-medium">업로드 완료!</p>
                    <p className="text-xs text-text-secondary">
                      "{result.title}" - {result.sectionCount || 0}개 섹션 추출됨
                      {result.fileType && ` (${FILE_TYPE_CONFIG[result.fileType]?.label || result.fileType})`}
                    </p>
                    {result.deidentify && (
                      <div className="flex items-center gap-2 pt-1 border-t border-green-200">
                        <span className="text-xs font-medium text-green-700">비식별화 결과:</span>
                        {result.deidentify.totalReplaced > 0 ? (
                          <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full font-medium">
                            {result.deidentify.totalReplaced}건 키워드 치환 완료
                          </span>
                        ) : (
                          <span className="text-xs text-text-secondary">일치하는 키워드 없음 (0건)</span>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              )}

              <div className="flex gap-3">
                <Button variant="primary" size="lg" className="flex-1" disabled={!file || uploading} onClick={handleUpload}>
                  {uploading ? '업로드 중...' : '업로드'}
                </Button>
                <Button variant="ghost" size="lg" onClick={handleReset} disabled={uploading}>초기화</Button>
              </div>
            </>
          )}

          {/* ── 법령 검색 모드 ── */}
          {uploadMode === 'law' && (
            <>
              {/* 검색 입력 */}
              <Card>
                <div className="space-y-3">
                  {/* 검색 대상 선택 */}
                  <div className="flex gap-1 bg-bg border border-border rounded-lg p-0.5">
                    {[
                      { value: 'law', label: '법령', desc: '법률·시행령·시행규칙' },
                      { value: 'admrul', label: '행정규칙', desc: '고시·훈령·예규·지침' },
                      { value: 'ordin', label: '자치법규', desc: '조례·규칙' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setLawTarget(opt.value)}
                        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          lawTarget === opt.value
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-text-secondary hover:text-text'
                        }`}
                        title={opt.desc}
                      >{opt.label}</button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={lawQuery}
                      onChange={e => setLawQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleLawSearch()}
                      placeholder={
                        lawTarget === 'law' ? '법령명을 입력하세요 (예: 개인정보보호법)' :
                        lawTarget === 'admrul' ? '행정규칙명을 입력하세요 (예: 개인영상정보 보호)' :
                        '자치법규명을 입력하세요 (예: 개인정보 보호 조례)'
                      }
                      className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-text placeholder-text-secondary/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                    />
                    <Button onClick={handleLawSearch} disabled={lawSearching || !lawQuery.trim()}>
                      {lawSearching ? '검색 중...' : '검색'}
                    </Button>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {lawTarget === 'law' && '법제처 국가법령정보에서 법률·대통령령·시행규칙을 검색합니다.'}
                    {lawTarget === 'admrul' && '고시·훈령·예규·지침 등 행정규칙을 검색합니다.'}
                    {lawTarget === 'ordin' && '지방자치단체의 조례·규칙을 검색합니다.'}
                  </p>
                </div>
              </Card>

              {/* 에러 메시지 */}
              {lawError && (
                <Card className="border-red-200 bg-red-50">
                  <p className="text-sm text-red-500">{lawError}</p>
                </Card>
              )}

              {/* 임포트 완료 결과 */}
              {lawResult && (
                <Card className="border-green-200 bg-green-50">
                  <div className="space-y-1">
                    <p className="text-sm text-green-600 font-medium">법령 임포트 완료!</p>
                    <p className="text-xs text-text-secondary">
                      "{lawResult.title}" - {lawResult.articleCount}개 조문 저장됨
                    </p>
                  </div>
                </Card>
              )}

              {/* 검색 결과 목록 */}
              {lawResults.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-text-secondary">{lawResults.length}건의 법령을 찾았습니다.</p>
                  {lawResults.slice(0, lawVisibleCount).map(law => {
                    const imported = lawImportedMap[String(law.id)];
                    return (
                      <Card key={law.id} className={imported ? 'border-green-200 bg-green-50/30' : ''}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-text">{law.name}</h3>
                            {law.shortName && <p className="text-xs text-text-secondary mt-0.5">({law.shortName})</p>}
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <Badge color="primary">{law.ministry || '소관부처 미상'}</Badge>
                              {law.lawType && <Badge color="purple">{law.lawType}</Badge>}
                              {law.enforcementDate && (
                                <span className="text-xs text-text-secondary">시행 {law.enforcementDate}</span>
                              )}
                            </div>
                            {/* 이미 임포트된 법령 안내 */}
                            {imported && (
                              <div className="mt-2 flex items-center gap-1.5">
                                <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                <span className="text-xs text-green-600">
                                  이미 등록됨 (문서 #{imported.documentId})
                                </span>
                              </div>
                            )}
                          </div>
                          {imported ? (
                            <span className="text-xs text-green-600 font-medium whitespace-nowrap px-3 py-1.5 bg-green-100 rounded-lg">
                              등록완료
                            </span>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={importing !== null}
                              onClick={() => handleLawImport(law)}
                            >
                              {importing === law.id ? '임포트 중...' : '임포트'}
                            </Button>
                          )}
                        </div>
                        {/* 임포트 진행률 — 해당 카드 바로 아래에 표시 */}
                        {importing === law.id && lawImportProgress.progress > 0 && (
                          <div className="mt-3 pt-3 border-t border-border space-y-2">
                            <ProgressBar value={lawImportProgress.progress} />
                            <div className="flex justify-between items-center">
                              <p className="text-xs text-text-secondary">{lawImportProgress.message}</p>
                              <span className="text-xs text-primary font-medium">{Math.round(lawImportProgress.progress)}%</span>
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                  {/* 더보기 버튼 */}
                  {lawResults.length > lawVisibleCount && (
                    <button
                      onClick={() => setLawVisibleCount(prev => prev + 5)}
                      className="w-full py-2.5 text-sm text-primary hover:text-primary-hover font-medium border border-border rounded-lg hover:bg-primary/5 transition-colors"
                    >
                      더보기 ({lawResults.length - lawVisibleCount}건 남음)
                    </button>
                  )}
                </div>
              )}

              {/* 로딩 */}
              {lawSearching && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </>
          )}

          {/* ── URL 크롤링 모드 ── */}
          {/* ── 크롤링 수집 모드 ── */}
          {uploadMode === 'crawl' && (
            <>
              {/* 서브탭 */}
              <div className="flex gap-1 bg-bg border border-border rounded-lg p-0.5">
                {[
                  { id: 'execute', label: '실행' },
                  { id: 'sources', label: '소스 관리' },
                  { id: 'keywords', label: '키워드' },
                  { id: 'exclusions', label: '제외 패턴' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setCrawlSubTab(tab.id)}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      crawlSubTab === tab.id ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text'
                    }`}
                  >{tab.label}</button>
                ))}
              </div>

              {crawlError && (
                <Card className="border-red-200 bg-red-50">
                  <p className="text-sm text-red-500">{crawlError}</p>
                </Card>
              )}

              {/* ── 실행 탭 ── */}
              {crawlSubTab === 'execute' && (
                <>
                  <Card>
                    <div className="space-y-4">
                      {/* 수집 방식 선택 */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setCrawlMode('naver')}
                          className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                            crawlMode === 'naver' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:text-text'
                          }`}
                        >네이버 뉴스</button>
                        <button
                          onClick={() => setCrawlMode('board')}
                          className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                            crawlMode === 'board' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-secondary hover:text-text'
                          }`}
                        >사이트 게시판</button>
                      </div>

                      {/* 사이트 소스 선택 (게시판 모드) */}
                      {crawlMode === 'board' && (
                        <Select
                          label="크롤링 소스"
                          value={crawlSourceId}
                          onChange={e => setCrawlSourceId(e.target.value)}
                          options={[
                            { value: '', label: '소스를 선택하세요' },
                            ...crawlSources.filter(s => s.is_active).map(s => ({ value: String(s.id), label: s.name })),
                          ]}
                        />
                      )}

                      {/* 키워드 멀티 선택 */}
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1.5">검색 키워드 (복수 선택)</label>
                        <div className="space-y-1 max-h-40 overflow-y-auto p-2 bg-bg border border-border rounded-lg">
                          {crawlKeywords.filter(k => k.is_active).length === 0 && (
                            <p className="text-xs text-text-secondary py-2 text-center">활성 키워드가 없습니다. 키워드 탭에서 추가하세요.</p>
                          )}
                          {crawlKeywords.filter(k => k.is_active).map(kw => (
                            <label key={kw.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-card-bg cursor-pointer">
                              <input type="checkbox"
                                checked={crawlSelectedKeywordIds.has(kw.id)}
                                onChange={() => setCrawlSelectedKeywordIds(prev => {
                                  const next = new Set(prev);
                                  next.has(kw.id) ? next.delete(kw.id) : next.add(kw.id);
                                  return next;
                                })}
                                className="accent-primary" />
                              <span className="text-sm text-text">{kw.keyword}</span>
                              <span className="text-[10px] text-text-secondary ml-auto">
                                제목 x{parseFloat(kw.title_weight)} | 내용 x{parseFloat(kw.content_weight)}
                              </span>
                            </label>
                          ))}
                        </div>
                        {crawlSelectedKeywordIds.size > 0 && (
                          <p className="text-xs text-primary mt-1">{crawlSelectedKeywordIds.size}개 키워드 선택됨</p>
                        )}
                      </div>

                      {/* 설정 옵션 */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">최근 일수</label>
                          <input type="number" min="1" max="90" value={crawlRecentDays} onChange={e => setCrawlRecentDays(parseInt(e.target.value) || 7)}
                            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">최대 건수 (스코어 상위)</label>
                          <input type="number" min="1" max="100" value={crawlMaxResults} onChange={e => setCrawlMaxResults(parseInt(e.target.value) || 20)}
                            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary" />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">제목 가중치</label>
                          <input type="number" min="0" step="0.5" value={crawlTitleWeight} onChange={e => setCrawlTitleWeight(parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">내용 가중치</label>
                          <input type="number" min="0" step="0.5" value={crawlContentWeight} onChange={e => setCrawlContentWeight(parseFloat(e.target.value) || 0)}
                            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary" />
                        </div>
                      </div>

                      <p className="text-xs text-text-secondary">
                        {crawlMode === 'naver'
                          ? '선택된 키워드별 네이버 뉴스 검색 후 점수 합산 → 상위 N건 저장'
                          : '사이트 중요도 + 키워드 점수 합산 → 상위 N건 저장'}
                      </p>
                    </div>
                  </Card>

                  <Button variant="primary" size="lg" className="w-full" disabled={crawlExecuting || crawlSelectedKeywordIds.size === 0}
                    onClick={handleCrawlExecute}>
                    {crawlExecuting ? '수집 중...' : '크롤링 실행'}
                  </Button>

                  {/* 수집 결과 미리보기 */}
                  {crawlResults.length > 0 && (() => {
                    const naverResults = crawlResults.filter(r => r.source_type === 'naver_news');
                    const boardResults = crawlResults.filter(r => r.source_type !== 'naver_news');
                    const filteredResults = crawlResultFilter === 'naver' ? naverResults
                      : crawlResultFilter === 'board' ? boardResults : crawlResults;
                    const selectableResults = filteredResults.filter(r => !r.is_ingested);

                    return (
                    <div className="space-y-3">
                      {/* 결과 필터 탭 + 액션 버튼 */}
                      <div className="flex items-center justify-between">
                        <div className="flex gap-1 bg-bg border border-border rounded-lg p-0.5">
                          {[
                            { id: 'all', label: `전체 (${crawlResults.length})` },
                            { id: 'naver', label: `뉴스 (${naverResults.length})` },
                            { id: 'board', label: `게시판 (${boardResults.length})` },
                          ].map(tab => (
                            <button key={tab.id} onClick={() => { setCrawlResultFilter(tab.id); setCrawlVisibleCount(10); }}
                              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                                crawlResultFilter === tab.id ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text'
                              }`}
                            >{tab.label}</button>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => {
                            const allIds = new Set(selectableResults.map(r => r.id));
                            setSelectedCrawlIds(prev => prev.size === allIds.size ? new Set() : allIds);
                          }} className="text-[11px] text-primary hover:underline">
                            {selectedCrawlIds.size > 0 ? '선택 해제' : '전체 선택'}
                          </button>
                        </div>
                      </div>

                      {/* 선택 시 액션 바 */}
                      {selectedCrawlIds.size > 0 && (
                        <div className="flex items-center gap-2 p-2 bg-primary/5 border border-primary/20 rounded-lg">
                          <span className="text-xs text-primary font-medium">{selectedCrawlIds.size}건 선택</span>
                          <div className="flex-1" />
                          <button onClick={handleCrawlIngest} disabled={crawlIngesting}
                            className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50">
                            {crawlIngesting ? '처리 중...' : '지식화'}
                          </button>
                          <button onClick={handleDeleteSelectedCrawl}
                            className="text-xs bg-red-500 text-white px-3 py-1.5 rounded-lg hover:bg-red-600">
                            삭제
                          </button>
                        </div>
                      )}

                      {/* 전체 삭제 버튼 */}
                      {selectableResults.length > 0 && selectedCrawlIds.size === 0 && (
                        <div className="flex justify-end">
                          <button onClick={handleClearAllCrawlResults}
                            className="text-[11px] text-red-400 hover:text-red-600 transition-colors">
                            미지식화 결과 전체 삭제
                          </button>
                        </div>
                      )}

                      <div className="space-y-2">
                        {filteredResults.length === 0 && (
                          <p className="text-sm text-text-secondary text-center py-4">
                            {crawlResultFilter === 'naver' ? '네이버 뉴스 결과가 없습니다.' :
                             crawlResultFilter === 'board' ? '사이트 게시판 결과가 없습니다.' : '수집 결과가 없습니다.'}
                          </p>
                        )}
                        {filteredResults.slice(0, crawlVisibleCount).map(item => (
                          <div key={item.id} className={`p-3 rounded-lg border transition-colors ${
                            item.is_ingested ? 'border-green-200 bg-green-50/30 opacity-60' :
                            selectedCrawlIds.has(item.id) ? 'border-primary bg-primary/5' : 'border-border bg-card-bg'
                          }`}>
                            <div className="flex items-start gap-2">
                              {!item.is_ingested && (
                                <input type="checkbox" checked={selectedCrawlIds.has(item.id)}
                                  onChange={() => setSelectedCrawlIds(prev => {
                                    const next = new Set(prev);
                                    next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                                    return next;
                                  })}
                                  className="mt-1 accent-primary" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                    item.source_type === 'naver_news' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                  }`}>
                                    {item.source_type === 'naver_news' ? '뉴스' : item.source_name || '게시판'}
                                  </span>
                                  <span className="text-[10px] text-text-secondary font-mono">
                                    점수: {parseFloat(item.relevance_score || 0).toFixed(1)}
                                  </span>
                                  {item.is_ingested && <span className="text-[10px] text-green-600 font-medium">저장됨</span>}
                                </div>
                                <a href={item.url} target="_blank" rel="noopener noreferrer"
                                  className="text-sm font-medium text-text hover:text-primary line-clamp-2">{item.title}</a>
                                {item.snippet && <p className="text-xs text-text-secondary mt-1 line-clamp-2">{item.snippet}</p>}
                                <div className="flex items-center gap-3 mt-1">
                                  {item.published_at && (
                                    <span className="text-[10px] text-text-secondary">
                                      {new Date(item.published_at).toLocaleDateString('ko-KR')}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-text-secondary">
                                    제목:{parseFloat(item.title_score || 0).toFixed(1)} / 내용:{parseFloat(item.content_score || 0).toFixed(1)}
                                  </span>
                                </div>
                              </div>
                              {/* 개별 삭제 버튼 */}
                              {!item.is_ingested && (
                                <button onClick={() => handleDeleteCrawlResult(item.id)}
                                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-text-secondary hover:text-red-500 hover:bg-red-50 transition-colors"
                                  title="삭제">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        {/* 더보기 버튼 */}
                        {filteredResults.length > crawlVisibleCount && (
                          <button
                            onClick={() => setCrawlVisibleCount(prev => prev + 10)}
                            className="w-full py-2.5 text-sm font-medium text-primary bg-primary/5 border border-primary/20 rounded-lg hover:bg-primary/10 transition-colors"
                          >
                            더보기 ({filteredResults.length - crawlVisibleCount}건 남음)
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })()}
                </>
              )}

              {/* ── 소스 관리 탭 ── */}
              {crawlSubTab === 'sources' && (
                <>
                  <Card>
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-text">새 소스 추가</p>
                      <Input label="사이트 이름" value={newSourceName} onChange={e => setNewSourceName(e.target.value)} placeholder="예: KISA" />
                      <Input label="게시판 URL" value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)} placeholder="https://www.kisa.or.kr/401" />
                      <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">사이트 중요도 (기본 1.0, 높을수록 점수에 곱셈)</label>
                        <input type="number" min="0.1" max="10" step="0.1" value={newSourceImportance}
                          onChange={e => setNewSourceImportance(parseFloat(e.target.value) || 1.0)}
                          className="w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary" />
                      </div>
                      <Button variant="primary" size="sm" onClick={handleAddSource} disabled={!newSourceName.trim() || !newSourceUrl.trim()}>추가</Button>
                    </div>
                  </Card>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-text">등록된 소스 ({crawlSources.length})</p>
                    {crawlSources.map(src => (
                      <Card key={src.id}>
                        {editingSourceId === src.id ? (
                          <div className="space-y-2">
                            <Input label="사이트 이름" value={editSourceName} onChange={e => setEditSourceName(e.target.value)} />
                            <Input label="게시판 URL" value={editSourceUrl} onChange={e => setEditSourceUrl(e.target.value)} />
                            <div>
                              <label className="block text-xs font-medium text-text-secondary mb-1">사이트 중요도 (기본 1.0, 높을수록 점수에 곱셈)</label>
                              <input type="number" min="0.1" max="10" step="0.1" value={editSourceImportance}
                                onChange={e => setEditSourceImportance(parseFloat(e.target.value) || 1.0)}
                                className="w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary" />
                            </div>
                            <div className="flex gap-2">
                              <Button variant="primary" size="sm" onClick={async () => {
                                await authFetch(`${API_BASE_URL}/crawl-sources?id=${src.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ name: editSourceName, boardUrl: editSourceUrl, importance: editSourceImportance }),
                                });
                                setEditingSourceId(null);
                                await loadCrawlData();
                              }}>저장</Button>
                              <Button variant="ghost" size="sm" onClick={() => setEditingSourceId(null)}>취소</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                              setEditingSourceId(src.id);
                              setEditSourceName(src.name);
                              setEditSourceUrl(src.board_url);
                              setEditSourceImportance(parseFloat(src.importance) || 1.0);
                            }} title="클릭하여 편집">
                              <p className="text-sm font-medium text-text">{src.name}</p>
                              <p className="text-xs text-text-secondary truncate">{src.board_url}</p>
                              <p className="text-[10px] text-text-secondary">중요도: {parseFloat(src.importance || 1.0).toFixed(1)}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={async () => {
                                await authFetch(`${API_BASE_URL}/crawl-sources?id=${src.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ isActive: !src.is_active }),
                                });
                                await loadCrawlData();
                              }} className={`text-xs px-2 py-1 rounded ${src.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {src.is_active ? '활성' : '비활성'}
                              </button>
                              <button onClick={() => {
                                setEditingSourceId(src.id);
                                setEditSourceName(src.name);
                                setEditSourceUrl(src.board_url);
                                setEditSourceImportance(parseFloat(src.importance) || 1.0);
                              }} className="text-xs text-blue-500 hover:text-blue-700">수정</button>
                              <button onClick={async () => {
                                if (!confirm('이 소스를 삭제하시겠습니까?')) return;
                                await authFetch(`${API_BASE_URL}/crawl-sources?id=${src.id}`, { method: 'DELETE' });
                                await loadCrawlData();
                              }} className="text-xs text-red-500 hover:text-red-700">삭제</button>
                            </div>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </>
              )}

              {/* ── 키워드 관리 탭 ── */}
              {crawlSubTab === 'keywords' && (
                <>
                  <Card>
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-text">새 키워드 추가</p>
                      <Input label="키워드" value={newKeyword} onChange={e => setNewKeyword(e.target.value)} placeholder="예: 개인정보보호" />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">제목 가중치</label>
                          <input type="number" min="0" step="0.5" value={crawlTitleWeight} onChange={e => setCrawlTitleWeight(parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">내용 가중치</label>
                          <input type="number" min="0" step="0.5" value={crawlContentWeight} onChange={e => setCrawlContentWeight(parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary" />
                        </div>
                      </div>
                      <Button variant="primary" size="sm" onClick={handleAddKeyword} disabled={!newKeyword.trim()}>추가</Button>
                    </div>
                  </Card>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-text">등록된 키워드 ({crawlKeywords.length})</p>
                    {crawlKeywords.map(kw => (
                      <Card key={kw.id}>
                        {editingKeywordId === kw.id ? (
                          <div className="space-y-2">
                            <Input label="키워드" value={editKeywordText} onChange={e => setEditKeywordText(e.target.value)} />
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs font-medium text-text-secondary mb-1">제목 가중치</label>
                                <input type="number" min="0" step="0.5" value={editKeywordTitleWeight} onChange={e => setEditKeywordTitleWeight(parseFloat(e.target.value) || 0)}
                                  className="w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-text-secondary mb-1">내용 가중치</label>
                                <input type="number" min="0" step="0.5" value={editKeywordContentWeight} onChange={e => setEditKeywordContentWeight(parseFloat(e.target.value) || 0)}
                                  className="w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary" />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="primary" size="sm" onClick={async () => {
                                await authFetch(`${API_BASE_URL}/crawl-keywords?id=${kw.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    keyword: editKeywordText,
                                    titleWeight: editKeywordTitleWeight,
                                    contentWeight: editKeywordContentWeight,
                                  }),
                                });
                                setEditingKeywordId(null);
                                await loadCrawlData();
                              }}>저장</Button>
                              <Button variant="ghost" size="sm" onClick={() => setEditingKeywordId(null)}>취소</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex-1 cursor-pointer" onClick={() => {
                              setEditingKeywordId(kw.id);
                              setEditKeywordText(kw.keyword);
                              setEditKeywordTitleWeight(parseFloat(kw.title_weight));
                              setEditKeywordContentWeight(parseFloat(kw.content_weight));
                            }} title="클릭하여 편집">
                              <p className="text-sm font-medium text-text">{kw.keyword}</p>
                              <p className="text-xs text-text-secondary">
                                제목 x{parseFloat(kw.title_weight)} | 내용 x{parseFloat(kw.content_weight)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={async () => {
                                await authFetch(`${API_BASE_URL}/crawl-keywords?id=${kw.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ isActive: !kw.is_active }),
                                });
                                await loadCrawlData();
                              }} className={`text-xs px-2 py-1 rounded ${kw.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {kw.is_active ? '활성' : '비활성'}
                              </button>
                              <button onClick={() => {
                                setEditingKeywordId(kw.id);
                                setEditKeywordText(kw.keyword);
                                setEditKeywordTitleWeight(parseFloat(kw.title_weight));
                                setEditKeywordContentWeight(parseFloat(kw.content_weight));
                              }} className="text-xs text-blue-500 hover:text-blue-700">수정</button>
                              <button onClick={async () => {
                                if (!confirm('이 키워드를 삭제하시겠습니까?')) return;
                                await authFetch(`${API_BASE_URL}/crawl-keywords?id=${kw.id}`, { method: 'DELETE' });
                                await loadCrawlData();
                              }} className="text-xs text-red-500 hover:text-red-700">삭제</button>
                            </div>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </>
              )}

              {/* ── 제외 패턴 탭 ── */}
              {crawlSubTab === 'exclusions' && (
                <>
                  <Card>
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-text">제외 URL 패턴 추가</p>
                      <Input label="URL 패턴" value={newExclusion} onChange={e => setNewExclusion(e.target.value)} placeholder="예: blog.example.com" />
                      <p className="text-xs text-text-secondary">이 패턴이 포함된 URL은 크롤링 결과에서 제외됩니다.</p>
                      <Button variant="primary" size="sm" onClick={handleAddExclusion} disabled={!newExclusion.trim()}>추가</Button>
                    </div>
                  </Card>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-text">등록된 제외 패턴 ({crawlExclusions.length})</p>
                    {crawlExclusions.map(ex => (
                      <Card key={ex.id}>
                        {editingExclusionId === ex.id ? (
                          <div className="space-y-2">
                            <Input label="URL 패턴" value={editExclusionPattern} onChange={e => setEditExclusionPattern(e.target.value)} />
                            <Input label="사유 (선택)" value={editExclusionReason} onChange={e => setEditExclusionReason(e.target.value)} placeholder="제외 사유" />
                            <div className="flex gap-2">
                              <Button variant="primary" size="sm" onClick={async () => {
                                await authFetch(`${API_BASE_URL}/crawl-sources?exclusionId=${ex.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ urlPattern: editExclusionPattern, reason: editExclusionReason }),
                                });
                                setEditingExclusionId(null);
                                await loadCrawlData();
                              }}>저장</Button>
                              <Button variant="ghost" size="sm" onClick={() => setEditingExclusionId(null)}>취소</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex-1 cursor-pointer" onClick={() => {
                              setEditingExclusionId(ex.id);
                              setEditExclusionPattern(ex.url_pattern);
                              setEditExclusionReason(ex.reason || '');
                            }} title="클릭하여 편집">
                              <p className="text-sm font-mono text-text">{ex.url_pattern}</p>
                              {ex.reason && <p className="text-xs text-text-secondary">{ex.reason}</p>}
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => {
                                setEditingExclusionId(ex.id);
                                setEditExclusionPattern(ex.url_pattern);
                                setEditExclusionReason(ex.reason || '');
                              }} className="text-xs text-blue-500 hover:text-blue-700">수정</button>
                              <button onClick={async () => {
                                await authFetch(`${API_BASE_URL}/crawl-sources?exclusionId=${ex.id}`, { method: 'DELETE' });
                                await loadCrawlData();
                              }} className="text-xs text-red-500 hover:text-red-700">삭제</button>
                            </div>
                          </div>
                        )}
                      </Card>
                    ))}
                    {crawlExclusions.length === 0 && (
                      <p className="text-xs text-text-secondary text-center py-4">등록된 제외 패턴이 없습니다.</p>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      );
    }


export default UploadTab;
