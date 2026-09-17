# ChatGPT 독립 SSOT 감사 — schedule delivery gap

검수 시각: 2026-09-16 21:36 KST

## 판정

**신규 운영 drift / 원인 미확정.** Repository에는 여러 production/legacy writer의 cron이 그대로 선언돼 있지만, GitHub Actions의 `event=schedule` 실행 기록은 2026-09-16 16:18:54 KST 이후 한 건도 보이지 않았다. 따라서 현재 시점에는 “선언된 cadence대로 scheduled publisher/writer가 계속 돌고 있다”는 운영 가정을 증거로 뒷받침할 수 없다.

이 감사에서는 workflow UI enable/disable 상태나 GitHub scheduler 내부 원인을 직접 확정하지 못했다. 따라서 **disabled인지, GitHub scheduler가 지연/누락한 것인지 단정하지 않는다.** 다만 실행 기록 부재 자체는 실제 운영 증거이며 Claude 구현 Owner가 확인해야 한다.

## GitHub Actions 실제 실행 기록

`GET /repos/freepass-creator/freepasserp4/actions/runs?event=schedule&created=2026-09-16&per_page=100` 결과는 하루 전체 기준 `total_count: 4`였다.

| KST | Workflow | Run | 결론 |
|---|---|---:|---|
| 10:32:35 | 계약중 표기(30분) | 35044497887 | success |
| 12:46:35 | ERP5 SSOT 원천 최신화(매시간) | 35053074482 | success |
| 13:41:34 | 정산 접수 반영(1시간) | 35056578656 | failure |
| 16:18:54 | 계약중 표기(30분) | 35067894061 | failure |

추가 조회에서도:

- `event=schedule&created=>2026-09-16T08:00:00Z` → 0건
- `event=schedule&created=>2026-09-16T10:35:34Z` → 0건

이었다. 검수 시각 21:36 KST 기준 마지막 schedule event와 약 5시간 17분의 공백이 있다.

## Repository가 선언하는 기대 cadence

current main의 workflow 원문은 다음 schedule을 계속 선언한다.

- `.github/workflows/erp5-ssot-refresh.yml`: `5 0-10 * * 1-6`
  - 수요일 기준 17:05, 18:05, 19:05 KST 회차가 마지막 관측 run 뒤에 있어야 함.
- `.github/workflows/settlement-sync.yml`: `5 0-9 * * 1-6`
  - 17:05, 18:05 KST 회차가 기대됨.
- `.github/workflows/sales-erp-hourly.yml`: `0 0-9 * * 1-5`
  - 17:00, 18:00 KST 회차가 기대됨.
- `.github/workflows/mirror-sync.yml`: `*/30 * * * *`
  - 16:30 KST 이후에도 30분마다 회차가 기대됨.

그런데 GitHub Actions API의 실제 `schedule` run 목록에는 위 회차들이 없다.

## 기존 감사와의 관계

이 finding은 audit `(18)/(19)`의 기존 runtime failure를 반복한 것이 아니다.

- `check:shop-data-parity` checker drift는 그대로다.
- `.github/actions/prepare-credentials/action.yml`의 composite metadata `${{ secrets.GOOGLE_SA_JSON }}` 오류도 그대로다.
- `settlement-sync.yml`의 옛 `sync-contract-from-ledger.mts` / `정산` 탭 경로도 그대로다.
- production pin `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`, canonical source registry, F01/F86 projection, 손오공/오토플러스 전용탭 계약에는 이번 재검수에서 새 코드 회귀가 없다.
- `mirror-sync.yml`/`sales-erp-hourly.yml`의 write-capable schedule 선언과 RP023 legacy mirror도 그대로다.

새로운 점은 **그 scheduled workflow들이 선언된 cadence대로 GitHub에서 실제 dispatch되고 있다는 증거가 끊겼다**는 것이다. 우발적인 미기동을 writer retirement나 SSOT 단일화로 간주하면 안 된다.

## Claude 구현 Owner에게 넘기는 확인 순서

1. GitHub Actions UI/API에서 `erp5-ssot-refresh`, `settlement-sync`, `sales-erp-hourly`, `mirror-sync`, `contract-status` 각각의 실제 workflow enabled/disabled 상태를 확인한다.
2. intentional disable이라면 repository의 cron/예약지도/ownership 계약을 그 상태와 맞춰 **코드로 증명 가능하게** 만든다.
3. intentional disable이 아니라면 schedule event 미발생 원인을 확인하고, 특히 production `erp5-ssot-refresh`의 다음 정상 scheduled F01/F86 full-audit run을 확보한다.
4. schedule 미발생을 이유로 legacy writer ownership 문제를 “해소”로 닫지 않는다.
5. application code/business logic 수정은 Claude 단일 구현 세션에서만 한다.

이번 ChatGPT 감사에서는 애플리케이션 코드나 비즈니스 로직을 수정하지 않았다.