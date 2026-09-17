# ChatGPT 독립 SSOT 감사 — audit (26): F86 values range addressing failure

검토일: 2026-09-17

## 결론

손오공 보증금 SSOT는 live ERP5 Atom에서 정상이다. run `35169123131`의 F86 실패 원인은 보증금 gate가 아니라 Google Sheets values write 단계의 A1 range addressing failure다.

## 실행 증거

- production checkout: `6a6f3f75c065143ad14286d08baa28e382535eea`
- Sonogong RP012: 692대, 수정 필요 0대, 숫자 보증금 잔존 0대, 규칙 글자 불일치 0대
- 규칙 글자: `월 대여료 × 약정연수 (최대 3개월)`
- snapshot/deposit gate: PASS — `20260917010511539-16123390d345`, 등록 1,615 / 출고불가 861 / 현재 재고 754
- F86 backup: PASS
- F86 plan: 754대 = 상품리스트 391 + 오공구독 51 + 픽업구독 251 + 오플구독 61
- locked format / manual production-write approval: PASS
- publish: FAIL — HTTP 400 `INVALID_ARGUMENT`, `Invalid data[0]: Unable to parse range: '종합 09.17 10:05:11 · 391대'!A1`
- F86 audit: skipped

## 코드 경계

production `scripts/build-channel-supplier-sheet.mts`는 dynamic tab `title`로 `'<title>'!A1`를 만들어 `values:batchUpdate`에 넘긴다. structural/format `batchUpdate`를 먼저 수행하고 values write를 뒤에 수행하므로, 구현 Owner는 range addressing과 write ordering/원자성을 함께 검토해야 한다. deposit rule/gate는 이번 failure의 원인이 아니므로 완화하지 않는다.

## live read-only 확인

운영 F86 불변 ID의 현재 summary는 `종합 09.17 10:05:01 · 391대`이며 A1:H5가 채워져 있었다. failed run이 시도한 `10:05:11` title은 live에 남아 있지 않았다. 따라서 이 run이 live sheet를 blank/corrupt했다고 단정하지 않으며, 최신 validated snapshot이 정상 publish/audit되지 못했다는 범위로 판정한다.

## 미해소 유지

- main-vs-production deposit-policy 이중정의 (audit 22)
- F86 freshness checker contract drift (audit 23)
- canonical ERP5 workflow disabled
- one-time F86 writer ownership
- legacy sales/mirror/settlement/credential/RP023 mirror/pickup-color HOLD

이번 감사에서는 application code/business logic을 수정하지 않았다.
