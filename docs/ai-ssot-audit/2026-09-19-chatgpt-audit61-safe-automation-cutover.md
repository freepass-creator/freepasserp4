# 2026-09-19 ChatGPT audit (61) — canonical safe automation cutover

## 판정

**자동운영 구조의 P0 writer 충돌은 repository/config 수준에서 해소했다.**

사용자의 명시적 지시(“알아서 판단하고 자동화”)에 따라 ChatGPT가 application/business logic은 건드리지 않고 GitHub Actions 운영 topology를 정리했다.

## 1. PR #418 — 중복/legacy automatic writer retirement

Merge:

- PR #418
- merge commit `27adad84d0fd1d980e51eb00394de11afa48dbed`

변경:

### contract-status

`.github/workflows/contract-status.yml`

- schedule 제거
- 운영 `--apply` 경로 제거
- `workflow_dispatch` dry-run only
- canonical ERP5만 정산원장 → Atom 계약락 자동 writer 역할 유지

따라서 `LEDGER` vs `정산원장`의 **scheduled dual-writer**는 해소했다.

단, `scripts/mark-contract-in-listings.mts` 내부 legacy marker `정산원장`은 코드 debt로 남아 있어 issue #415는 OPEN 유지한다. 운영 automatic writer는 아니다.

### sales-erp-hourly

`.github/workflows/sales-erp-hourly.yml`

- schedule 제거
- push trigger 제거
- `cloud-hourly-sync.mts --apply` 경로 제거
- manual dry-run only

따라서 legacy mirror → F01/special tabs → RTDB/Firestore mirror → main publish chain이 자동으로 되살아날 수 없다.

### mirror-sync

`.github/workflows/mirror-sync.yml`

- schedule 제거
- scheduled `--apply` 제거
- manual dry-run only

RP023 old Google Sheet source는 legacy code debt로 남지만 RebornCar canonical을 덮는 예약 writer는 아니다.

### settlement

기존 `settlement-sync.yml`에서:

- `sync-contract-from-ledger.mts` 제거
- 계약접수 시트 → 정산원장 `접수`만 쓰도록 축소
- inventory/supplier/F01 상태 mutation은 canonical ERP5로 넘김

### CI regression guard

`scripts/check-schedule-map.mts`:

- contract-status / sales-erp-hourly / mirror-sync에 schedule이 다시 생기면 FAIL
- settlement intake workflow에 `sync-intake-to-ledger.mts`가 없으면 FAIL
- legacy `sync-contract-from-ledger.mts`가 다시 연결되면 FAIL

## 2. PR #418 검증

PR head `a704d67d9d892e40dd7d8bf3275cab47f09993a0`:

- SSOT adapter contract run `35386792417` — success
- general CI run `35386792385` — success
  - workflow parse PASS
  - schedule map PASS
  - ERP5 Firebase boundary PASS
  - RTDB guard PASS
  - settlement contract PASS
  - vehicle lock sim PASS
  - 3-party settlement E2E PASS
  - production build PASS
- Vercel status — success

## 3. PR #419 — 새 settlement intake workflow identity로 automation 등록

과거 `settlement-sync.yml`은 repository history에서 `disabled_manually` 상태가 확인됐다. 현재 GitHub connector에는 workflow enable API가 없어 같은 identity를 repo 수정만으로 다시 켰다고 증명할 수 없다.

따라서 새 workflow identity를 생성했다.

Merge:

- PR #419
- merge commit `8583e640a30b058e152443fdf1bfce24f873b0aa`

현재 main:

- 추가: `.github/workflows/settlement-intake-sync.yml`
- 삭제: `.github/workflows/settlement-sync.yml`

schedule:

- cron `5 0-9 * * 1-6`
- KST 월~토 09:05~18:05

책임:

1. 계약접수 시트 읽기
2. canonical 정산원장 `접수` 반영
3. ledger 서식/용어 정리
4. **재고/공급사/F01 상태 직접 mutation 없음**

그 다음 canonical ERP5 workflow:

- `erp5-ssot-refresh.yml`
- KST 월~토 09:17~19:17
- 원장 접수/취소 → ERP5 Atom lock
- 24 supplier ingest
- fixed snapshot
- F01
- F86
- freshness / cross parity / photo audit

즉 자동흐름은:

```text
09:05 settlement-intake-sync
  intake → ledger 접수
       ↓
09:17 erp5-ssot-refresh
  ledger lock → Atom → snapshot → F01/F86 → audits
```

## 4. PR #419 검증

PR head `19f670f3ed35da5a936f3394502296467b9606a0`:

- CI run `35387211356` — success
  - workflow parse PASS
  - schedule map PASS
  - ERP5 Firebase boundary PASS
  - RTDB guard PASS
  - settlement contract PASS
  - vehicle lock sim PASS
  - settlement E2E PASS
  - production build PASS
- Vercel status — success

## 5. GitHub issues

- #416 settlement legacy `정산` writer retire/rewire — **closed/completed**
- #417 legacy scheduled writers retirement proof — **closed/completed**
- #415 contract-lock owner/marker code cleanup — **OPEN**
  - automatic production conflict는 #418로 격리됨
  - `mark-contract-in-listings.mts` 내부 legacy marker 자체 정리는 남음

## 6. 이미 확보된 canonical runtime proof

ERP5 canonical production에는 기존 scheduled full-green 증거가 있다:

- run `35347508078`
- production pin `cf940df642edf315adbc6da2b4134fbad53da160`
- source → Atom → fixed snapshot → F01/F86 → freshness → cross parity → photo-link 전부 green

이번 cutover는 해당 canonical path를 변경하지 않았다.

## 7. 아직 runtime proof가 필요한 것

새 `settlement-intake-sync.yml`은 2026-09-19 새벽 main에 처음 등록됐다.

따라서 **새 workflow identity의 첫 실제 `event=schedule` 성공은 아직 관측할 수 없다.**
첫 선언 슬롯은 KST 09:05 이후다.

이를 숨기지 않는다:

- repository/config 기준 automation 등록 완료
- PR CI/시뮬레이션/build 완료
- 실제 scheduled runtime proof는 다음 선언 슬롯 이후 별도 감사 대상

불필요한 수동 `apply=true`를 실행해 “scheduled proof”처럼 대체하지 않았다.

## 8. 자동운영 현재 판정

**GO(config/topology), WATCH(runtime).**

- 중복 automatic writer: 제거
- legacy settlement writer: 제거
- legacy sales/mirror schedules: 제거
- canonical ERP5 scheduled full-run: 기존 green 증거 있음
- safe settlement intake schedule: 새 identity로 main 등록 완료
- 첫 실제 schedule delivery: 아직 미관측

application/business logic은 수정하지 않았다. 운영 workflow/config 및 CI governance만 변경했다.
