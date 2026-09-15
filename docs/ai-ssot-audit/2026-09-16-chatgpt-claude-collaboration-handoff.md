# 2026-09-16 — ChatGPT ↔ Claude 협업 핸드오프

상태: **ACTIVE — 둘이 같은 SSOT와 감사기준을 보고 병렬 작업한다.**

이 문서는 ChatGPT와 Claude가 `freepasserp4 / freepasserp5 / 판매시트 / F86` 영역을 함께 작업할 때 사용하는 공통 핸드오프다.

목표는 하나다.

> **한 AI가 확인한 사실을 다른 AI가 다시 추측하지 않고, 같은 정본·같은 운영결정·같은 감사로그를 기준으로 다음 작업을 이어간다.**

---

## 1. 시작할 때 반드시 읽는 순서

1. `CLAUDE-AUDIT.md`
2. `docs/AI-SSOT-AUDIT-LOG.md`
3. `docs/ai-ssot-audit/2026-09-16-sonogong-autoplus-tab-routing.md`
4. `docs/ai-ssot-audit/2026-09-16-f86-hahuhho-sheet-audit.md`
5. 이 문서 `docs/ai-ssot-audit/2026-09-16-chatgpt-claude-collaboration-handoff.md`

문서 요약만 믿지 말고, 실제 코드·workflow·실행로그가 다르면 **코드/실행 현실을 우선**하고 감사로그를 갱신한다.

---

## 2. 지금 확정된 공통 사실

### 2-1. ERP5 / Firestore가 재고 원자의 정본

- F01 상품리스트, F86 하허호 전용 시트, Finder/고객면 등은 정본을 소비하는 면이다.
- F86을 별도 canonical source로 승격하지 않는다.
- projection/output에서 가공된 값을 upstream SSOT로 역류시키지 않는다.

### 2-2. F86의 역할

F86은 `F86) 프리패스x하허호 전용 상품시트`이며 **하허호가 과거에 보던 시트 UX를 유지하는 전용 projection/presentation**이다.

허용:

- 종합 + 공급사별 탭 구조
- 하허호가 보기 좋은 열 순서/표현/헤더
- 하허호 채널 전용 노출 필터

금지:

- F86 자체가 원천값의 정본이 되는 것
- F86 표시 요구를 ERP5 canonical atom 규칙으로 역수입하는 것
- F86에서 독자적으로 upstream 재고/가격/상태를 쓰는 것

### 2-3. F86 현재 검증 결과

동일 snapshot 기준:

- 일반 종합: 373대
- 일반 공급사별 탭 합계: 373대
- 손오공: 289대 — 별도 탭
- 오토플러스: 68대 — 별도 탭

내부 구조는 PASS다.

F01 일반 상품리스트 382대와 F86 일반 종합 373대의 9대 차이는 **누락이 아니다.**

확인된 규칙:

- `scripts/build-channel-supplier-sheet.mts`
- `RETRO_SHORT`
- 하허호는 장기렌트만 취급하므로 **장기요금이 하나도 없고 단기요금만 있는 차량은 F86에 싣지 않는다.**

9대:

- RP006 아이언 6대: `02하9092`, `29하9769`, `11하2307`, `13하4947`, `29하8070`, `17허7390`
- RP021 빌린카 2대: `100신0001`, `100신0002`
- RP032 에코렌트카 1대: `109호1780`

따라서 **9대를 F86에 복원하지 않는다.** 사업규칙이 변경될 때만 다시 판단한다.

### 2-4. 손오공 / 오토플러스 판매탭 원칙

- 손오공은 별도 탭 유지.
- 오토플러스도 별도 탭 유지.
- 일반 상품리스트의 `1/6/12/24/36/60` 구조에 억지로 맞추지 않는다.
- 각 공급사의 실제 기간/주행거리/요금 구조를 그대로 보존한다.
- 공통화는 **표의 레이아웃·기본 열·표현 양식**만 한다.
- 손오공 중고렌트는 별도 새 탭을 만들지 않고 손오공 탭의 반납형 상품군에 합류하는 방향이다. 실제 ERP/API 버킷 식별자는 실데이터/코드로 확인 후 연결하고 추측하지 않는다.

---

## 3. 아직 끝나지 않은 큰 SSOT 문제

F86 자체보다 더 큰 우선순위는 전체 writer topology다.

현재 감사에서 남은 핵심:

1. production ERP5 collector가 아직 검증 commit `eafbd88e43b1b4e5bacab858a2e0c65845956e5f`에 pin되어 있음.
2. `MIRROR_SOURCES`에 RP023 오토플러스의 옛 Google Sheet source 정의가 잔존.
3. `.github/workflows/mirror-sync.yml`의 자동 writer가 살아 있음.
4. `.github/workflows/sales-erp-hourly.yml` → `hourly-sync.mts` 계열의 판매시트/운영 RTDB writer가 살아 있음.
5. 현재 source-contract CI가 위 전체 writer topology를 완전히 막지 못함.

