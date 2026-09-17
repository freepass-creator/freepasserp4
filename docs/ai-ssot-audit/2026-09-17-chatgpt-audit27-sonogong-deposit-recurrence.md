# ChatGPT 독립 SSOT 감사 — audit (27): 손오공 보증금 숫자 재발 경로가 active production pin 밖에서만 수정됨

검토일: 2026-09-17

## 판정

**충돌 — audit (26)의 live Atom clean/gate PASS 판정은 그대로 맞지만, active canonical production pin `6a6f3f75c065143ad14286d08baa28e382535eea`의 ingest에는 손오공 숫자 보증금을 다시 살릴 수 있는 재발 경로가 남아 있다.**

Claude feature branch commit `e5fac1b40de282f0a59dc22a39cc42a2e01de8d3`에서 이 재발 경로를 실제로 재현하고 수정했지만, current main과 active production pin에는 아직 들어오지 않았다.

## 증거 1 — 재발이 274대에서 실제 재현됨

commit `e5fac1b40de282f0a59dc22a39cc42a2e01de8d3`의 구현/검증 기록:

- 손오공 보증금 계산 지점을 `deposit: 0`으로 바꾼 뒤에도 ingest를 한 번 실행하자 **274대의 Atom에 옛 숫자 보증금이 다시 박힘**.
- 원인은 price map을 쓰는 경로가 두 곳이고, 한 경로가 기존 Atom 값을 되살리는 구조였음.
- `levelDepositsForRuleText(price, note)`를 신설해 **쓰기 직전** 규칙 글자가 있는 price map의 모든 `deposit`을 0으로 강제.
- ingest의 두 price-write 지점 모두 이 문지기를 통과하도록 수정.
- heal로 274대를 정정한 뒤 같은 ingest를 다시 `--apply`해 **deposit-rule violation 0대**를 재확인.
- snapshot 오류문에도 `보증금규칙 N`을 표시하도록 보완.

즉 이 commit은 단순 예방성 refactor가 아니라 **기존 production 계보의 실제 재발을 재현한 뒤 막은 수정**이다.

## 증거 2 — 수정 commit은 active production pin보다 3커밋 앞이지만 production에는 미포함

Git compare `6a6f3f75...` → `e5fac1b...`:

- status: `ahead`
- merge base: `6a6f3f75c065143ad14286d08baa28e382535eea`
- `e5fac1b...`가 production pin보다 **3 commits ahead**
- 변경 파일에는 `lib/domain/sales-published-tabs.ts`, `scripts/ingest-supplier-to-firestore.mts`, `scripts/capture-sales-publish-snapshot.mts`가 포함됨.

따라서 `e5fac1b...`의 재발 방지 guard는 `6a6f3f75...`에 이미 들어 있던 코드가 아니다.

## 증거 3 — current main에도 guard가 없음

current main code search에서 `levelDepositsForRuleText`는 0건이다. 또한 current main과 `e5fac1b...`는 동일 직계 계보가 아니라 `diverged`다.

따라서 feature-branch 수정이 current main에 merge됐다고 볼 근거가 없다.

## 증거 4 — canonical workflow는 여전히 old pin을 checkout

current main `.github/workflows/erp5-ssot-refresh.yml`은 여전히:

- `ref: 6a6f3f75c065143ad14286d08baa28e382535eea`

를 checkout해 source ingest를 수행하도록 선언한다.

따라서 이 workflow가 다시 enabled되어 schedule/apply ingest를 수행하거나, 같은 pin의 ingest를 다른 수동 경로에서 실행하면 **숫자 보증금 재발 가능성은 active production 기준 미해소**다.

반면 current F86-only emergency writer는 source ingest를 하지 않고 Sonogong heal → snapshot gate를 거치므로, 그 한 경로는 재발을 직접 만들지 않는다. 이것을 canonical ingest 재발 해소로 일반화하면 안 된다.

## audit (26)와의 관계

다음 audit (26) 사실은 그대로 유지한다.

- run `35169123131` 시점 live RP012 Atom은 숫자 보증금 0대 / 규칙글자 불일치 0대였음.
- snapshot/deposit gate는 PASS했음.
- F86 실제 publish의 blocker는 별도 A1 range-addressing 400임.

새로운 결론은 **현재 데이터가 깨져 있다는 뜻이 아니라, production ingest가 같은 숫자 보증금을 다시 만들 수 있는 recurrence path를 feature branch에서 실제로 발견했다는 것**이다.

## Claude 구현 Owner 인계

1. `e5fac1b40de282f0a59dc22a39cc42a2e01de8d3`의 **쓰기 직전 deposit normalization guard**를 current production lineage에 선택적으로 이식/병합한다.
2. production의 7-canonical product type, `오공구독`, F86 표시계약, settlement lock, publication gate를 되돌리지 않는다.
3. `heal → ingest --apply → snapshot` 순서로 다시 실행해 `depositRuleViolations=0`이 ingest 후에도 유지되는지 검증한다.
4. 보증금 publication gate는 유지한다. gate가 재발을 막아주는 최후선이지, ingest recurrence를 허용하는 근거가 아니다.
5. audit (26)의 F86 A1 addressing blocker는 별도 OPEN으로 계속 처리한다.

이번 감사에서는 application code나 business logic을 수정하지 않았다.
