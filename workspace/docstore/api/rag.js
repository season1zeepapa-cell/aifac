// RAG (Retrieval-Augmented Generation) 질의응답 API
// POST /api/rag
// { question: "...", topK: 5, provider: "gemini"|"openai"|"claude", history: [...] }
//
// 처리 흐름:
// 1) 질문을 벡터로 변환
// 2) 유사도 높은 조문/청크 topK개 검색
// 3) 검색 결과 + 대화 히스토리를 컨텍스트로 선택된 LLM에 전달
// 4) 근거 조문과 함께 답변 생성
const { query } = require('../lib/db');
const { generateEmbedding } = require('../lib/embeddings');
const { requireAdmin } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { checkRateLimit } = require('../lib/rate-limit');
const { callLLM, getAvailableProviders } = require('../lib/gemini');

module.exports = async (req, res) => {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return;

  // 인증 체크
  const { error: authError } = requireAdmin(req);
  if (authError) return res.status(401).json({ error: authError });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  if (checkRateLimit(req, res, 'rag')) return;

  const { question, topK = 5, docId, provider = 'gemini', history = [], llmOptions = {} } = req.body;
  if (!question || question.trim().length === 0) {
    return res.status(400).json({ error: '질문(question)이 필요합니다.' });
  }

  try {
    // 1) 질문을 벡터로 변환
    console.log(`[RAG] 질문: "${question.trim().substring(0, 50)}..." (${provider})`);
    const embedding = await generateEmbedding(question.trim());
    const vecStr = `[${embedding.join(',')}]`;

    // 2) 유사 청크 검색
    let filterClause = 'dc.embedding IS NOT NULL';
    let params = [vecStr];
    let paramIdx = 2;

    if (docId) {
      filterClause += ` AND ds.document_id = $${paramIdx}`;
      params.push(parseInt(docId, 10));
      paramIdx++;
    }
    params.push(Math.min(parseInt(topK, 10) || 5, 10));

    const searchResult = await query(
      `SELECT
         dc.chunk_text,
         ds.section_type,
         ds.metadata AS section_metadata,
         d.title AS document_title,
         d.category,
         1 - (dc.embedding <=> $1::vector) AS similarity
       FROM document_chunks dc
       JOIN document_sections ds ON dc.section_id = ds.id
       JOIN documents d ON ds.document_id = d.id
       WHERE ${filterClause}
       ORDER BY dc.embedding <=> $1::vector
       LIMIT $${paramIdx}`,
      params
    );

    const sources = searchResult.rows.map(row => {
      const meta = row.section_metadata || {};
      return {
        text: row.chunk_text,
        documentTitle: row.document_title,
        category: row.category,
        label: meta.label || '',
        chapter: meta.chapter || '',
        similarity: parseFloat(row.similarity).toFixed(4),
      };
    });

    console.log(`[RAG] ${sources.length}개 근거 자료 검색 완료`);

    if (sources.length === 0) {
      return res.json({
        question: question.trim(),
        answer: '관련된 문서를 찾을 수 없습니다. 먼저 관련 법령이나 문서를 임포트해주세요.',
        sources: [],
        provider,
      });
    }

    // 3) 선택된 LLM에 컨텍스트 + 대화 히스토리와 함께 질문
    const contextText = sources.map((s, i) => {
      const header = s.label || `${s.documentTitle} - ${s.category}`;
      return `[근거 ${i + 1}] ${header}\n${s.text}`;
    }).join('\n\n---\n\n');

    // 대화 히스토리 구성 (최근 10턴 = 20메시지까지)
    const recentHistory = Array.isArray(history) ? history.slice(-20) : [];
    const historyText = recentHistory.length > 0
      ? '\n\n--- 이전 대화 ---\n' + recentHistory.map(h =>
          h.role === 'user' ? `사용자: ${h.content}` : `AI: ${h.content}`
        ).join('\n\n')
      : '';

    const prompt = `당신은 법령 및 규정 전문 AI 어시스턴트입니다. 아래 근거 자료를 참고하여 사용자의 질문에 정확하게 답변해주세요.

규칙:
- 근거 자료에 있는 내용만을 바탕으로 답변하세요
- 답변 시 어떤 근거(조문)를 참고했는지 [근거 N] 형태로 인용하세요
- 근거 자료에 없는 내용은 "해당 내용은 제공된 자료에서 확인할 수 없습니다"라고 답변하세요
- 답변은 한국어로 작성하세요
- 핵심을 먼저 말하고, 상세 설명을 이어서 하세요
- 이전 대화가 있으면 맥락을 이어서 답변하세요

--- 근거 자료 ---
${contextText}
${historyText}

--- 현재 질문 ---
${question.trim()}`;

    // llmOptions로 모델/온도/토큰 등 상세 설정 적용
    const callOpts = {
      provider,
      temperature: llmOptions.temperature ?? 0.3,
      maxTokens: llmOptions.maxTokens ?? 2048,
    };
    if (llmOptions.model) callOpts.model = llmOptions.model;
    if (llmOptions.thinkingBudget) callOpts.thinkingBudget = llmOptions.thinkingBudget;
    const answer = await callLLM(prompt, callOpts);
    console.log(`[RAG] 답변 생성 완료 (${provider}, ${answer.length}자)`);

    // 4) 응답
    res.json({
      question: question.trim(),
      answer,
      provider,
      sources: sources.map(s => ({
        documentTitle: s.documentTitle,
        label: s.label,
        chapter: s.chapter,
        similarity: s.similarity,
        excerpt: s.text.substring(0, 200) + (s.text.length > 200 ? '...' : ''),
      })),
    });
  } catch (err) {
    const { sendError } = require('../lib/error-handler');
    sendError(res, err, '[RAG]');
  }
};
