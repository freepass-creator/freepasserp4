# ChatGPT 독립 SSOT 감사 — audit 29: 판매 탭 갈래 SSOT staged migration

검수일: 2026-09-17

## 판정

**구현 진전은 있으나 production/main 해소는 아님.** Claude 단일 구현 branch에 F01/F86 공통 판매 탭 갈래 정의와 잠금 checker가 새로 생겼지만, 해당 commit은 스스로 “1/3단계 — 정의만 / 발행에는 아직 안 붙였다”고 명시한다. 현재 발행기와 live production pin은 여전히 서로 다른 옛 이름 계약을 사용한다.

## 증거

1. `claude/f86-peer-spec-transplant` head `a6843cdbb8fac53f922b726f89ecf1a976c88a20`
   - `lib/domain/sales-tab-kinds.ts` 신설
   - target: `상품리스트`, `손오공상품`, `픽업구독`, `오토플러스`
   - legacy read aliases: `종합→상품리스트`, `오공구독/손오공구독→손오공상품`, `오플구독→오토플러스`
   - `scripts/check-sales-tabs.mts` 신설 및 `check:sync` 연결
   - commit message가 명시적으로 “정의뿐이고 발행에는 아직 안 붙였다”고 적음.
2. 같은 branch의 `lib/server/channel-f86-plan.ts`는 아직 `RETRO_SUMMARY_TAB` 기반 `종합` summary/tab plan을 사용한다. 따라서 새 tab-kind SSOT는 F86 publisher/plan에 아직 완전 연결되지 않았다.
3. naming contract는 현재 세 벌이다.
   - current main: `상품리스트 / 손오공구독 / 픽업구독 / 오플구독`
   - active production `6a6f3f75...`: `상품리스트 / 오공구독 / 픽업구독 / 오플구독`
   - staged target `a6843cdb...`: `상품리스트 / 손오공상품 / 픽업구독 / 오토플러스`
4. compare `6a6f3f75... → a6843cdb...`: ahead 5, behind 0, merge-base=`6a6f3f75...`. audit (27)/(28)의 deposit/vehicle-price 수정 계보에 새 tab-contract 정의가 추가됐지만 production workflow의 checkout pin은 아직 `6a6f3f75...`다.
5. current main `d87bb185...` CI는 green이며 audit (28) 이후 main application 변경은 상품찾기 UI 문구 변경뿐이다. canonical source registry와 mirror/legacy topology에는 신규 해소 증거가 없다.

## 범위

- 새 `sales-tab-kinds.ts`는 **projection tab naming/routing SSOT**다. canonical inventory source나 Atom price/deposit 의미를 바꾸는 근거로 사용하지 않는다.
- audit (26) F86 A1 values write 400, audit (27) Sonogong deposit recurrence, audit (28) vehicle-price lineage gap은 계속 OPEN/HOLD다.
- 새 checker가 존재해도 publisher/auditor가 아직 모두 같은 SSOT를 소비하지 않으므로 “잠겼다/해소됐다”라고 판정하지 않는다.

## Claude 구현 Owner 인계

2/3 F86 + 3/3 F01 단계에서 publisher, auditor, old-tab cleanup, F86 locked layout을 같은 tab-kind SSOT에 연결하고 legacy 이름은 읽기 alias로만 남긴다. production repin 전 audit (27)/(28) fixes 보존과 audit (26) A1 fix를 따로 확인한다. 실제 F01/F86 publish + cross-audit가 green인 뒤에만 naming migration을 해소 처리한다.
