---
name: hardcoded-auth
description: "Vercel 서버리스 환경에서 DB 없이 하드코딩 계정 + HMAC 토큰 기반 로그인/인증 기능을 구현한다. 사용자가 '로그인 추가', '인증 기능', '로그인 필수로', '하드코딩 로그인' 등을 요청할 때 실행."
---

# Hardcoded Auth (DB 없는 로그인)

Vercel 서버리스 환경에서 DB 없이 하드코딩 계정과 HMAC 서명 토큰으로 로그인/인증을 구현한다.

## 적용 조건

- Vercel 서버리스 함수 사용 프로젝트
- DB를 쓰지 않고 고정 계정만 필요한 경우
- Node.js `crypto` 모듈만 사용 (외부 패키지 불필요)

## 아키텍처 개요

```
[클라이언트]                    [Vercel 서버리스]
  로그인 폼                      api/login.js
  ─────────────────────────────>  하드코딩 계정 확인
  <─────────────────────────────  HMAC 토큰 발급
  localStorage에 토큰 저장

  API 요청 (Authorization 헤더)
  ─────────────────────────────>  api/auth.js 검증
                                  api/xxx.js 실행
  <─────────────────────────────  응답

  401 수신 시
  → 자동 로그아웃 → 로그인 화면
```

## 파일 구조

```
api/
  login.js    ← 로그인 엔드포인트
  auth.js     ← 토큰 검증 유틸리티 (다른 API에서 require)
  xxx.js      ← 기존 API에 인증 가드 추가
index.html    ← 로그인 오버레이 UI + 인증 로직
```

## 작업 흐름

### 1단계: 사용자 요구사항 확인

- 계정 수와 아이디/이름 확인
- 비밀번호 확인 (Vercel 환경변수로 저장)
- 로그인 필수 범위 확인 (전체 잠금 / AI 기능만 잠금 등)
- 토큰 유효기간 확인 (기본 7일)

### 2단계: api/auth.js 생성 (토큰 검증 유틸리티)

```js
const crypto = require('crypto');

const TOKEN_SECRET = (process.env.AUTH_TOKEN_SECRET || 'default-secret').trim();

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractToken(req) {
  const authHeader = req.headers?.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return req.query?.token || null;
}

module.exports = { verifyToken, extractToken };
```

### 3단계: api/login.js 생성

```js
const crypto = require('crypto');

// 하드코딩 계정 (비밀번호는 환경변수)
const USERS = [
  { id: '아이디', name: '표시이름' },
];

const TOKEN_SECRET = (process.env.AUTH_TOKEN_SECRET || 'default-secret').trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();

function createToken(userId, name) {
  const payload = {
    sub: userId,
    name,
    iat: Date.now(),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7일
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD 환경변수 미설정' });
  }

  const { id, password } = req.body || {};
  if (!id || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  const user = USERS.find(u => u.id === id);
  if (!user) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  // 타이밍 공격 방지
  const inputBuf = Buffer.from(password);
  const correctBuf = Buffer.from(ADMIN_PASSWORD);
  const match = inputBuf.length === correctBuf.length &&
    crypto.timingSafeEqual(inputBuf, correctBuf);

  if (!match) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  const token = createToken(user.id, user.name);
  res.json({ token, name: user.name });
};
```

### 4단계: 기존 API에 인증 가드 추가

보호할 각 API 파일 상단에:

```js
const { verifyToken, extractToken } = require('./auth');
```

핸들러 초입에:

```js
const user = verifyToken(extractToken(req));
if (!user) {
  return res.status(401).json({ error: '로그인이 필요합니다.' });
}
```

### 5단계: 클라이언트 HTML/JS 구현

#### 로그인 오버레이 HTML

```html
<div class="login-overlay" id="loginOverlay">
  <div class="login-box">
    <h1>사이트 제목</h1>
    <p>로그인 후 이용 가능</p>
    <input class="login-input" id="loginId" type="text" placeholder="아이디">
    <input class="login-input" id="loginPw" type="password" placeholder="비밀번호">
    <button class="login-btn" id="loginBtn" onclick="doLogin()">로그인</button>
    <div class="login-error" id="loginError"></div>
  </div>
</div>
```

#### 로그인 오버레이 CSS

