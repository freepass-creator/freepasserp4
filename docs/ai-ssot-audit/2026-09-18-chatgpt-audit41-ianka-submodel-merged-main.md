# 2026-09-18 ChatGPT 독립 SSOT 감사 — audit (41)

## 판정

**audit (40) 상태 정정 — PR #402는 감사 기록 직전 동시 작업으로 main에 merge됐다. 따라서 finding은 더 이상 pre-merge HOLD가 아니라 current-main writer/identity conflict다. 다만 실제 RP031 Sheet write나 production cutover가 일어났다는 증거는 없다.**

## 동시 변경 확인

- PR #402 `fix: 이안카 차명(원문) 칼럼 부재 — 세부모델로 채운다`는 2026-09-18T00:51:26Z에 merge됐다.
- merge commit: `86ecb136681151f4c7602a3ccdd4ef6eae51fb0a`.
- current main의 `ianka/scripts/이안카-재고시트.mjs`에는 실제로 다음 두 변경이 들어 있다.
  - `put(['차명(원문)', '차명', '차량명', '세부모델'], c.차명원문)`
  - finance lookup `차명col`의 alias에도 `세부모델` 추가
- 따라서 audit (40)의 기술적 finding 자체는 그대로 유효하지만 `open/unmerged` 범위 설명은 최신 상태가 아니다.

## 현재 충돌의 정확한 범위

`행빌드()`는 기존 Sheet row를 복사한 후 API source 값이 있으면 대상 칸을 덮는다. 현재 main에서는 API `차명원문`이 `세부모델` target으로 허용되므로 `--쓰기` 실행 시 기존 RP031 canonical Sheet의 `세부모델`을 raw display name으로 바꿀 수 있다.

그리고 바로 그 `세부모델` 칸이 rendered-DOM finance map의 lookup key로 사용된다. 즉 current main은 **identity/model mutation을 통해 finance join key를 만들어내는 write-capable path**를 보유한다.

아직 다음은 증명되지 않았다.

- API `차명원문`과 Sheet `세부모델`이 동일한 business identity라는 계약
- 기존 `세부모델`을 rawName으로 덮어써도 되는 보존/마이그레이션 규칙
- DOM 27개 model rate key와 RP031 plate/model/term/mileage/deposit의 deterministic mapping
- DOM finance의 upstream authority/provenance/formula

또 실제 Sheet 40-column schema에는 `연식` 칼럼도 없으므로 API year는 current writer에서 저장되지 않는다. 이는 별도 schema completeness gap이다.

## live / production 경계

- `.github/workflows/diag-ianka-collector.yml`은 계속 manual `workflow_dispatch` + preview-only이며 `--쓰기`를 호출하지 않는다.
- RP031 canonical registry는 계속 Google Sheet다.
- canonical production workflow는 계속 production pin `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`을 checkout하며, 이 main의 새 identity/finance writer 경로를 사용하지 않는다.

따라서 **main에는 위험 경로가 merge됐지만, 이 변경 때문에 live Sheet/Atom/F01/F86가 이미 오염됐다고 단정하지 않는다.**

## Claude 구현 Owner 인계

1. audit (40)의 `pre-merge` 표현만 정정하고 기술 finding은 유지한다. current main의 `차명원문 → 세부모델 overwrite`를 canonical solution으로 승인하지 않는다.
2. `--쓰기`나 scheduled promotion 전에 rawName/subModel identity 계약과 기존 값 보존/마이그레이션 규칙을 확정한다.
3. finance join을 identity overwrite와 분리하고 deterministic model/plate/term/mileage/deposit key + source provenance/parity를 증명한다.
4. `연식` 부재도 명시적 schema gap으로 처리한다.
5. authority가 승인되기 전에는 DOM finance를 canonical Sheet mutation → Atom promotion → production repin으로 연결하지 않는다.
6. audit (35)/(27)/(28)/(29)/(34) 및 legacy mirror/sales/settlement/RTDB HOLD는 직접 해소 증거가 없으므로 유지한다.

이번 독립 감사에서는 application code/business logic을 수정하지 않았다.
