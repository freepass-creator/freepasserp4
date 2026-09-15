# HANDOFF — freepasserp4

CLI 연결 여부와 무관하게 이 저장소를 여는 누구나 여기부터 읽으면 이어받을 수 있다. 이 파일은 저장소 전체 현황이 아니라 **이번 AI Core 통합 세션(2026-09-15/16)에서 실제로 확인한 것만** 담는다 — 날짜 붙은 기존 `docs/HANDOFF-*.md`들은 각자의 사건 기록으로 별도 유지한다.

## 현재 revision

`4d962b2db293a8cc193a106008b0270265dcd30d` (branch `feat/spring-atom-monitor`, default branch 아님, 2026-09-16 확인)

## 현재 작업

없음(이번 세션은 워크트리 인벤토리·미병합 브랜치 후보 조사만 함, 코드 변경 없음).

## 완료된 것

- 없음(이 저장소 자체는)

## 미완료 / 이번 세션이 찾은 것

**워크트리가 50개 이상 흩어져 있다** — `C:\dev\freepasserp4-*`, `.wt-*`, `_wt-*`, `worktrees\*`, `fp-*`, `C:\tmp\*`, Codex 전용 worktree 등. `git worktree list`로 전수 확인 가능. `aiops/docs/저장소지도.md`가 이미 이 문제를 알고 "C:/dev/_worktrees/<repo>/<작업번호>로 모은다"는 재배치안을 세워뒀으나 미실행.

**정정(2026-09-16, 3-way diff 실행 완료)**: 처음엔 `fix/sonokong-rent-plate-classification`이 ERP5 publication-gate 계열의 최신 흡수 지점이라고 가정했으나 틀렸다 — 그 브랜치는 main과 완전히 갈라져 있다(main에 없는 커밋 482개, sonokong에 없는 커밋 402개). **main 기준으로 다시 비교해야 진짜 결론이 나온다.**

**실제로 main에 안 흡수된 것으로 보이는 작업 3개**(각 2~3커밋, main에 실제로 있는지 확인 필요 — 검토 전 병합 금지):
- `codex/freepass-inventory-contract` — 사진/시트링크 분리, `lib/domain/inventory-contract.ts` 신규(재고계약 스냅샷 통합)
- `codex/freepass-option-source-audit` — TCar 유료옵션 소싱/파싱 수정
- `codex/freepass-source-snapshot-engine` — `lib/server/source-snapshot.ts` 신규(공급사 소스 스냅샷 캡처)

**이미 main에 흡수됐거나 사소해서 버려도 되는 것**: `codex/erp5-publication-gate-current`(순수 subset), `codex/erp5-publication-gate`(main에 이미 있음), `codex/contract-status-erp5-main`/`codex/freepass-freshness-audit`/`codex/source-registry-v2`(main 대비 진짜 미흡수분은 1~3커밋뿐, 이미 main에 있음), `codex/source-registry-current`(문서만).

**안전하게 버려도 될 것으로 보이는 브랜치**: photo 파이프라인 구버전 2개, RTDB 초기 부분조치 2개, 배포 스냅샷용 detached-HEAD worktree들. `codex/rtdb-cutover-current`·`codex/restore-canonical-whitelabel`·`feat/settlement-firestore-cockpit`은 아직 main 기준 재검증 안 함.

## Blocker

이 저장소는 실운영 배포(Vercel+Firebase) 중이라 워크트리 재배치나 브랜치 병합을 검증 없이 진행하면 배포 경로가 깨질 위험이 있다. 위 "살릴 가치 있는 브랜치" 목록도 3-way diff 대조 전에는 실제로 main에 흡수됐는지 불확실하다.

## 다음 한 작업

`codex/freepass-inventory-contract`·`codex/freepass-option-source-audit`·`codex/freepass-source-snapshot-engine`의 실제 변경 내용이 main에 있는지(동등 기능이 다른 커밋으로 들어갔는지) 확인 — 없으면 이 3개가 진짜 유실 위험이 있는 작업이다.

## 마지막 실제 검증

없음 — 이번 세션은 이 저장소의 빌드/테스트를 실행하지 않았다(`package.json`에 test 스크립트 자체가 없음, `registry/projects.json` known_blockers 참조).
