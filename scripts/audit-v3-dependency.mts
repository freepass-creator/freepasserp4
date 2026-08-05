/**
 * **v3 를 끊어도 되는가** — 게시중 매물 중 v3 에만 있는 것이 얼마나 되나.
 *
 * 방향(사용자 지시): erp3 에 기대지 말고 fp4 가 «시트 기반»으로 자체 구축한다.
 * 그러려면 게시 매물이 전부 v4 에 있어야 한다. v3 에만 있는 게 남아 있으면
 * v3 를 끊는 순간 그만큼 재고가 사라진다.
 *
 * 판정:
 *   v4 있음        → 시트 반영으로 우리가 만든 것. v3 끊어도 안전.
 *   v3 에만 있음    → erp3 가 넣은 것. 시트에 있으면 반영으로 v4 에 생기고, 없으면 버릴 것.
 *
 * 읽기 전용.
 *   npx tsx scripts/audit-v3-dependency.mts
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { dedupeProductsByVehicle } from '../lib/firebase/rtdb-products';
import { isOfferableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();
const S = (v: unknown) => String(v ?? '').trim();

async function main() {
  const [p3, p4, t3, t4] = await Promise.all([
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v3 = (p3.val() || {}) as Record<string, EntityRecord>;
  const v4 = (p4.val() || {}) as Record<string, EntityRecord>;
  // ⚠ 키 단위 병합(`{...v3, ...v4}`)을 쓰면 v4 부분 오버레이가 v3 의 sheet_url 을 통째로 덮어
  //   시트 연결 공급사가 «시트 없음»으로 보인다. 반드시 필드 단위로 합친다.
  const partners: Record<string, EntityRecord> = {};
  for (const [k, v] of Object.entries((t3.val() || {}) as Record<string, EntityRecord>)) partners[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((t4.val() || {}) as Record<string, EntityRecord>)) partners[k] = { ...(partners[k] || {}), ...v, _key: k };
  const sheetCodes = new Set<string>();
  for (const p of Object.values(partners)) {
    if (!p || p._deleted === true || !S(p.sheet_url)) continue;
    const c = S(p.partner_code) || S(p._key);
    if (c) sheetCodes.add(c);
  }

  // merged = 어댑터가 보는 것
  const merged: Record<string, EntityRecord> = {};
  for (const [k, v] of Object.entries(v3)) merged[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries(v4)) merged[k] = { ...(merged[k] || {}), ...v, _key: k };
  const live = Object.values(merged).filter((x) => x && x._deleted !== true && !x.deletedAt && S(x.status) !== 'deleted');
  const shown = dedupeProductsByVehicle(live).filter(isOfferableProduct);

  console.log(`\n══ v3 의존도 — 게시중 ${shown.length}대 ══\n`);
  const inV4 = shown.filter((x) => v4[S(x._key)] !== undefined);
  const v3Only = shown.filter((x) => v4[S(x._key)] === undefined);
  console.log(`  v4 에 있음(우리가 만든 것)   ${inV4.length}`);
  console.log(`  ★ v3 에만 있음              ${v3Only.length}   ← v3 끊으면 사라진다`);

  // v3-only 를 공급사별로
  const byProv = new Map<string, { n: number; sheet: boolean }>();
  for (const x of v3Only) {
    const c = S(x.provider_company_code) || '(없음)';
    const cur = byProv.get(c) || { n: 0, sheet: sheetCodes.has(c) };
    cur.n++; byProv.set(c, cur);
  }
  console.log('\n  v3-only 공급사별:');
  [...byProv.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([c, v]) => {
    const p = Object.values(partners).find((x) => S(x.partner_code) === c);
    console.log(`     ${c.padEnd(12)} ${String(v.n).padStart(4)}대  시트연결 ${v.sheet ? 'O' : '❌ 없음'}   ${S(p?.name) || S(p?.partner_name) || ''}`);
  });

  // 시트 연결된 공급사인데 v3-only 인 것 = 반영을 더 돌리면 v4 로 올라올 후보
  const recoverable = v3Only.filter((x) => sheetCodes.has(S(x.provider_company_code)));
  const orphan = v3Only.filter((x) => !sheetCodes.has(S(x.provider_company_code)));
  console.log(`\n  시트 연결 공급사라 반영으로 회수 가능  ${recoverable.length}`);
  console.log(`  시트가 없어 회수 불가(버릴 것)          ${orphan.length}`);
  console.log('\n  회수 불가 표본:');
  orphan.slice(0, 10).forEach((x) => console.log(`     ${S(x._key).padEnd(24)} ${S(x.car_number).padEnd(10)} ${S(x.provider_company_code) || '(공급사없음)'} ${S(x.maker)} ${S(x.sub_model) || S(x.model)}`));
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
