import { createContext, useState, useCallback, useEffect } from 'react';
import { authFetch, API_BASE_URL } from '../lib/api';

// API 키 활성 상태 전역 Context
export const ApiKeyStatusContext = createContext({
  disabledApis: {},  // { provider: true } 비활성 API 맵
  isApiDisabled: () => false,
  reload: () => {},
});

export function useApiKeyStatusProvider() {
  const [disabledApis, setDisabledApis] = useState({});
  const reload = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api-usage?range=today`);
      if (res.ok) {
        const data = await res.json();
        const disabled = {};
        (data.keys || []).forEach(k => {
          if (k.configured && !k.is_active) disabled[k.provider] = true;
        });
        setDisabledApis(disabled);
      }
    } catch {}
  }, []);
  // 특정 provider가 비활성인지 확인하는 헬퍼
  const isApiDisabled = useCallback((provider) => {
    if (Array.isArray(provider)) return provider.some(p => !!disabledApis[p]);
    return !!disabledApis[provider];
  }, [disabledApis]);
  useEffect(() => { reload(); }, []);
  return { disabledApis, isApiDisabled, reload };
}
