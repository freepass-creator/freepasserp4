/**
 * **판매시트 「상품리스트」 ↔ ERP 목록 대조(읽기 전용)** — 시트에 있는데 ERP 목록에 없는 차와 그 이유(상태 어긋남 · 유효가격 0 · ERP 에 없음), 반대 방향도.
 *
 * ★사장님 2026-08-19 — 「지금 시트는 512대고 ERP 는 482대인데 왜 안 맞지??? 시트랑 맞아야 하는데」 → 실측 30대가 ERP 만 출고불가(표식 없음)였다.
 *   원인은 sheet-merge 의 «표식 없는 출고불가 = 수기 보류» 규칙 → 상품마스터 경로는 덮도록 고침 + 1회 허용 플래그로 즉시 복구(504대).
 *   남는 차이는 데이터 사유(대여료·보증금 쌍 없음 · 원본 수식 깨짐 · 번호미정 · 시트 계약중→ERP 출고불가 투영)라 공급사/규칙 몫.
 * ★ERP 일일 동기(sync-daily) 뒤에 돌려야 뜻이 있다(run-daily 는 그 앞 단계). 「일일 반영」 오더의 마지막 검수로 쓴다.
 *   npx tsx scripts/audit-sales-vs-erp.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isListableProduct, isHiddenFromCatalog, priceList } from '../lib/domain/product';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (p: string) => p.replace(/\s+/g, '');
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const call = async (u: string): Promise<Rec> => { const tok = (await jwt.getAccessToken()).token; const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : {}; };
const SALES = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}?fields=sheets.properties(title,index,hidden)`);
// ★발행된 표 = 상품리스트 · 손오공구독 · 오플구독 세 탭의 합(2026-08-19).
const tabs = pickPublishedSalesTabs(((meta.sheets || []) as Rec[]).filter((s) => !s.properties.hidden).map((s) => S(s.properties.title)));
const sheet = new Map<string, Rec>();
for (const t of tabs) {
  const v = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}/values/${encodeURIComponent(`'${t.title}'!A1:CZ800`)}`);
  const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  const hdr = rows[hi]; const at = (n: string) => hdr.indexOf(n);
  const pi = at('차량번호'), si = at('공급사'), sti = hdr.findIndex((h) => /상태|배차/.test(h));
  const moneyCols = hdr.map((h, i) => (/개월|보증/.test(h) ? i : -1)).filter((i) => i >= 0);
  for (const r of rows.slice(hi + 1)) { const p = norm(r[pi] || ''); if (!p || sheet.has(p)) continue; sheet.set(p, { plate: p, supplier: r[si], status: r[sti], tab: t.prefix, money: moneyCols.map((i) => r[i]).filter((x) => x && x !== '-') }); }
}
const tab = tabs.map((t) => t.title).join(' + ');
console.log(`판매시트 「${tab}」 차량번호 ${sheet.size}대`);

const { initializeApp, cert, getApps } = await import('firebase-admin/app');
const { getDatabase } = await import('firebase-admin/database');
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const v4 = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;
const alive = Object.entries(v4).filter(([, p]) => !(p._deleted === true || S(p.status) === 'deleted'));
const byPlate = new Map<string, Rec[]>();
for (const [k, p] of alive) { const pl = norm(S(p.car_number)); if (!pl) continue; if (!byPlate.has(pl)) byPlate.set(pl, []); byPlate.get(pl)!.push({ ...p, _key: k }); }
const listable = alive.filter(([, p]) => isListableProduct(p as any));
console.log(`ERP 살아있음 ${alive.length} · 목록(isListableProduct) ${listable.length}`);

const missing: string[] = []; const reasons = new Map<string, number>();
for (const [pl, s] of sheet) {
  const cands = byPlate.get(pl) || [];
  const ok = cands.some((p) => isListableProduct(p as any));
  if (ok) continue;
  let why: string;
  if (!cands.length) why = 'ERP에 차량번호 없음';
  else if (cands.every((p) => isHiddenFromCatalog(p as any))) why = `ERP 상태 출고불가/삭제(시트 상태 ${s.status})`;
  else if (cands.every((p) => priceList(p as any).length === 0)) why = s.money.length ? '시트엔 대여료 있는데 ERP 유효가격 0(대여료·보증금 쌍 없음?)' : '시트에도 대여료 없음(「-」)';
  else why = '기타';
  reasons.set(why, (reasons.get(why) || 0) + 1);
  missing.push(`${pl} ${s.supplier} ${s.status} · ${why} · 시트돈:${s.money.slice(0, 6).join('/')} · ERP:${cands.map((p) => `${S(p.vehicle_status)}|price키 ${Object.keys(p.price || {}).length}|${S(p.provider_code || p.supplier_code)}`).join(' ; ')}`);
}
console.log(`\n■ 판매시트에는 있는데 ERP 목록에 없는 차 ${missing.length}대`);
for (const [w, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(3)}대  ${w}`);
for (const m of missing) console.log('   ', m.slice(0, 230));
const extra = listable.filter(([, p]) => !sheet.has(norm(S(p.car_number))));
console.log(`\n■ ERP 목록에는 있는데 판매시트에 없는 차 ${extra.length}대`);
for (const [k, p] of extra.slice(0, 40)) console.log('   ', norm(S(p.car_number)) || '(번호없음)', S(p.vehicle_status), S(p.provider_code || p.supplier_code), S(p.model || p.vehicle_name || p.name).slice(0, 30), k.slice(0, 24));
process.exit(0);
