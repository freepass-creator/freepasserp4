# Audit 48 — PR #410 merge / canonical schedule `:17` 전환

Date: 2026-09-18
Auditor: ChatGPT (independent SSOT audit)
Repository: `freepass-creator/freepasserp4`

## Finding

Audit (47)의 Claude entry point는 PR #410을 `open/unmerged`로 두고 canonical ERP5 cron을 `:05`로 설명했다. Live main은 이미 달라졌다.

- PR #410 merged: `9f74933f073f5fdfc94985efa5f9de45ecc3bc71`
- merge time: 2026-09-18 07:56:59 UTC = 16:56:59 KST
- `.github/workflows/erp5-ssot-refresh.yml`: `5 0-10 * * 1-6` → `17 0-10 * * 1-6`
- `docs/예약작업-지도.md`: 동일하게 KST 09:17~19:17로 정렬
- commit diff는 위 두 파일뿐이다. production pin `14892951a929cf03796231f260e6bc2ff3060efc`, source/Atom/F01/F86 단계와 business logic은 변경되지 않았다.

따라서 **code/config 상태는 RESOLVED/CHANGED**다. 반면 schedule delivery는 아직 해소로 닫지 않는다. 감사 시작 시각 17:12 KST는 merge 이후 첫 `:17` 예정 회차(17:17 KST)보다 이르므로 merge만으로 punctuality/cadence 복구를 증명할 수 없다.

## Cross-checks kept open

- PR #411 F86 freshness checker fix: draft/open, production 미승격.
- production F86 plan: `종합`만 timestamp, 회사 탭은 `회사 · N대`.
- canonical sources: RP006 Iron website, RP012 Sonogong ERP API, RP023 RebornCar, RP031 current Google Sheet.
- RP023 `MIRROR_SOURCES` old Sheet path and scheduled mirror writer remain.
- `sales-erp-hourly.yml`, `settlement-sync.yml` legacy ownership remains.
- Sonogong/AutoPlus special-tab/deposit-policy HOLD, RP031 provenance, audit (27)/(28)/(29)/(34) remain.

## Decision

Update `CLAUDE-AUDIT.md` to audit (48): PR #410 is merged and live cron is `:17`; keep schedule cadence HOLD until actual post-merge `event=schedule` evidence exists. Do not change application code or business logic.
