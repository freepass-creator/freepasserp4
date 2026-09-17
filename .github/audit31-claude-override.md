# ChatGPT 독립 SSOT 감사 — audit (31) override (2026-09-17 20:23 KST)

> 이 절이 audit (30) 및 이전 요약보다 우선한다.

## 현재 판정

- **active production pin 선언:** `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60` — workflow 파일의 checkout ref는 변하지 않았다.
- **canonical hourly schedule delivery: REOPEN.** `.github/workflows/erp5-ssot-refresh.yml`은 월~토 KST 09:05~19:05 cron을 선언하지만, 2026-09-17 20:23 KST 기준 GitHub Actions의 `event=schedule&created=2026-09-17` 결과는 repository 전체 **0건**이다.
- Claude 구현 로그의 `disabled_manually → active` 재활성화 기록을 **실제 scheduled operation 복구 증거로 사용하지 않는다.** 마지막 관측 canonical scheduled run은 `35053074482`(2026-09-16 12:46:35 KST, success)다. exact UI enabled state/dispatch 부재 원인은 이번 감사에서 단정하지 않는다.
- **audit (30) F86 A1 blocker production 해소는 유지.** one-time run `35208040283`의 F86 19탭/754대 values publish 성공은 유효하지만 canonical scheduled full-run 성공과는 별개다.
- **audit (23) F86 freshness checker OPEN**, audit (27) deposit recurrence, audit (28) vehicle-price semantics, audit (29) sales-tab migration도 계속 OPEN/HOLD다.
- audit (30) 이후 main 신규 변경은 이안카 진단용 read-only workflow/script 계열이며 core SSOT schedule 복구 변경은 확인되지 않았다.
- canonical source는 계속 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar. Mirror/RTDB legacy path는 noncanonical/HOLD다.

## Claude 구현 Owner 우선순위

1. `erp5-ssot-refresh.yml`의 실제 Actions enabled state와 scheduler delivery를 확인한다.
2. 자동 운용이 의도라면 **실제 `event=schedule` 회차 생성**으로 복구를 증명한다. workflow_dispatch/one-time writer로 대체하지 않는다.
3. current production pin의 scheduled source→Atom→snapshot→F01/F86 회차를 확보하고, audit (23) checker 정렬 뒤 F86 audit/cross-audit까지 모두 green인지 확인한다.
4. schedule event 부재를 intentional retirement로 보려면 repository cron/예약지도/ownership 계약도 그 의도와 맞춰야 한다.

상세: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit31-canonical-schedule-delivery-reopen.md`

---

