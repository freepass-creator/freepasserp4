---

## 2026-09-17(31) — ChatGPT 독립 감사: “재활성화” 뒤에도 schedule event 0건 — canonical hourly delivery gap 재오픈

**판정: 운영 schedule-delivery/enablement drift를 다시 OPEN으로 판정한다. 정확한 disabled/root cause는 이번 감사에서 단정하지 않는다.**

- current main `.github/workflows/erp5-ssot-refresh.yml`은 계속 `cron: '5 0-10 * * 1-6'`(월~토 KST 09:05~19:05)과 production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`을 선언한다.
- 그러나 2026-09-17 20:23 KST 기준 GitHub Actions `event=schedule&created=2026-09-17` 조회는 **`total_count: 0`**이다. 오늘은 목요일이고 마지막 예정 시각 19:05도 지났으므로, 선언된 canonical cron이 정상 전달됐다면 scheduled run이 있어야 한다.
- 마지막 관측 canonical scheduled run은 `35053074482`, 2026-09-16 12:46:35 KST, success다. audit (23)에서 workflow disabled가 확인된 뒤 Claude 구현 로그는 F86 A1 fix 후 `disabled_manually → active`로 재활성화했다고 기록했지만, 그 뒤 실제 scheduled dispatch 증거는 이번 조회에서 **0건**이다.
- 따라서 “canonical hourly가 복구됐다”는 상태를 운영 사실로 두면 안 된다. 이번 감사 도구로 실제 UI enabled state/왜 dispatch되지 않았는지까지 독립 확정하지 않았으므로 원인은 단정하지 않고 **schedule delivery/enablement OPEN**으로 되돌린다.
- one-time run `35208040283`은 audit (30)대로 F86 values publish 성공 증거이지만, canonical source→Atom→snapshot→F01/F86 **scheduled full-run**의 대체 증거가 아니다.
- audit (30)의 F86 A1 production 해소 판정은 유지한다. audit (23) freshness checker, audit (27) deposit recurrence, audit (28) vehicle-price semantics, audit (29) sales-tab migration 및 legacy mirror/sales writer ownership HOLD도 유지한다.
- audit (30) 이후 main 신규 변경은 이안카 사이트/계정 진단용 read-only workflow/script 계열이며 core SSOT schedule gap을 해소한 변경은 확인되지 않았다.
- canonical source는 계속 RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar다.

### Claude 구현 Owner 인계

1. `erp5-ssot-refresh.yml`의 실제 GitHub Actions enabled state와 schedule delivery를 확인한다.
2. 자동 운용이 의도라면 **실제 `event=schedule` run**이 다시 생성되는 것까지 증명한다. workflow_dispatch/one-time run으로 대체하지 않는다.
3. 그 scheduled run이 current pin에서 source→Atom→snapshot→F01/F86을 지나도록 확인하고, audit (23) freshness checker 정렬 후 F86 audit/cross-audit 전체 green을 확보한다.
4. schedule event 부재를 writer retirement로 볼 경우 repository cron/예약지도/ownership 계약도 그 의도와 일치해야 한다.

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit31-canonical-schedule-delivery-reopen.md`.

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.
