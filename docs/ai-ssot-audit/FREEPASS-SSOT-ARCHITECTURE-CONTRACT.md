# FreePass SSOT Architecture Contract

상태: **ACTIVE / 공통 기준**

작성: ChatGPT 독립 감사자

이 문서는 FreePass의 공급사 데이터가 어디서 들어와서, 어떻게 해석되고, 어떤 정본을 거쳐, 각 화면·시트·ERP에 어떻게 배포되어야 하는지를 고정한다.

사용자 요구를 한 줄로 표현하면 다음과 같다.

> **공급사 데이터를 정확히 모은다 → 공급사별 Adapter가 의미를 해석한다 → ERP5 공통 Atom에 저장한다 → 각 사용처 Projection이 자기 형식으로 가져간다 → 실제 화면/시트/ERP에 출력한다.**

---

## 1. 유일하게 허용되는 기본 흐름

```text
SOURCE
  ↓
ADAPTER
  ↓
ATOM = freepasserp5 SSOT
  ↓
PROJECTION
  ↓
OUTPUT
```

세부 의미:

```text
[1] SOURCE
공급사 실제 원본
- Google Sheet
- Website
- ERP/API
        ↓

[2] ADAPTER
공급사마다 다른 표현과 구조를 해석
- 차량번호
- 상태
- 제조사/모델/차명
- 기간별 대여료
- 보증금
- 약정주행거리
- 보험/정책
- 공급사 고유 가격축
        ↓

[3] ATOM = freepasserp5
공통 의미 모델로 저장
★ 여기까지가 재고/상태/가격 의미의 canonical SSOT
★ 공급사 표현이 달라도 의미는 하나로 보존
        ↓

[4] PROJECTION
사용처에 맞게 재배열/선별/표현
- F01 일반 상품리스트
- 손오공구독
- 오플구독
- F86 하허호
- Finder
- 고객 상품페이지
- ERP4 UI
        ↓

[5] OUTPUT
Google Sheet / Web / App / ERP 화면
```

---

## 2. 역할 분리의 핵심

### Adapter가 흡수하는 차이

Adapter는 **공급사마다 입력 형식이 다른 문제**를 흡수한다.

예:

- 어떤 곳은 12/24/36개월
- 어떤 곳은 12개월 2만km / 12개월 3만km
- 어떤 곳은 반납형/인수형
- 어떤 곳은 웹사이트
- 어떤 곳은 API
- 어떤 곳은 Google Sheet

이 차이는 Adapter 영역이다.

### Projection이 흡수하는 차이

Projection은 **같은 Atom을 사용처마다 다르게 보여줘야 하는 문제**를 흡수한다.

예:

- F01은 일반 영업 상품리스트 규격
- F86은 하허호가 익숙한 과거식 종합 + 공급사별 탭
- 손오공은 손오공 전용 기간/반납형/인수형 구조
- 오토플러스는 오플 전용 기간×주행거리 구조

이 차이는 Projection 영역이다.

**Adapter와 Projection을 섞지 않는다.**

---

## 3. 특수 공급사 원칙

### 오토플러스 RP023

canonical source:

- RebornCar website

원칙:

- 일반 F01 기간 구조에 억지로 변환하지 않는다.
- 공급사의 기간×주행거리 가격축을 Atom에서 의미 손실 없이 보존한다.
- `오플구독` Projection이 그 고유 구조로 출력한다.
- F01 일반 상품리스트에서 제외되는 것은 Source/Adapter 규칙이 아니라 **F01 Projection scope 규칙**이다.

### 손오공 RP012

canonical source:

- Sonogong ERP/API

원칙:

- 손오공 전용 탭 유지.
- 반납형/인수형 및 공급사 고유 기간 구조를 보존한다.
- 중고렌트는 별도 신규 탭을 만들지 않고, 확정된 운영결정에 따라 `손오공구독` 내부 반납형 상품군에 합류한다.
- 실제 API 버킷/식별자는 코드·실데이터로 확인하고 추측하지 않는다.

### 아이언 RP006

canonical source:

- ironrentcar.com

projection/정제시트는 canonical source가 아니다.

---

## 4. F86의 위치

F86은 **하허호 전용 Projection/Presentation**이다.

허용:

- 하허호가 익숙한 종합 + 공급사별 탭 구조
- 하허호 전용 열 배치
- 하허호 채널의 합법적 노출 필터
- 사용자가 원하는 과거 시트 UX 재현

금지:

- F86을 canonical source로 승격
- F86 값을 다시 ERP5 upstream으로 역류
- F86 표시 요구를 Atom 정의에 그대로 강제

즉 **Atom은 하나지만 F86의 화면 모양은 자유롭게 다를 수 있다.**

---

## 5. 절대 금지하는 역류/우회 경로

### 금지 1 — Projection → SSOT 역류

아래 경로는 금지한다.

