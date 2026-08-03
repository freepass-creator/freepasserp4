# 정산 전수 감사 — 2026-08-04 (Claude)

방법: 운영 실데이터 전수(읽기 전용, write 0건). `tmp/audit-settlement.mts`

## 결과 요약

```
계약 70 · 살아있는 정산 15

① 계약완료 26건 중 정산 없음 ......... 0건   ✓
② 계약 없는 유령 정산 ................ 1건   ⚠
③ 금액 산식 불일치 .................. 12건   ✗  (전부 순수익 0)
④ fee_rate 분포 ..................... 0.1 × 13 · 없음 2 · 미확정표식 0

R2(영업자지급) 없음 .................. 14/15
순수익 없음 .......................... 14/15
미지급 R2 추정 합계 .................. 466,400원
```

## 원인 — v3 정산에 금액 필드가 아예 없었다

v3 `settlements` 14건 필드 전수:

| 있음 | 없음 |
|---|---|
| agent_code · agent_uid · car_number · contract_code · customer_name · provider_company_code · settlement_status · rent_amount(12) · deposit_amount(11) | **fee_rate · fee_amount · agent_payout · payout_rate · net_amount — 전부 0건** |

erp3 의 정산은 **상태·귀속만 들고 금액은 저장하지 않았다.**

이관(`migratedAt: 2026-07-27`)이 R1(`fee_amount`)은 계산해 `v4/settlements_provider_private` 에 13건 넣었지만,
`agent_payout` 은 원본에 없으므로 `splitSettlementPrivate` 의 `nonEmpty(agentRecord, AGENT_FIELDS)` 가 null 을
반환해 **`settlements_agent_private` 가 아예 생성되지 않았다.** `net_amount`(admin_private)도 마찬가지다.

```
v4/settlements_provider_private  13건  (fee_rate 0.1 · fee_amount 있음)
v4/settlements_agent_private      1건  ← R2 없음
v4/settlements_admin_private      1건  ← 순수익 없음
v4/admin_settlements              1건  ← 월정산서에서 관리되는 것도 아님
```

## 영향

`lib/domain/settlement-engine.ts` 헤더가 선언한 **"돈·상태 누락 제로(최상위 비타협)"** 가
이관분에서 깨져 있다. 영업자 정산 화면에서 지급액이 0 으로 보인다 — 계약을 물어온 영업자에게
바로 클레임이 되는 종류다.

**신규 계약은 정상이다.** `createSettlement` 가 R1·R2·순수익을 모두 만든다.
문제는 **이관분 14건에 국한**되며 오픈 자체를 막지는 않는다.

## 고치기 전에 확정할 것 두 가지

계산 재료는 다 있다.

```
R2      = rent_amount × 영업자 지급율
          지급율 = users[agent_code].agent_payout_rate · 없으면 기본 0.04
순수익  = R1 − R2
```

`v4/admin_settlements` 실 레코드가 `agency_fee_rate: "0.04"` 를 쓰므로 4% 가정에 근거는 있다.
그래도 **임의 백필하지 않았다.** 두 가지 때문이다.

1. **영업자별 지급율이 실제로 4% 인가.** 지금 `users` 에 `agent_payout_rate` 가 설정된 사람이 없어
   전원 기본값을 쓴다. 공급사 수수료율과 같은 함정 — 미정 상태로 굳히면 되돌리기 어렵다.
   (계약의 `payout_rate_snapshot` 은 규칙상 생성 후 불변이다.)
2. **유령 정산 `ST_CT-260714-01`.** 계약 `CT-260714-01` 이 없는데 수수료 78,000 이 잡혀 있다.
   계약이 삭제된 것인지 코드가 바뀐 것인지 확인이 필요하다.

지급율 확정 후 백필 스크립트를 dry-run 으로 제시하고 승인 뒤 적용한다. 원본은 JSONL 백업.
