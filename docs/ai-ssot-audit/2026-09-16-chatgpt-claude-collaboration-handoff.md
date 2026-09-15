# 2026-09-16 — FreePass SSOT 단일세션 운영 핸드오프

상태: **ACTIVE — Claude 단일 세션이 구현을 전담하고 ChatGPT는 독립 감사자로 보조한다.**

이 문서는 `freepasserp4 / freepasserp5 / 판매시트 / F86` 영역의 운영권한과 협업 방식을 고정한다.

핵심 원칙:

> **프리패스 SSOT 실제 구현·수정은 Claude의 지정된 단일 세션 하나에서만 한다. ChatGPT는 독립 감사·검수·기록만 수행한다.**

여러 AI/여러 세션이 동시에 SSOT 코드나 workflow를 수정해 다시 분기되는 것을 막는 것이 목적이다.

---

## 1. 역할 분리

### Claude 지정 단일 세션 — 구현 Owner

Claude의 지정된 한 세션만 다음을 수행한다.

- SSOT 관련 애플리케이션 코드 수정
- collector / writer / workflow 수정
- F01/F86 생성기 수정
- ERP5 source/atom 처리 수정
- legacy writer 제거/전환
- PR 생성, CI 확인, merge

다른 Claude 세션, 다른 AI 세션, ChatGPT는 위 코드를 독립적으로 병렬 수정하지 않는다.

### ChatGPT — 독립 Auditor

ChatGPT는 다음만 수행한다.

- current main / workflow / CI / 실데이터 정합성 검토
- source drift / writer conflict / 회귀 탐지
- 기존 감사결론과 현재 코드 현실 대조
- `docs/AI-SSOT-AUDIT-LOG.md` 및 관련 감사 MD에 근거 기록
- `CLAUDE-AUDIT.md`가 stale일 때 최신 상태로 갱신
- 사용자에게 중요한 충돌만 알림

**ChatGPT는 SSOT 애플리케이션 코드나 business logic을 직접 고치지 않는다.** 발견사항을 GitHub 감사로그에 남기고 Claude 구현 Owner가 처리한다.

---

## 2. 주기 감사

ChatGPT는 **매시간** FreePass SSOT 상태를 독립 검토한다.

검토 범위:

- `origin/main` 최근 변경
- `CLAUDE-AUDIT.md`
- `docs/AI-SSOT-AUDIT-LOG.md`
- 최신 날짜별 audit/decision 문서
- `lib/domain/inventory-source-registry.ts`
- production ERP5 workflow
- mirror / sales-hourly / RTDB writer topology
- F01/F86 projection 규칙
- 손오공/오토플러스 특수탭 계약
- 최근 CI/Actions/commit

의미 있는 변경·충돌·해소가 있을 때만 감사로그에 append한다. 변화가 없으면 문서를 불필요하게 갱신하지 않는다.

Claude 구현 Owner는 작업 시작/중간/완료 시 최신 감사로그를 읽고 대응한다.

---

## 3. 시작할 때 반드시 읽는 순서

1. `CLAUDE-AUDIT.md`
2. `docs/AI-SSOT-AUDIT-LOG.md`
3. `docs/ai-ssot-audit/2026-09-16-sonogong-autoplus-tab-routing.md`
4. `docs/ai-ssot-audit/2026-09-16-f86-hahuhho-sheet-audit.md`
5. 이 문서 `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

문서와 실제 코드/workflow가 다르면 **실행 현실을 우선**하고 감사로그를 갱신한다.

---

## 4. 지금 확정된 공통 사실

### ERP5 / Firestore 재고 원자

- ERP5 / Firestore가 재고 원자의 정본이다.
- F01, F86, Finder/고객면은 소비/output 면이다.
- projection에서 만든 값을 upstream SSOT로 역류시키지 않는다.

### F86

F86은 하허호가 과거에 보던 시트 UX를 유지하는 전용 projection/presentation이다.

현재 검증:

- 일반 종합 373대 = 일반 공급사별 탭 합계 373대
- 손오공 289대 별도 탭
- 오토플러스 68대 별도 탭
- F01 382대 vs F86 373대 차이 9대는 `RETRO_SHORT` 장기요금 필터에 의한 의도된 제외
- 해당 9대는 임의 복원하지 않는다.

### 손오공 / 오토플러스

- 손오공 별도 탭 유지
- 오토플러스 별도 탭 유지
- 각 공급사의 실제 기간/주행거리/요금구조 유지
- 일반 1/6/12/24/36/60 구조로 강제 표준화하지 않음
- 공통화는 레이아웃/기본 열/표현 양식만
- 손오공 중고렌트는 새 탭을 만들지 않고 손오공 탭의 반납형 상품군에 합류하는 방향
- ERP/API 실제 bucket 식별자는 데이터/코드로 확인하고 추측하지 않음

---

## 5. 아직 끝나지 않은 큰 SSOT 문제

현재 감사에서 남은 핵심:

1. production ERP5 collector가 검증 commit `eafbd88e43b1b4e5bacab858a2e0c65845956e5f`에 pin.
2. `MIRROR_SOURCES`에 RP023 오토플러스 옛 Google Sheet source 정의 잔존.
3. `.github/workflows/mirror-sync.yml` 자동 writer 잔존.
4. `.github/workflows/sales-erp-hourly.yml` → `hourly-sync.mts` 계열 판매시트/운영 RTDB writer 잔존.
5. source-contract CI가 전체 writer topology까지 완전히 막지 못함.

`inventory-source-registry.ts`만 정상이라고 전체 SSOT 단일화 완료로 판정하지 않는다.

---

## 6. Claude 구현 Owner 작업 방식

작업 전:

- `git fetch origin`
- current branch / local HEAD / `origin/main` 확인
- dirty working tree 보존
- ChatGPT 최신 감사 로그 확인

작업 중:

- 실제 writer/consumer topology부터 확인하고 제거/전환
- 다른 세션이 만든 변경을 추측으로 덮어쓰지 않음
- production pin과 current main을 분리해서 판단
- source/버킷/필터를 실행근거 없이 추측하지 않음

작업 후:

- branch → PR → CI → merge를 기본으로 함
- 실제 변경과 함께 감사결론도 최신화
- `본 것 / 확인됨 / 새 충돌 / 변경 / 검증 / 다음` 형식으로 결과 남김

---

## 7. ChatGPT 감사 결과를 Claude가 처리하는 방법

ChatGPT가 감사로그에 새 항목을 남기면 Claude 구현 Owner는:

1. 해당 근거 파일/로그를 직접 재확인한다.
2. 문제가 맞으면 같은 단일 세션에서 수정한다.
3. PR/CI/merge 후 기존 감사항목을 삭제하지 않는다.
4. 새 항목에 `해소됨`과 PR/commit SHA를 기록한다.
5. 다음 ChatGPT 시간 감사에서 실제 해소 여부를 다시 독립검증한다.

즉 운영 루프는 다음과 같다.

```text
Claude 단일 세션 구현
        ↓
GitHub main / CI / production 현실
        ↓
ChatGPT 매시간 독립 감사
        ↓
감사로그에 발견사항 기록
        ↓
Claude 단일 세션이 읽고 수정
        ↓
ChatGPT가 다음 감사에서 재검증
```

---

## 최종 원칙

> **ERP5 원자는 하나, 구현 Owner도 하나, 감사자는 별도다.**
>
> Claude 단일 세션이 FreePass SSOT를 실제로 만든다. ChatGPT는 코드를 빼앗아 병렬 수정하는 것이 아니라, 바깥에서 계속 검수하여 드리프트와 오판을 잡는다.
