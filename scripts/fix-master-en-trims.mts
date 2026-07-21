/**
 * 국산 마스터 트림 영문 잔재 → 한글 SSOT.
 * 수집 영문은 TRIM_EN_KO로 들어오고, JSON 노드는 한글만.
 */
import fs from 'fs';

const path = 'public/data/vehicle-master.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as { entries?: any[] } | any[];
const entries = Array.isArray(raw) ? raw : raw.entries;

const REPLACERS: [RegExp, string][] = [
  [/\bX[\s\-]*Line\b/gi, 'X라인'],
  [/X[\s\-]*라인\s*\(\s*X\s*라인\s*\)/gi, 'X라인'],
  [/X[\s\-]*라인\s*\(\s*X[\s\-]*Line\s*\)/gi, 'X라인'],
  [/X[\s\-]+라인/g, 'X라인'],
  [/\bN[\s\-]*Line\b/gi, 'N라인'],
  [/N[\s\-]+라인/g, 'N라인'],
  [/\bGT[\s\-]*LIne\b/gi, 'GT라인'], // typo in master
  [/\bGT[\s\-]*LINE\b/gi, 'GT라인'],
  [/\bGT[\s\-]*Line\b/gi, 'GT라인'],
];

function fixTrim(s: string): string {
  let out = s;
  for (const [re, to] of REPLACERS) out = out.replace(re, to);
  return out.replace(/\s+/g, ' ').trim();
}

let changed = 0;
const samples: string[] = [];
for (const e of entries) {
  if (e.origin !== '국산') continue;
  const fixList = (arr: unknown) => {
    if (!Array.isArray(arr)) return arr;
    return arr.map((t) => {
      const before = String(t ?? '');
      const after = fixTrim(before);
      if (before !== after) {
        changed++;
        if (samples.length < 20) samples.push(`${before} → ${after}`);
      }
      return after;
    });
  };
  if (e.trims) e.trims = fixList(e.trims);
  for (const v of e.variants || []) {
    if (v.trims) v.trims = fixList(v.trims);
  }
}

if (Array.isArray(raw)) {
  fs.writeFileSync(path, JSON.stringify(raw));
} else {
  fs.writeFileSync(path, JSON.stringify({ entries }, null, 0));
}
console.log(JSON.stringify({ changed, samples }, null, 2));
