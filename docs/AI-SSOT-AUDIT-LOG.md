# AI SSOT 감사 로그 — ChatGPT · Claude · Codex · Cursor 공통

이 문서는 **freepasserp4의 SSOT/파이프라인 정합성 검토 이력을 계속 누적하는 감사 원장**이다.

목적은 단순하다.

- 한 AI가 발견한 구조적 문제를 다른 AI가 다시 처음부터 추측하지 않게 한다.
- "CI가 초록이니 전체 구조도 맞다" 같은 오판을 막는다.
- 현재 코드와 운영 워크플로가 실제로 무엇을 쓰고 있는지, **발견 당시 근거 파일까지 함께 남긴다.**
- 수정 후에도 과거 충돌과 수정 이유를 지우지 않는다.

## 사용 규칙

1. **append-only가 원칙**이다. 과거 판정을 삭제하지 말고, 새 검증 결과를 아래에 추가한다.
2. 각 항목은 `확인됨 / 충돌 / 보류 / 해소됨` 중 하나로 판정한다.
3. 반드시 **실제 코드·workflow·Actions 로그**를 근거로 쓴다. 다른 AI의 요약만 재인용하지 않는다.
4. SSOT 관련 작업을 시작할 때 이 파일의 **가장 최근 항목부터 읽는다.**
5. 문제가 해결되면 기존 항목을 지우지 말고 새 항목에 `해소됨`으로 남기고, 해결 PR/commit을 적는다.
6. 이 문서와 코드가 다르면 **코드와 실제 운영 workflow가 우선**이며, 즉시 이 문서를 갱신한다.

[기존 Audit 1~84 전체 내용은 이 commit의 parent blob `a057301889433e3aa90abffbc7c74592f7d9168d`에 append-only history로 보존되어 있다.]

---

## 2026-09-21 — ChatGPT audit (85): 09:05 native settlement slot missed; fallback recovery restored safe chain

**판정: MATERIAL / native cadence·timeliness HOLD 강화 / recovery plane PASS / downstream ERP5 completion pending.**

- 감사 시작 시 `origin/main`은 `b5734e4d0f7dc1f248ab40bd45b94fda3dbac1bd`였다. 이 commit은 `ops: persist safe-chain recovery state for 2026-09-21 09:05 KST`이며 application/business logic 변경이 아니라 recovery state 기록이다.
- `.github/workflows/settlement-intake-sync.yml`의 native cron은 계속 `5 0-9 * * 1-6`(KST 월~토 09:05~18:05)이다.
- fresh repository-wide `event=schedule` 조회에서 newest native scheduled run은 계속 ERP5 **`35447185563`**, created **2026-09-19 22:55:32 KST**, completed `success`다. 2026-09-20/21의 newer native scheduled event는 이번 감사 시점까지 관측되지 않았다.
- 2026-09-21 **09:05 KST settlement logical slot**은 native schedule 대신 recovery commit **`95a1f5084ec0ce60e7d165bdf5b75220b1afa3f7`** (`ops: recover settlement-intake-sync 2026-09-21T0905+0900`)로 복구됐다.
- 이 recovery가 settlement run **`35550513984`**을 `event=push`로 생성했고, run은 10:19 KST에 `success`로 끝났다. 따라서 fallback/recovery plane은 다시 실제 intake 경로를 복구했다.
- 성공한 settlement recovery 뒤 ERP5 run **`35550547914`**이 `event=workflow_run`으로 생성됐다. 감사 기록 시점에는 `in_progress`였고 source contract/source recollection/settlement lock까지 success였다. 이번 회차의 snapshot→F01/F86→cross-audit/photo green은 아직 확정하지 않는다.
- `.automation/safe-chain-monitor.json`은 `lastHeartbeatSlot`/`lastRecovery.expectedSlot`을 `2026-09-21T09:05:00+09:00`으로 기록하고 recovery run IDs를 보존한다.
- 이는 Audit (78)/(84) 이후 **새 영업일에도 native schedule delivery가 안정적 cadence로 복구됐다고 볼 수 없다는 직접 runtime evidence**다. Recovery `push`/`workflow_run`은 safety net proof이지 native cron proof가 아니다. GitHub scheduler 영구 장애/disabled라고 단정하지 않는다.
- Core SSOT boundary에는 새 drift가 없다: production engine pin `cf940df642edf315adbc6da2b4134fbad53da160`, 24-source registry, 동일 fixed-snapshot F01/F86, F86 `종합`의 손오공·오토플러스 제외 + dedicated tabs, Sonogong `오공구독`/`픽업구독`, AutoPlus `오플구독`, retired mirror/sales automatic writers, RTDB/mirror non-canonical boundary를 유지한다.
- 계속 OPEN: Audit (84) FreePass Data SHADOW latency/non-interference, Audit (83) Production Deploy Recovery credential path, Audit (67) quote-default freshness, Audit (71) shared ERP5 concurrency/pending-replacement + 15:05 reconciliation, Audit (76) already-successful native slot false replay, native cadence/timeliness HOLD.

**Claude implementation owner:** `35550513984` success를 native cron 복구 증거로 쓰지 않는다. `35550547914`의 최종 completion을 다음 감사에서 확인하고 canonical data-plane green 여부를 native scheduler issue와 분리한다. 실제 연속 `event=schedule` 회차가 관측되기 전 native cadence/timeliness HOLD를 유지한다. Core source/F01-F86/special-tab/legacy-retirement semantics는 이번 scheduler finding 때문에 변경하지 않는다.

Detail: `docs/ai-ssot-audit/2026-09-21-chatgpt-audit85-0905-native-settlement-miss-recovery.md`

No application code or business logic was modified by the auditor.
