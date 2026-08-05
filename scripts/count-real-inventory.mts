/**
 * **상품 차량이 실제로 몇 대인가.**
 *
 * 레코드 수 ≠ 차 대수다. 같은 실물이 여러 코드로 들어와 있고(트윈), 가격 없는 v3 잔재가 섞여 있고,
 * 번호판이 필드에 없어 신원이 안 잡히는 것도 있다. 그래서 «몇 대 파느냐»를 물으면
 * 레코드를 세면 안 되고 **목록 파이프라인을 그대로 태워서** 세야 한다.
 *
 * 이 스크립트는 `RtdbAdapter.list('product')` 가 하는 일을 그대로 재현한다 —
 *   소프트삭제 제외 → status='deleted' 제외 → isExcludedProduct(금강) 제외 → dedupeProductsByVehicle
 * 그 위에 «팔 수 있는가»(상태·가격)를 얹어 단계별로 몇 대가 남는지 보여준다.
 *
 * 읽기 전용.
 *   npx tsx scripts/count-real-inventory.mts
 *   ... --by-provider     공급사별 상세
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { dedupeProductsByVehicle } from '../lib/firebase/rtdb-products';
import { vehicleIdentity, isOfferableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();

const BY_PROVIDER = process.argv.includes('--by-provider');
const S = (v: unknown) => String(v ?? '').trim();
// 금강 = 운영 공급사에서 제외된 곳(rtdb-products.ts KASHUNG_PROVIDERS 와 같은 의미).
const EXCLUDED = new Set(['RP001', 'RP002', '금강', '금강렌트카']);
const SELLABLE_STATUS = new Set(['', '출고가능', '상품화중', '출고협의']);

const mergeNodes = (a: unknown, b: unknown) => {
  const m: Record<string, EntityRecord> = {};
  for (const [k, v] of Object.entries((a || {}) as Record<string, EntityRecord>)) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((b || {}) as Record<string, EntityRecord>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};
const priced = (x: EntityRecord) => !!(x.price && typeof x.price === 'object' && Object.keys(x.price).length);
const bar = (n: number, max: number) => '█'.repeat(Math.max(0, Math.round((n / Math.max(1, max)) * 28)));

async function main() {
  const [p3, p4, t3, t4] = await Promise.all([
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const partners = mergeNodes(t3.val(), t4.val());
  const nameOf = (code: string) => {
    const p = partners[code] || Object.values(partners).find((x) => S(x.partner_code) === code);
    return S(p?.name) || S(p?.partner_name) || code || '(공급사 없음)';
  };

  const raw = Object.values(mergeNodes(p3.val(), p4.val()));
  const step: { label: string; rows: EntityRecord[] }[] = [];
  step.push({ label: '① RTDB 레코드 전부', rows: raw });
  step.push({ label: '② 소프트삭제 제외', rows: step[0].rows.filter((r) => !r._deleted && !r.deletedAt) });
  step.push({ label: '③ status=deleted 제외', rows: step[1].rows.filter((r) => S(r.status) !== 'deleted') });
  step.push({ label: '④ 제외 공급사 빼기', rows: step[2].rows.filter((r) => !EXCLUDED.has(S(r.provider_company_code)) && !EXCLUDED.has(S(r.partner_code))) });
  step.push({ label: '⑤ 중복정리(dedup) — 목록에 뜨는 것', rows: dedupeProductsByVehicle(step[3].rows) });
  step.push({ label: '⑥ 팔 수 있는 상태만', rows: step[4].rows.filter((r) => SELLABLE_STATUS.has(S(r.vehicle_status))) });
  // ⑦ 은 카탈로그 화면이 실제로 쓰는 판정을 그대로 쓴다(app/catalog/page.tsx:39 `all.filter(isOfferableProduct)`).
  //   가격 없는 매물은 여기서 걸러지므로 «목록에 뜨는 상품»과 이 숫자가 같아야 한다.
  step.push({ label: '⑦ 게시 가능 = ★ 진짜 상품', rows: step[5].rows.filter(isOfferableProduct) });

  console.log('\n══ 상품 차량 실수량 ══\n');
  const max = raw.length;
  let prev = 0;
  for (const [i, s] of step.entries()) {
    const n = s.rows.length;
    const delta = i === 0 ? '' : `  (−${prev - n})`;
    console.log(`${s.label.padEnd(30)} ${String(n).padStart(5)}  ${bar(n, max)}${delta}`);
    prev = n;
  }

  // dedup 이 실제로 몇 대를 합쳤나 — 트윈이 부풀린 양
  const beforeDedup = step[3].rows.length;
  const afterDedup = step[4].rows.length;
  console.log(`\n중복정리로 합쳐진 레코드 ${beforeDedup - afterDedup}건 = 같은 차가 여러 코드로 있던 분량`);

  // 신원이 없어 «합쳐지지 못하고 그냥 노출되는» 것 — 진짜 상품 안에 숨은 중복 후보
  const finalRows = step[6].rows;
  const noId = finalRows.filter((r) => !vehicleIdentity(r));
  console.log(`진짜 상품 ${finalRows.length}대 중 신원(번호판·VIN) 없는 것 ${noId.length}대`);
  if (noId.length) console.log('   → 이건 dedup 을 통과한 게 아니라 «판정 불가라 그냥 노출»된 것이다. 실제로는 중복일 수 있다.');

  if (!BY_PROVIDER) { console.log('\n공급사별은 --by-provider\n'); return; }

  console.log('\n── 공급사별 진짜 상품 ─────────────────────────────');
  const byProv = new Map<string, { total: number; noId: number }>();
  for (const r of finalRows) {
    const c = S(r.provider_company_code) || '(없음)';
    const cur = byProv.get(c) || { total: 0, noId: 0 };
    cur.total++; if (!vehicleIdentity(r)) cur.noId++;
    byProv.set(c, cur);
  }
  const rows = [...byProv.entries()].sort((a, b) => b[1].total - a[1].total);
  const top = rows[0]?.[1].total || 1;
  for (const [code, v] of rows) {
    console.log(`  ${code.padEnd(12)} ${String(v.total).padStart(4)}대  ${bar(v.total, top)}${v.noId ? `  신원없음 ${v.noId}` : ''}  ${nameOf(code)}`);
  }
  console.log(`\n  합계 ${finalRows.length}대\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
