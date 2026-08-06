/**
 * 중복 정리(merge) 후 «살아남은» 레코드가 차번을 잃었나 — 검색 불가의 실체. 읽기 전용.
 *
 * 삭제된 쪽에는 `_merged_into`(또는 `product_uid`)로 생존자 키가 남아 있고 차번도 있다.
 * 생존자에 차번이 없으면 그 차는 ERP 에 «있는데 차번으로 못 찾는» 상태가 된다 —
 * erp3 에서는 검색되고 erp4 에서는 안 되는 이유.
 *
 * npx tsx scripts/audit-merged-lost-plate.mts
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
const PLATE = /\d{2,3}[가-힣]\d{4}/;

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const v4 = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;

  let pairs = 0, survivorAlive = 0, lostPlate = 0, survivorMissing = 0;
  const samples: string[] = [];
  const fixable: { survivor: string; plate: string }[] = [];

  for (const [key, p] of Object.entries(v4)) {
    if (!dead(p)) continue;
    const plate = (S(p.car_number).replace(/\s/g, '').match(PLATE) || [''])[0]
      || (S(key).replace(/\s/g, '').match(PLATE) || [''])[0];
    if (!plate) continue;
    const target = S(p._merged_into) || S(p.product_uid);
    if (!target || target === key) continue;
    pairs++;
    const sv = v4[target];
    if (!sv) { survivorMissing++; continue; }
    if (dead(sv)) continue;
    survivorAlive++;
    if (!S(sv.car_number)) {
      lostPlate++;
      fixable.push({ survivor: target, plate });
      if (samples.length < 12) {
        samples.push(`   ${plate.padEnd(10)} 삭제 ${key.padEnd(22)} → 생존 ${target.padEnd(20)} ${S(sv.maker)} ${S(sv.model)}  ❌차번없음`);
      }
    }
  }

  console.log('\n══ 중복 정리 후 생존자가 차번을 잃었나 ══\n');
  console.log(`  삭제된 쪽에 생존자 지목이 있는 것        ${pairs}건`);
  console.log(`  ├ 생존자가 살아 있음                   ${survivorAlive}건`);
  console.log(`  │  └ ❌ 그런데 차번이 없음              ${lostPlate}건   ← 차번으로 검색 안 됨`);
  console.log(`  └ 생존자가 v4 에 없음                  ${survivorMissing}건\n`);
  if (samples.length) {
    console.log('■ 표본');
    for (const s of samples) console.log(s);
    if (lostPlate > samples.length) console.log(`   … 그 외 ${lostPlate - samples.length}건`);
  }
  console.log(`\n※ 고치는 법: 생존자에 삭제된 형제의 car_number 를 채운다(${lostPlate}건).\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
