# 2026-09-19 ChatGPT audit (59) — schedule gap 원인 좁힘: manual-disable 증거와 예약지도 drift

## 판정

**MATERIAL / 운영상 선언-실행 drift가 구체화됨.** audit (58)은 `contract-status`의 30분 schedule 공백 원인을 `GitHub UI disabled drift`와 `GitHub scheduler delivery failure` 두 후보로 남겼다. 이번 재감사에서 repository commit history와 실제 Actions runtime을 대조한 결과, 최소한 **마지막으로 증명된 runtime 상태는 manual disabled**였고, `docs/예약작업-지도.md`의 `켜짐` 표기가 그 상태를 따라가지 못했다는 직접 증거가 확인됐다.

## 직접 증거

1. commit `8b7a417578e6e2b2b2fac673588cf1b0db9e59a9`(2026-09-17)은 commit message에 다음 7개 workflow가 `disabled_manually` 상태라고 명시한다.
   - `sales-erp-hourly`
   - `mirror-sync`
   - `sheet-sync`
   - `contract-status`
   - `settlement-sync`
   - `direct-ingest-hourly`
   - `refresh-30min`

2. 그런데 current `docs/예약작업-지도.md`는 여전히:
   - `contract-status.yml` = **켜짐**, `*/30 * * * *`
   - `settlement-sync.yml` = **켜짐**, `5 0-9 * * 1-6`
   로 기록한다. 문서가 스스로 UI enable/disable 변경 시 상태/날짜를 같이 갱신하라고 규정하므로 현재 지도는 last-proven runtime state와 불일치한다.

3. 실제 `contract-status`의 마지막 관측 scheduled run은 `35067894061`(2026-09-16 16:18:54 KST, event=`schedule`, failure)이다. 이후 독립 조회에서 `contract-status` scheduled run은 확인되지 않았다.

4. run `35067894061`은 실제 계약중 표기 로직까지 가지 못했다. job `104702278635`에서 checkout/OIDC/npm ci는 성공했지만 `자격증명 놓기`가 실패했고 `계약중 표기` step은 skipped됐다. 당시 정확한 오류는 composite action metadata의 `secrets.GOOGLE_SA_JSON` 표현식이었다.

5. 그 credential parser 문제 자체는 이후 commit `e8956bcac84e87f8bcf4a0b3b212119c7642be8c`(2026-09-18)로 수정됐다. current `.github/actions/prepare-credentials/action.yml`은 `inputs.google-sa-json`만 소비하며 composite metadata 안에서 `secrets` context를 직접 평가하지 않는다. 따라서 **마지막 contract-status run의 실패원인은 현재 코드에서는 해소됐지만, 그 뒤 runtime re-enable/scheduled success 증거는 없다.**

6. audit (57)의 canonical ERP5 scheduled green run `35347508078`은 그대로 유효하다. 반면 이번 재조회에서도 그 뒤 repository-wide schedule 연속성은 복구됐다고 볼 증거가 없다. 다만 `contract-status`에 대해서는 audit (58)처럼 scheduler failure와 manual-disable을 동등한 두 후보로 두는 것보다, **manual-disable이 repository history로 직접 증명된 상태**라는 점을 우선해야 한다.

## current main 정합성

audit (58)의 audited application HEAD `dc6c5cf16146c7439f5a5293383d503e8e30d00d` 이후 current main까지의 변경은 audit 문서 계열뿐이며 application/business logic의 새 변경은 없다. production pin도 계속 `cf940df642edf315adbc6da2b4134fbad53da160`이다.

따라서 다음 기존 HOLD는 그대로 유지한다.

- canonical `LEDGER` vs `contract-status`의 `정산원장` contract-lock dual writer
- `settlement-sync`의 legacy `정산` writer
- RP023 canonical RebornCar vs legacy mirror old Sheet
- RP031 finance provenance/canonical migration
- special-tab deposit-policy single-definition/recurrence/lineage
- vehicle-price lineage
- sales-tab naming migration
- newest-Atom freshness semantics
- `/inventory` ERP4 read/write boundary

## Claude 구현 Owner 인계

1. `contract-status.yml`과 `settlement-sync.yml`을 **현재 의도상 켤 것인지 끌 것인지 먼저 결정**하고 GitHub Actions runtime state와 `docs/예약작업-지도.md`를 같은 상태로 맞춘다.
2. manual-disabled가 의도라면 YAML cron이 남아 있어도 다시 켰을 때 위험한 writer임을 명시하고 repository-level retirement/fail-closed 여부를 정리한다.
3. `contract-status`를 다시 켤 경우 current credential action 수정 이후 controlled run을 먼저 통과시키고, 그 다음 실제 `event=schedule` 연속 회차로 delivery를 증명한다.
4. `settlement-sync`는 지도상 `켜짐`이라고 해서 바로 re-enable하지 않는다. legacy `정산` writer를 retire/rewire한 뒤에만 자동화 후보로 본다.
5. audit (57)의 ERP5 scheduled full green은 유지하되, legacy/secondary writers의 runtime 상태 증명과 contract-lock ownership 단일화 전에는 automatic writer 전체 GO를 주지 않는다.

이번 감사에서는 application code/business logic을 수정하지 않았다.
