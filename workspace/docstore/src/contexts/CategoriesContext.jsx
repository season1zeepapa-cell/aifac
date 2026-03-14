import { createContext, useState, useCallback, useEffect } from 'react';
import { authFetch, API_BASE_URL } from '../lib/api';
import { DEFAULT_CATEGORIES } from '../constants/categories';

// 카테고리 전역 상태 (API 로드 후 갱신)
export const CategoriesContext = createContext({
  categories: DEFAULT_CATEGORIES,
  reload: () => {},
});

export function useCategoriesProvider() {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const reload = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/settings?key=categories`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.value) && data.value.length > 0) {
          setCategories(data.value);
        }
      }
    } catch {}
  }, []);
  useEffect(() => { reload(); }, []);
  return { categories, reload };
}

// CATEGORIES 호환용 getter (전체 옵션 포함)
export function getCategoriesWithAll(categories) {
  return [{ value: '', label: '전체' }, ...categories];
}
