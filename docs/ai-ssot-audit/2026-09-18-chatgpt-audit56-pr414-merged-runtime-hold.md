# 2026-09-18 ChatGPT audit 56 — PR #414 merged / runtime schedule hold

상태: **RESOLVED(code/main) / runtime HOLD**

## 새로 바뀐 사실

Audit (55)는 downstream ERP5 consumer 통일을 PR #414의 staged implementation으로 기록했다. 현재 main에서는 PR #414가 merge commit `817865d732b92b284c1db78a183325c6bfb12a1f`로 병합됐다.

PR #414는 authenticated `/api/products`, Finder 목록, `/m/[code]` 상세, F01 상세링크 identity join, 영업자 내부정보 policy/partner, read-only ops inventory를 canonical `freepasserp5` read 경계로 통일한다. ERP4 Firebase Auth는 인증 경계로 유지하고, ERP5 product read 장애를 옛 ERP4 product store로 silent fallback하지 않는다. PR head CI run `35343147167`과 merge-main push CI run `35343414676`은 success다.

따라서 audit (55)의 `IMPLEMENTATION STAGED` 판정은 폐기하고 **internal read-only downstream split-brain은 code/main 기준 RESOLVED**로 올린다.

## 의도적으로 남긴 `/inventory` HOLD

편집 `/inventory`는 아직 ERP4 read/write 한 묶음이다. ERP5 authenticated write API, 권한, audit log, field ownership/CAS가 없는 상태에서 읽기만 ERP5로 옮기면 read/write DB가 갈리므로, ERP5 write boundary가 생길 때 read/write를 함께 전환한다.

## production pipeline / source registry

`.github/workflows/erp5-ssot-refresh.yml`은 계속 production pin `cf940df642edf315adbc6da2b4134fbad53da160`을 사용하며, ledger lock → 24-source ingest → policy reconcile → fixed snapshot → public verify → F01 → F86 backup/publish/audit → Atom/F01/F86 parity → photo-link audit 순서를 유지한다. PR #414는 writer/publisher engine, F01/F86 projection, Sonogong/AutoPlus special-tab rule을 바꾸지 않았다.

Canonical source registry도 그대로다: RP006 Iron website, RP012 Sonogong ERP API, RP023 RebornCar website, RP031 Google Sheet canonical. Legacy `MIRROR_SOURCES`의 RP023 old Google Sheet는 별도 경로로 여전히 남아 있다.

## schedule runtime OPEN

2026-09-18 21:23 KST repository-wide `event=schedule` 재조회 기준 최신 run은 여전히 `35304903901`, 12:53:42 KST이고 이후 scheduled event가 없다. 따라서 ERP5 17:17 / 18:17 / 19:17 회차 및 이후 contract-status 등 scheduled delivery 복구 증거가 없다. push/manual success는 schedule recovery proof로 사용하지 않는다.

## writer topology HOLD 재확인

- canonical production `sync-vehicle-lock-from-ledger.mts`는 `LEDGER` marker를 쓰고 자기 marker만 취소 시 해제한다.
- main `contract-status.yml`은 30분마다 `mark-contract-in-listings.mts --apply`를 선언하며 같은 ERP5 products에 `정산원장` marker를 쓰고 공급사 상태/F01 배차상태도 직접 변경한다. 공유 concurrency group은 동시 실행만 직렬화하며 ownership을 통일하지 않는다.
- `settlement-sync.yml`은 `sync-intake-to-ledger.mts` 다음 legacy `sync-contract-from-ledger.mts`를 실행한다. canonical ledger는 `접수/취소/분납실적/완납실적/청구`인데 legacy script는 호환 alias `SETTLEMENT_LEDGER_TAB='정산'`을 읽어 공급사 시트를 쓴다.
- 예약지도는 `sales-erp-hourly`/`mirror-sync`를 꺼짐으로 적지만 YAML cron/`--apply` 경로는 남아 있고 schedule map checker는 GitHub Actions UI runtime enabled/disabled 상태를 증명하지 않는다.

## 최종 판정

새 material change는 **PR #414 main merge**다. Downstream read split-brain은 code/main RESOLVED로 올린다. 그러나 audit (54)의 pre-automation writer gate와 schedule runtime HOLD는 그대로다. Claude 구현 Owner는 같은 consumer read 경로를 다시 고치지 말고 contract lock owner 단일화, settlement legacy writer retire/rewire, legacy workflow runtime proof, production full-run/scheduled-run proof에 집중한다.
