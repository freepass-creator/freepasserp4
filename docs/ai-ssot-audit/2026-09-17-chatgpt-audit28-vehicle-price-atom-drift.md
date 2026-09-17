# ChatGPT 독립 SSOT 감사 — audit (28): 차량가격 차량별 Atom/projection 수정이 production 밖에만 존재

검토일: 2026-09-17

## 판정

**충돌 — active production pin `6a6f3f75c065143ad14286d08baa28e382535eea`은 차량별 가격을 canonical source에서 Atom으로 읽어 보존하고, 발행에서 차량별 값을 우선하는 계약을 갖고 있지 않다. 이 수정은 Claude feature lineage `b6933732...` → `b0aedeee...`에 구현·실측됐지만 production/main에는 미반영이다.**

이 finding은 audit (27)의 손오공 보증금 recurrence와 별개다. audit (27)은 `e5fac1b...`가 production보다 3 commits ahead라고 기록했지만, 그 앞선 두 커밋의 vehicle-price 의미 변경은 별도 판정으로 남아 있지 않았다.

## 증거

1. production `6a6f3f75...`의 `scripts/ingest-supplier-to-firestore.mts`는 `resolveCols()`에 `차량가격/소비자가격/차량가/차량가액/차량금액` 탐지가 없고 `Row`에도 `carPrice`가 없다. 시트형 source의 차량별 가격을 Atom `consumer_price`로 읽는 경로가 없다.
2. 같은 pin의 `lib/domain/sales-atom-row.ts`는 `소비자가격/가격/금액`에서 supplier policy `sp[col]`을 먼저 반환한다. 차량별 Atom 가격 우선 분기가 없고, 정책값도 없으면 소비자가격은 빈칸으로 떨어진다.
3. commit `b6933732cfd4494d41eeddc1f75ed92e027d1ff3`은 이 구조를 실제 재현했다. 기록상 손오공 listable 258대가 전부 `36,000,000`으로 표시됐고 원천에는 차량별 서로 다른 가격이 있었다. 수정은 source price alias를 읽어 `carPrice`/`consumer_price`로 저장하고, 차량가격에 한해 **Atom 차량별 값 우선 → 정책 fallback** 순서로 바꿨다. RP004 반영 후 `consumer_price`가 전부 빈값 상태에서 46개 서로 다른 값으로 분화됐다.
4. commit `b0aedeee38a5fb47c97af2cc032e9d021f107fa8`은 Sonogong API dump 296대 전부에 `차량가격` 필드가 있었지만 collector가 읽지 않던 것을 확인하고 `carPrice: S(c.차량가격)`를 배선했다. 자체 실측은 listable 전체 차량가격 보유 `121/710 (17%) → 352/710 (50%)`, RP012 손오공 258대 `0 → 전량`이다.
5. Git compare `6a6f3f75...` → `e5fac1b40de282f0a59dc22a39cc42a2e01de8d3`는 `ahead`, merge-base가 정확히 `6a6f3f75...`, ahead by 3 commits다. 그 3개는 위 두 vehicle-price 수정과 audit (27)의 deposit recurrence guard 계보다. canonical workflow는 여전히 `6a6f3f75...`를 checkout한다.
6. current main의 `scripts/ingest-supplier-to-firestore.mts`는 `SSOT HARD GUARD` stub이므로 feature implementation이 main canonical collector로 이식된 상태도 아니다.

## 범위

현재 live F01/F86가 지금 반드시 다시 `36,000,000`으로 깨져 있다고 단정하지 않는다. feature-branch/manual ingest가 live Atom을 보완했을 수 있고 canonical workflow는 현재 disabled 상태다. 확정 가능한 위험은 **다음 `6a6f3f75...` canonical ingest/publish가 실행되면 차량별 가격 의미를 source에서 재생성·보존할 수 없는 production lineage gap**이다.

RP023/AutoPlus와 RP006/Iron canonical 원천에 차량가격이 실제 있는지는 해당 feature commit에서도 별도 HOLD였으므로 값을 추정하거나 만들어 넣지 않는다.

## Claude 구현 Owner 인계

`b6933732...` + `b0aedeee...` vehicle-price semantics를 audit (27)의 `e5fac1b...` deposit write-time guard와 같은 current production lineage에 선택 이식한다. RP004처럼 원천 가격이 다른 차량번호 표본과 Sonogong API 표본으로 SOURCE→ATOM→F01/F86 가격 일치를 검증한다. 차량가격은 차량별 Atom 사실이 supplier-wide policy보다 우선해야 하며 source가 비면 `미입력` 의미를 보존한다. RP023/RP006은 canonical 원천 필드 존재 여부를 별도 확인한다. production의 7-canonical/`오공구독`/F86/settlement-lock 계약은 되돌리지 않는다.

이번 감사에서는 application code나 business logic을 수정하지 않았다.
