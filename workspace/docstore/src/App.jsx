import { useState, useCallback } from 'react';
import { getAuthToken, clearAuthToken, setAuthToken, setAuthUser, API_BASE_URL } from './lib/api';
import useTheme from './hooks/useTheme';
import { ApiKeyStatusContext, useApiKeyStatusProvider } from './contexts/ApiKeyStatusContext';
import { CategoriesContext, useCategoriesProvider } from './contexts/CategoriesContext';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import UploadTab from './tabs/UploadTab';
import DocumentsTab from './tabs/DocumentsTab';
import SearchTab from './tabs/SearchTab';
import ChatTab from './tabs/ChatTab';
import SettingsTab from './tabs/SettingsTab';
import TuningTab from './tabs/SettingsTab/TuningTab';

// 로그인 화면
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
          <div className="text-4xl mb-2">📚</div>
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

// 루트 App 컴포넌트
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(!!getAuthToken());
  const [activeTab, setActiveTab] = useState('upload');
  const [refreshKey, setRefreshKey] = useState(0);
  const { theme, toggle: toggleTheme } = useTheme();
  const categoriesCtx = useCategoriesProvider();
  const apiKeyStatusCtx = useApiKeyStatusProvider();
  // 검색 결과 → 문서 목록 탭 이동 시 열 문서 정보 { docId, sectionIndex, label }
  const [navigateDocInfo, setNavigateDocInfo] = useState(null);

  // 업로드 완료 시 문서 목록 새로고침 트리거
  const handleUploadComplete = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  // 검색 결과에서 문서 탭으로 이동 (refreshKey 증가로 DocumentsTab 강제 재마운트)
  const handleNavigateToDoc = useCallback((docId, sectionInfo) => {
    setNavigateDocInfo({ docId, ...(sectionInfo || {}) });
    setRefreshKey(k => k + 1);
    setActiveTab('documents');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleLogout = useCallback(() => {
    clearAuthToken();
    setIsLoggedIn(false);
  }, []);

  // 홈 버튼: 문서 목록 탭으로 이동 + 새로고침
  const handleHomeClick = useCallback(() => {
    setActiveTab('upload');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // 로그인 전이면 로그인 화면 표시
  if (!isLoggedIn) {
    return <LoginScreen onLogin={() => setIsLoggedIn(true)} theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <ApiKeyStatusContext.Provider value={apiKeyStatusCtx}>
    <CategoriesContext.Provider value={categoriesCtx}>
      <div className="min-h-screen pb-16">
        <Header onLogout={handleLogout} onHomeClick={handleHomeClick} theme={theme} onToggleTheme={toggleTheme} />
        <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-5 pb-20">
          {activeTab === 'upload' && (
            <UploadTab onUploadComplete={handleUploadComplete} />
          )}
          {activeTab === 'documents' && (
            <DocumentsTab key={refreshKey} initialDocInfo={navigateDocInfo} onInitialDocConsumed={() => setNavigateDocInfo(null)} />
          )}
          {/* 검색/채팅 탭: 상태 유지를 위해 display:none 방식 사용 */}
          <div style={{ display: activeTab === 'search' ? 'block' : 'none' }}>
            <SearchTab onNavigateToDoc={handleNavigateToDoc} />
          </div>
          <div style={{ display: activeTab === 'chat' ? 'block' : 'none' }}>
            <ChatTab onNavigateToDoc={handleNavigateToDoc} />
          </div>
          {activeTab === 'settings' && (
            <SettingsTab />
          )}
          {activeTab === 'tuning' && (
            <TuningTab />
          )}
        </main>
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    </CategoriesContext.Provider>
    </ApiKeyStatusContext.Provider>
  );
}
