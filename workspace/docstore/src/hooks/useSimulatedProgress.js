import { useState, useRef, useCallback, useEffect } from 'react';

// 시뮬레이션 진행률 훅
// steps: [{ message, duration(ms), progress }] — 각 단계 정보
// 서버 응답이 오면 자동으로 100%로 전환
export default function useSimulatedProgress(steps) {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const timerRef = useRef(null);

  const start = useCallback(() => {
    let stepIdx = 0;
    setProgress(steps[0]?.progress || 5);
    setMessage(steps[0]?.message || '처리 중...');

    timerRef.current = setInterval(() => {
      stepIdx++;
      if (stepIdx < steps.length) {
        setProgress(steps[stepIdx].progress);
        setMessage(steps[stepIdx].message);
      } else {
        // 마지막 단계 이후 천천히 증가 (최대 92%)
        setProgress(prev => Math.min(92, prev + 1));
      }
    }, steps[stepIdx]?.duration || 3000);
  }, [steps]);

  const finish = useCallback((msg) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(100);
    setMessage(msg || '완료!');
  }, []);

  const reset = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(0);
    setMessage('');
  }, []);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  return { progress, message, start, finish, reset };
}
