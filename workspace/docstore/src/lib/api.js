// API 기본 URL
export const API_BASE_URL = '/api';

// 인증 토큰 관리
export function getAuthToken() {
  return localStorage.getItem('docstore_token');
}

export function setAuthToken(token) {
  localStorage.setItem('docstore_token', token);
}

export function clearAuthToken() {
  localStorage.removeItem('docstore_token');
  localStorage.removeItem('docstore_user');
}

export function getAuthUser() {
  try { return JSON.parse(localStorage.getItem('docstore_user')); } catch { return null; }
}

export function setAuthUser(user) {
  localStorage.setItem('docstore_user', JSON.stringify(user));
}

// 인증 헤더가 포함된 fetch 래퍼
export function authFetch(url, options = {}) {
  const token = getAuthToken();
  if (token) {
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    };
  }
  return fetch(url, options).then(res => {
    // 401 응답이면 자동 로그아웃
    if (res.status === 401) {
      clearAuthToken();
      window.location.reload();
    }
    return res;
  });
}