따라서 `inventory-source-registry.ts`만 맞다고 전체 SSOT 단일화가 끝났다고 판정하지 않는다.

---

## 4. Claude가 지금 작업할 때의 우선순위

### A. 먼저 현재 현실 동기화

- `git fetch origin`
- 현재 branch / local HEAD / `origin/main` HEAD 확인
- dirty working tree가 있으면 절대 덮어쓰지 않는다.
- 다른 AI/세션이 새 commit을 만들었으면 fetch 후 차이를 보고 작업을 이어간다.

### B. F86은 재설계하지 말고 검증·보존

- `RETRO_SHORT` 9대 제외 규칙을 유지한다.
- 일반 종합 373대 = 공급사 탭 합계 373대 invariance를 깨지 않는다.
- 손오공/오토플러스 별도 탭과 고유 요금구조를 유지한다.
- 필요하면 F86의 UX/과거 시트 모양만 고도화한다.

### C. 더 큰 우선순위는 writer topology 단일화

다음 순서로 실제 코드/워크플로를 검증한다.

1. `erp5-ssot-refresh.yml` production pin과 current main의 collector parity
2. `mirror-sync.yml`
3. `sales-erp-hourly.yml`
4. `sync-mirror-all.mts`
5. `hourly-sync.mts`
6. RTDB write 경로
7. `MIRROR_SOURCES`
8. source-contract / writer-topology CI

바로 제거부터 하지 말고 **각 writer가 현재 무엇을 쓰고 누가 소비하는지 topology를 먼저 확정**한다.

---

## 5. ChatGPT ↔ Claude 병렬 작업 규칙

### 서로 하지 말아야 할 것

- 다른 AI가 수정 중인 파일을 추측으로 덮어쓰지 않는다.
- 오래된 요약만 보고 “이미 해결됨/아직 문제”라고 단정하지 않는다.
- production pin과 current main을 섞어서 설명하지 않는다.
- 실행 근거 없이 source/버킷/필터를 추측하지 않는다.
- CI green 하나만으로 전체 SSOT 정상이라고 판정하지 않는다.

### 새 사실을 발견하면

1. 실제 파일/로그/데이터 근거를 확보한다.
2. `docs/AI-SSOT-AUDIT-LOG.md` 또는 날짜별 audit 문서에 append한다.
3. 상태를 `확인됨 / 충돌 / 보류 / 해소됨`으로 적는다.
4. 해결 시 PR/commit SHA를 남긴다.
5. 다른 AI가 바로 이어받을 수 있게 “다음 작업”을 1~3개로 적는다.

### 코드 변경 방식

- 구조 변경은 가급적 branch → PR → CI → merge.
- 현재 main에서 다른 AI가 동시에 작업 중이면 반드시 최신 `origin/main`을 다시 확인한 뒤 branch를 딴다.
- 문서도 가능하면 코드 변경 PR 안에 같이 넣어 실제 변경과 감사기록이 분리되지 않게 한다.

---

## 6. Claude의 결과 보고 형식

작업 후 아래 6개만 짧게 보고한다.

1. **본 것:** 실제로 읽은 핵심 파일/워크플로
2. **확인됨:** 기존 판단과 일치한 사실
3. **새 충돌:** 새로 발견한 문제
4. **변경:** 실제 수정 파일과 핵심 내용
5. **검증:** dry-run / 테스트 / CI / 실데이터 대사 결과
6. **다음:** ChatGPT 또는 Claude가 이어서 할 1~3개 작업

가능하면 commit/PR 번호를 같이 적는다.

---

## 7. 지금 Claude에게 맡길 첫 작업

**F86을 다시 뜯어고치는 작업이 아니다.**

먼저 현재 main에서 다음을 교차확인한다.

1. `RETRO_SHORT`/장기요금 필터가 current main 또는 실제 production F86 builder 경로에도 동일하게 존재하는지 확인.
   - 감사로그의 증거는 `erp5` 워크트리 `freepasserp4-rtdb-current`에서 확인된 이력이 있으므로, **현재 main/실행 workflow와의 동일성까지 명시적으로 확인**한다.
2. F86 builder가 실제 어느 snapshot/Firestore 경로를 소비하는지 현재 production workflow 기준으로 확인.
3. 그 결과가 맞으면 F86은 건드리지 않고, writer topology 단일화 문제로 넘어간다.

이 3개를 끝내면 감사로그에 결과를 append하고 다음 작업을 이어간다.

---

## 최종 원칙

> **ERP5 원자는 하나, 출력은 여러 개다.**
>
> F01은 F01 방식으로, F86은 하허호가 보는 방식으로, 손오공/오토플러스는 각 상품 구조대로 보여줄 수 있다. 그러나 원천 재고·상태·가격의 정본은 갈라지지 않는다.

ChatGPT와 Claude는 각자 다른 해석을 만드는 것이 아니라, **같은 정본을 보고 서로 검증하는 두 번째 눈**으로 움직인다.
