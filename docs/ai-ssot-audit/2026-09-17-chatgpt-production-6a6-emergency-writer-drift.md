# ChatGPT 독립 SSOT 감사 — production 6a6 pin · special-tab policy split · stale emergency writer

검토일: 2026-09-17

## 결론

이번 감사에서 audit (23) 이후 의미 있는 production 구현 변경과 새 writer drift를 확인했다.

1. canonical `.github/workflows/erp5-ssot-refresh.yml`의 검증 엔진 pin이 `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`에서 `6a6f3f75c065143ad14286d08baa28e382535eea`로 전진했다. PR #340 merge commit은 `7203c0ee703475f9f55cedf4c4d1034432d4069a`다. `6a6f3f75...`는 `2e880cef...`의 직계 전진 계보(2 commits ahead, 0 behind)다.
2. 새 engine은 차량가격 빈칸을 `미입력`으로 표시하고, 손오공 보증금을 숫자 계산값이 아니라 `deposit_note` 규칙 글자로 보존하도록 ingest를 바꿨다. 기존 손오공 숫자 보증금은 heal 도구로 0으로 정리하고, `inventory-contract`에 `depositRuleViolations`를 추가해 F01/F86/snapshot 발행 직전 위반을 막는다.
3. main의 `scripts/check-inventory-source-contract.mts`는 `6a6f3f75...`를 `VALIDATED_ENGINES`에 추가했고 PR #340의 `SSOT Source Contract` run `35168129260`과 generic verify run `35168129290`이 모두 success다. 따라서 audit (23)의 `production pin=2e880cef...` 요약은 stale하다.
4. 그러나 audit (22)의 special-tab deposit-policy SSOT drift는 해소되지 않았다. current main에는 `lib/domain/deposit-policy.ts`가 있고 손오공/오토플러스 표시가 이 canonical policy object/resolver를 소비한다. 반면 active production `6a6f3f75...`에는 `deposit-policy.ts` 자체가 없고 `sales-published-tabs.ts`가 별도 `sonokongDepositRuleText()`와 AutoPlus 로컬 판정을 사용한다. 특히 production AutoPlus는 maker 빈값도 `isImportBrand('') ? 수입 : 국산`으로 국산 fallback하는 반면 main canonical resolver는 maker 빈값을 `undefined`로 fail-closed한다. 손오공 rule label도 main canonical `월 대여료 × 연수 (최대 ×3)`와 production local `월 대여료 × 약정연수 (최대 3개월)` 두 정의가 공존한다.
5. current main `lib/domain/inventory-contract.ts`도 production `6a6f3f75...`의 `depositRuleViolations` gate를 아직 포함하지 않는다. production이 더 엄격한 publication gate를 갖게 됐지만 main canonical implementation과 계약이 다시 한 줄로 합쳐진 상태는 아니다. 향후 production pin 해제/이식 시 이 차이를 잃지 않도록 명시적으로 병합해야 한다.
6. audit (23)에서 이미 second writer로 분류한 `.github/workflows/manual-erp5-full-sync-once.yml`이 이제 **stale engine writer**가 됐다. 이 파일은 여전히 `ref: 2e880cefa96e3fa4bfc79902fed448d5bd74abdb`를 checkout하고 `FREEPASS_MANUAL_PUBLISH_APPROVED`로 F01/F86을 직접 쓴다. canonical production은 `6a6f3f75...`로 전진했으므로 이 one-time workflow가 다시 트리거되면 차량가격 `미입력`, 손오공 보증금 규칙글자/발행문지기 등 새 production 의미를 갖지 않은 옛 engine으로 동일 F01/F86을 다시 쓸 수 있다. 기존 “second writer” 위험이 **same-output engine drift**로 구체화됐다.
7. F86 freshness checker drift도 새 pin에서 그대로다. `channel-f86-plan.ts`는 하허호에서 `종합`만 timestamp를 붙이고 공급사 탭은 `회사 · N대`로 만든다. 같은 `6a6f3f75...`의 `audit-f86-vs-atom.mts`는 여전히 모든 탭 제목에 timestamp regex를 요구한다. audit (23)의 false-positive 판정은 미해소 유지다.
8. canonical inventory source registry는 그대로다: RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar. `mirror-sync.yml`의 30분 `--apply`, `sales-erp-hourly.yml`의 scheduled `--apply`, RP023 legacy mirror Google Sheet, old `settlement-sync.yml`, composite credential-action parser HOLD도 이번 변경으로 해소되지 않았다.

## 최근 CI/commit 관찰

- PR #340 merge `7203c0ee703475f9f55cedf4c4d1034432d4069a`
  - `SSOT Source Contract` run `35168129260`: success
  - `verify` run `35168129290`: success
- 감사 시점 main HEAD `a5407c53d806c89ad9a738f96809882426c23543`(PR #333)은 required checker의 known-bad fixture 증명을 시작한 CI-governance 변경이며 verify run `35168190277`이 success다. 이 변경은 위 writer/source/policy drift를 직접 해소하지 않는다.
- audit (23)에서 확인한 canonical ERP5 workflow disabled 상태를 뒤집는 신규 운영 증거는 이번 감사에서 확인하지 않았다. PR #340 commit 설명도 workflow가 `disabled_manually` 상태임을 명시한다.

## Claude 구현 Owner 지시

- current production pin은 `6a6f3f75c065143ad14286d08baa28e382535eea`로 취급한다. `2e880cef...`를 최신 pin으로 쓰는 문서/one-time writer를 그대로 두지 않는다.
- `manual-erp5-full-sync-once.yml`은 긴급 회차가 끝난 임시 writer라면 retire/remove하고, 유지할 이유가 있다면 canonical workflow와 동일 production engine 계약을 따르도록 명시적으로 통제한다. **옛 pin으로 동일 F01/F86을 쓰게 두지 않는다.**
- production의 손오공 deposit-rule/gate 개선은 유지하면서 main `deposit-policy.ts` canonical policy object/resolver와 하나로 합친다. AutoPlus maker blank는 current canonical fail-closed 결정과 맞춘다. production의 7-canonical/F86/collector 의미를 main 옛 구현으로 되돌리지 않는다.
- F86 freshness checker는 `종합` timestamp 또는 shared plan contract 기준으로 고치되 칸/차례/값 감사 강도는 유지한다.
- legacy `sales-erp-hourly`/`mirror-sync`/settlement/credential/pickup-color HOLD는 직접 해소 증거가 생길 때까지 유지한다.

이번 감사에서는 application code/business logic을 수정하지 않았다.