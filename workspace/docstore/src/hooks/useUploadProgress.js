import { useState, useRef, useCallback, useEffect } from 'react';

// XHR 기반 실시간 업로드 진행률 훅
// 파일 전송(0~50%): 바이트 기반 실시간, 서버 처리(50~100%): 시뮬레이션
export default function useUploadProgress() {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const timerRef = useRef(null);
  const xhrRef = useRef(null);

  // XHR로 파일 업로드 + 진행률 추적
  const upload = useCallback((url, formData, token) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      // 파일 전송 진행률 (0~50%)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = (e.loaded / e.total) * 50;
          setProgress(pct);
          const mb = (e.loaded / 1024 / 1024).toFixed(1);
          const totalMb = (e.total / 1024 / 1024).toFixed(1);
          setMessage(`파일 전송 중... ${mb}MB / ${totalMb}MB`);
        }
      };

      // 파일 전송 완료 → 서버 처리 시뮬레이션 시작 (50~95%)
      xhr.upload.onload = () => {
        setProgress(50);
        setMessage('서버에서 텍스트 추출 중...');
        const serverSteps = [
          { msg: '서버에서 텍스트 추출 중...', pct: 55, delay: 3000 },
          { msg: 'DB 저장 중...', pct: 62, delay: 3000 },
          { msg: '임베딩 생성 중...', pct: 70, delay: 5000 },
          { msg: '임베딩 처리 중...', pct: 80, delay: 5000 },
          { msg: '마무리 중...', pct: 90, delay: 5000 },
        ];
        let idx = 0;
        timerRef.current = setInterval(() => {
          idx++;
          if (idx < serverSteps.length) {
            setProgress(serverSteps[idx].pct);
            setMessage(serverSteps[idx].msg);
          } else {
            setProgress(prev => Math.min(95, prev + 0.5));
          }
        }, serverSteps[idx]?.delay || 4000);
      };

      // 응답 수신 완료
      xhr.onload = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error('응답 파싱 실패'));
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `업로드 실패 (${xhr.status})`));
          } catch {
            reject(new Error(`업로드 실패 (${xhr.status})`));
          }
        }
      };

      xhr.onerror = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        reject(new Error('네트워크 오류'));
      };

      xhr.open('POST', url);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  }, []);

  // 대용량 파일 업로드 (Supabase Storage 경유)
  // 1단계: signed URL 발급 → Storage에 PUT (0~40%)
  // 2단계: 서버에 storagePath + 메타 전달 (40~100%)
  const uploadLarge = useCallback(async (file, metadata, token) => {
    const apiBase = '';

    // 1단계: signed upload URL 발급
    setProgress(2);
    setMessage('대용량 파일 업로드 준비 중...');
    const urlRes = await fetch(`${apiBase}/api/upload-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        filename: file.name,
        mimetype: file.type || 'application/octet-stream',
        fileSize: file.size,
      }),
    });
    if (!urlRes.ok) {
      const err = await urlRes.json().catch(() => ({}));
      throw new Error(err.error || `Upload URL 발급 실패 (${urlRes.status})`);
    }
    const { signedUrl, storagePath, token: uploadToken } = await urlRes.json();

    // 2단계: signed URL로 파일 직접 PUT (진행률 0~40%)
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = (e.loaded / e.total) * 40;
          setProgress(pct);
          const mb = (e.loaded / 1024 / 1024).toFixed(1);
          const totalMb = (e.total / 1024 / 1024).toFixed(1);
          setMessage(`Storage 업로드 중... ${mb}MB / ${totalMb}MB`);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          let detail = '';
          try { detail = ': ' + JSON.parse(xhr.responseText).message; } catch {}
          reject(new Error(`Storage 업로드 실패 (${xhr.status})${detail}`));
        }
      };
      xhr.onerror = () => reject(new Error('Storage 업로드 네트워크 오류'));

      // Supabase signed upload URL 사용
      xhr.open('PUT', signedUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.send(file);
    });

    // 3단계: 서버에 storagePath + 메타데이터 전달 (40~100%)
    setProgress(45);
    setMessage('서버에서 텍스트 추출 중...');

    // 서버 처리 진행률 시뮬레이션 (45~95%)
    let idx = 0;
    const serverSteps = [
      { msg: '서버에서 텍스트 추출 중...', pct: 55, delay: 3000 },
      { msg: 'DB 저장 중...', pct: 65, delay: 3000 },
      { msg: '임베딩 생성 중...', pct: 75, delay: 5000 },
      { msg: '임베딩 처리 중...', pct: 85, delay: 5000 },
      { msg: '마무리 중...', pct: 92, delay: 5000 },
    ];
    timerRef.current = setInterval(() => {
      idx++;
      if (idx < serverSteps.length) {
        setProgress(serverSteps[idx].pct);
        setMessage(serverSteps[idx].msg);
      } else {
        setProgress(prev => Math.min(95, prev + 0.3));
      }
    }, serverSteps[idx]?.delay || 4000);

    const processRes = await fetch(`${apiBase}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        storagePath,
        filename: file.name,
        mimetype: file.type || 'application/octet-stream',
        ...metadata,
      }),
    });

    if (timerRef.current) clearInterval(timerRef.current);

    if (!processRes.ok) {
      const err = await processRes.json().catch(() => ({}));
      throw new Error(err.error || `서버 처리 실패 (${processRes.status})`);
    }

    return await processRes.json();
  }, []);

  const finish = useCallback((msg) => {
    if (timerRef.current) clearInterval(timerRef.current);
    xhrRef.current = null;
    setProgress(100);
    setMessage(msg || '완료!');
  }, []);

  const reset = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    xhrRef.current = null;
    setProgress(0);
    setMessage('');
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (xhrRef.current) xhrRef.current.abort();
  }, []);

  return { progress, message, upload, uploadLarge, finish, reset };
}
