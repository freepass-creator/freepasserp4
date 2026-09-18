# ChatGPT → Claude SSOT 감사 진입점 — audit (45) override

> 이 파일은 구현 지시의 최신 진입점이다. Claude 단일 SSOT 세션만 application/business logic을 수정한다. ChatGPT는 독립 감사·증거 기록만 한다.

## 최신 판정

### 1) OPEN — F86 freshness checker false-negative가 실제 scheduled production을 red로 만든다
canonical scheduled run `35304903901`은 ingest → Atom lock → snapshot → F01 → F86 publish까지 실제 완료했다.

- current snapshot / F01 / F86: 682대.
- 후속 `원자 ↔ F01 ↔ F86` 감사: missing 0 / extra 0 / value diff 0.
- 사진 링크 감사: diff 0.
- `audit-f86-vs-atom` 내부 freshness: oldest 0분(허용 120분).
- 같은 checker의 cell parity: 19 tabs / 1,071 rows / 44,462 cells / mismatch 0.
- 그런데 현재 publisher tab names를 `탭 이름에 발행 시각이 없다`로 19갈래 오판해 exit 1.

**우선순위 1:** publisher/tab naming을 checker 때문에 되돌리지 말고, `audit-f86-vs-atom`이 현재 발행 metadata/시각 계약을 읽도록 수정한 뒤 scheduled/apply 회차에서 freshness + cell parity가 함께 green인 증거를 남긴다.

### 2) RESOLVED(code/contract), 운영 증명 대기 — 신차렌트 색 production-pin drift
PR #409 / main `5bfc9ad5d6e5269d2217f60552cf8c5df402aa9c`에서 production pin이 `14892951a929cf03796231f260e6bc2ff3060efc`로 상승했다. 이 pin은 `신차렌트=#FF00FF`, pink web badge, publisher color-SSOT 참조를 포함한다. `SSOT Source Contract` run `35305111467`은 성공했다.

단 run `35305115126`은 manual `apply=false`라 F01/F86 publish가 skip됐다. **신규 pin으로 실제 full apply 뒤 FF00FF가 재역전되지 않는 운영 증명**은 아직 필요하다.

### 3) RESOLVED/PARTIAL — schedule delivery
audit (43)/(44)의 “2026-09-17 23:47 KST 이후 scheduled event 0건”은 stale하다. canonical ERP5 `event=schedule` run `35304903901`이 2026-09-18 12:53:42 KST에 실제 도착했다.

다만 cron `:05` 대비 큰 지연이므로 scheduler punctuality가 정상화됐다고 단정하지 않는다. 다음 회차 지속 도착 여부는 계속 관측한다.

### 4) OPEN/HOLD — RP031 provenance
RP031 canonical registry는 계속 Google Sheet(`1fJu...`)다. audit (44)에서 API inventory + rendered-DOM finance feeder가 canonical Sheet에 실제 write한 crossing은 되돌아가지 않았다. backup↔live diff, 신규/변경 identity, 389 finance cells의 provenance와 deterministic mapping 증명이 끝나기 전 DOM-derived finance를 독립 authoritative SSOT로 승격하지 않는다.

### 5) 기존 HOLD 유지
직접 해소 증거가 없는 다음 항목은 유지한다.

- RP023 canonical RebornCar vs legacy `MIRROR_SOURCES` sheet source.
- `mirror-sync.yml` 30분 scheduled apply writer.
- `sales-erp-hourly.yml` 평일 scheduled apply writer.
- `settlement-sync.yml` legacy ledger→supplier-status writer.
- audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage, audit (29) sales-tab naming, audit (34) newest-Atom freshness semantics 및 기타 이전 미해소 HOLD.

## 근거

- 중앙 로그: `docs/AI-SSOT-AUDIT-LOG.md` → `2026-09-18(45)`.
- 상세 증거: `docs/ai-ssot-audit/2026-09-18-chatgpt-audit45-schedule-resume-color-pin-f86-checker.md`.
- 비교 기준: audit (44) commit `5a3b9c2e2a851256456accf8ecaad717926a466a` → 관측 main `5bfc9ad5d6e5269d2217f60552cf8c5df402aa9c`.

**구현은 Claude 단일 SSOT 세션만 수행한다.**
