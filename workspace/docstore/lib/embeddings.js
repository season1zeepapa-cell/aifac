// 임베딩 생성 유틸리티 (OpenAI text-embedding-3-small)
const OpenAI = require('openai');

// OpenAI 클라이언트 (싱글턴)
let client;
function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * 텍스트를 청크로 분할
 * - 문장 단위로 끊어서 chunkSize 이내로 묶음
 * - overlap만큼 이전 청크의 끝 부분을 다음 청크에 포함
 * @param {string} text - 원본 텍스트
 * @param {number} chunkSize - 청크 최대 글자 수 (기본 500)
 * @param {number} overlap - 겹침 글자 수 (기본 100)
 * @returns {string[]} 청크 배열
 */
function chunkText(text, chunkSize = 500, overlap = 100) {
  if (!text || text.trim().length === 0) return [];

  // 문장 단위로 분리 (마침표, 느낌표, 물음표 기준)
  const sentences = text.match(/[^.!?]+[.!?]?\s*/g) || [text];

  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    // 현재 청크 + 문장이 chunkSize 이내면 추가
    if (currentChunk.length + sentence.length <= chunkSize) {
      currentChunk += sentence;
    } else {
      // 현재 청크가 비어있지 않으면 저장
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      // overlap 적용: 이전 청크의 끝 부분을 가져옴
      if (overlap > 0 && currentChunk.length > overlap) {
        currentChunk = currentChunk.slice(-overlap) + sentence;
      } else {
        currentChunk = sentence;
      }
    }
  }

  // 마지막 청크 저장
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * 청크 배열을 받아 임베딩 벡터 배열 반환
 * @param {string[]} chunks - 텍스트 청크 배열
 * @returns {Promise<number[][]>} 임베딩 벡터 배열
 */
async function generateEmbeddings(chunks) {
  if (!chunks || chunks.length === 0) return [];

  const openai = getClient();

  // OpenAI API는 한 번에 여러 텍스트 임베딩 가능 (배치 처리)
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: chunks,
  });

  // 인덱스 순서대로 정렬하여 반환
  return response.data
    .sort((a, b) => a.index - b.index)
    .map(item => item.embedding);
}

/**
 * 단일 텍스트의 임베딩 벡터 반환
 * @param {string} text - 텍스트
 * @returns {Promise<number[]>} 임베딩 벡터 (1536차원)
 */
async function generateEmbedding(text) {
  const openai = getClient();

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return response.data[0].embedding;
}

module.exports = { chunkText, generateEmbeddings, generateEmbedding };
