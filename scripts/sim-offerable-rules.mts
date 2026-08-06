/**
 * 「판매가능」 판정 기준을 바꾸면 대수가 어떻게 되는가 — 안 A/B/C 를 실데이터로 계산. 쓰기 없음.
 *
 *   A 현행     삭제× · 출고불가× · 가격 ≥ 1
 *   B 권고     A + 차종 확정(재스냅 후 high·medium)
 *   C          B + 연동(시트·홈페이지) 없는 공급사 제외
 *
 * 재스냅은 아직 반영 전이므로 «반영했다면» 값을 지금 매처로 계산해서 낸다.
 *
 * npx tsx scripts/sim-offerable-rules.mts
 */
import { readFileSync } from 'node:fs';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { isOfferableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const entries = (() => {
    const d = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
    return (d.entries || d) as MasterEntry[];
  })();

  const [prodSnap, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const products = (prodSnap.val() || {}) as Record<string, Rec>;
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };

  /** 연동 자격 = 시트 있음 또는 홈페이지(RP006). 파트너 레코드 자체가 없으면 자격 없음. */
  const linked = new Set<string>();
  for (const p of Object.values(partners)) {
    const code = S(p.partner_code);
    if (!code || dead(p)) continue;
    if (S(p.sheet_url) || code === 'RP006' || S(p.inventory_source) === 'ironrentcar_web') linked.add(code);
  }
  const nameOf = (c: string) => S(Object.values(partners).find((x) => S(x.partner_code) === c)?.partner_name
    || Object.values(partners).find((x) => S(x.partner_code) === c)?.company_name);

  const offerable = Object.entries(products).filter(([, p]) => !dead(p) && isOfferableProduct(p as any));

  /** 재스냅을 «반영했다면» 차종이 확정되는가. */
  const confirmedAfter = (p: Rec) => {
    if (p._needs_master_review !== true) return true;      // 이미 확정
    const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : {}) as Rec;
    const res = snapToMaster({ ...p, ...raw } as EntityRecord, entries);
    return !!res && (res.confidence === 'high' || res.confidence === 'medium');
  };

  const rows = offerable.map(([k, p]) => ({
    key: k,
    co: S(p.provider_company_code),
    confirmed: confirmedAfter(p),
  }));

  const A = rows.length;
  const B = rows.filter((r) => r.confirmed).length;
  const C = rows.filter((r) => r.confirmed && linked.has(r.co)).length;

  console.log('\n══ 판매가능 판정 기준별 대수 (재스냅 반영 가정) ══\n');
  console.log(`  A 현행 (삭제×·출고불가×·가격○)                 ${A}대`);
  console.log(`  B 권고 (A + 차종 확정)                        ${B}대`);
  console.log(`  C     (B + 연동 있는 공급사만)                 ${C}대`);
  console.log(`\n  태윤 확인 (2026-08-05)                        363대\n`);

  console.log('■ 공급사별 — A(현행) / B(차종확정) / 연동');
  const by = new Map<string, { a: number; b: number }>();
  for (const r of rows) {
    const e = by.get(r.co) || { a: 0, b: 0 };
    e.a++; if (r.confirmed) e.b++;
    by.set(r.co, e);
  }
  for (const [co, e] of [...by].sort((x, y) => y[1].b - x[1].b)) {
    const link = linked.has(co) ? '연동' : '❌미연동';
    const drop = e.a - e.b ? `  (−${e.a - e.b})` : '';
    console.log(`   ${co.padEnd(8)} ${nameOf(co).padEnd(18)} ${String(e.a).padStart(4)} → ${String(e.b).padStart(4)}${drop.padEnd(8)} ${link}`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
