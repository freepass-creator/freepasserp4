/**
 * 축별 금지값 — 트림 scrub + 파워트레인 라벨 감사.
 *   npx tsx scripts/clean-master-junk-trims.mts
 *   APPLY=1 npx tsx scripts/clean-master-junk-trims.mts   ← 트림칸만 삭제
 *
 * 파워트레인·세부모델 금지는 미리보기만(노드 삭제는 설계 판단).
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import {
  isForbiddenAsSubModel,
  isForbiddenAsTrim,
  isForbiddenAsVariant,
} from '../lib/domain/vehicle-field-guards';
import { isNoTrimLabel } from '../lib/domain/vehicle-master-options';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const FILE = 'public/data/vehicle-master.json';
const apply = S(process.env.APPLY) === '1';

const isJunkTrim = (t: string): boolean => {
  const s = S(t);
  if (!s || isNoTrimLabel(s)) return false;
  return isForbiddenAsTrim(s);
};

const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { entries: Rec[] };
let removed = 0;
const trimSamples: string[] = [];
const badVariants: string[] = [];
const badSubs: string[] = [];

for (const e of doc.entries || []) {
  const sub = S(e.sub_model);
  if (sub && isForbiddenAsSubModel(sub) && badSubs.length < 40) {
    badSubs.push(`${S(e.maker)} · ${sub}`);
  }
  const scrub = (arr: unknown): string[] => {
    const list = Array.isArray(arr) ? arr.map(S).filter(Boolean) : [];
    return list.filter((t) => {
      if (!isJunkTrim(t)) return true;
      removed++;
      if (trimSamples.length < 50) trimSamples.push(`${sub} · ${t}`);
      return false;
    });
  };
  if (Array.isArray(e.trims)) e.trims = scrub(e.trims);
  for (const v of (e.variants || []) as Rec[]) {
    if (Array.isArray(v.trims)) v.trims = scrub(v.trims);
    const lab = S(v.label);
    if (lab && isForbiddenAsVariant(lab) && badVariants.length < 50) {
      badVariants.push(`${sub} · ${lab}`);
    }
  }
}

console.log(`══ 세부트림 잡음 ${removed}칸 (APPLY 시 삭제)`);
for (const s of trimSamples.slice(0, 30)) console.log(' ', s);
if (removed > 30) console.log(`  … +${removed - 30}`);

console.log(`\n══ 파워트레인 라벨 금지 ${badVariants.length}건+ (미리보기·삭제 안 함)`);
for (const s of badVariants.slice(0, 20)) console.log(' ', s);

console.log(`\n══ 세부모델 금지 ${badSubs.length}건+ (미리보기·삭제 안 함)`);
for (const s of badSubs.slice(0, 20)) console.log(' ', s);

if (!apply) {
  console.log('\n(미리보기 — APPLY=1 이면 트림칸만 반영)');
  process.exit(0);
}
copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`\n트림 scrub 반영 · 백업 ${FILE}.bak`);
