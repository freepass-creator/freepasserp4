/**
 * **톰스톤 해제 시뮬레이션** — 화면의 「검증 → 반영」이 실제로 부르는 `commitSheetProducts` 를
 * LocalAdapter 위에서 그대로 돌린다.
 *
 * 무엇을 고정하는가:
 *   ① 시트에 있는데 삭제 상태로 묻힌 차는 **되살아난다**  (2026-08-05 아이카 6대가 그랬다)
 *   ② 시트에 «없는» 삭제 매물은 **그대로 둔다**            (아무거나 부활하면 안 된다)
 *   ③ 되살린 차는 다시 목록에 뜬다
 *
 * ②가 이 테스트의 핵심이다. `store.save` 의 dedup 이 소프트삭제 키를 포함하는 건
 * 자연키 재저장으로 아무 매물이나 부활하는 걸 막으려는 의도였다(rtdb-adapter:622).
 * 그 가드를 깨지 않았다는 걸 여기서 증명해야 한다.
 *
 *   npx tsx scripts/sim-sheet-revive.mts
 */
const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
(globalThis as unknown as { localStorage: typeof ls; window: typeof globalThis }).localStorage = ls;
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
(globalThis as unknown as { window: { dispatchEvent: (e: Event) => boolean } }).window.dispatchEvent = () => true;
class CE extends Event { detail: unknown; constructor(t: string, i?: { detail?: unknown }) { super(t); this.detail = i?.detail; } }
(globalThis as unknown as { CustomEvent: typeof CE }).CustomEvent = CE;
process.env.NEXT_PUBLIC_DATA_BACKEND = ''; // LocalAdapter 강제

const { getStore } = await import('../lib/store');
const { getCompanyId } = await import('../lib/tenant');
const { commitSheetProducts, listProductsForSheetReconcile } = await import('../lib/domain/sheet-merge');
import type { EntityRecord } from '../lib/intake/entities';

const co = getCompanyId();
const store = getStore();
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got === undefined ? '' : `  → got: ${JSON.stringify(got)}`}`); }
};
const head = (s: string) => console.log(`\n━━ ${s}`);

const product = (code: string, plate: string, extra: Record<string, unknown> = {}): EntityRecord => ({
  product_code: code, car_number: plate, maker: '현대', model: '쏘나타', sub_model: '쏘나타 DN8',
  vehicle_status: '출고가능', product_type: '중고렌트', provider_company_code: 'RP999',
  price: { '36': { rent: 550000, deposit: 0, fee: 55000 } },
  ...extra,
} as EntityRecord);

// ── 준비: 살아있는 1대 + 삭제된 2대(하나는 시트에 있고, 하나는 없다)
head('준비 — 살아있는 1 · 삭제된 2');
await store.save('product', co, [
  product('RP999_11가1111', '11가1111'),
  product('RP999_22나2222', '22나2222'),
  product('RP999_33다3333', '33다3333'),
]);
// 2·3번을 삭제 상태로 만든다
await store.update('product', co, 'RP999_22나2222', { _deleted: true, status: 'deleted' } as EntityRecord);
await store.update('product', co, 'RP999_33다3333', { _deleted: true, status: 'deleted' } as EntityRecord);
const beforeLive = await listProductsForSheetReconcile(co, true);
check('살아있는 매물 1대', beforeLive.filter((r) => String(r.provider_company_code) === 'RP999').length === 1,
  beforeLive.filter((r) => String(r.provider_company_code) === 'RP999').length);

// ── 반영: 시트에는 1번(기존)과 2번(삭제된 것)만 있다. 3번은 시트에 없다.
head('반영 — 시트에 1·2번만 있다(3번은 없다)');
const result = await commitSheetProducts(co, [
  product('RP999_11가1111', '11가1111', { mileage: '10000' }),
  product('RP999_22나2222', '22나2222'),
]);
console.log(`  결과: 신규 ${result.created} · 수정 ${result.updated} · 되살림 ${result.revived ?? 0} · 중복 ${result.duplicates}`);

check('되살림 1건', (result.revived ?? 0) === 1, result.revived);

const after = await listProductsForSheetReconcile(co, true);
const live = after.filter((r) => String(r.provider_company_code) === 'RP999');
const codes = new Set(live.map((r) => String(r.product_code)));
check('① 시트에 있던 삭제분이 되살아남 (22나2222)', codes.has('RP999_22나2222'), [...codes]);
check('② 시트에 없는 삭제분은 그대로 (33다3333 안 살아남)', !codes.has('RP999_33다3333'), [...codes]);
check('③ 되살아난 뒤 살아있는 매물 2대', live.length === 2, live.length);

const revived = live.find((r) => String(r.product_code) === 'RP999_22나2222');
check('되살림 흔적 revived_at 기록', !!String(revived?.revived_at || ''), revived?.revived_at);
check('삭제 표식 제거됨', revived?._deleted !== true && String(revived?.status || '') !== 'deleted',
  { _deleted: revived?._deleted, status: revived?.status });

// ── 두 번 돌려도 안전한가(멱등)
head('멱등 — 같은 반영을 한 번 더');
const again = await commitSheetProducts(co, [
  product('RP999_11가1111', '11가1111', { mileage: '10000' }),
  product('RP999_22나2222', '22나2222'),
]);
check('두 번째엔 되살릴 게 없다', (again.revived ?? 0) === 0, again.revived);
const after2 = await listProductsForSheetReconcile(co, true);
check('매물 수 그대로 2대', after2.filter((r) => String(r.provider_company_code) === 'RP999').length === 2);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
