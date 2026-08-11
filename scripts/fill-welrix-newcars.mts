/**
 * 웰릭스 신차견적 근거 — 마스터 트림 append-only.
 *
 *   npx tsx scripts/fill-welrix-newcars.mts
 *   APPLY=1 npx tsx scripts/fill-welrix-newcars.mts
 *
 * 규칙: 기존 트림·표기 변경 금지 · 빈 칸만 · 근거=웰릭스 vehicles.json
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const FILE = 'public/data/vehicle-master.json';

const FILL: Array<{ sub: string; trim: string; variants: string[]; why: string }> = [
  {
    sub: '더 뉴 그랜저 GN7',
    trim: '아너스',
    variants: ['가솔린', '하이브리드'],
    why: '웰릭스 trim_detail「Honors」 · 더 뉴 그랜저 / Hybrid · 이웃「아너스」(그랜저 GN7) 표기 맞춤',
  },
  {
    sub: '더 뉴 K5 DL3',
    trim: '스마트 셀렉션',
    variants: ['가솔린 2.0'],
    why: '웰릭스 trim_detail「스마트 셀렉션」 · K5 · engine 가솔린 2.0',
  },
];

const raw = readFileSync(FILE, 'utf8');
const doc = JSON.parse(raw) as { entries?: Rec[] } | Rec[];
const entries: Rec[] = Array.isArray(doc) ? doc : (doc.entries || []);
const apply = S(process.env.APPLY) === '1';

let added = 0;
let skipped = 0;
for (const f of FILL) {
  const targets = entries.filter((e) => S(e.sub_model) === f.sub);
  if (!targets.length) {
    console.log(`✗ 세대 없음: ${f.sub}`);
    continue;
  }
  console.log(`\n■ ${f.sub} ← 「${f.trim}」`);
  console.log(`   근거: ${f.why}`);
  for (const e of targets) {
    if (!Array.isArray(e.trims)) e.trims = [];
    if (e.trims.some((t: unknown) => S(t) === f.trim)) {
      console.log('   · 세대 목록: 이미 있음');
    } else {
      e.trims.push(f.trim);
      added++;
      console.log(`   · 세대 목록에 추가 (총 ${e.trims.length})`);
    }
    for (const v of (e.variants || []) as Rec[]) {
      const label = S(v.label);
      if (!f.variants.some((want) => label.includes(want))) continue;
      if (!Array.isArray(v.trims)) v.trims = [];
      if (v.trims.some((t: unknown) => S(t) === f.trim)) {
        console.log(`   · [${label}] 이미 있음`);
        skipped++;
        continue;
      }
      v.trims.push(f.trim);
      added++;
      console.log(`   · [${label}] 추가 → ${v.trims.join(' · ')}`);
    }
  }
}

console.log(`\n추가 ${added}곳 · 이미 있어 건너뜀 ${skipped}곳`);
if (!apply) {
  console.log('\n(미리보기만 — 반영하려면 APPLY=1)');
  process.exit(0);
}

copyFileSync(FILE, `${FILE}.bak-welrix`);
if (Array.isArray(doc)) {
  writeFileSync(FILE, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
} else {
  doc.entries = entries;
  writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}
console.log(`\n반영 완료 · 백업 ${FILE}.bak-welrix`);
