import { useState, useEffect, useCallback } from 'react';

// 다크모드 테마 관리 훅
export default function useTheme() {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('docstore_theme') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('docstore_theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  return { theme, toggle };
}
