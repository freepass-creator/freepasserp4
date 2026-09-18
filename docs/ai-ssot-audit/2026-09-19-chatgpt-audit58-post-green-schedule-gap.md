# 2026-09-19 ChatGPT audit 58 — post-green schedule gap / enabled contract-status mismatch

상태: **OPEN — operational schedule delivery/runtime-state drift**

## 확인한 사실

1. `origin/main` application 기준점은 audit (57) 이후 변하지 않았다. audited application HEAD는 `dc6c5cf16146c7439f5a5293383d503e8e30d00d`; latest push CI run `35350559341`은 success다.
2. audit (57)의 scheduled production run `35347508078`은 유효하다. 2026-09-18 21:58:18 KST에 `event=schedule`, conclusion `success`, production pin `cf940df642edf315adbc6da2b4134fbad53da160`을 checkout해 source registry/ingest/snapshot/F01/F86/freshness/cross-parity/photo-link 전 구간을 green으로 완료했다.
3. 이후 schedule event가 다시 낔겼다. 2026-09-19 02:25 KST 재조회에서 `GET /actions/runs?event=schedule&created=>2026-09-18T13:00:00Z` 결과는 `total_count=0`이었다. 즉 22:00 KST 이후 repository-wide scheduled event가 하나도 없다.
4. `docs/예약작업-지도.md`는 `contract-status.yml`을 `켜짐`으로 명시한다. 실제 `.github/workflows/contract-status.yml`은 `*/30 * * * *`이고 schedule이면 `mark-contract-in-listings.mts --apply`를 실행한다. 22:00부터 02:00까지 기대되는 9회가 모두 없다.
5. 같은 지도에서 `mirror-sync`와 `sales-erp-hourly`는 꺼짐이다. `settlement-sync`는 09:05~18:05 KST이고 ERP5 refresh는 09:17~19:17 KST다. 따라서 야간 공백은 적어도 `contract-status`의 문서화된 ON/runtime 상태 또는 GitHub schedule delivery와 직접 충돌한다.

## 판정

- audit (57)의 **scheduled end-to-end green**은 취소하지 않는다.
- 하지만 그것을 scheduler/cadence 복구로 해석하면 안 된다. 그 green 직후, 24/7 30분 writer가 켜짐으로 선언돼 있음에도 9회 연속 event가 없다.
- root cause는 두 후보로 남긴다.
  1. GitHub UI에서 `contract-status`가 disabled인데 `docs/예약작업-지도.md`가 stale.
  2. workflow는 enabled이나 GitHub scheduled-event delivery가 다시 누락/지연.
- 어느 경우든 자동운영 GO는 HOLD다. Claude는 **UI enabled/disabled 실상과 예약지도 일치 여부를 먼저 확정**하고, enabled라면 실제 `event=schedule` 연속 도착을 확인해야 한다.

## 변경 없는 SSOT 경계 재확인

- canonical inventory registry: RP006=ironrentcar.com, RP012=sokrc.com API, RP023=RebornCar, RP031=Google Sheet.
- production engine pin: `cf940df642edf315adbc6da2b4134fbad53da160`.
- production `MASTER_CATEGORY_COLORS['분류'].신차렌트 = #FF00FF` 유지.
- production special-tab은 오공구독/픽업구독/오플구독 구조를 유지하고, main `deposit-policy.ts`와 production pin의 단일정의 차이는 여전히 HOLD다.
- `MIRROR_SOURCES` RP023 old Google Sheet, settlement legacy `정산`, `LEDGER` vs `정산원장` contract-lock dual writer, RP031 API/DOM finance provenance, vehicle-price lineage, sales-tab naming, newest-Atom freshness, `/inventory` ERP4 read/write boundary는 미해소 유지.

## Claude 구현 Owner 다음 확인

1. GitHub Actions UI에서 `contract-status.yml` enabled/disabled를 확인핔 `docs/예약작업-지도.md`와 맞춘다.
2. enabled라면 왜 22:00~02:00의 9개 schedule event가 생성되지 않았는지 확인한다.
3. disabled가 의도라면 YAML cron/scheduled `--apply`와 예약지도를 fail-closed 상태로 정리한다.
4. contract-lock owner 단일화와 settlement legacy writer retirement는 기존 우선순위를 유지한다.

이번 감사에서는 application code/business logic을 수정하지 않았다.
