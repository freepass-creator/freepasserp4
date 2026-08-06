/**
 * 「차종 미확정」이 실제로 무엇인가 — 재스냅해도 안 붙는 매물의 원본 신호를 그대로 보여준다. 읽기 전용.
 *
 * 확정 = 차종마스터(1,800세대)의 한 세대로 특정됨(high·medium).
 * 미확정 = 신호가 모자라거나 어긋나 어느 세대인지 못 고름 → 제조사·차명이 공란으로 남는다.
 *
 * 무엇이 모자란지는 원본(`_raw_vehicle`)을 봐야 안다. 그래서 원본을 그대로 찍는다.
 *
 *   npx tsx scripts/audit-unconfirmed-vehicles.mts            (전체)
 *   npx tsx scripts/audit-unconfirmed-vehicles.mts --code=RP021
 */
import { readFileSync } from 'node:fs';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { isOfferableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

async function main() {
  const only = (process.argv.find((a) => a.startsWith('--code=')) || '').split('=')[1] || '';

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

  const products = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;
  const rows: { key: string; co: string; raw: Rec; conf: string }[] = [];

  for (const [key, p] of Object.entries(products)) {
    if (dead(p) || !isOfferableProduct(p as any)) continue;
    if (only && S(p.provider_company_code) !== only) continue;
    if (p._needs_master_review !== true) continue;
    const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : {}) as Rec;
    const res = snapToMaster({ ...p, ...raw } as EntityRecord, entries);
    const conf = res ? res.confidence : '매칭없음';
    if (conf === 'high' || conf === 'medium') continue;   // 재스냅으로 해결되는 건 제외
    rows.push({ key, co: S(p.provider_company_code), raw: { ...p, ...raw }, conf });
  }

  console.log(`\n══ 재스냅해도 차종이 안 붙는 매물 ${rows.length}대 ══\n`);
  console.log('  차종마스터는 «제조사 → 모델 → 세대 → 파워트레인» 트리다.');
  console.log('  모델 신호가 없거나 마스터에 없는 이름이면 어느 가지로도 못 내려간다.\n');

  const byCo = new Map<string, typeof rows>();
  for (const r of rows) byCo.set(r.co, [...(byCo.get(r.co) || []), r]);

  for (const [co, list] of [...byCo].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`■ ${co} — ${list.length}대`);
    for (const r of list.slice(0, 20)) {
      const sig = ['maker', 'model', 'sub_model', 'trim_name', 'fuel_type', 'year', 'engine_cc']
        .map((f) => `${f.replace('_type', '').replace('_name', '')}«${S(r.raw[f])}»`)
        .filter((s) => !s.endsWith('«»'))
        .join(' ');
      console.log(`   ${r.conf.padEnd(9)} ${sig || '(신호 없음)'}`);
    }
    if (list.length > 20) console.log(`   … 그 외 ${list.length - 20}대`);
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
