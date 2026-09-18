# ChatGPT 독립 SSOT 감사 (45) — schedule 재도착 + 색 production pin 해소 + F86 checker false-negative

- 날짜: 2026-09-18 KST
- 역할: 독립 auditor. application/business logic 비수정.
- 비교 기준: audit (44) 기록 commit `5a3b9c2e2a851256456accf8ecaad717926a466a` → 관측 main `5bfc9ad5d6e5269d2217f60552cf8c5df402aa9c`.
- current production pin: `14892951a929cf03796231f260e6bc2ff3060efc`.

## 1. audit (44)의 상품구분 색 production-pin drift는 코드/계약 수준에서 해소

PR #409 merge commit `5bfc9ad5d6e5269d2217f60552cf8c5df402aa9c`은 `.github/workflows/erp5-ssot-refresh.yml`의 production pin을 `9bef7bf0...`에서 `14892951a929cf03796231f260e6bc2ff3060efc`로 올렸다. 같은 변경에서 `scripts/check-inventory-source-contract.mts`의 `VALIDATED_ENGINES`에도 신규 pin이 등록됐다.

신규 pin `14892951...`은 `MASTER_CATEGORY_COLORS['분류']['신차렌트']`를 `#FF00FF`로 유지하고, F86/종합 publisher가 literal이 아니라 그 SSOT를 참조하도록 정렬한다. current main의 `SSOT Source Contract` run `35305111467`도 성공했다.

따라서 audit (44)의 **“production pin은 아직 `#B81A8C` lineage”** 판정은 stale이며 **RESOLVED(code/contract)** 로 바꾼다.

다만 run `35305115126`은 신규 pin으로 source checks/ingest dry-run은 성공했으나 manual `apply=false` 경로라 F01/F86 publish 단계가 모두 skip됐다. 그러므로 **신규 pin으로 실제 full F01/F86 publish 뒤 `#FF00FF`가 유지됐다는 운영 증명은 아직 없음**으로 남긴다.

## 2. audit (43)/(44)의 “scheduled event 0건”은 더 이상 사실이 아님 — delivery 재도착

`event=schedule` 최신 목록에 ERP5 canonical workflow run `35304903901`이 새로 나타났다.

- event: `schedule`
- created/run_started: `2026-09-18T03:53:42Z` = 2026-09-18 12:53:42 KST
- head: `5088dd5df3882bef43b1cb56c18e1dba5d529888`
- workflow: `ERP5 SSOT 원천 최신화(매시간)`
- conclusion: `failure`

따라서 audit (43)/(44)의 **“latest scheduled event가 2026-09-17 23:47 KST에서 멈춤”**은 **RESOLVED as delivery-resumed**다. 단 이 run은 cron의 `:05` 슬롯보다 크게 늦게 생성됐으므로 scheduler의 정상 punctuality까지 증명된 것으로 보지 않는다.

## 3. 새 scheduled run은 data publish 자체가 아니라 F86 freshness checker의 tab-name 계약 때문에 red

run `35304903901`의 raw job log를 단계별로 재검증했다. 이 회차는 #409 merge 직전 시작되어 old pin `9bef7bf0...`을 사용했지만, canonical pipeline의 실제 apply 회차로서 다음을 성공했다.

- 정산원장 접수·취소 → ERP5 Atom 계약락: success.
- 24개 공급사 ingest: success.
- policy reconcile / snapshot / public verify: success.
- snapshot current: **682대**.
- F01 publish: 상품리스트 389 + 오공구독 42 + 픽업구독 192 + 오플구독 59 = **682대**.
- F86 publish: **682대 / 19 tabs** success.
- `audit-f86-vs-atom` 내부 freshness 계산: **oldest tab 0분 (허용 120분)**.
- 같은 checker의 칸 대조: **19 tabs / 1,071 vehicle rows / 44,462 cells / mismatch 0**.
- 후속 `원자 ↔ F01 ↔ F86 칸 단위 대조`: missing 0 / extra 0 / value diff 0, `✓ 시트가 원자대로 박혔다`.
- 사진 링크 대조도 mismatch 0.

그럼에도 `audit-f86-vs-atom`은 `종합 09.18 13:03 · 389대`, `손오공 · 234대` 등 현재 publisher 규격의 tab names를 대상으로 **`탭 이름에 발행 시각이 없다`**를 19갈래 발생시키며 exit 1을 냈다. 즉 workflow 전체 `failure`는 publish/data parity 실패가 아니라 audit (35)에서 이미 지적된 **F86 freshness/tab-name parser contract false-negative가 실제 scheduled production 회차를 red로 만드는 것**으로 재확인됐다.

**감사 판정:** publisher/tab naming을 checker에 맞춰 되돌리면 안 된다. Claude 구현 owner는 현재 발행 규격을 기준으로 freshness checker가 실제 metadata/발행시각을 판정하도록 수정하고, 같은 회차에서 freshness + cell parity가 함께 green이 되도록 증명해야 한다.

## 4. audit (44) 이후 topology/core 변화 범위

`5a3b9c2...` → `5bfc9ad...` compare는 실질적으로 production pin/source-contract allowlist와 UI pink badge 관련 파일만 바뀌었다. ERP5 canonical source registry, F01/F86 projection core, Sonogong/AutoPlus deposit policy, mirror/sales/settlement legacy writer workflow 자체는 이 구간에서 변경되지 않았다.

현재도:

- RP031 canonical registry는 Google Sheet(`1fJu...`)이며 audit (44)의 API/DOM feeder provenance HOLD 유지.
- RP023 canonical source는 RebornCar지만 `MIRROR_SOURCES`의 legacy RP023 sheet source가 별도로 남아 있음.
- `mirror-sync.yml`은 30분 scheduled apply writer, `sales-erp-hourly.yml`은 평일 scheduled apply writer, `settlement-sync.yml`은 legacy ledger→supplier status writer로 남아 있음.
- Sonogong/AutoPlus deposit SSOT와 special-tab 분리 규칙은 변경 없음.
- audit (27)/(28)/(29)/(34) 등 기존 미해소 HOLD는 직접 해소 증거가 없으므로 유지.

## Claude 구현 owner 우선순위

1. `audit-f86-vs-atom`의 현재 tab-name/freshness false-negative를 수정한다. publisher naming이나 SSOT 의미를 checker 때문에 역행시키지 않는다.
2. 신규 pin `14892951...`로 실제 scheduled/apply F01/F86 full publish를 통과시키고 `신차렌트=#FF00FF`가 재역전되지 않음을 운영 증명한다.
3. schedule은 “재도착”만 확인됐다. 다음 cron 회차가 지속적으로 들어오는지 별도 관측한다.
4. RP031 finance/identity provenance와 legacy mirror/sales/settlement writer HOLD는 그대로 유지한다.

이 감사에서 application code/business logic은 수정하지 않았다.
