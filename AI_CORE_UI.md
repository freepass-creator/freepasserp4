# AI Core UI Reference — freepasserp4

상태: **PROJECT POINTER**  
기준일: 2026-09-19  
프로필: **ERP4 / White Label**

이 파일은 프로젝트 UI 정본을 복사하지 않는다. FreePass 계열 공통 UI/UX 작업에서 AI Core의 상위 공통 매뉴얼을 찾는 고정 진입점이다.

## 공통 매뉴얼

Canonical repository:
- `freepass-creator/ai-core`

Canonical paths:
- `docs/FREEPASS_UI_STANDARD.md`
- `docs/SCREEN_DESIGN_STANDARD.md`
- `design-system/freepass-ui-standard.json`
- `docs/coordination/UI_LEARNING_INTAKE.md`

현재 도입 PR:
- AI Core PR #87 — FreePass 공통 모바일·업무화면 디자인 규격 v1

## 작업 시작 규칙

UI/UX를 새로 만들거나 수정하기 전에:

1. 사용자의 최신 명시 결정을 확인한다.
2. AI Core의 현재 `docs/FREEPASS_UI_STANDARD.md`를 읽고 **읽은 AI Core commit SHA**를 작업 기록/PR에 남긴다.
3. 이 프로젝트의 local UI/UX SSOT와 실제 구현을 읽는다.
4. 공통 행동 문법과 제품 고유 규격을 분리한다.
5. 충돌하면 조용히 한쪽을 덮지 말고 Product Profile exception 또는 HOLD로 남긴다.

AI Core 경로를 읽을 수 없으면 예전 기억으로 추정 적용하지 않는다. local SSOT를 유지하고 공통 규격 상태를 UNKNOWN/HOLD로 기록한다.

## 소유권

AI Core가 소유:
- 모바일 depth
- top/header와 bottom action의 역할
- touch/action hierarchy
- list interaction contract
- state/accessibility contract
- 공통 검증/학습 승격 규칙

이 프로젝트가 계속 소유:
- 업무 의미
- 브랜드/CI
- 메뉴명과 실제 업무 흐름
- 데이터/도메인 SSOT
- 제품별 정보 밀도와 허용 예외
- 실제 배포/운영

## 프로젝트가 더 앞섰을 때

이 프로젝트에서 AI Core보다 나은 패턴을 실제로 구현·검증하면 되돌려 맞추지 않는다.

`docs/coordination/UI_LEARNING_INTAKE.md` 형식에 맞춰 local MD에:
- source revision
- before failure
- 새 pattern
- rendered/static evidence
- counterexample
- 적용/비적용 조건
- product-owned 부분
- common candidate
- unknowns

를 남기고 AI Core에는 **요약 + pointer**만 전달한다.

승격 상태:
`CANDIDATE → PROJECT_VERIFIED → CROSS_PROJECT_VERIFIED → COMMON_ADOPTED`

문서 존재, CI green, render 검증, 사용자 승인을 같은 상태로 취급하지 않는다.
