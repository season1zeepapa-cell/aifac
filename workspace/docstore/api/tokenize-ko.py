"""
한국어 토크나이저 API (Vercel Python 서버리스 함수)

kiwipiepy 사용 가능 시 형태소 분석, 불가 시 정규식 기반 토큰화.
FTS 인덱싱/검색 시 한국어 토큰을 생성한다.

POST /api/tokenize-ko
요청: { "texts": ["개인정보보호법에 따른 처리", ...], "mode": "tokens" | "nouns" }
응답: { "results": [{ "tokens": [...], "tsvector_text": "..." }], "engine": "..." }
"""

from http.server import BaseHTTPRequestHandler
import json
import re

# kiwipiepy 사용 가능 여부 확인
_kiwi = None
_use_kiwi = False

try:
    from kiwipiepy import Kiwi
    _use_kiwi = True
except ImportError:
    _use_kiwi = False

def get_kiwi():
    global _kiwi
    if _kiwi is None and _use_kiwi:
        _kiwi = Kiwi()
    return _kiwi

# 검색에 유용한 품사 태그
USEFUL_POS = {'NNG', 'NNP', 'NNB', 'VV', 'VA', 'SL', 'SN', 'XR'}
NOUN_POS = {'NNG', 'NNP', 'SL', 'SN'}

# 불용어
STOPWORDS = {'것', '수', '등', '및', '이', '그', '저', '또', '때', '더', '안',
             '의', '에', '를', '을', '는', '은', '가', '이', '와', '과', '로',
             '으로', '에서', '까지', '부터', '대한', '위한', '따른', '관한'}

# 법률 복합 명사 사전 (정규식 기반 토크나이저용)
COMPOUND_NOUNS = [
    '개인정보보호법', '개인정보', '정보보호', '정보주체', '정보통신망',
    '영상정보처리기기', '영상정보', '처리기기', '개인영상정보',
    '보호위원회', '보호책임자', '영향평가', '안전조치',
    '동의권', '열람권', '삭제권', '처리정지', '손해배상',
    '과태료', '과징금', '시정명령', '위반행위',
    '민감정보', '고유식별정보', '주민등록번호', '여권번호',
    '운전면허', '외국인등록', '건강정보', '유전정보',
    '수집이용', '제3자제공', '목적외이용', '위탁처리',
]

def tokenize_regex(text):
    """정규식 기반 한국어 토크나이저 (형태소 분석기 없이)"""
    tokens = []

    # 1) 복합 명사 사전 매칭 (긴 것부터)
    remaining = text
    found_compounds = []
    for compound in sorted(COMPOUND_NOUNS, key=len, reverse=True):
        if compound in remaining:
            found_compounds.append(compound)
            remaining = remaining.replace(compound, ' ')

    tokens.extend(found_compounds)

    # 2) 영문 단어 추출
    english = re.findall(r'[a-zA-Z]{2,}', text)
    tokens.extend(english)

    # 3) 숫자 추출 (제N조, 제N항 등)
    article_nums = re.findall(r'제\d+조(?:의\d+)?(?:제\d+항)?', text)
    tokens.extend(article_nums)

    # 4) 한글 단어 추출 (조사 제거)
    # 2글자 이상 한글 연속 추출
    korean_words = re.findall(r'[가-힣]{2,}', remaining)
    for word in korean_words:
        if word in STOPWORDS:
            continue
        if len(word) >= 2:
            tokens.append(word)
        # N-gram (3글자 이상 단어에서 2-gram 생성)
        if len(word) >= 4:
            for i in range(len(word) - 1):
                bigram = word[i:i+2]
                if bigram not in STOPWORDS:
                    tokens.append(bigram)

    return tokens


def tokenize_kiwi(text, mode='tokens'):
    """kiwipiepy 형태소 분석 기반 토크나이저"""
    kiwi = get_kiwi()
    result = kiwi.tokenize(text)

    pos_filter = NOUN_POS if mode == 'nouns' else USEFUL_POS

    tokens = []
    for token in result:
        if token.tag not in pos_filter:
            continue
        form = token.form.strip()
        if len(form) < 2 and token.tag in {'NNG', 'NNP', 'NNB'}:
            continue
        if form in STOPWORDS:
            continue
        tokens.append(form)

    return tokens


def tokenize_text(text, mode='tokens'):
    """텍스트를 토큰화 (kiwipiepy 우선, 없으면 정규식 폴백)"""
    if _use_kiwi:
        return tokenize_kiwi(text, mode)
    return tokenize_regex(text)


def batch_tokenize(texts, mode='tokens'):
    """여러 텍스트를 배치로 토큰화"""
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
            t_lower = t.lower()
            if t_lower not in seen:
                seen.add(t_lower)
                unique_tokens.append(t)

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
            mode = data.get('mode', 'tokens')

            if not texts:
                self._send_json(400, {'error': 'texts 배열이 필요합니다.'})
                return

            if len(texts) > 100:
                texts = texts[:100]

            results = batch_tokenize(texts, mode)
            engine = 'kiwipiepy' if _use_kiwi else 'regex-tokenizer'

            self._send_json(200, {
                'results': results,
                'count': len(results),
                'mode': mode,
                'engine': engine,
            })

        except Exception as e:
            self._send_json(500, {'error': str(e)})

    def do_GET(self):
        """헬스체크 + 테스트"""
        try:
            test = tokenize_text('개인정보보호법에 따른 영상정보처리기기 설치 및 운영 제한')
            engine = 'kiwipiepy' if _use_kiwi else 'regex-tokenizer'
            self._send_json(200, {
                'status': 'ok',
                'engine': engine,
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
