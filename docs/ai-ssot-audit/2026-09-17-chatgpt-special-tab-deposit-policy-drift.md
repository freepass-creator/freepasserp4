# ChatGPT 독립 SSOT 감사 — 손오공/오토플러스 특수탭 보증금 정책 drift

검토일: 2026-09-17

## 판정

**충돌 — current main의 보증금 정책 SSOT와 current production pin의 특수탭 projection 계약이 갈라져 있다.**

이 finding은 새 커밋이 방금 만든 회귀라기보다, current main과 production pin을 독립 비교하면서 새로 확인한 계보/정책 drift다.

## 증거 1 — current main은 보증금 규칙을 `deposit-policy.ts`에 canonicalize했다

current main `lib/domain/deposit-policy.ts`는 손오공/오토플러스 보증금 정책을 단일 객체/리졸버로 정의한다.

- 도입 commit: `110bb75935688dc6b01d361d1e6dcac335e65b50` — `feat(ssot): centralize Sonogong and Autoplus deposit rules`
- 보완 commit: `aae377d048181f09edbeaa7546ae0afb71c09be4` — `fix(ssot): do not infer Autoplus deposit policy without maker`

핵심 계약:

- 손오공: `월 대여료 × 연수 (최대 ×3)`
- 오토플러스 국산: `월 대여료×2`
- 오토플러스 수입: `12개월 ×3 · 18개월↑ ×6`
- **제조사가 비어 있으면 오토플러스를 국산으로 추정하지 않고 `undefined`로 fail-closed**

current main `lib/domain/sales-published-tabs.ts`도 commit `80a0d82317fc84b80dd7b5e7ff4d45426966e9b0`에서 이 정책 SSOT를 소비하도록 바뀌었다.

- 손오공 `보증금 반납형`은 원본 문자열 복사가 아니라 `SONOGONG_DEPOSIT_POLICY.label`을 발행
- 오토플러스 보증금 표시는 `resolveAutoplusDepositPolicy(maker)?.label ?? ''`

## 증거 2 — production pin `2e880cef...`에는 이 canonical policy 파일 자체가 없다

current production checkout ref:

- `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`

이 ref에서 `lib/domain/deposit-policy.ts`는 존재하지 않는다.

production `lib/domain/sales-published-tabs.ts`는 여전히:

- `오공구독`의 `보증금 반납형`을 special-tab 원본 block에서 그대로 읽고,
- 오토플러스 보증금 표시는 로컬 함수에서 문자열을 직접 하드코딩한다.

```ts
return isImportBrand(String(maker ?? ''))
  ? '수입: 12개월 대여료×3 · 18개월↑ ×6'
  : '국산: 월 대여료×2';
```

따라서 maker가 빈 문자열이면 production은 `isImportBrand('') === false` 경로로 **국산 ×2를 추정**한다. current main canonical resolver는 같은 경우 **정책 미확정/빈 표시**로 둔다. 이는 실제 의미 차이다.

## 증거 3 — 두 계보는 동일 정책 commit을 공유하는 직계 계보가 아니다

`110bb759...`와 production `2e880cef...` 비교는 `diverged`이며 merge-base는 `4bab085d30181612cbf47624a76006c57065dccd`다. production pin이 main의 보증금 정책 centralization을 상속했다고 볼 수 없다.

## 범위와 비범위

이번 finding은 **손오공/오토플러스 특수탭의 보증금 정책 SSOT/projection**에 한정한다.

- canonical inventory source는 그대로 RP012=`sokrc.com/api`, RP023=RebornCar다.
- production 특수탭 이름 `오공구독 / 픽업구독 / 오플구독`, F86 projection 규칙, collector source 계약을 되돌리라는 뜻이 아니다.
- 손오공 원본 `보증금 반납형` 문자열이 현재 canonical 정책과 실제 값까지 다른지는 이번 감사에서 단정하지 않는다. 다만 production projection이 canonical policy object에 잠겨 있지 않은 것은 확정이다.
- 오토플러스 maker 누락 시 동작은 코드상 명확히 다르다.

## Claude 구현 Owner 인계

1. production lineage에 current main `deposit-policy.ts`의 canonical policy를 선택적으로 이식/병합하되, production의 7-canonical 상품구분·`오공구독` naming·F86·collector semantics를 되돌리지 않는다.
2. 손오공/오토플러스 adapter 및 special-tab publisher가 같은 policy object/resolver를 소비하도록 정리한다.
3. 특히 오토플러스 maker 누락을 국산으로 추정하지 않는 fail-closed 계약을 current business rule로 재확인하고, production publish/audit에서 검증한다.
4. 기존 schedule gap, same-output F01 legacy writer, credential action, settlement Atom-lock, pickup color, mirror ownership HOLD는 별도 항목으로 유지한다.

이번 감사에서는 application code나 business logic을 수정하지 않았다.
