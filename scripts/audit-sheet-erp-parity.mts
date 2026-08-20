/**
 * **판매시트(영업자 표) ↔ ERP 대조** — 대수와 «다른 차»를 이유별로 보여 준다. 읽기 전용.
 *   규칙 정본은 `lib/domain/sheet-erp-parity.ts`(시트 「AI 운영 매뉴얼」 탭에도 같은 글이 실린다).
 *   기대값: 「판매시트에 있는데 ERP 에 안 뜨는 차 0」. ERP 에만 있는 차는 계약락 걸린 차뿐이어야 한다.
 *
 *   npx tsx scripts/audit-sheet-erp-parity.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';
import { isHiddenFromCatalog, isOfferableProduct } from '../lib/domain/product';
import { SHEET_ERP_PARITY_SUMMARY } from '../lib/domain/sheet-erp-parity';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const P = (v: unknown) => S(v).replace(/\s/g, '');
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const tok = (await jwt.getAccessToken()).token; const H = { Authorization: 'Bearer ' + tok };
const get = async (id: string, rng: string) => (((await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(rng)}`, { headers: H })).json()) as any).values || []).map((r: string[]) => r.map(S));

const SALES = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}?fields=sheets.properties(title)`, { headers: H })).json() as any;
const sales = new Map<string, Rec>();
for (const t of meta.sheets.map((s: any) => S(s.properties.title)).filter((t: string) => /상품리스트|손오공구독|오플구독/.test(t))) {
  const rows = await get(SALES, `'${t}'!A1:N600`); const h = rows[0]; const c = (n: string) => h.indexOf(n);
  for (const r of rows.slice(1)) { const p = P(r[c('차량번호')]); if (p) sales.set(p, { tab: t, 상태: S(r[c('배차상태')]), 제조사: S(r[c('제조사')]), 모델: S(r[c('모델')]) }); }
}
const pm = await get(DEFAULT_PRODUCT_MASTER_SHEET_ID, `'${PRODUCT_MASTER_TAB}'!A1:AX3000`);
const ph = pm[0]; const pi = (n: string) => ph.indexOf(n);
const pmBy = new Map<string, Rec>();
for (const r of pm.slice(1)) { const p = P(r[pi('차량번호')]); if (p) pmBy.set(p, { 상태: S(r[pi('차량상태')]), 관리: S(r[pi('관리상태')]), 검증: S(r[pi('검증상태')]) }); }

if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const prods = ((await getDatabase().ref('v4/products').get()).val() || {}) as Record<string, Rec>;
const live = new Map<string, Rec>(); const dead = new Map<string, Rec>();
for (const [key, p] of Object.entries(prods)) {
  const plate = P(p.car_number || p.car_number_snapshot || ''); if (!plate) continue;
  const rec = { key, ...p };
  if (p?._deleted === true || S(p?.status) === 'deleted') { dead.set(plate, rec); continue; }
  const cur = live.get(plate);
  if (!cur || S(p.updatedAt) > S(cur.updatedAt)) live.set(plate, rec);
}
// ★상품찾기 목록 기준 = «출고불가만 숨김»(사장님 2026-08-20 「ERP에는 출고불가만 안 나타내는 거야, 상품화중·계약중은 다 표시」).
const offerable = [...live.entries()].filter(([, p]) => !isHiddenFromCatalog(p as any));
const quotable = [...live.entries()].filter(([, p]) => isOfferableProduct(p as any));
console.log(`■ 규칙 — ${SHEET_ERP_PARITY_SUMMARY}
`);
console.log(`■ 판매시트 ${sales.size}대 · 상품마스터(취급 이력 원장) ${pmBy.size}대`);
console.log(`■ ERP 살아있는 차 ${live.size}대 · 상품찾기 목록(출고불가만 숨김) ${offerable.length}대 · 그중 견적 가능(대여료 있음) ${quotable.length}대 · 삭제된 차 ${dead.size}대`);

// 시트에는 있는데 ERP 노출 안 되는 차
const offerableSet = new Set(offerable.map(([p]) => p));
const missing = [...sales.keys()].filter((p) => !offerableSet.has(p));
const why: Rec = {}; const rows: Rec[] = [];
for (const p of missing) {
  const e = live.get(p); const d = dead.get(p); const m = pmBy.get(p);
  const reason = !e && !d ? 'ERP 에 아예 없음' : !e && d ? 'ERP 에서 삭제됨' : `ERP 상태 ${S(e!.vehicle_status) || '(빈)'}${S(e!.management_status) ? `/관리 ${S(e!.management_status)}` : ''}`;
  why[reason] = (why[reason] || 0) + 1;
  rows.push({ plate: p, reason, 시트상태: sales.get(p)!.상태, 시트탭: sales.get(p)!.tab, pm: m ? `${m.상태}/${m.관리}/${m.검증}` : '(상품마스터 없음)' });
}
console.log(`\n■ 판매시트에 있는데 상품찾기에 안 뜨는 차 ${missing.length}대`);
for (const [r, n] of Object.entries(why).sort((a: any, b: any) => b[1] - a[1])) console.log(`   ${String(n).padStart(3)}대  ${r}`);
for (const r of rows.slice(0, 25)) console.log(`     ${r.plate.padEnd(10)} ${r.reason} · 시트 ${r.시트상태}(${r.시트탭.split(' ')[0]}) · 상품마스터 ${r.pm}`);

// 반대로 ERP 에만 뜨는 차
const extra = offerable.filter(([p]) => !sales.has(p));
console.log(`\n■ 상품찾기에 뜨는데 판매시트에 없는 차 ${extra.length}대`);
const extraWhy: Rec = {};
for (const [p, e] of extra) { const k = `${S(e.provider_company_code) || '?'} · ${S(e.vehicle_status)}`; extraWhy[k] = (extraWhy[k] || 0) + 1; }
for (const [k2, n] of Object.entries(extraWhy).sort((a: any, b: any) => b[1] - a[1]).slice(0, 12)) console.log(`   ${String(n).padStart(3)}대  ${k2}`);
console.log('   예:', extra.slice(0, 12).map(([p, e]) => `${p}(${S(e.provider_company_code)}/${S(e.vehicle_status)})`).join(' · '));
writeFileSync('tmp/sheet-erp-parity.json', JSON.stringify({ at: new Date().toISOString(), sales: sales.size, offerable: offerable.length, missing: rows, extra: extra.map(([p, e]) => ({ plate: p, code: S(e.provider_company_code), status: S(e.vehicle_status), updatedBy: S(e.updatedBy), updatedAt: S(e.updatedAt) })) }, null, 1));
process.exit(0);
