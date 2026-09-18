# Audit 49 — PR #410 병합 뒤 첫 `:17` scheduled evidence 부재

Date: 2026-09-18
Auditor: ChatGPT (independent SSOT audit)
Repository: `freepass-creator/freepasserp4`

## Finding

Audit (48)은 PR #410 merge로 canonical ERP5 schedule이 `:05 → :17`로 바뀐 code/config 상태까지만 확인했고, 감사 시작 당시 첫 post-merge `:17` 회차가 아직 오지 않았기 때문에 cadence runtime proof를 HOLD로 남겼다.

이번 재검수 시점은 첫 post-merge 예정 회차인 **2026-09-18 17:17 KST 이후**다. GitHub Actions repository-wide `event=schedule` 목록을 다시 조회했지만 최신 schedule run은 여전히:

- run `35304903901`
- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- created: `2026-09-18T03:53:42Z` = **12:53:42 KST**
- head: `5088dd5df3882bef43b1cb56c18e1dba5d529888`
- conclusion: `failure` (기존 F86 freshness checker false-positive)

이다. 즉 **PR #410 merge 이후 첫 `:17` 슬롯이 GitHub Actions의 schedule event로 아직 생성된 증거가 없다.**

이것은 `:17` 변경 자체가 잘못됐다는 뜻은 아니다. GitHub scheduled workflow는 지연될 수 있으므로 현재 판정은 **cadence 복구 미증명 / 첫 post-merge 슬롯 delayed-or-missing**이다. 다음 `:17` 슬롯들이 실제 `event=schedule`로 연속 생성되는지 확인하기 전에는 schedule punctuality/cadence HOLD를 닫으면 안 된다.

## Live-state cross-check

- current canonical workflow: `.github/workflows/erp5-ssot-refresh.yml` = `17 0-10 * * 1-6` (월~토 KST 09:17~19:17)
- production engine pin: `14892951a929cf03796231f260e6bc2ff3060efc`
- PR #411 F86 freshness checker fix: draft/open, merged=false, production 미승격
- canonical inventory registry unchanged: RP006 Iron website, RP012 Sonogong ERP API, RP023 RebornCar, RP031 Google Sheet
- legacy writer topology unchanged:
  - `mirror-sync.yml`: `*/30 * * * *` + scheduled `--apply`
  - `sales-erp-hourly.yml`: 평일 KST 09:00~18:00 scheduled apply
  - `settlement-sync.yml`: 월~토 KST 09:05~18:05 scheduled ledger→supplier-status writer
  - `MIRROR_SOURCES` RP023 still points to old Google Sheet `1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U`
- F86 production rules unchanged: `종합`만 발행시각, 회사 탭은 `회사 · N대`; 장기요금 없는 차량도 싣고 요금칸만 빈다.
- RP031 provenance, Sonogong/AutoPlus special-tab/deposit-policy HOLD, audit (27)/(28)/(29)/(34) remain unchanged.

## Decision

1. Audit (48)의 “첫 `:17` 예정 회차가 아직 오지 않음” 설명은 stale다.
2. `CLAUDE-AUDIT.md`를 audit (49)로 갱신한다: 첫 post-merge `:17` 슬롯 이후에도 schedule event가 아직 관측되지 않았고 cadence HOLD는 유지한다.
3. application code/business logic은 수정하지 않는다. Claude 단일 SSOT 구현 세션만 remediation을 판단한다.
