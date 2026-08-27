// v4/products를 상품찾기 기준으로 세어 824/828/863 을 정합한다. 읽기만.
import { readFileSync } from 'node:fs';
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';
for (const file of ['.env.local', '.env.development.local']) {
  try { for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line); if (!m) continue; const v = m[2].replace(/^["']|["']$/g, ''); if (v && !process.env[m[1]]) process.env[m[1]] = v; } } catch { /* skip */ }
}
const { firebaseAdminDatabase } = await import('../lib/server/firebase-admin');
const prod = await import('../lib/domain/product');
const products = (await firebaseAdminDatabase().ref('v4/products').get()).val() || {};
const arr: any[] = Object.values(products);
const S = (v: unknown) => String(v ?? '').trim();
const byStatus: Record<string, number> = {};
const byProvider: Record<string, number> = {};
let offerable = 0, stocked = 0;
for (const p of arr) {
  const st = S(p.vehicle_status) || '(빈)';
  byStatus[st] = (byStatus[st] || 0) + 1;
  const code = S(p.provider_company_code || p.provider_code) || '?';
  try { if (prod.isOfferableProduct?.(p)) offerable++; } catch { /* */ }
  try { if (prod.isStockedProduct?.(p)) stocked++; } catch { /* */ }
  if (code === 'RP012') byProvider.RP012 = (byProvider.RP012 || 0) + 1;
}
console.log(`v4/products 총 ${arr.length} · offerable(상품찾기 판매가능) ${offerable} · stocked ${stocked}`);
console.log(`손오공 RP012 총 ${byProvider.RP012 || 0}`);
console.log('vehicle_status 분포:', JSON.stringify(byStatus, null, 0));
