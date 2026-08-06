/**
 * 「판매가능이 몇 대인가」 — 코드의 실제 판정(isOfferableProduct)으로 센다. 읽기 전용.
 *
 * 대수가 세 군데서 다르게 나온 이유는 기준이 달랐기 때문이다:
 *   · «살아있는 것»(삭제표시 아님)  ≠  «판매가능»(게시 가능)  — 출고불가가 살아있는 채로 남는다
 *   · 시트가 정본이면, 시트가 없는 공급사의 재고는 근거가 없다
 *
 * 그래서 판매가능을 «시트 연동 공급사» / «시트 없는 공급사» / «스코프 없음» 으로 갈라 낸다.
 * 시트로 재고를 재구성할 때 실제로 남는 수가 첫 칸이다.
 *
 * npx tsx scripts/audit-offerable-count.mts
 */
import { readFileSync } from 'node:fs';
import { isOfferableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();

  const [prodSnap, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const products = (prodSnap.val() || {}) as Record<string, Rec>;
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };

  /** 시트가 붙어 있는 공급사 = 시트로 재고를 검증할 수 있는 곳. */
  const withSheet = new Set(Object.values(partners).filter((p) => S(p.sheet_url)).map((p) => S(p.partner_code)).filter(Boolean));
  const nameOf = (code: string) => S(Object.values(partners).find((p) => S(p.partner_code) === code)?.partner_name
    || Object.values(partners).find((p) => S(p.partner_code) === code)?.company_name);

  const alive = Object.values(products).filter((p) => !dead(p));
  const offerable = alive.filter((p) => isOfferableProduct(p as EntityRecord));

  console.log('\n══ 판매가능이 몇 대인가 ══\n');
  console.log(`  v4/products 전체        ${Object.keys(products).length}건`);
  console.log(`  삭제표시 아님(살아있음)   ${alive.length}건`);
  console.log(`  ★ 판매가능(게시 가능)    ${offerable.length}건   ← ERP 목록에 뜨는 수\n`);

  const bucket = { sheet: new Map<string, number>(), noSheet: new Map<string, number>(), noScope: 0 };
  for (const p of offerable) {
    const c = S(p.provider_company_code);
    if (!c) { bucket.noScope++; continue; }
    const m = withSheet.has(c) ? bucket.sheet : bucket.noSheet;
    m.set(c, (m.get(c) || 0) + 1);
  }
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  console.log(`■ 시트 연동 공급사 — ${bucket.sheet.size}곳 · ${sum(bucket.sheet)}대   ← 시트로 재구성 가능`);
  for (const [c, n] of [...bucket.sheet].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}대  ${c.padEnd(8)} ${nameOf(c)}`);
  }

  console.log(`\n■ 시트 없는 공급사 — ${bucket.noSheet.size}곳 · ${sum(bucket.noSheet)}대   ❌ 시트가 정본이면 근거 없음`);
  for (const [c, n] of [...bucket.noSheet].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}대  ${c.padEnd(8)} ${nameOf(c) || '(파트너 레코드 없음)'}`);
  }

  console.log(`\n■ 공급사 스코프 없음 — ${bucket.noScope}대   ❌ 어느 공급사 화면에도 안 뜬다\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
