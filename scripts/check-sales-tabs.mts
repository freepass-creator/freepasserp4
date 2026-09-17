/**
 * **판매 탭 갈래 잠금** — 「앞으로 쭉 유지될 수 있게끔」.
 *
 * ★★★사장님 2026-09-17 「이렇게 플래시성으로 하지말고 앞으로 쭉 유지될수 있게끔」·
 *   「탭 이름을 동일하게 맞추고 하허호 전용 시트에만 나머지 공급사 탭을 쭉 나열해주면 되는거였어」·
 *   「상품리스트  손오공상품 픽업구독 오토플러스 ←여기까지는 동일」
 *
 * 왜 이 검사가 있나 — F01 은 「상품구분별 탭」, F86 은 「회사별 탭」이라는 **다른 개념**으로 짜여
 * 있었고, 같은 것(고유 셋 뺀 나머지)이 한쪽은 「상품리스트」 다른 쪽은 「종합」이었다. 코드 어디에도
 * 그 둘이 «같다»는 말이 없어서 한쪽을 고치면 다른 쪽이 어긋났다. 정의를 한 곳에 두고 여기서 잠근다.
 *
 * ★바꾸려면 사장님께 여쭙고 → `lib/domain/sales-tab-kinds.ts` 를 고치고 → 이 검사를 고친다.
 *   ⚠ 이 검사를 «먼저» 고쳐 통과시키는 것은 규격을 지운 것과 같다.
 *
 *   npm run check:sales-tabs
 */
import {
  SALES_TAB_KINDS, SALES_TAB_OWN_KINDS, SALES_TAB_LEGACY_NAMES,
  salesTabKindOf, inSalesMainList,
} from '../lib/domain/sales-tab-kinds';

const fails: string[] = [];
const must = (ok: boolean, what: string) => { if (!ok) fails.push(what); };
const J = (v: unknown) => JSON.stringify(v);
const SSOT = 'lib/domain/sales-tab-kinds.ts';

/* ── ① 갈래 넷 · 차례 · 이름 ─────────────────────────────────── */
must(J([...SALES_TAB_KINDS]) === J(['상품리스트', '손오공상품', '픽업구독', '오토플러스']),
  `탭 갈래·차례가 바뀌었습니다: ${J([...SALES_TAB_KINDS])}\n      → ${SSOT} · SALES_TAB_KINDS — 사장님 2026-09-17 확정`);
must(J([...SALES_TAB_OWN_KINDS]) === J(['손오공상품', '픽업구독', '오토플러스']),
  `«따로 다니는» 셋이 바뀌었습니다: ${J([...SALES_TAB_OWN_KINDS])}\n      → ${SSOT} · SALES_TAB_OWN_KINDS`);

/* ── ② 옛 이름 → 지금 이름 (시트에 남은 옛 탭을 찾기 위해 남긴다) ── */
for (const [옛, 지금] of [['종합', '상품리스트'], ['오공구독', '손오공상품'], ['오플구독', '오토플러스']] as const) {
  must(SALES_TAB_LEGACY_NAMES[옛] === 지금,
    `옛 탭 이름 매핑이 빠졌습니다: ${옛} → ${SALES_TAB_LEGACY_NAMES[옛] ?? '(없음)'} (기대 ${지금})\n      → ${SSOT} · SALES_TAB_LEGACY_NAMES`);
}

/* ── ③ 원자 → 갈래 판정 ──────────────────────────────────────── */
const 케이스: [string, ReturnType<typeof salesTabKindOf>, { provider_company_code: string }, boolean][] = [
  ['손오공 픽업', '픽업구독', { provider_company_code: 'RP012' }, true],
  ['손오공 그 밖(오공구독·중고렌트 포함)', '손오공상품', { provider_company_code: 'RP012' }, false],
  ['오토플러스', '오토플러스', { provider_company_code: 'RP023' }, false],
  ['그 밖 렌트사', '상품리스트', { provider_company_code: 'RP004' }, false],
  ['픽업은 공급사보다 먼저', '픽업구독', { provider_company_code: 'RP004' }, true],
];
for (const [무엇, 기대, atom, 픽업] of 케이스) {
  const got = salesTabKindOf(atom, 픽업);
  must(got === 기대, `갈래 판정이 바뀌었습니다 — ${무엇}: ${got} (기대 ${기대})\n      → ${SSOT} · salesTabKindOf`);
}
must(inSalesMainList('상품리스트') && !inSalesMainList('손오공상품') && !inSalesMainList('픽업구독') && !inSalesMainList('오토플러스'),
  `「상품리스트」에 들어가는 갈래 판정이 바뀌었습니다 — 고유 셋은 제 탭에만 서야 합니다.\n      → ${SSOT} · inSalesMainList`);

if (fails.length) {
  console.error(`\n⛔ 판매 탭 갈래 규격이 어긋났습니다 — ${fails.length}건\n`);
  for (const f of fails) console.error(`  ✗ ${f}\n`);
  console.error(`  바꾸려면: 사장님께 여쭙고 → ${SSOT} → 이 검사 순서로.\n`);
  process.exit(1);
}
console.log(`✓ 판매 탭 갈래 그대로 — ${SALES_TAB_KINDS.join(' · ')} (F01·F86 같은 이름 · F86 은 뒤에 공급사 탭이 쭉)`);
