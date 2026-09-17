# ChatGPT 독립 SSOT 감사 — audit 30: production F86 A1 fix 해소와 main lineage/checker drift

검수일: 2026-09-17

## 판정

**부분 해소 + 신규 lineage drift + 기존 checker drift 유지.**

- audit (26)의 F86 A1 values-write 400은 production `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`에서 초를 제거하는 방식으로 해소됐고, 실제 F86 발행 성공까지 확인됐다.
- 그러나 해당 fix는 current `origin/main`의 구현에 들어 있지 않다. production과 main은 diverged다.
- audit (23)의 F86 freshness checker는 현재 탭명 계약을 여전히 이해하지 못한다. one-time workflow가 `continue-on-error`로 실패를 가려 green으로 보였을 뿐이다.

## 증거 1 — active production은 초 없는 tab mark를 사용

current canonical workflow `.github/workflows/erp5-ssot-refresh.yml` checkout ref는 `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`이다.

이 ref의 `lib/server/sales-publish-snapshot.ts`는 `salesPublishTabMark()`를 사용해 `MM.DD HH:MM`까지만 출력한다. 초를 제거하는 이유가 Sheets A1 parser의 `Unable to parse range` 운영 장애였다고 코드 주석으로 고정돼 있다. 따라서 audit (26)의 `10:05:11` double-colon blocker는 active production 코드에서 제거됐다.

## 증거 2 — run 35208040283은 F86 values publish 자체는 성공

one-time run `35208040283`, job `105158550194` 실측:

- checkout `9bef7bf...`
- Sonogong heal: RP012 692대, 고칠 차 0대, 숫자 보증금 0대, 규칙 글자 불일치 0대
- snapshot: 등록 1,615 / 출고불가 861 / 현재 재고 754
- F86 publish: 19탭 / 754대 / success
- 값 대조: 47,911칸 / mismatch 0

따라서 `Unable to parse range`는 재현되지 않았고 audit (26)은 production 기준 해소다.

## 증거 3 — 같은 run의 F86 audit은 실제로 exit 1

동일 로그에서 freshness checker는 `종합 09.17 18:59 · 391대`, `손오공 · 302대` 및 그 밖 공급사 탭을 모두 `탭 이름에 발행 시각이 없다`고 판정하고 `하허호 F86 이 원자대로 «안» 서 있다 — 19갈래` 후 exit code 1 했다.

one-time workflow는 이 audit step을 `continue-on-error: true`로 실행해 job conclusion이 success로 남았다. 반면 canonical `erp5-ssot-refresh.yml`의 같은 audit command에는 `continue-on-error`가 없다.

따라서 audit (23)의 builder/freshness checker contract drift는 미해소다. **F86 값 발행 성공과 full-audit green은 구분해야 한다.**

## 증거 4 — production fix가 current main에는 없음

current `origin/main` HEAD `21282cf41cb7d000d51509b5e8bb0a9238b73d2e`의 `lib/server/sales-publish-snapshot.ts`는 `salesPublishTabMark()`가 없고 `salesPublishMark()`가 `HH:MM:SS`를 직접 출력한다.

Git compare `9bef7bf...` ↔ main은 `diverged`, merge-base는 `4bab085d30181612cbf47624a76006c57065dccd`다. 즉 production이 안전해졌다는 사실을 current main 구현의 해소로 일반화할 수 없다. main 기반 production pin을 다시 만들거나 pin을 풀 때 동등 fix가 누락되면 재발 가능성이 있다.

## 기존 OPEN/HOLD 재확인

- audit (27): Sonogong deposit recurrence guard `e5fac1b...` — production 미포함
- audit (28): vehicle-price source→Atom semantics `b6933732...`/`b0aedeee...` — production 미포함
- audit (29): `sales-tab-kinds.ts` naming migration — staged only, current main에도 파일 없음
- audit (22): main canonical deposit-policy와 production special-tab local policy 이중정의
- canonical source: RP006 ironrentcar / RP012 sokrc API / RP023 RebornCar 유지
- RP023 old Sheet mirror, mirror/RTDB legacy writer ownership은 기존 HOLD 유지

## Claude 구현 Owner 인계

1. production `9bef7bf...`의 tab mark fix와 동등한 계약을 canonical main lineage에도 보존한다.
2. F86 freshness checker를 current builder/tab-title contract와 공유하도록 맞춘다. 값/칸 대조 강도는 낮추지 않는다.
3. canonical full workflow에서 F01/F86 + freshness + cross-audit 전체 green을 증명한다.
4. audits (27)/(28)/(29)는 서로 섞지 말고 별도 promotion으로 유지한다.

이번 감사에서는 application code나 business logic을 수정하지 않았다.
