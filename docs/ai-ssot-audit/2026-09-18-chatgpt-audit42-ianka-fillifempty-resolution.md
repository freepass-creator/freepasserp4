# 2026-09-18 ChatGPT 독립 SSOT 감사 — audit (42)

## 판정

**PR #403가 audit (41)의 가장 위험한 부분인 기존 `세부모델` 파괴적 overwrite를 해소했다. 다만 blank fallback과 finance lookup alias가 같은 `세부모델`에 남아 있어 identity/finance authority 경계는 부분 OPEN이다.**

## 1. audit (41) 이후 current main delta

audit (41) 기록 HEAD `aee3d6334b0621c67ed0fcdfff803479130ac9b3`에서 current main `88b16da5c07a1091eba401540891c41280731408`까지는 정확히 **1 commit / 2 files**다.

- `ianka/scripts/이안카-재고시트.mjs`
- `.github/workflows/diag-supplier-counts.yml`

따라서 이 회차에서 ERP5 production workflow, canonical source registry, F01/F86 projection, Sonogong/AutoPlus special-tab, mirror/RTDB legacy writer에 별도 구현 변경이 들어왔다고 확대해석하지 않는다.

PR #403:
- merged: `2026-09-18T01:12:33Z`
- merge commit: `88b16da5c07a1091eba401540891c41280731408`
- PR head: `d7dae6665c286175bdf4900d50618254c0dedcfb`
- PR CI run: `35294178908` — success

## 2. 해소된 부분 — 기존 canonical `세부모델` overwrite

audit (41)의 직접 충돌은 다음 코드였다.

```js
put(['차명(원문)', '차명', '차량명', '세부모델'], c.차명원문);
```

기존 row를 복사한 뒤 API `차명원문`을 `세부모델`까지 ALWAYS 후보로 두어, 사람이 정제한 non-empty `세부모델`도 raw display name으로 바꿀 수 있었다.

PR #403는 이를 제거하고 다음 계약으로 바꿨다.

- 실제 `차명(원문)` / `차명` / `차량명` 칼럼이 있으면 그 전용 칼럼은 source 값으로 갱신
- 그런 칼럼이 없고 `세부모델`만 있으면 `세부모델`이 **빈 경우에만** API `차명원문`을 채움
- 기존 non-empty `세부모델`은 보존

따라서 **기존 정제 identity를 API rawName으로 파괴적으로 덮는 audit (41) finding은 해소됨**이다.

## 3. 여전히 OPEN인 경계

FILLIFEMPTY는 보존 안전장치이지 identity 계약의 증명은 아니다.

현재도 다음 경계는 남는다.

1. 신규/blank row의 `세부모델`은 API `차명원문`으로 채울 수 있다.
2. finance lookup은 같은 `세부모델` alias를 사용할 수 있다.
3. 따라서 `rawName == subModel` business identity 동치가 증명되지 않은 상태에서 신규행의 identity bootstrap과 finance join이 여전히 같은 필드에 의존할 수 있다.
4. rendered-DOM 27개 model rate와 실제 차량의 `model/plate/term/mileage/deposit` deterministic mapping, source authority/provenance/parity도 아직 별도 증명이 필요하다.
5. 실제 RP031 Sheet에는 `연식` 칼럼이 없어 API year를 보존하지 못하는 schema gap도 그대로다.

따라서 audit (41)은 **전면 폐기**가 아니라 “destructive overwrite 부분 해소 / identity-finance boundary 부분 OPEN”으로 좁혀진다.

## 4. runtime 증거 — preview path는 정상, live write는 아님

main commit `88b16da5...`에서 manual diagnostic run `35294388217`이 success했다.

실측 로그:
- inventory API: 총 85대, 출고가능 84대, 예약중 21대
- DOM rate scrape: 1/3/5/12/24/36/48/60개월 각각 34 cards, 고유 27종
- 최종 요금표: 27종
- Sheet mapping preview:
  - 총 88행
  - 기존시트 차번 16행
  - API∩기존 13대
  - API 신규 72대
  - 기존시트에만 있어 보존 3대
  - 요금 FILLIFEMPTY 56행 / 413칸
- 최종 로그: `[미리보기만] 라이브 안 건드림`

이 run은 PR #403 이후 **preview 계산과 보존 로직이 끝까지 실행됨**을 보여준다. 하지만 workflow 자체가 `workflow_dispatch` + no `--쓰기`이므로 live canonical Sheet mutation, ERP5 Atom promotion, F01/F86 publication을 증명하지 않는다.

## 5. production 경계

`.github/workflows/erp5-ssot-refresh.yml`은 계속 production pin:

`9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`

을 checkout한다.

이번 audit (41) → audit (42) main delta에는 production workflow, registry, F01/F86, Sonogong/AutoPlus special-tab, mirror/RTDB writer 변경이 없다. 따라서 기존 audit (35)/(27)/(28)/(29)/(34) 및 legacy writer HOLD는 직접 해소 증거가 없으므로 유지한다.

## Claude 구현 Owner 인계

1. FILLIFEMPTY 안전화는 유지한다.
2. 이를 canonical identity 승인으로 해석하지 않는다.
3. blank 신규행의 rawName/subModel 의미와 migration contract를 명시한다.
4. finance join은 deterministic identity key와 provenance/parity를 따로 증명한다.
5. `연식` schema gap을 닫는다.
6. 그 뒤에만 write/schedule/production promotion을 승인하고 Sheet → Atom → snapshot → F01/F86 전체 대사를 다시 증명한다.

이번 독립 감사에서는 application code/business logic을 수정하지 않았다.
