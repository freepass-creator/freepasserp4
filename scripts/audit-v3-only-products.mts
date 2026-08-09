/**
 * v4 에 없는 «살아 있는 v3 상품» 실사 — v4 독립 전에 무엇을 잃는지 먼저 본다.
 *
 * erp4 가 v3 products 읽기를 끊으면 이 레코드들은 화면에서 사라진다.
 * 진짜 파는 차인지, 이름도 없는 껍데기인지에 따라 옮길지 버릴지가 갈린다.
 */
import { readFileSync } from 'node:fs';

const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: any) => r?._deleted === true || r?.deletedAt || S(r?.status) === 'deleted';

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const v3 = ((await db.ref('products').get()).val() || {}) as Record<string, any>;
  const v4Keys = new Set(Object.keys(((await db.ref('v4/products').get()).val() || {}) as Record<string, any>));

  const only = Object.entries(v3).filter(([key, row]) => !dead(row) && !v4Keys.has(key));
  console.log(`\nv4 에 없는 살아있는 v3 상품 ${only.length}건\n`);

  const byProvider = new Map<string, number>();
  let named = 0, plated = 0, priced = 0, offerable = 0;
  for (const [key, row] of only) {
    const provider = S(row.provider_company_code || row.partner_code) || '(미확정)';
    byProvider.set(provider, (byProvider.get(provider) || 0) + 1);
    const name = S(row.sub_model || row.model || row.vehicle_name);
    const plate = S(row.car_number);
    const hasPrice = !!(row.price && typeof row.price === 'object' && Object.keys(row.price).length);
    if (name) named++;
    if (plate) plated++;
    if (hasPrice) priced++;
    if (name && plate && hasPrice) offerable++;
    if (only.indexOf([key, row] as never) < 0 && false) console.log(key);
  }
  console.log(`  이름 있음 ${named} · 차번 있음 ${plated} · 가격표 있음 ${priced} · 셋 다(팔 수 있는 꼴) ${offerable}`);
  console.log('\n  공급사별');
  for (const [provider, n] of [...byProvider].sort((a, b) => b[1] - a[1])) console.log(`    ${provider.padEnd(14)} ${n}건`);

  console.log('\n  표본 8건 (키 · 공급사 · 차번 · 이름 · 상태)');
  for (const [key, row] of only.slice(0, 8)) {
    console.log(`    ${key.padEnd(20)} ${S(row.provider_company_code || row.partner_code).padEnd(8)} ${S(row.car_number).padEnd(10)} ${S(row.sub_model || row.model).slice(0, 18).padEnd(20)} ${S(row.vehicle_status || row.status)}`);
  }
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
