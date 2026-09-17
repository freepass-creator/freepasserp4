---

## 2026-09-17(30) — ChatGPT 독립 감사: audit (26) production 해소 확인 + F86 fix의 detached-lineage drift + freshness checker 미해소

**판정: audit (26)의 F86 A1 values-write blocker는 active production에서 해소됐다. 다만 그 수정은 current `origin/main` 구현에 포함되지 않은 detached production lineage에만 있고, audit (23)의 F86 freshness checker contract drift도 그대로 남아 있다.**

- current `origin/main` HEAD는 `21282cf41cb7d000d51509b5e8bb0a9238b73d2e`이고, canonical `.github/workflows/erp5-ssot-refresh.yml`은 production engine `9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60`을 checkout한다.
- production `9bef7bf...`의 `lib/server/sales-publish-snapshot.ts`에는 `salesPublishTabMark()`가 있으며 탭 시각을 `MM.DD HH:MM`으로 만든다. 초를 제거해 `10:05:11`처럼 콜론이 두 개 들어가던 audit (26)의 Sheets A1 parsing failure를 직접 막는다.
- 반면 current main의 같은 파일에는 `salesPublishTabMark()`가 없고 `salesPublishMark()`가 여전히 `HH:MM:SS`를 직접 만든다. Git compare `9bef7bf...` ↔ current main은 `diverged`, merge-base=`4bab085d30181612cbf47624a76006c57065dccd`다. 즉 production fix는 current main의 조상이 아니며, 향후 main 기반 repin/이식 때 동등 수정이 누락되면 audit (26)이 재발할 수 있다.
- one-time run `35208040283`은 실제로 production `9bef7bf...`를 checkout해 F86 **19탭 / 754대** 발행을 완료했다. 같은 run의 F86 값 대조는 **47,911칸 / 값 어긋남 0**이었다. 따라서 audit (26)의 values-write blocker는 active production 기준 **해소됨**으로 갱신한다.
- 그러나 같은 `audit-f86-vs-atom.mts`는 탭명 freshness 검사에서 `종합 09.17 18:59 · 391대`와 공급사 탭 18개를 모두 `탭 이름에 발행 시각이 없다`고 판정하고 exit 1 했다. one-time workflow는 이 step을 `continue-on-error: true`로 마스킹해 job 전체가 green이었을 뿐이다. canonical `erp5-ssot-refresh.yml`의 동일 audit step에는 `continue-on-error`가 없다. 따라서 audit (23)의 **builder↔freshness checker contract drift는 여전히 OPEN**이며, canonical full-run은 F86 values write가 성공해도 이 checker 때문에 red가 될 수 있다.
- 그러므로 run `35208040283`을 `F86 publish 성공 증거`로 쓰는 것은 맞지만 `F86 full-audit green 증거`로 쓰면 안 된다. Claude 구현 Owner의 직전 로그에서 미해소 목록에 audit (23)이 빠져 있었던 부분은 이 항목으로 보완한다.
- audit (27) 손오공 deposit recurrence guard, audit (28) 차량별 price semantics, audit (29) `sales-tab-kinds` staged migration도 active production `9bef7bf...`에 승계되지 않았다. `9bef7bf...`는 해당 feature lineage들과 diverged 상태다.
- canonical source 계약은 변화 없다: RP006=`ironrentcar.com`, RP012=`sokrc.com/api`, RP023=RebornCar. `MIRROR_SOURCES`의 RP023 옛 Google Sheet와 legacy mirror/RTDB scheduled paths는 canonical source 권한이 없으며 기존 ownership HOLD를 유지한다.

### Claude 구현 Owner 인계

1. audit (26)은 active production에서 **해소됨**으로 닫되, `9bef7bf...`의 초 제거와 동등한 tab-mark 계약을 canonical main lineage에도 보존한 뒤 future repin을 한다.
2. `audit-f86-vs-atom.mts` freshness 판정을 현재 F86 plan 계약(종합에만 시각, 공급사 탭은 회사명+대수)과 공유/정렬한다. **차량/칸 값 대조는 약화하지 않는다.**
3. 수정 뒤 canonical `erp5-ssot-refresh`에서 F01/F86 publish + F86 audit + Atom↔F01↔F86 cross-audit가 전부 green인 회차를 확보한다.
4. audit (27)/(28)/(29)는 별도 promotion work로 유지하며 production의 기존 7-canonical/정산락/F86 계약을 되돌리지 않는다.

상세 근거: `docs/ai-ssot-audit/2026-09-17-chatgpt-audit30-production-main-f86-lineage.md`.

이번 ChatGPT 감사에서는 application code/business logic을 수정하지 않았다.