```css
.login-overlay{position:fixed;inset:0;z-index:99999;background:var(--bg);
  display:flex;align-items:center;justify-content:center;transition:opacity .3s}
.login-overlay.hidden{opacity:0;pointer-events:none}
.login-box{background:var(--card-bg);border-radius:16px;padding:40px 36px;
  box-shadow:0 8px 40px var(--shadow);max-width:360px;width:90%;text-align:center}
.login-input{width:100%;padding:12px 14px;border:1.5px solid var(--border);
  border-radius:10px;font-size:14px;background:var(--box-bg);color:var(--text);
  margin-bottom:12px;outline:none;transition:border .2s}
.login-input:focus{border-color:var(--accent)}
.login-btn{width:100%;padding:12px;border:none;border-radius:10px;
  background:var(--accent);color:#fff;font-size:15px;font-weight:700;
  cursor:pointer;transition:.2s}
.login-btn:hover{background:var(--accent-hover)}
.login-btn:disabled{opacity:.5;cursor:not-allowed}
.login-error{color:#ef4444;font-size:13px;margin-top:10px;min-height:20px}
```

#### 인증 JS 로직

```js
// 토큰 관리
function getAuthToken(){ return localStorage.getItem('auth-token'); }
function getAuthName(){ return localStorage.getItem('auth-name'); }

// 로그인 상태 확인 → UI 전환
function checkAuth(){
  const token = getAuthToken();
  const overlay = document.getElementById('loginOverlay');
  const logoutBtn = document.getElementById('logoutBtn');
  const userNameEl = document.getElementById('userName');
  if(token){
    overlay.classList.add('hidden');
    logoutBtn.style.display = '';
    userNameEl.textContent = getAuthName() || '';
  } else {
    overlay.classList.remove('hidden');
    logoutBtn.style.display = 'none';
    userNameEl.textContent = '';
  }
}

// 로그인 요청
async function doLogin(){
  const id = document.getElementById('loginId').value.trim();
  const pw = document.getElementById('loginPw').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  errEl.textContent = '';
  if(!id || !pw){ errEl.textContent = '아이디와 비밀번호를 입력해주세요.'; return; }

  btn.disabled = true;
  btn.textContent = '로그인 중...';
  try{
    const resp = await fetch('/api/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ id, password: pw })
    });
    const data = await resp.json();
    if(!resp.ok) throw new Error(data.error || '로그인 실패');
    localStorage.setItem('auth-token', data.token);
    localStorage.setItem('auth-name', data.name);
    checkAuth();
  }catch(e){
    errEl.textContent = e.message;
  }finally{
    btn.disabled = false;
    btn.textContent = '로그인';
  }
}

// 로그아웃
function doLogout(){
  localStorage.removeItem('auth-token');
  localStorage.removeItem('auth-name');
  checkAuth();
}

// Enter 키 지원
document.getElementById('loginPw').addEventListener('keydown', e=>{
  if(e.key==='Enter') doLogin();
});

// 페이지 로드 시 인증 확인
checkAuth();
```

#### fetch 래퍼에 토큰 자동 주입

기존 fetch 헬퍼에 Authorization 헤더를 자동 추가:

```js
const token = getAuthToken();
if(token){
  options.headers = { ...options.headers, 'Authorization': 'Bearer ' + token };
}
```

#### 401 응답 시 자동 로그아웃

API 응답 처리 부분에:

```js
if(resp.status === 401){
  doLogout();
  throw new Error('로그인이 만료되었습니다. 다시 로그인해주세요.');
}
```

### 6단계: Vercel 환경변수 설정

```bash
# 관리자 비밀번호
npx vercel env add ADMIN_PASSWORD production <<< "비밀번호"

# 토큰 서명 비밀키 (랜덤 생성)
npx vercel env add AUTH_TOKEN_SECRET production <<< "$(openssl rand -hex 32)"
```

### 7단계: 배포

```bash
npx vercel --prod --yes
```

## 다중 계정 확장

계정별로 다른 비밀번호가 필요하면 환경변수를 분리:

```js
const USERS = [
  { id: 'admin', name: '관리자', pwEnv: 'ADMIN_PASSWORD' },
  { id: 'student1', name: '학생1', pwEnv: 'STUDENT1_PASSWORD' },
];

// 비밀번호 확인 시
const correctPw = (process.env[user.pwEnv] || '').trim();
```

## 보안 고려사항

- 비밀번호는 반드시 환경변수에 저장 (코드에 하드코딩 금지)
- `crypto.timingSafeEqual`로 타이밍 공격 방지
- 토큰에 만료 시간(`exp`) 포함
- HMAC-SHA256 서명으로 토큰 위변조 방지
- 401 응답 시 클라이언트에서 즉시 토큰 삭제

## 한계

- 회원가입(동적 계정 추가) 불가 → DB 필요
- 비밀번호 변경 불가 → Vercel 환경변수 수동 변경 필요
- 기기 간 세션 공유 안 됨 (localStorage 기반)
