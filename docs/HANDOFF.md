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

**살릴 가치 있어 보이는 미병합 브랜치**(에이전트 조사, main과의 정확한 3-way diff는 미실행 — 검증 필요):
- `fix/sonokong-rent-plate-classification` — ERP5 publication-gate 계열 중 가장 최신 tip으로 보임(638파일)
- `codex/rtdb-cutover-current` — RTDB 폐기(사용자 확정 정책) 관련 가장 최신·완전해 보임(828파일)
- `codex/restore-canonical-whitelabel` — 작고 집중된 수정(415줄)
- `feat/settlement-firestore-cockpit` — 독립적인 정산 코크핏 기능

**안전하게 버려도 될 것으로 보이는 브랜치**: photo 파이프라인 구버전 2개, RTDB 초기 부분조치 2개, 배포 스냅샷용 detached-HEAD worktree들.

## Blocker

이 저장소는 실운영 배포(Vercel+Firebase) 중이라 워크트리 재배치나 브랜치 병합을 검증 없이 진행하면 배포 경로가 깨질 위험이 있다. 위 "살릴 가치 있는 브랜치" 목록도 3-way diff 대조 전에는 실제로 main에 흡수됐는지 불확실하다.

## 다음 한 작업

`fix/sonokong-rent-plate-classification`을 main과 3-way diff 대조해서 나머지 후보 브랜치들이 실제로 그 안에 흡수됐는지 확인 — 그래야 안전하게 정리할 수 있다.

## 마지막 실제 검증

없음 — 이번 세션은 이 저장소의 빌드/테스트를 실행하지 않았다(`package.json`에 test 스크립트 자체가 없음, `registry/projects.json` known_blockers 참조).
