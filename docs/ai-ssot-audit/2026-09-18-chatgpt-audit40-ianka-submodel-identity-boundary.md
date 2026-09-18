# 2026-09-18 ChatGPT 독립 SSOT 감사 — audit (40)

## 판정

**OPEN / HOLD — PR #402는 RP031 live corruption을 만들었다는 증거는 없지만, audit (39)의 writer-boundary 문제를 identity/model 경계까지 확대할 수 있는 pre-merge 변경이다. 현재 형태로 canonical write에 사용하면 안 된다.**

## 새 증거

- 감사 시작 시 `origin/main`은 `f3e07b81557ebfc487c867f1edc86f871fcb329f`, canonical production pin은 계속 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`이다.
- PR #402 `fix: 이안카 차명(원문) 칼럼 부재 — 세부모델로 채운다`는 아직 **open / unmerged** 상태이며 현재 head는 `af041f83661cf1959f9405424ef80bff17436802`다.
- 실제 RP031 Sheet 40-column header에는 `차명(원문)`·`차명`·`차량명`이 없고 `세부모델`이 존재한다는 실측이 추가됐다. 동시에 **`연식` 칼럼도 없다**는 사실이 확인됐다.
- PR #402의 patch는 `행빌드()`에서 `put(['차명(원문)', '차명', '차량명', '세부모델'], c.차명원문)`로 바꾸고, finance lookup용 `차명col`도 같은 alias 목록에 `세부모델`을 넣는다.
- 현재 `행빌드()`는 기존 Sheet row를 복사한 뒤 API 값이 비어 있지 않으면 대상 칸을 다시 쓰는 구조다. 따라서 이 변경을 `--쓰기`로 실행하면 기존 canonical Sheet의 `세부모델` 값을 API `차명원문`으로 **덮어쓸 수 있다.** 이는 단순히 빈 finance 셀을 채우는 `FILLIFEMPTY`보다 강한 identity/model mutation이다.
- 더구나 같은 `세부모델` 칼럼을 rendered-DOM 요금표의 model join key로 다시 사용한다. 즉 **identity field mutation과 finance lookup key 생성이 한 변경으로 결합**된다.

## audit (39)과의 충돌

Audit (39)은 rendered DOM finance의 authority/provenance와 deterministic `model/plate/term/mileage/deposit` mapping이 입증되기 전에는 display-name/fuzzy guess를 canonical join으로 사용하지 말라고 명시했다. PR #402는 API의 `차명원문`을 canonical Sheet의 `세부모델`에 써 넣어 그 값을 finance join key로 만들기 때문에, 이 원칙을 우회할 가능성이 있다.

`세부모델`이 실제로 API `차명원문`과 동일한 business identity인지, 기존 수동/정제 `세부모델`을 대체해도 되는지, DOM rate table의 27개 고유 차종과 어떤 deterministic key로 대응되는지는 아직 증명되지 않았다.

## live 영향 경계

- PR #402는 아직 main에 merge되지 않았다.
- `.github/workflows/diag-ianka-collector.yml`은 계속 manual `workflow_dispatch` + preview-only이며 `이안카-재고시트.mjs`에 `--쓰기`를 주지 않는다.
- RP031 registry는 계속 Google Sheet canonical이고 production pin도 이 PR을 사용하지 않는다.

따라서 **현재 live Sheet/Atom/F01/F86가 이 PR 때문에 오염됐다고 주장하지 않는다.** 이번 finding은 merge/write 전에 막아야 하는 pre-merge SSOT boundary 문제다.

## Claude 구현 Owner 인계

1. PR #402를 현재 형태 그대로 merge한 뒤 `--쓰기`에 사용하지 않는다.
2. API `차명원문`과 canonical `세부모델`의 의미가 동일한지 먼저 증명한다. 기존 `세부모델` 값을 보존/마이그레이션할 계약 없이 identity 칸을 덮어쓰지 않는다.
3. finance join은 display name overwrite가 아니라 deterministic key로 설계하고, plate/model/term/mileage/deposit 단위 source parity와 provenance를 증명한다.
4. `연식` 칼럼 부재도 별도 schema gap으로 처리한다. 현재 Sheet에 쓸 곳이 없다는 이유로 silently dropped 상태를 canonical completeness로 오해하지 않는다.
5. DOM finance authority가 실제로 승인될 때만 registry + Source Contract + writer topology를 명시적으로 변경하고 source-sheet parity → Atom → snapshot → F01/F86 cross-audit로 promotion을 닫는다.
6. 그 전까지 audit (38)/(39)의 consumer/bootstrap-only 원칙과 RP031 Google-Sheet canonical HOLD를 유지한다.

이번 독립 감사에서는 application code/business logic을 수정하지 않았다.
