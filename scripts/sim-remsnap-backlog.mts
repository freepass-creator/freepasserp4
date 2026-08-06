/**
 * 검토대기(_needs_master_review) 적체를 «지금 매처»로 재스냅하면 몇 대가 살아나나 — 쓰기 없음.
 *
 * 배경: 저장된 레코드는 옛 스냅 결과로 굳어 있다. master-ingress.ts:44 의 가드가
 * `low` 까지 «이미 스냅됨»으로 보고 재시도를 건너뛰어, 매처가 좋아져도 자동 회복이 안 된다.
 * 그래서 지금 매처로 다시 물려 결과를 미리 센다.
 *
 * 원본은 `_raw_vehicle` 에 보존돼 있으므로 그것을 입력으로 쓴다(스냅이 지운 값 복원).
 *
 * npx tsx scripts/sim-remsnap-backlog.mts
 */
import { readFileSync } from 'node:fs';
import { snapToMaster, applySnap, type MasterEntry } from '../lib/domain/vehicle-master-match';
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
  const targets = Object.entries(products)
    .filter(([, p]) => !dead(p) && isOfferableProduct(p as any) && p._needs_master_review === true);

  console.log(`\n══ 재스냅하면 몇 대가 살아나나 (쓰기 없음) ══\n`);
  console.log(`  차종마스터 ${entries.length}세대 · 검토대기 판매가능 ${targets.length}대\n`);

  const conf = new Map<string, number>();
  let identityGained = 0, nullRes = 0;
  const samples: string[] = [];

  for (const [k, p] of targets) {
    // 스냅이 지운 값이 있으므로 _raw_vehicle 을 우선 입력으로 되살린다(모듈 주석의 «재변환 시 원본 우선»).
    const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : {}) as Rec;
    const input = { ...p, ...raw } as EntityRecord;
    const res = snapToMaster(input, entries);
    if (!res) { nullRes++; conf.set('매칭 없음', (conf.get('매칭 없음') || 0) + 1); continue; }
    conf.set(res.confidence, (conf.get(res.confidence) || 0) + 1);
    const after = applySnap(input, res, { source: 'sim' });
    const hadIdentity = !!S(p.maker) || !!S(p.model);
    const hasIdentity = !!S(after.maker) && !!S(after.model);
    if (!hadIdentity && hasIdentity) {
      identityGained++;
      if (samples.length < 10) {
        samples.push(`${k.slice(0, 20).padEnd(22)} raw«${S(raw.model) || '?'}·${S(raw.fuel_type) || '?'}» → ${S(after.maker)} ${S(after.model)} ${S(after.sub_model)} (${res.confidence})`);
      }
    }
  }

  console.log('■ 재스냅 결과 confidence');
  for (const [c, n] of [...conf].sort((a, b) => b[1] - a[1])) {
    const auto = c === 'high' || c === 'medium' ? '  ← 자동확정(검토 해제)' : '';
    console.log(`   ${String(n).padStart(4)}대  ${c}${auto}`);
  }
  const fixed = (conf.get('high') || 0) + (conf.get('medium') || 0);
  console.log(`\n★ 자동확정 ${fixed}대 / ${targets.length}대  (${Math.round((fixed / Math.max(targets.length, 1)) * 100)}%)`);
  console.log(`★ 제조사·차명이 «빈칸 → 채워짐» ${identityGained}대\n`);

  if (samples.length) {
    console.log('■ 표본');
    for (const s of samples) console.log(`   ${s}`);
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
