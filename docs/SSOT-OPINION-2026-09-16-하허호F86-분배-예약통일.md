# 하허호 F86 · 운영 분배 · 예약 통일 — SSOT 통합 세션 인계 의견

작성: Claude Code(freepasserp4 세션) · 2026-09-16 07:30 KST
대상: SSOT 통합 세션(Codex/Claude 무관) — «원자 한 벌 → 운영별 분배»를 하나로 합칠 때 읽는다.
**판정: 운영 엔진은 `claude/f86-on-gate`(fb4872dd)로 모았다 · 운영 반영은 PR #294 머지 대기 · 두 엔진 가지(gate·erp5) 병합은 아직 HOLD.**

## 1. 사장님 결정(2026-09-15~16, 이 세션에서 받은 것 그대로)

| 주제 | 결정 |
|---|---|
| 방향 | 「일단 중요한 건 SSOT이고, 이걸 각각 운영에 맞춰 어떻게 뿌려줄 것인가인데, **그중 하허호 시트는 제일 중요하게** 관리해야」 · 「이 시트 때문에 하허호가 많이 힘들었다고 해, 잘 유지하자」 |
| 하허호 F86 | 「86번 시트만, 완전 커스터마이징」 — 옛 「프리패스 공급사 상품리스트」 레트로 모습 · 공급사명 맨 앞 · 종합 탭(손오공·오토플러스 뺌) · 회사 탭은 자기 고유 대여료만 · 단기 칸(단기보증·1·6·12개월) 없음 · 대여료 색 옛 기간 색 · 「양식을 굳혀, 매번 달라지지 말고」 |
| 장기 요금 없는 차 | 「24개월 이후로 대여료가 없으면 그냥 대여료 없이 두자, 그래야 총 상품 숫자를 맞출 수 있다」 → **싣고 요금 칸만 빈다 · F86 대수 = F01 대수** (9/15~16 「안 싣는다」는 폐기) |
| 빈 값 표기 | F86 도 F01 과 같이 「미입력·없음·해당없음」(gate 엔진 `missing-value-display`) |
| 손오공 중고렌트 | 「그냥 반납형 칸을 같이 써, F01에도」 → RP012 는 픽업 외 전부 오공구독 탭(반납형·인수형 칸) |
| 예약 | 「예약자를 하나로 통일, 어느 AI든 통일」 · 집 = **GitHub Actions** · **한 워크플로가 F01·F86 둘 다** · **통합 워크플로만 운영에 쓴다** · 규칙은 저장소 지도 + 검사 |
| 엔진 | 「gate 엔진 위에 F86 만 올리기」(두 가지 통째 병합 아님) |
| F86 지키기 | 넷 다: F01 실패해도 F86 발행 · F86 감사 첫 관문 · 신선도 감시 · 발행 직전 백업/되돌리기 |

## 2. 지금 상태(07:30)

```
가지                                   무엇                                              GitHub
main                                    운영 앱 · 워크플로 파일의 집                         -
codex/erp5-publication-gate-current     Codex gate 엔진(eafbd88e) — 9/15 운영 발행 엔진      그대로(안 건드림)
claude/f86-on-gate  ★운영 엔진 후보      gate + F86 + 운영 쓰기 문지기 + 손오공 오공구독      fb4872dd 푸시
codex/rtdb-cutover-current              erp5 워크트리(F86 레트로를 처음 만든 곳) + 문지기      77ed7f22 푸시 · 다른 세션 미커밋 변경 있음
claude/schedule-map → PR #294           예약 지도 · check:schedules · 통합 워크플로(ref fb4872dd) 머지 대기
```

- GitHub: `ERP5 SSOT 원천 최신화(매시간)` **켜짐**(PR 머지 전까지 옛 ref eafbd88e 로 F01 만) · `판매·천이·ERP 시간별 동기` **꺼짐** · `계약중 표기(30분)`·`정산 접수 반영` 켜짐.
- 이 PC `프리패스-자동동기` 는 켜져 있으나 `hourly-sync.cmd` 가 아무것도 안 하는 껍데기(9/11~).
- 운영 F01: 09.16 01:23 erp5 엔진 손 발행본 → 오늘 09:05부터 gate 워크플로가 다시 씀.
- 운영 F86: 탭 시각 **09.16 01:25:23**(다른 세션이 erp5 워크트리에서 손 발행 — 누구인지 미확인). 새 규칙(대수=F01·오공구독 배정·미입력)은 **PR 머지 뒤 첫 회차부터**.
- 미리보기 사본 `1Ki1VI9y…`: 07:14 fb4872dd 로 발행 — 737대(=F01) · F86 감사 46,800칸 어긋남 0.

