---
name: exam-explanation-writer
description: "영상정보관리사 오답노트(index.html) 문항 카드에 정답·해설을 추가한다. 사용자가 '해설 추가', '기본 해설', 'N번부터 M번까지 해설' 등을 요청할 때 실행. 파일 경로: /Users/2team/aifac/workspace/error/index.html, 이미지 경로: /Users/2team/aifac/workspace/error/qNNN.png"
---

# Exam Explanation Writer

영상정보관리사 오답노트 HTML에 문항별 퀴즈 정답·해설 블록을 삽입한다.

## 대상 파일

- HTML: `/Users/2team/aifac/workspace/error/index.html`
- 이미지: `/Users/2team/aifac/workspace/error/q001.png` ~ `q110.png`

## 작업 흐름

### 1단계: 대상 범위 파악

사용자가 지정한 번호 범위(e.g. q003~q010)를 확인한다.
`index.html`에서 해당 `<div class="card" id="qNNN">` 블록을 Read로 읽는다.

### 2단계: 문항별 상태 확인

각 문항에 대해:

- `<ul class="choices" data-answer="...">` 이미 있으면 → **건너뜀**
- `<ul class="choices">` 있으나 `data-answer` 없으면 → 정답·해설 작성 필요
- `<ul class="choices">` 자체 없음 (시나리오/이미지형) → 해당 qNNN.png를 Read(vision)로 읽어 선지 추출 후 작성

### 3단계: 이미지 기반 문항 처리

`<div class="img-note">` 또는 `<ul class="choices">` 미존재 시:

```
Read 도구로 /Users/2team/aifac/workspace/error/qNNN.png 를 읽는다 (vision 자동 적용)
→ 선지 텍스트·정답 추출
→ choices HTML 생성 후 explanation 추가
```

### 4단계: HTML 삽입

#### choices 수정 패턴

```html
<!-- 기존 -->
<ul class="choices">
    <li><span class="c-num">①</span> 텍스트</li>
    ...

<!-- 변경 후 -->
<ul class="choices" data-answer="N">
    <li data-num="1"><span class="c-num">①</span> 텍스트</li>
    <li data-num="2"><span class="c-num">②</span> 텍스트</li>
    <li data-num="3"><span class="c-num">③</span> 텍스트</li>
    <li data-num="4"><span class="c-num">④</span> 텍스트</li>
</ul>
```

#### explanation 삽입 패턴

`</ul>` 바로 다음, 카드 닫는 `</div>` 바로 앞에 삽입:

```html
<div class="explanation" id="exp-qNNN">
    <div class="exp-result"></div>
    <div class="exp-body">
        <p class="exp-answer">✅ 정답: <strong>[번호] [선지 내용]</strong></p>
        <div class="exp-section">
            <div class="exp-section-title">📖 [근거 법령 | 해설]</div>
            <p>핵심 근거·개념 설명</p>
        </div>
        <div class="exp-section">
            <div class="exp-section-title">[❌ 오답 분석 | ✅ 나머지 보기 해설]</div>
            <ul class="exp-list">
                <li><strong>① (O/X)</strong> — 설명</li>
                ...
            </ul>
        </div>
        <div class="exp-tip">💡 <strong>핵심 암기</strong>: 한 줄 요약</div>
    </div>
</div>
```

#### 섹션 선택 기준

| 문제 유형 | 해설 섹션 제목 | 오답 섹션 제목 |
|-----------|---------------|---------------|
| 법령 근거 문제 | 📖 근거 법령 | ❌ 오답 분석 |
| 개념·기술 문제 | 📖 해설 | ❌ 오답 분석 |
| "옳은 것은?" | 📖 해설 | ❌ 오답 분석 |
| "옳지 않은 것은?" | 📖 해설 (왜 틀렸는지 중심) | ✅ 나머지 보기 해설 |

### 5단계: 배포

모든 편집 완료 후:

```bash
cd /Users/2team/aifac/workspace/error && vercel --prod --yes
```

## 정답 결정 기준

1. 영상정보관리사 시험 기출 지식 기반으로 판단
2. 확실하지 않은 경우 문제 유형으로 추론:
   - "옳지 않은 것": 나머지 3개가 모두 맞는 경우를 확인
   - 법령 문제: 실제 조문 내용과 대조
3. 이미지 선지가 있으면 vision 추출 결과 최우선

## 주의사항

- `data-answer` 이미 존재하는 문항은 절대 덮어쓰지 않는다
- `<span class="law">` 태그는 법령명 감싸는 기존 마크업 유지
- 해설 내 법령 인용 시 `<span class="law">「법령명」</span>` 형식 사용
- exp-tip은 반드시 한 줄 요약으로 간결하게 작성
