/**
 * 미확정 매물이 «마스터에 없는 차»인가, «제조사 칸이 틀린 차»인가 — 실제 신호로 검증. 쓰기 없음.
 *
 * 같은 매물을 두 번 물린다:
 *   ① 있는 그대로 (제조사 칸 포함)
 *   ② 제조사만 뺀 채 (모델·연료·연식만)
 *
 * ②에서 붙으면 «마스터에 없는 차»가 아니라 «제조사가 오염된 차»다.
 *
 * npx tsx scripts/sim-bad-maker.mts
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

  const products = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;
  const ok = (c?: string) => c === 'high' || c === 'medium';

  let n = 0, fixedByDroppingMaker = 0, stillNo = 0;
  const shown: string[] = [];

  for (const [, p] of Object.entries(products)) {
    if (dead(p) || !isOfferableProduct(p as any)) continue;
    if (p._needs_master_review !== true) continue;
    const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : {}) as Rec;
    const input = { ...p, ...raw } as EntityRecord;

    const asIs = snapToMaster(input, entries);
    if (ok(asIs?.confidence)) continue;   // 지금도 붙는 건 논외
    n++;

    const noMaker = snapToMaster({ ...input, maker: '' } as EntityRecord, entries);
    if (ok(noMaker?.confidence)) {
      fixedByDroppingMaker++;
      if (shown.length < 14) {
        shown.push(`   maker«${S(input.maker) || '(없음)'}» model«${S(input.model)}»`
          + `  →  제조사 무시하니 ${S(noMaker!.maker)} ${S(noMaker!.model)} ${S(noMaker!.sub_model)} (${noMaker!.confidence})`);
      }
    } else {
      stillNo++;
    }
  }

  console.log('\n══ 미확정 매물 — 제조사 칸을 빼면 붙나 ══\n');
  console.log(`  미확정 ${n}대`);
  console.log(`  ✅ 제조사만 빼면 붙는 것        ${fixedByDroppingMaker}대   ← 마스터에 있는 차. 제조사가 오염된 것`);
  console.log(`  ❌ 그래도 안 붙는 것            ${stillNo}대   ← 신호가 더 필요한 차\n`);
  if (shown.length) {
    console.log('■ 표본');
    for (const s of shown) console.log(s);
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