## 3. 이 세션이 한 일(커밋)

**claude/f86-on-gate** (gate eafbd88e 위)
- `60a0e677` F86 레트로 규격 이식(channel-retro-skin · 발행기 · check-f86-locked · 감사기 F86 부분) + Sheets/ERP5 자격증명 분리(google-service-account)
- `ebb34eb5` 발행기 Firestore 는 스냅샷 없을 때만 ERP5 문으로(RTDB 주소 요구 제거)
- `aa80a1cd` 손오공 중고렌트 → 오공구독 · **운영 F01·F86 쓰기 문지기** `lib/server/production-sheet-write-gate.ts` 를 7개 쓰기 스크립트에
- `8009feb8` **발행 계획 한 벌** `lib/server/channel-f86-plan.ts` · **F86 감사** `scripts/audit-f86-vs-atom.mts` · **백업** `backup-f86` · **되돌리기** `restore-f86-from-backup`
- `fb4872dd` 장기 요금 없는 차도 싣는다(요금 칸만 빈 채)

**codex/rtdb-cutover-current** — 9/15 F86 레트로 구현 커밋 다수(989c5a6d 까지) + `77ed7f22` 운영 쓰기 문지기(이 가지에서 손으로 운영을 못 덮게).

**claude/schedule-map(PR #294)** — `docs/예약작업-지도.md` · `scripts/check-schedule-map.mts`(CI) · AGENTS.md·CLAUDE.md·.cursorrules·AI_COLLABORATION.md 머리 안내 · `erp5-ssot-refresh.yml`: 스냅샷→F01→(F01 실패해도)F86 백업→F86 발행→F86 감사(신선도 120분)→원자·F01·F86 감사→사진 링크.

## 4. 의견 — 통합할 때

### FP-F86-01 · 높음 · 분배 계층을 «계획 + 감사» 한 쌍으로 표준화
F86 은 이제 `buildF86Plan`(원자 스냅샷 → 탭·줄·칸·값)을 발행기와 감사기가 **같이** 쓴다. 감사가 발행기 코드를 믿지 않고 같은 계획으로 시트를 한 칸씩 맞대므로, 미리보기에서 46,800칸 0 을 «증명»으로 쓸 수 있었다.
**권고:** F01(`make-sample-sheet-google`)·ERP 화면·손님 카탈로그도 같은 모양(`build<X>Plan` + `audit-<x>-vs-atom`)으로. 지금 F01 은 발행기 안에서 줄을 만들고, `audit-sheet-vs-atom` 이 F01 을 원자와 맞대되 F86 은 «F01 을 거쳐» 본다(F01 이 틀리면 F86 도 틀렸다고 운다) — F86 은 첫 관문 감사로 따로 떼었다.

### FP-F86-02 · 높음 · 엔진 가지 둘(gate·erp5)의 병합은 «옮겨심기»로, gate 규칙 기준
두 가지 합치면 판매 발행 핵심 37곳이 충돌(`git merge-tree`, 07:00). 서로 다른 «정답»이 들어 있다:
- 빈 값: gate = 「미입력·없음·해당없음」(Codex·Cursor 검증 SSOT 문서) / erp5 = 대체로 빈 칸(`MISSING` 상수만 있음)
- 탭 배정: gate = `tabOf` 코드 분기(이번에 RP012 전부 오공구독) / erp5 = `PROVIDER_SALES_TAB` **표**(사장님 9/15 「SSOT에 분류가 되어 있어서 탭 위치도 분류해 놓고」) — **표 방식이 더 SSOT 답다. gate 로 옮길 가치 1순위.**
- 탭 이름: gate F01 = 분까지(모바일) / erp5 = 초·대수 — F86 은 초·대수(`salesPublishTabMark`) 유지.
**권고:** gate(claude/f86-on-gate)를 기준으로 두고 erp5 가지에만 있는 «가치»를 목록화해 한 건씩 옮겨심는다(메모리 원칙 「묵은 가지는 병합 말고 없는 것만」). erp5 워크트리에는 지금도 다른 세션이 F86 파일을 고치는 중(미커밋) — 같은 규칙을 두 가지에 두 번 적는 상태라 곧 갈라진다.

### FP-F86-03 · 높음 · 운영 쓰기 문지기의 빈틈
문지기는 `GITHUB_WORKFLOW` 이름 허용 목록(F01: ERP5 매시간·계약중 표기 / F86: ERP5 매시간) 또는 사장님 허락 플래그만 연다.
- **main 코드로 도는 `contract-status.yml`(계약중 표기)은 main 에 문지기가 없다** — main 에 병합되기 전까지는 이름으로만 허용된 셈.
- `sheet-sync.yml`·`sync-now-once.yml` 같은 수동 워크플로는 허용 목록 밖이라 막힌다(의도) — 필요하면 여쭙고 목록에.
- 문지기는 «이 코드»만 막는다. 옛 가지 코드(문지기 없는 커밋)를 로컬에서 돌리면 못 막는다 — 서비스계정 권한 쪽 빗장(예: 운영 시트 쓰기 권한을 워크플로 전용 계정으로)이 근본책.

### FP-F86-04 · 중간 · 굳힌 양식은 «표 밖이면 멈춤» — 운영 알림 경로가 필요
`RETRO_TAB_ORDER`·`RETRO_TAB_FEES`·`RETRO_WIDTH` 표 밖 데이터(새 공급사, 새 요금 칸에 값)가 오면 F86 발행이 멈춘다(요금을 몰래 감추지도, 칸을 몰래 늘리지도 않게). 9/16 07:00 에 실제로 손오공 중고렌트 7대가 걸렸다.
**권고:** 멈춤이 워크플로 빨간불로만 끝나지 않게 사람에게 가는 알림(메일·메신저)과 「표에 한 줄 넣기」 절차를 SSOT 운영 문서에.

### FP-F86-05 · 중간 · 원자 파생값 드리프트가 발행을 막았다가 저절로 풀림
07:00 캡처 때 `status_kind` 드리프트 21대로 gate 캡처가 throw → 몇 분 뒤 0대. 누가 원자 상태를 gate 규칙(상태 6종)과 다르게 썼다가 고쳤는지 미확인. gate 는 막고(좋음) erp5 는 계산식이 달라(`resolveStatus` 차량검수 처리) 같은 원자를 다르게 본다. **상태 판정 함수도 한 벌로.**

### FP-F86-06 · 낮음 · 확인 못 한 것(모른다 ≠ 없다)
- 01:23 F01 · 01:25 F86 손 발행을 한 세션이 누구인지.
- `check:sync` 가 erp5 가지에서 `sim-inventory-contract.mts:74`(픽업 T카 링크 경고)로 이미 실패 — 원인 커밋 추정 f6b2b79e, 작업 칩으로만 남김. gate 가지에선 통과.
- Vercel cron `/api/sheet/sync-daily`(매일 02:00)는 `SHEET_DAILY_SYNC_ENABLED` 환경변수로 켜짐 여부가 갈리는데 운영 값을 안 봤다.

## 5. 통합 체크리스트(제안 차례)

1. PR #294 머지 여부 사장님 확인 → 머지 뒤 첫 정시 회차 로그: 「운영 F86 쓰기 허용 — GitHub 워크플로」 · F86 감사 0 · 백업 id.
2. erp5 워크트리 미커밋 F86 변경(다른 세션)과 gate 가지 규칙이 같은지 대조 후 한쪽으로(권고: gate).
3. erp5 가지 가치 목록 → gate 로 옮겨심기(탭 배정 표 1순위) → 워크플로 `ref:` 를 PR 로 갱신(지도 규칙 3).
4. F01 도 «계획 + 감사» 한 쌍으로(FP-F86-01).
5. 문지기 근본책 — 운영 시트 쓰기 권한 계정 분리(FP-F86-03).

## 6. 파일 지도(claude/f86-on-gate)

| 역할 | 파일 |
|---|---|
| F86 규격(칸·색·굳힌 표·단기·종합) | `lib/domain/channel-retro-skin.ts` |
| F86 발행 계획(한 벌) | `lib/server/channel-f86-plan.ts` |
| F86 발행기 | `scripts/build-channel-supplier-sheet.mts` |
| F86 감사(첫 관문·신선도) | `scripts/audit-f86-vs-atom.mts` |
| 백업 · 되돌리기 | `scripts/backup-f86.mts` · `scripts/restore-f86-from-backup.mts` |
| 규격 잠금 | `scripts/check-f86-locked.mts`(`npm run check:f86`, `check:sync` 에 포함) |
| 운영 쓰기 문지기 | `lib/server/production-sheet-write-gate.ts` |
| 규격 문서 | `docs/영업자시트-매뉴얼.md` §하허호 F86 «완전 커스텀 레트로» 1~6 |
| 예약 지도(main PR) | `docs/예약작업-지도.md` · `scripts/check-schedule-map.mts` |
| 운영 문서 | F86 `1hQtshpWKL4L0zSR3H3UQ36atICtHv9Ka7dQh7d7K5Vg` · 미리보기 `1Ki1VI9yVRdlCk4kfhNTmbYA38pnpx-ZbCiddefrDpnc` · 백업 폴더 「[F86 백업] 프리패스x하허호 전용 상품시트」(pyh 드라이브) |
