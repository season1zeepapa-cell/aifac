"""
한국어 형태소 분석 API (Vercel Python 서버리스 함수)

kiwipiepy를 사용한 형태소 분석 엔드포인트.
FTS 인덱싱/검색 시 정확한 한국어 토큰을 생성한다.

POST /api/tokenize-ko
요청: { "texts": ["개인정보보호법에 따른 처리", ...], "mode": "tokens" | "nouns" }
응답: { "results": [{ "tokens": ["개인정보", "보호", "법", "처리"], "nouns": ["개인정보", "보호", "법", "처리"] }] }
"""

from http.server import BaseHTTPRequestHandler
import json

# kiwipiepy 인스턴스 (모듈 레벨에서 생성하여 콜드 스타트 최소화)
_kiwi = None

def get_kiwi():
    global _kiwi
    if _kiwi is None:
        from kiwipiepy import Kiwi
        _kiwi = Kiwi()
    return _kiwi

# 검색에 유용한 품사 태그 (불용어 제거용)
# NNG: 일반명사, NNP: 고유명사, NNB: 의존명사
# VV: 동사(어간), VA: 형용사(어간)
# SL: 영문, SN: 숫자
USEFUL_POS = {'NNG', 'NNP', 'NNB', 'VV', 'VA', 'SL', 'SN', 'XR'}

# 명사 품사만 (nouns 모드)
NOUN_POS = {'NNG', 'NNP', 'SL', 'SN'}

# 불용어 (너무 일반적인 단어)
STOPWORDS = {'것', '수', '등', '및', '이', '그', '저', '또', '때', '더', '안'}


def tokenize_text(text, mode='tokens'):
    """텍스트를 형태소 분석하여 토큰 목록 반환"""
    kiwi = get_kiwi()
    result = kiwi.tokenize(text)

    if mode == 'nouns':
        pos_filter = NOUN_POS
    else:
        pos_filter = USEFUL_POS

    tokens = []
    for token in result:
        # 품사 필터링
        if token.tag not in pos_filter:
            continue
        form = token.form.strip()
        # 1글자 불용어 제거 (명사는 2글자 이상만)
        if len(form) < 2 and token.tag in {'NNG', 'NNP', 'NNB'}:
            continue
        # 불용어 제거
        if form in STOPWORDS:
            continue
        tokens.append(form)

    return tokens


def batch_tokenize(texts, mode='tokens'):
    """여러 텍스트를 배치로 형태소 분석"""
    results = []
    for text in texts:
        if not text or not text.strip():
            results.append({'tokens': [], 'tsvector_text': ''})
            continue

        tokens = tokenize_text(text, mode)
        # 중복 제거하되 순서 유지
        seen = set()
        unique_tokens = []
        for t in tokens:
            if t not in seen:
                seen.add(t)
                unique_tokens.append(t)

        # tsvector용 텍스트 (공백 구분, simple 설정에서 사용)
        tsvector_text = ' '.join(unique_tokens)

        results.append({
            'tokens': unique_tokens,
            'tsvector_text': tsvector_text,
        })

    return results


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode('utf-8'))

            texts = data.get('texts', [])
            mode = data.get('mode', 'tokens')  # 'tokens' | 'nouns'

            if not texts:
                self._send_json(400, {'error': 'texts 배열이 필요합니다.'})
                return

            # 배치 크기 제한 (최대 100개)
            if len(texts) > 100:
                texts = texts[:100]

            results = batch_tokenize(texts, mode)

            self._send_json(200, {
                'results': results,
                'count': len(results),
                'mode': mode,
            })

        except ImportError as e:
            self._send_json(500, {
                'error': f'kiwipiepy 로드 실패: {str(e)}',
                'hint': 'requirements.txt에 kiwipiepy>=0.18.0 추가 필요',
            })
        except Exception as e:
            self._send_json(500, {'error': str(e)})

    def do_GET(self):
        """헬스체크 + 테스트"""
        try:
            test = tokenize_text('개인정보보호법에 따른 영상정보처리기기 설치 및 운영 제한')
            self._send_json(200, {
                'status': 'ok',
                'engine': 'kiwipiepy',
                'test_tokens': test,
            })
        except Exception as e:
            self._send_json(500, {
                'status': 'error',
                'error': str(e),
            })

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
