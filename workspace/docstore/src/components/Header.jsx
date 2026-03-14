import { getAuthUser } from '../lib/api';

// 헤더 컴포넌트
export default function Header({ onLogout, onHomeClick, theme, onToggleTheme }) {
  const user = getAuthUser();
  return (
    <header className="bg-card-bg border-b border-border px-4 py-3 sticky top-0 z-40 shadow-sm">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <button onClick={onHomeClick} className="flex items-center gap-1.5 hover:opacity-70 transition-opacity">
          <h1 className="text-xl font-bold text-primary">DocStore</h1>
        </button>
        {onLogout && (
          <div className="flex items-center gap-3">
            {user && <span className="text-xs text-text-secondary">{user.orgName ? `${user.orgName} · ` : ''}{user.name}</span>}
            {/* 다크모드 토글 */}
            <button
              onClick={onToggleTheme}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-text hover:bg-card-bg-hover transition-colors"
              title={theme === 'light' ? '다크모드' : '라이트모드'}
            >
              {theme === 'light' ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              )}
            </button>
            <button
              onClick={onLogout}
              className="text-xs text-text-secondary hover:text-red-500 border border-border rounded px-2 py-1 transition-colors"
            >
              로그아웃
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
