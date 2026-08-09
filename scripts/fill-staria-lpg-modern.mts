/**
 * 더 뉴 스타리아 US4 LPG 3.5 — 11인승 노드에 형제 트림「모던」append
 * (실측 700호2227 · seat 축이 달라 union이 안 합침)
 *
 *   APPLY=1 npx tsx scripts/fill-staria-lpg-modern.mts
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const FILE = 'public/data/vehicle-master.json';
const apply = S(process.env.APPLY) === '1';

const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { entries: Rec[] };
let n = 0;
for (const e of doc.entries || []) {
  if (S(e.sub_model) !== '더 뉴 스타리아 US4') continue;
  for (const v of (e.variants || []) as Rec[]) {
    if (!S(v.label).startsWith('LPG 3.5')) continue;
    const trims = Array.isArray(v.trims) ? v.trims.map(S).filter(Boolean) : [];
    if (trims.includes('모던')) continue;
    trims.unshift('모던');
    v.trims = trims;
    n++;
    console.log(`append 모던 · ${v.label} seat=${v.seat} → ${trims.join('|')}`);
  }
}
console.log(`채움 ${n}칸`);
if (!apply) {
  console.log('(미리보기 — APPLY=1 반영)');
  process.exit(0);
}
copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log('반영');
