# 미입력 표시 SSOT — 2026-09-15

## 확정 규칙

- 원본·정제 Firestore 원자는 빈값과 근거 상태를 보존한다.
- 판매시트와 ERP는 `lib/domain/missing-value-display.ts` 한 곳에서 표시 상태를 판정한다.
- 필수 항목의 빈값은 `미입력`, 명시적인 옵션 없음은 `없음`, 차종상 적용되지 않는 배기량·배터리는 `해당없음`으로 표시한다.
- `option_evidence_status=PASS`는 근거 확인 상태이며 옵션 없음의 증명이 아니다. PASS여도 값이 비면 `미입력`이다.
- 숫자 `0`은 값으로 보존한다.
- 판매시트를 ERP가 다시 읽을 때 `미입력`과 제원 `해당없음`은 원자에 넣지 않는다. 옵션 `없음`은 명시적 업무값으로 왕복 보존한다.
- 판매 옵션은 `원문.옵션`을 우선하고, authoritative 판매시트 재유입 뒤에는 `options`로 폴백한다.

## 실제 소비 경로

- 현재 원자 발행: `lib/domain/sales-atom-row.ts`
- ERP 옵션: `components/product-card-options.tsx`
- 판매시트 역유입 문지기: `lib/domain/sheet-import.ts`
- ERP4 호환 발행: `scripts/make-sample-sheet-google.mts` — 정책·파트너도 Firestore `policy`/`partner`만 읽는다.

## 2026-09-15 라이브 읽기 감사

- Firestore 현재 재고: 658대
- 모델·세부모델 미입력: 각 0대
- 세부트림 51대, 외장 8대, 내장 236대, 연식 8대, Km 14대, 연료 3대, 차종구분 71대 미입력
- 원산지 1대, 구동 132대, 인승 138대, 배터리용량 109대, 옵션 120대, 정책UID 250대 미입력
- 손오공 RP012 현재 재고 293대: 옵션 값 194대, 미입력 99대. 빈값을 `없음`으로 승격하지 않았다.

재현: `npm run audit:missing-display`

## 검증

- source-registry: `check:pipeline`, `check:axes`, `check:manual`, TypeScript, `audit:missing-display`, `git diff --check` 통과
- ERP4 호환: `check:missing-display`, `check:ui`, TypeScript, `git diff --check` 통과
- 최종 검토 스냅샷: source `c037a817388ea8492852e660df75cb7d766fb7ff40ed218fa2f99dbe26e36d29`, ERP4 `8a79ffe54ff4e063f53c84d099f192b54001ae6728349b9836809afa2d175c5a`
- Codex OK, Cursor Agent 독립 OK. Claude Code는 주간 한도, Gemini CLI는 신뢰 폴더 정책으로 응답 실패했으며 OK로 세지 않았다.

