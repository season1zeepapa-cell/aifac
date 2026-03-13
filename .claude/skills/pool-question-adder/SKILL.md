---
name: pool-question-adder
description: "workspace/error/pool/ 폴더에 넣어둔 문제 이미지를 순서대로 읽어서 index.html에 새 문항 카드로 자동 추가한다. 사용자가 '문제 추가', 'pool 처리', '새 문제 넣어줘', 'pool 이미지 추가' 등을 요청할 때 실행."
---

# Pool Question Adder

`workspace/error/pool/` 폴더의 이미지를 읽어서 오답노트에 새 문항으로 자동 추가한다.

## 대상 파일

- HTML: `/Users/2team/aifac/workspace/error/index.html`
- Pool 폴더: `/Users/2team/aifac/workspace/error/pool/`
- 이미지 대상: `/Users/2team/aifac/workspace/error/qNNN.png`

## 작업 흐름

### 1단계: 현재 상태 파악

1. index.html에서 **마지막 카드 번호**를 확인한다:
   ```
   Grep: class="card" id="q → 마지막 번호 확인 (예: q110)
   ```
2. pool 폴더에서 **이미지 파일 목록**을 확인한다:
   ```
   Glob: /Users/2team/aifac/workspace/error/pool/*.{png,jpg,jpeg,webp}
   ```
3. 파일명 기준 정렬 (알파벳/숫자 순서)

### 2단계: 이미지 분석 (Vision)

pool 폴더의 각 이미지를 Read 도구로 읽는다 (vision 자동 적용).

이미지에서 추출할 정보:
- **문제 번호** (원본 시험지 번호, q-num에 표시)
- **문제 텍스트** (question-body)
- **선지 4개** (choices li)
- **정답 번호** (data-answer)

### 3단계: 카드 HTML 생성

각 이미지에 대해 다음 형식의 카드를 생성한다.
새 번호는 마지막 번호 + 1부터 순차 부여 (예: q111, q112...).

```html
<div class="card" id="qNNN">
    <div class="meta"><span>틀린문제 컬렉션</span><span>NNN / 총수</span></div>
    <div class="question-body"><span class="q-num">원본번호.</span> 문제 텍스트</div>

    <ul class="choices" data-answer="정답번호"><li data-num="1"><span class="c-num">①</span> 선지1</li><li data-num="2"><span class="c-num">②</span> 선지2</li><li data-num="3"><span class="c-num">③</span> 선지3</li><li data-num="4"><span class="c-num">④</span> 선지4</li></ul>
    <div class="explanation" id="exp-qNNN">
        <div class="exp-result"></div>
        <div class="exp-body">
            <p class="exp-answer">✅ 정답: <strong>번호 선지내용</strong></p>
            <div class="exp-section">
                <div class="exp-section-title">📖 해설</div>
                <p>핵심 해설</p>
            </div>
            <div class="exp-section">
                <div class="exp-section-title">❌ 오답 분석</div>
                <ul class="exp-list">
                    <li><strong>① (O/X)</strong> — 설명</li>
                    <li><strong>② (O/X)</strong> — 설명</li>
                    <li><strong>③ (O/X)</strong> — 설명</li>
                    <li><strong>④ (O/X)</strong> — 설명</li>
                </ul>
            </div>
            <div class="exp-tip">💡 <strong>핵심 암기</strong>: 한 줄 요약</div>
        </div>
    </div>
</div>
```

### 4단계: index.html에 삽입

1. `</main>` 바로 앞에 새 카드 HTML을 삽입한다:
   ```
   Edit: old_string="</main>" → new_string="새카드HTML\n  </main>"
   ```

2. 헤더의 **총 문항 수 배지**를 업데이트한다:
   ```
   Edit: "전체 110문항" → "전체 NNN문항"
   ```

3. 기존 카드들의 `NNN / 110` 패턴을 업데이트할 필요 없음.
   (JS에서 동적으로 헤더를 생성하므로 meta는 참고용)

### 5단계: 이미지 파일 이동

pool 폴더의 이미지를 qNNN.png로 이름 변경하여 상위 폴더로 이동:

```bash
mv /Users/2team/aifac/workspace/error/pool/원본파일.png /Users/2team/aifac/workspace/error/qNNN.png
```

### 6단계: 배포

```bash
cd /Users/2team/aifac/workspace/error && npx vercel --prod --yes
```

## 이미지 분석 가이드라인

### 문제 텍스트 추출 규칙
- 법령명은 `<span class="law">「법령명」</span>` 태그로 감싼다
- 문제 번호(예: "9.")는 `<span class="q-num">9.</span>`에 넣는다
- 선지가 길면 그대로 유지 (줄이지 않는다)

### 정답 결정 규칙
1. 이미지에 정답 표시(체크, 밑줄 등)가 있으면 그대로 사용
2. 없으면 영상정보관리사 시험 지식 기반으로 판단
3. 확실하지 않으면 정답을 `0`으로 두고 사용자에게 확인 요청

### 선지 레이아웃
- 선지가 짧으면 (20자 이내) 2열 그리드 적용:
  ```html
  <ul class="choices" data-answer="N" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
  ```
- 선지가 길면 기본 세로 배치 (style 없음)

## 병렬 처리

pool에 이미지가 여러 개일 때:
- 이미지 읽기(Read)는 **최대 3개씩 병렬**로 실행
- HTML 삽입은 **순서대로** (번호 꼬임 방지)

## 주의사항

- pool 폴더가 비어있으면 "추가할 이미지가 없습니다" 안내
- 이미 존재하는 qNNN.png와 번호 충돌 방지 (마지막 번호 + 1부터)
- 이미지에서 텍스트 추출이 불확실한 경우 사용자에게 확인 요청
- 원본 이미지는 이동 후 pool 폴더에서 삭제됨 (mv 사용)
