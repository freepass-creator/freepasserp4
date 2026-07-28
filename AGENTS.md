# AGENTS.md — freepasserp4 작업원칙 (모든 AI·작업자 공통)

이 저장소에서 작업하는 **모든 AI(Claude Code·Cursor·Codex 등)와 사람**은 시작 전 이 원칙을 확인한다.
사용자가 "**프리패스erp4 작업원칙 확인**"이라 하면 이 파일 + 아래 문서를 읽고 역할·규칙을 재확인한다.

- 상세 파이프라인: `docs/AI_COLLABORATION.md`
- 규격 SSOT(디자인·데이터·구조): `CLAUDE.md`
- Cursor 세부 규칙: `.cursorrules`

## 역할 분담 — 토큰 분산 = 비용↓ 퀄리티↑

각자 잘하는 것에 집중하고, 토큰 많이 드는 일을 나눈다.

- **Claude Code = 설계 + 위험영역 게이트/판단.** `PLAN.md` 작성, 아키텍처 제약 명시, 규칙/돈/데이터/보안 최종 go·no-go. **토큰 많이 드는 일(대량 구현·리팩터·전수검증·대형파일 통독)은 직접 하지 않고 오더만 제안**(직접 조종 X).
- **Cursor = 노가다.** 대량·반복·리팩터 구현. `PLAN.md`·`.cursorrules` 준수. 설계·보안 판단 안 함. 진행은 `IMPLEMENTATION_LOG.md`.
- **Codex = 독립 전수검증 + 수정.** sim·빌드·타입·적대 검증을 직접 실행하고 문제를 수정, 최종 판정을 `VERIFICATION.md`. **위험영역 수정(규칙·정산엔진·rtdb-adapter)은 게시/머지 전 사람 또는 Claude 게이트를 통과해야 한다.**

## 불변 규칙 (어기면 앱·보안 깨짐)

- **검증 기준 = 사용자의 원래 요구사항** (설계 문서 아님). 중요한 기술·범위·데이터·보안 결정은 **사용자 승인** 필요.
- **`database.rules.json` 게시는 사람이 실데이터로 검증 후에만.** 로컬 에뮬레이터 통과 ≠ 실데이터 안전(레거시 스냅샷/필드로 정당 write가 막힐 수 있음).
- **RTDB v3+v4 이중읽기 tolerance**(`.catch(() => [])`)를 throw로 바꾸지 않는다 — 계약·정산 페이지가 통째로 안 열린다.
- **디자인 토큰 SSOT**(`components/ui/tokens.ts`): 색·폰트·컨트롤 치수 하드코딩 금지. 뱃지 색 = `--bdg-*` CSS 변수.
- **v3(운영) 노드 write 금지** — 쓰기는 `v4/` 오버레이로만. **정산엔진 우회 금지**(계약 단계·차량상태는 엔진이 단일 writer).

## 작업 후 게이트

```
npx tsc --noEmit        # 빌드 게이트(린트 미설정)
npm run check:fonts     # 폰트/토큰 드리프트 0
# 계약·정산·차량 변경 시 관련 scripts/sim-*.mts 추가 실행
```

## 인수인계 문서

| 파일 | 책임 | 용도 |
|---|---|---|
| `PLAN.md` | Claude Code | 요구사항·설계·구현계획·완료조건 |
| `IMPLEMENTATION_LOG.md` | Cursor | 실제 구현·계획변경·단계테스트 |
| `VERIFICATION.md` | Codex | 독립검증·수정·최종판정 |
| `HANDOFF.md` | 모두 | 프로젝트 인수인계 진입점 |
