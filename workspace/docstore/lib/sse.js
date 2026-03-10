// SSE (Server-Sent Events) 헬퍼 모듈
// 업로드/임베딩/분석 등 장시간 작업의 실시간 진행 상황 전송
//
// 사용법:
//   const sse = initSSE(res);
//   sse.send('extracting', { message: '텍스트 추출 중...', progress: 30 });
//   sse.done({ documentId: 1, title: '문서' });
//   sse.error('실패 메시지');

const { setCors } = require('./cors');

/**
 * SSE 스트리밍 초기화
 * 요청에 Accept: text/event-stream 헤더가 있으면 SSE 모드,
 * 없으면 일반 JSON 응답 모드로 동작 (하위 호환성 유지)
 */
function initSSE(req, res, corsOptions = {}) {
  // CORS 처리
  if (setCors(req, res, { methods: 'POST, OPTIONS', ...corsOptions })) {
    return null; // OPTIONS 프리플라이트 → 종료
  }

  const wantsSSE = (req.headers.accept || '').includes('text/event-stream');

  if (wantsSSE) {
    // SSE 헤더 설정
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx 버퍼링 비활성화
    });

    return {
      isSSE: true,

      // 진행 상황 이벤트 전송
      // step: 단계 이름 (extracting, saving, embedding 등)
      // data: { message, progress(0-100), ...추가 정보 }
      send(step, data = {}) {
        const payload = JSON.stringify({ step, ...data });
        res.write(`event: progress\ndata: ${payload}\n\n`);
      },

      // 완료 이벤트 전송 후 스트림 종료
      done(result) {
        const payload = JSON.stringify({ step: 'done', ...result });
        res.write(`event: done\ndata: ${payload}\n\n`);
        res.end();
      },

      // 에러 이벤트 전송 후 스트림 종료
      error(message, statusCode = 500) {
        const payload = JSON.stringify({ error: message });
        res.write(`event: error\ndata: ${payload}\n\n`);
        res.end();
      },
    };
  }

  // 일반 모드 — SSE가 아닌 기존 JSON 응답 방식 (하위 호환)
  return {
    isSSE: false,
    send() {}, // 무시 (JSON에서는 중간 진행 없음)
    done(result) { res.json(result); },
    error(message, statusCode = 500) { res.status(statusCode).json({ error: message }); },
  };
}

module.exports = { initSSE };
