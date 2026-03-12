// Neo4j 연결 모듈 (Aura 무료 플랜 호환)
// 환경변수: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
//
// Aura Free 설정 예시:
//   NEO4J_URI=neo4j+s://xxxxxxxx.databases.neo4j.io
//   NEO4J_USER=neo4j
//   NEO4J_PASSWORD=your-password

const neo4j = require('neo4j-driver');

let _driver = null;

/**
 * Neo4j 드라이버 싱글턴 반환
 * 환경변수가 없으면 null 반환 (PG 전용 모드)
 */
function getDriver() {
  if (_driver) return _driver;

  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !password) {
    console.warn('[Neo4j] 환경변수 미설정 (NEO4J_URI, NEO4J_PASSWORD). Neo4j 비활성화.');
    return null;
  }

  _driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    maxConnectionPoolSize: 5,
    connectionAcquisitionTimeout: 10000,
  });

  return _driver;
}

/**
 * Neo4j 세션으로 Cypher 쿼리 실행
 * @param {string} cypher - Cypher 쿼리
 * @param {Object} params - 쿼리 파라미터
 * @returns {Object} result
 */
async function runCypher(cypher, params = {}) {
  const driver = getDriver();
  if (!driver) throw new Error('Neo4j가 설정되지 않았습니다. 환경변수를 확인하세요.');

  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result;
  } finally {
    await session.close();
  }
}

/**
 * Neo4j 연결 상태 확인
 * @returns {{ connected: boolean, message: string }}
 */
async function checkConnection() {
  const driver = getDriver();
  if (!driver) return { connected: false, message: 'NEO4J_URI / NEO4J_PASSWORD 환경변수 미설정' };

  try {
    const session = driver.session();
    await session.run('RETURN 1');
    await session.close();
    return { connected: true, message: 'Neo4j 연결 성공' };
  } catch (err) {
    return { connected: false, message: `연결 실패: ${err.message}` };
  }
}

/**
 * Neo4j 드라이버 종료
 */
async function closeDriver() {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}

module.exports = {
  getDriver,
  runCypher,
  checkConnection,
  closeDriver,
};
