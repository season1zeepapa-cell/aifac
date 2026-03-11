// RAG (Retrieval-Augmented Generation) 질의응답 API
// POST /api/rag
// { question, topK, provider, history, docId, docIds, llmOptions }
//
// 처리 흐름:
// 1) 멀티홉 검색: 질문 벡터화 → 1차 검색 → 참조 추출 → 2차 검색
// 2) 근거 체인 프롬프트로 LLM 호출
// 3) 구조화된 답변 + 근거 체인 + 교차 참조 반환
const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { callLLM, callLLMStream } = require('../lib/gemini');
const { sendError } = require('../lib/error-handler');
const { multiHopSearch } = require('../lib/rag-agent');

// SSE 헬퍼: 이벤트 데이터를 SSE 형식으로 전송
function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;

  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  if (checkRateLimit(req, res, 'rag')) return;

  const { question, topK = 5, docId, docIds, provider = 'gemini', history = [], llmOptions = {}, stream = false } = req.body;
  if (!question || question.trim().length === 0) {
    return res.status(400).json({ error: '질문(question)이 필요합니다.' });
  }

  try {
    // 문서 필터: docIds(배열) 우선, docId(단일) 하위 호환
    const resolvedDocIds = Array.isArray(docIds) && docIds.length > 0
      ? docIds.map(id => parseInt(id, 10))
      : docId ? [parseInt(docId, 10)] : [];

    // 1) 멀티홉 검색
    console.log(`[RAG] 질문: "${question.trim().substring(0, 50)}..." (${provider})`);
    const searchResult = await multiHopSearch(query, question.trim(), {
      topK: Math.min(parseInt(topK, 10) || 5, 10),
      docIds: resolvedDocIds,
    });

    const sources = searchResult.sources;
    console.log(`[RAG] ${sources.length}개 근거 자료 검색 (${searchResult.hops}홉${searchResult.crossRefs ? ', 교차참조: ' + searchResult.crossRefs.length + '건' : ''})`);

    if (sources.length === 0) {
      return res.json({
        question: question.trim(),
        answer: '관련된 문서를 찾을 수 없습니다. 먼저 관련 법령이나 문서를 임포트해주세요.',
        sources: [],
        provider,
      });
    }

    // 2) 근거 체인 프롬프트 구성
    const contextText = sources.map((s, i) => {
      const header = s.label || `${s.documentTitle} - ${s.category}`;
      return `[근거 ${i + 1}] ${header} (${s.documentTitle})\n${s.text}`;
    }).join('\n\n---\n\n');

    // 대화 히스토리 (최근 10턴 = 20메시지)
    const recentHistory = Array.isArray(history) ? history.slice(-20) : [];
    const historyText = recentHistory.length > 0
      ? '\n\n--- 이전 대화 ---\n' + recentHistory.map(h =>
          h.role === 'user' ? `사용자: ${h.content}` : `AI: ${h.content}`
        ).join('\n\n')
      : '';

    const prompt = `당신은 법령 및 규정 전문 AI 어시스턴트입니다. 아래 근거 자료를 참고하여 사용자의 질문에 정확하게 답변해주세요.

## 답변 형식

반드시 아래 구조로 답변하세요. 각 섹션 제목은 정확히 아래 형식을 사용하세요.

### 결론
질문에 대한 직접 답변을 1~3문장으로 작성하세요.

### 근거 체인
결론에 이르는 논리 경로를 단계별로 작성하세요. 각 단계마다:
- **[근거 N] 출처 조문명**: 해당 조문의 핵심 내용 인용 → 이 근거가 의미하는 바를 설명

단계 간 연결이 있으면 "→ 따라서" 또는 "→ 이에 근거하여" 등으로 이어주세요.

### 교차 참조
근거 자료 사이의 관계를 정리하세요 (있는 경우만):
- 조문A → (준용/적용/예외) → 조문B
- 법률A ↔ 법률B (관련 조문)

관계가 없으면 이 섹션은 생략하세요.

### 주의사항
예외 조항, 단서, 주의할 점이 있으면 작성하세요. 없으면 생략하세요.

## 규칙
- 근거 자료에 있는 내용만 바탕으로 답변하세요
- 근거 자료에 없는 내용은 "해당 내용은 제공된 자료에서 확인할 수 없습니다"라고 답변하세요
- 답변은 한국어로 작성하세요
- 이전 대화가 있으면 맥락을 이어서 답변하세요

--- 근거 자료 ---
${contextText}
${historyText}

--- 현재 질문 ---
${question.trim()}`;

    // 3) LLM 호출 옵션
    const callOpts = {
      provider,
      temperature: llmOptions.temperature ?? 0.3,
      maxTokens: llmOptions.maxTokens ?? 3072,
    };
    if (llmOptions.model) callOpts.model = llmOptions.model;
    if (llmOptions.thinkingBudget) callOpts.thinkingBudget = llmOptions.thinkingBudget;

    // 소스 정보 (스트리밍/비스트리밍 공통)
    const sourcesData = sources.map(s => ({
      documentTitle: s.documentTitle,
      documentId: s.documentId,
      label: s.label,
      chapter: s.chapter,
      articleNumber: s.articleNumber,
      articleTitle: s.articleTitle,
      similarity: s.similarity,
      excerpt: s.text.substring(0, 300) + (s.text.length > 300 ? '...' : ''),
    }));

    if (stream) {
      // ── SSE 스트리밍 모드 ──
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // nginx 버퍼링 방지
      res.flushHeaders();

      // 먼저 검색 결과(sources) 전송
      sseWrite(res, {
        type: 'sources',
        sources: sourcesData,
        hops: searchResult.hops,
        crossRefs: searchResult.crossRefs || [],
        provider,
      });

      // LLM 스트리밍 시작 — 토큰 도착마다 전송
      try {
        await callLLMStream(prompt, callOpts, (token) => {
          sseWrite(res, { type: 'token', token });
        });
        sseWrite(res, { type: 'done' });
      } catch (streamErr) {
        console.warn(`[RAG] 스트리밍 실패, 일반 모드로 fallback:`, streamErr.message);
        // 스트리밍 실패 시 일반 호출로 fallback
        try {
          const answer = await callLLM(prompt, callOpts);
          sseWrite(res, { type: 'token', token: answer });
          sseWrite(res, { type: 'done' });
        } catch (fallbackErr) {
          sseWrite(res, { type: 'error', error: fallbackErr.message });
        }
      }
      res.end();
    } else {
      // ── 기존 JSON 응답 모드 ──
      const answer = await callLLM(prompt, callOpts);
      console.log(`[RAG] 답변 생성 완료 (${provider}, ${answer.length}자, ${searchResult.hops}홉)`);

      res.json({
        question: question.trim(),
        answer,
        provider,
        hops: searchResult.hops,
        crossRefs: searchResult.crossRefs || [],
        sources: sourcesData,
      });
    }
  } catch (err) {
    sendError(res, err, '[RAG]');
  }
};
