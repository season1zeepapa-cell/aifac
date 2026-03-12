// Supabase Storage 연동 유틸리티
// 원본 파일을 DB(BYTEA) 대신 Supabase Storage 버킷에 저장
//
// 필요 환경변수:
//   SUPABASE_URL        — Supabase 프로젝트 URL (예: https://xxxx.supabase.co)
//   SUPABASE_SERVICE_KEY — Service Role Key (관리자용, anon key 아님)
//
// 버킷 구조:
//   docstore-files/
//     documents/{documentId}/{filename}

const { createClient } = require('@supabase/supabase-js');

const BUCKET_NAME = 'docstore-files';

// Supabase 클라이언트 싱글톤 (서버리스 환경에서 재사용)
let supabase = null;

function getClient() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL과 SUPABASE_SERVICE_KEY 환경변수가 필요합니다.');
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

/**
 * Storage가 사용 가능한지 확인
 * (환경변수가 설정되어 있으면 true)
 */
function isStorageAvailable() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

/**
 * 버킷 존재 여부 확인 + 없으면 자동 생성
 */
async function ensureBucket() {
  const client = getClient();
  const { data, error } = await client.storage.getBucket(BUCKET_NAME);
  if (error && error.message.includes('not found')) {
    // 버킷 생성 (비공개 — Signed URL로만 접근)
    const { error: createError } = await client.storage.createBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: 52428800, // 50MB
    });
    if (createError) throw new Error(`버킷 생성 실패: ${createError.message}`);
    console.log(`[Storage] '${BUCKET_NAME}' 버킷 생성 완료`);
  } else if (error) {
    throw new Error(`버킷 확인 실패: ${error.message}`);
  }
}

/**
 * 파일 업로드
 * @param {Buffer} fileBuffer - 파일 바이너리
 * @param {number|string} documentId - 문서 ID
 * @param {string} filename - 원본 파일명
 * @param {string} mimetype - MIME 타입
 * @returns {string} storage_path (버킷 내 경로)
 */
async function uploadFile(fileBuffer, documentId, filename, mimetype) {
  await ensureBucket();
  const client = getClient();

  // 경로: documents/123/report.pdf
  // 파일명 충돌 방지: 타임스탬프 접두사
  // Supabase Storage는 영문+숫자+일부 특수문자만 안전
  // 한국어 등 비ASCII 문자는 제거하고, 확장자는 보존
  const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
  const nameOnly = filename.replace(/\.[^.]+$/, '');
  const ascii = nameOnly.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const safeName = (ascii || `file_${Date.now()}`) + ext;
  const storagePath = `documents/${documentId}/${safeName}`;

  const { error } = await client.storage
    .from(BUCKET_NAME)
    .upload(storagePath, fileBuffer, {
      contentType: mimetype,
      upsert: true, // 같은 경로면 덮어쓰기
    });

  if (error) throw new Error(`Storage 업로드 실패: ${error.message}`);
  console.log(`[Storage] 업로드 완료: ${storagePath} (${fileBuffer.length} bytes)`);
  return storagePath;
}

/**
 * Signed URL 발급 (다운로드/미리보기용)
 * @param {string} storagePath - 버킷 내 파일 경로
 * @param {number} expiresIn - 유효 시간 (초, 기본 1시간)
 * @returns {string} 서명된 URL
 */
async function getSignedUrl(storagePath, expiresIn = 3600) {
  const client = getClient();
  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw new Error(`Signed URL 발급 실패: ${error.message}`);
  return data.signedUrl;
}

/**
 * 파일 삭제
 * @param {string} storagePath - 버킷 내 파일 경로
 */
async function deleteFile(storagePath) {
  const client = getClient();
  const { error } = await client.storage
    .from(BUCKET_NAME)
    .remove([storagePath]);

  if (error) {
    console.warn(`[Storage] 삭제 실패 (무시): ${error.message}`);
  } else {
    console.log(`[Storage] 삭제 완료: ${storagePath}`);
  }
}

/**
 * 문서 폴더 전체 삭제 (문서 삭제 시)
 * @param {number|string} documentId - 문서 ID
 */
async function deleteDocumentFiles(documentId) {
  const client = getClient();
  const folderPath = `documents/${documentId}`;

  // 폴더 내 파일 목록 조회
  const { data: files, error: listError } = await client.storage
    .from(BUCKET_NAME)
    .list(folderPath);

  if (listError || !files || files.length === 0) return;

  // 전체 삭제
  const paths = files.map(f => `${folderPath}/${f.name}`);
  const { error } = await client.storage
    .from(BUCKET_NAME)
    .remove(paths);

  if (error) {
    console.warn(`[Storage] 폴더 삭제 실패 (무시): ${error.message}`);
  } else {
    console.log(`[Storage] 문서 ${documentId} 파일 ${paths.length}개 삭제 완료`);
  }
}

/**
 * Signed Upload URL 발급 (클라이언트가 직접 Storage에 업로드할 때 사용)
 * @param {string} storagePath - 버킷 내 파일 경로
 * @returns {{ signedUrl: string, path: string, token: string }}
 */
async function createSignedUploadUrl(storagePath) {
  await ensureBucket();
  const client = getClient();
  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .createSignedUploadUrl(storagePath);

  if (error) throw new Error(`Signed Upload URL 발급 실패: ${error.message}`);
  return data;
}

/**
 * Storage에서 파일 다운로드 (서버 처리용)
 * @param {string} storagePath - 버킷 내 파일 경로
 * @returns {Buffer} 파일 버퍼
 */
async function downloadFile(storagePath) {
  const client = getClient();
  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .download(storagePath);

  if (error) throw new Error(`Storage 파일 다운로드 실패: ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  uploadFile,
  getSignedUrl,
  deleteFile,
  deleteDocumentFiles,
  isStorageAvailable,
  ensureBucket,
  createSignedUploadUrl,
  downloadFile,
  BUCKET_NAME,
};
