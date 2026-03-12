// Python 브릿지 — Node.js에서 Python PDF 로더를 실행하는 공통 모듈
//
// 동작 방식:
// 1. pdfBuffer → /tmp 임시 파일 저장
// 2. 환경에 따라 분기:
//    - 로컬: child_process.spawn('python3', ['bridge.py']) + stdin JSON
//    - Vercel: fetch('/api/pdf-python') + multipart/form-data
// 3. JSON 결과 파싱 → { pages, totalPages, fullText } 반환
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Python 브릿지 스크립트 경로
const BRIDGE_SCRIPT = path.join(__dirname, 'python', 'bridge.py');

/**
 * Python 로더 호출 (로컬 환경용)
 * child_process.spawn으로 bridge.py를 실행하고 stdin/stdout으로 통신
 * @param {string} loaderId - 로더 ID (pymupdf, pypdf, pdfplumber, unstructured, docling)
 * @param {Buffer} pdfBuffer - PDF 파일 버퍼
 * @returns {{ pages: Array, totalPages: number, fullText: string }}
 */
async function callPythonLoader(loaderId, pdfBuffer) {
  // 1. PDF 버퍼를 임시 파일로 저장
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `pdf-loader-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmpFile, pdfBuffer);

  try {
    // 2. Vercel 환경인지 확인
    if (process.env.VERCEL) {
      return await callPythonViaApi(loaderId, pdfBuffer);
    }

    // 3. 로컬: Python 직접 실행
    return await callPythonDirect(loaderId, tmpFile);
  } finally {
    // 4. 임시 파일 정리
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

/**
 * 로컬 환경: child_process.spawn으로 Python 직접 실행
 */
function callPythonDirect(loaderId, pdfPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [BRIDGE_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000, // 5분 타임아웃
    });

    // stdin으로 요청 JSON 전송
    const request = JSON.stringify({ loader: loaderId, pdfPath });
    proc.stdin.write(request);
    proc.stdin.end();

    // stdout에서 결과 수집
    const stdoutChunks = [];
    const stderrChunks = [];

    proc.stdout.on('data', chunk => stdoutChunks.push(chunk));
    proc.stderr.on('data', chunk => stderrChunks.push(chunk));

    proc.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code !== 0) {
        const errMsg = stderr.trim() || `Python 프로세스 종료 코드: ${code}`;
        reject(new Error(`Python 로더(${loaderId}) 실행 실패: ${errMsg}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          reject(new Error(`Python 로더(${loaderId}): ${result.error}`));
          return;
        }
        resolve(normalizeResult(result, loaderId));
      } catch (e) {
        reject(new Error(`Python 로더(${loaderId}) 응답 파싱 실패: ${stdout.slice(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('Python3가 설치되어 있지 않습니다. Python 로더를 사용하려면 python3를 설치해주세요.'));
      } else {
        reject(new Error(`Python 실행 오류: ${err.message}`));
      }
    });
  });
}

/**
 * Vercel 환경: /api/pdf-python 서버리스 함수를 HTTP로 호출
 */
async function callPythonViaApi(loaderId, pdfBuffer) {
  // Vercel 내부 호출 — 같은 배포 내의 Python 함수 호출
  // VERCEL_PROJECT_PRODUCTION_URL 사용 (Deployment Protection 우회)
  // VERCEL_URL은 프리뷰 URL이라 Protection이 걸릴 수 있음
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL
    || null;
  const baseUrl = host ? `https://${host}` : 'http://localhost:3001';

  // Node.js 18+ 내장 FormData/Blob 사용 (formdata-node는 Content-Type 미설정 이슈)
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
  const formData = new FormData();
  formData.append('file', blob, 'document.pdf');
  formData.append('loader', loaderId);

  const response = await fetch(`${baseUrl}/api/pdf-python`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Python API 호출 실패 (${response.status}): ${text.slice(0, 200)}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(`Python 로더(${loaderId}): ${result.error}`);
  }

  return normalizeResult(result, loaderId);
}

/**
 * Python 결과를 표준 형식으로 정규화
 */
function normalizeResult(result, loaderId) {
  const pages = (result.pages || []).map((p, i) => ({
    pageNumber: p.pageNumber || i + 1,
    text: (p.text || '').trim(),
    isImagePage: (p.text || '').trim().length < 50,
    method: loaderId,
  }));

  const fullText = result.fullText || pages.map(p => p.text).join('\n\n');

  return {
    pages,
    totalPages: result.totalPages || pages.length,
    fullText,
  };
}

/**
 * Python3 설치 여부 확인
 * Vercel 환경에서는 Python 서버리스 함수(/api/pdf-python.py)가 있으므로 항상 true
 */
function isPythonAvailable() {
  if (process.env.VERCEL) return true;

  try {
    const { execSync } = require('child_process');
    execSync('python3 --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 특정 Python 패키지 설치 여부 확인
 * @param {string} packageName - import할 패키지명
 */
function isPythonPackageAvailable(packageName) {
  // Vercel 환경에서는 requirements.txt로 설치되므로 true 반환
  if (process.env.VERCEL) return true;

  try {
    const { execSync } = require('child_process');
    execSync(`python3 -c "import ${packageName}"`, { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  callPythonLoader,
  isPythonAvailable,
  isPythonPackageAvailable,
};
