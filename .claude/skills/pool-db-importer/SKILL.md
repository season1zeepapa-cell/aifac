---
name: pool-db-importer
description: "workspace/error/pool/ 폴더의 기출문제 이미지를 비전 AI로 텍스트 추출하여 DB(questions 테이블)에 저장하고, 해설을 직접 작성하여 저장하고, 이미지를 문제번호로 리네임하여 이동한다. 사용자가 'pool 처리', 'DB 문제 추가', '기출 이미지 등록', 'pool DB 등록', 'pool 가져오기' 등을 요청할 때 실행."
---

# Pool DB Importer

`workspace/error/pool/` 폴더의 기출문제 이미지를 비전으로 읽어 DB에 등록하는 파이프라인.

## 경로

- Pool 폴더: `/Users/2team/aifac/workspace/error/pool/`
- 이미지 저장: `/Users/2team/aifac/workspace/error/qNNN.png`
- 파이프라인 스크립트: `/Users/2team/aifac/workspace/error/pool-import.js`
- DB API: `https://error-liart.vercel.app/api/questions`
- 배포: `cd /Users/2team/aifac/workspace/error && npx vercel --prod --yes`

## 시험 목록

| exam_id | 제목 | 비고 |
|---------|------|------|
| 1 | 오답 풀이 | q001-q110 |
| 2 | 2025.11.30 시험 | q111-q150 |
| 3 | 2025.09.21 시험 | q151-q190 |
| 4 | 2025.06.22 시험 | q191~ |

새 시험 추가 시 로컬 DB에서 직접 INSERT:
```javascript
node -e "require('dotenv').config(); const {query}=require('./api/db');
query(\"INSERT INTO exams (title,exam_date,sort_order) VALUES ('제목','YYYY-MM-DD',N) RETURNING *\")
.then(r=>{console.log(r.rows[0]);process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
```

## 작업 흐름

### 0단계: 사전 확인

1. pool 폴더의 이미지 파일 목록 확인 (Glob: `pool/*.{png,jpg,jpeg,webp}`)
2. 이미지가 없으면 "pool 폴더에 이미지를 넣어주세요" 안내 후 종료
3. 사용자에게 **exam_id** 확인 (기존 시험 or 새 시험 생성)

### 1단계: 비전 AI로 텍스트 추출

각 이미지를 **Read 도구**로 읽어서 (vision 자동 적용) 다음을 추출:

- **original_number**: 원본 시험 문제 번호
- **body**: 문제 본문 (순수 텍스트)
- **choices**: 선택지 4개 `[{num:1, text:"..."}, ...]`
- **answer**: 정답 번호 (이미지에 표시 없으면 0)

추출 후 사용자에게 결과를 보여주고 확인받는다.

### 2단계: DB에 문제 저장

`pool-import.js --exam-id=N` 스크립트를 사용하거나, 직접 DB query 실행:

```javascript
// 마지막 문제번호 조회
query('SELECT MAX(question_number) as max_num FROM questions')
// 문제 INSERT
query(`INSERT INTO questions (exam_id, question_number, original_number, body, choices, answer, image_url)
  VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
  [exam_id, nextNum, original_number, body, JSON.stringify(choices), answer, imgFileName])
```

### 3단계: 해설 직접 작성

AI 자동 생성이 아닌, **Claude가 직접 해설을 작성**한다. 반드시 기존 양식을 따른다:

```html
<div class="exp-result"></div>
        <div class="exp-body">
            <p class="exp-answer">정답: <strong>N번 선지내용</strong></p>
            <div class="exp-section">
                <div class="exp-section-title">근거 법령</div>
                <p>관련 법령 및 상세 해설</p>
            </div>
            <div class="exp-section">
                <div class="exp-section-title">오답 분석</div>
                <ul class="exp-list">
                    <li><strong>1 (O)</strong> -- 설명</li>
                    <li><strong>2 (O)</strong> -- 설명</li>
                    <li><strong>3 (X)</strong> -- 틀린 이유</li>
                    <li><strong>4 (O)</strong> -- 설명</li>
                </ul>
            </div>
            <div class="exp-tip"><strong>핵심 암기</strong>: 한 줄 요약 키워드</div>
        </div>
```

해설 작성 규칙:
- 정답 선지에 (X), 오답 선지에 (O) 표기 ("옳지 않은 것" 문제 기준)
- "옳은 것" 문제면 정답에 (O), 오답에 (X)
- 근거 법령 섹션에 관련 조문 명시
- 핵심 암기는 시험 직전 암기용 한 줄 요약
- exp-answer 앞에 이모지 사용하지 않음 (initQuizChoices에서 동적 추가)

해설 DB 저장:
```javascript
query('UPDATE questions SET explanation=$1, updated_at=NOW() WHERE id=$2', [html, questionId])
```

### 4단계: 이미지 리네임 및 이동

```bash
mv pool/원본파일.png /Users/2team/aifac/workspace/error/qNNN.png
```

### 5단계: 커밋 및 배포

1. git add로 새 이미지 파일 스테이징
2. git_commit_writer_ko 스킬로 커밋
3. git push
4. `cd /Users/2team/aifac/workspace/error && npx vercel --prod --yes`

## 스크립트 사용법 (대량 처리)

이미지가 많을 때 pool-import.js 스크립트 활용:

```bash
# 미리보기 (DB 저장 안 함)
node pool-import.js --exam-id=4 --dry-run

# 실제 등록 (텍스트 추출 + DB 저장 + 이미지 이동)
node pool-import.js --exam-id=4
```

스크립트는 Gemini Vision으로 텍스트만 추출한다. 해설은 스크립트가 아닌 Claude가 직접 작성해야 한다.
스크립트 실행 후 해설을 별도로 UPDATE한다.

## 병렬 처리

- 이미지 Read는 최대 3개씩 병렬
- DB INSERT는 순서대로 (번호 꼬임 방지)
- 해설 작성은 문제당 하나씩 순차

## 주의사항

- pool 폴더가 비어있으면 안내 후 종료
- 정답을 모르면 answer=0으로 저장, 사용자에게 확인 요청
- 기존 qNNN.png와 번호 충돌 방지 (DB MAX(question_number)+1부터)
- 해설의 exp-result, exp-body 래퍼가 DB에 포함되므로 renderDbCard에서 이중 래핑하지 않음