```text
F01 → ERP5
F86 → ERP5
오플구독 → ERP5
정제시트 → canonical source 재정의
```

Projection은 소비자이지 재고 정본 writer가 아니다.

### 금지 2 — 같은 공급사를 둘 이상의 원천에서 동시에 수집

예:

```text
RP023 RebornCar + 옛 Google Sheet 동시 source
RP006 ironrentcar.com + projection Sheet 동시 source
RP012 API + projection Sheet 동시 source
```

이런 상태는 SSOT가 아니다.

### 금지 3 — Adapter 규칙과 Projection 규칙 혼합

예:

`RP023은 F01에서 제외`는 오토플러스 Adapter 규칙이 아니다.

정확한 의미:

- Adapter: RP023 데이터를 정확히 Atom으로 만든다.
- F01 Projection: RP023을 일반 F01 탭에서는 제외한다.
- 오플 Projection: 같은 RP023 Atom을 오플구독 형식으로 출력한다.

### 금지 4 — 출력별 독립 원본 생성

F01, F86, Finder, 고객면, ERP4가 각자 다른 source chain을 가지면 안 된다.

정상:

```text
한 Atom → 여러 Projection
```

비정상:

```text
F01용 원본
F86용 원본
Finder용 원본
ERP용 원본
```

---

## 6. 감사 시 항상 묻는 5개 질문

ChatGPT와 Claude는 복잡한 코드 이름보다 아래 5개 질문으로 데이터 흐름을 판정한다.

1. **어디서 왔나?** — canonical SOURCE가 무엇인가?
2. **누가 해석했나?** — 어떤 ADAPTER가 공급사 표현을 의미로 바꿨나?
3. **Atom에 제대로 들어갔나?** — ERP5 SSOT에서 의미가 보존됐나?
4. **어느 Projection이 가져갔나?** — F01/F86/손오공/오플/ERP4 중 누구인가?
5. **출력값이 Atom과 의미상 같은가?** — 표시 형식은 달라도 값의 의미가 변형되지 않았나?

이 5단계 중 추적이 끊기면 HOLD 또는 충돌로 판정한다.

특히 아래 표현이 나오면 즉시 구조 검토 대상이다.

- "정제시트에서 다시 가져왔다"
- "판매시트 값을 ERP에 넣었다"
- "projection 시트를 source라고 부른다"
- "같은 공급사를 다른 writer도 수집한다"
- "출력 탭의 편의 때문에 Atom 의미를 바꿨다"

---

## 7. 현재 정리 작업의 본질

지금 필요한 것은 기능을 계속 추가하는 일이 아니다.

**이미 존재하는 여러 우회경로/legacy writer를 하나씩 제거하거나 소비자 역할로 강등해서, 모든 데이터가 이 계약의 한 방향만 지나가도록 만드는 작업**이다.

목표:

```text
SOURCE → ADAPTER → ERP5 ATOM → PROJECTION → OUTPUT
```

외의 자동 writer 경로가 운영에서 살아 있지 않도록 한다.

---

## 8. 구현/감사 역할 분리

현재 FreePass SSOT 운영 원칙:

- **실제 구현/코드 수정 Owner: 지정된 Claude 단일 세션**
- **ChatGPT: 독립 감사/검수/설계 의견**
- 다른 AI는 필요 시 참고 의견을 줄 수 있으나 별도 SSOT writer가 되지 않는다.

ChatGPT가 발견한 사항은 GitHub MD에 남기고, Claude 단일 세션이 읽어서 구현한 뒤, ChatGPT가 다시 독립 검증한다.

---

## 9. ChatGPT 기록 규칙 — 사용자 확정

사용자 지시:

> **"니가 쓰는 거는 MD로 다 남겨."**

따라서 앞으로 ChatGPT가 FreePass SSOT와 관련해 내리는 실질적인:

- 검토 결과
- 설계 의견
- 구조 판정
- 충돌 발견
- 수정 권고
- 운영결정 해석
- Claude에게 전달할 지시/검토 답변

은 **채팅에만 두지 않고 GitHub의 Markdown 문서에도 남긴다.**

기록 위치 우선순위:

1. 검증된 사실/충돌/해소 → `docs/AI-SSOT-AUDIT-LOG.md`
2. 특정 주제의 상세 검토 → `docs/ai-ssot-audit/<날짜>-<주제>.md`
3. AI 간 짧은 요청/응답 → `docs/ai-ssot-audit/AI-INBOX.md`
4. 장기 구조 원칙 → 이 문서 같은 evergreen contract

채팅은 설명 창구이고, **GitHub MD가 AI 간 지속 가능한 공용 기억**이다.

---

## 최종 문장

> **공급사마다 입력은 달라도 Atom은 하나다. Atom 하나에서 사용처별 Projection을 여러 개 만든다. Projection은 절대 Source가 되지 않는다.**
