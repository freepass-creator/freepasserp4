# ChatGPT 독립 SSOT 감사 — audit (43) override (2026-09-18 KST)

> Claude 구현 세션은 이 파일을 최신 독립 감사 진입점으로 본다. audit (43)은 audit (42)의 RP031 판정을 유지하면서 **scheduled event delivery가 다시 멈춘 운영 회귀**를 최우선으로 추가한다.

## 현재 판정

- **OPEN / 운영 회귀 — scheduled event delivery 미생성.** 2026-09-18 10:21 KST 기준 repository 전체 최신 `event=schedule`은 전날 23:47:38 KST의 ERP5 run `35235961510`이다. 그 뒤 schedule run이 없다.
- current main은 여전히 `mirror-sync.yml` 30분, `sales-erp-hourly.yml` 평일 KST 09:00~18:00, `erp5-ssot-refresh.yml` 월~토 KST 09:05~19:05를 선언한다. 따라서 오늘 10:21까지 sales 09:00/10:00, ERP5 09:05/10:05, mirror 다수 회차가 생성됐어야 하나 repository-wide schedule event가 없다.
- push/manual Actions는 같은 오전에도 실행되고 있으므로 **GitHub Actions 전체 중단으로 단정하지 않는다.** workflow disabled인지 scheduler delivery 문제인지 원인은 아직 미확정이다.
- audit (35)에서 run `35235961510` 하나가 늦게 재출현해 schedule delivery 존재를 확인했지만 cadence/timeliness는 HOLD였다. 이번 상태는 그 HOLD를 더 강하게 재확인한다. 수동 dispatch나 newest Atom timestamp를 자동 schedule 복구 증거로 쓰면 안 된다.
- production pin은 계속 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`이다. audit (35)의 F86 freshness checker contract drift도 그대로 OPEN이다.
- **RESOLVED / PARTIAL — audit (42) RP031.** PR #403 merge `88b16da5c07a1091eba401540891c41280731408`로 기존 non-empty canonical `세부모델` destructive overwrite는 해소됐다. 전용 차명 칼럼이 없을 때 `세부모델` fallback은 FILLIFEMPTY다.
- **OPEN / HOLD — RP031 identity/finance boundary.** blank `세부모델`에는 API rawName이 들어갈 수 있고 같은 필드가 rendered-DOM finance lookup alias로 쓰일 수 있다. `rawName=subModel`, deterministic `model/plate/term/mileage/deposit` mapping, finance provenance/authority는 아직 미증명이다. 실제 RP031 Sheet의 `연식` 칼럼 부재도 유지된다.
- audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming, audit (34) newest-Atom freshness semantics, mirror/sales/settlement/RTDB legacy writer HOLD는 그대로다.

## Claude 구현 Owner 우선순위

1. **GitHub workflow enabled 상태와 schedule delivery를 먼저 확인한다.** 원인이 확인되기 전 코드 원인으로 단정하지 않는다.
2. 복구 판정은 선언 시간대에 실제 `event=schedule` run이 연속 생성되는 것으로만 한다. `workflow_dispatch` 성공이나 Atom 최신시각만으로 닫지 않는다.
3. 별도로 audit (35)의 F86 freshness parser/탭명 계약을 current F86 plan과 정렬하고, 실제 scheduled canonical full-run green을 증명한다.
4. PR #403의 RP031 FILLIFEMPTY 안전화는 유지하되 canonical identity 승인으로 확대하지 않는다. blank 신규행의 rawName/subModel 의미, deterministic finance join, provenance/parity, `연식` schema gap을 먼저 닫는다.
5. 위 경계를 닫기 전 RP031 `--쓰기` / scheduled writer / production repin을 승인하지 않는다.
6. 기존 audit (27)/(28)/(29)/(34) 및 legacy writer HOLD는 별도 해소 증거가 생길 때까지 유지한다.

## 상세 근거

- `docs/AI-SSOT-AUDIT-LOG.md` — audit (43)
- `docs/ai-ssot-audit/2026-09-18-chatgpt-audit43-schedule-delivery-regression.md`
- latest repository-wide scheduled run `35235961510` — 2026-09-17 23:47:38 KST, failure
- `.github/workflows/erp5-ssot-refresh.yml` — cron `5 0-10 * * 1-6`, production pin `9bef7bf0...`
- `.github/workflows/sales-erp-hourly.yml` — cron `0 0-9 * * 1-5`
- `.github/workflows/mirror-sync.yml` — cron `*/30 * * * *`
- audit (42) evidence: `docs/ai-ssot-audit/2026-09-18-chatgpt-audit42-ianka-fillifempty-resolution.md`

이번 독립 감사에서는 application code/business logic을 수정하지 않는다. 구현 변경은 Claude 단일 SSOT 세션만 수행한다.
