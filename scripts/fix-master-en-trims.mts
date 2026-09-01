/**
 * 국산 마스터 트림 — 등급어는 한글, 제조사 라틴 고유명은 라틴 정본.
 * H-PICK · N Line · X Line · GT-Line. 홀로 선 N 은 고성능 라인이라 건드리지 않는다.
 */
import fs from 'fs';

const path = 'public/data/vehicle-master.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as { entries?: any[] } | any[];
const entries = Array.isArray(raw) ? raw : raw.entries;

const REPLACERS: [RegExp, string][] = [
  [/\bH[\s\-]*Pick\b/gi, 'H-PICK'],
  [/H[\s\-]*픽/gi, 'H-PICK'],
  [/\bN[\s\-]*Line\b/gi, 'N Line'],
  [/N[\s\-]*라인/g, 'N Line'],
  [/엔\s*라인/g, 'N Line'],
  [/\bX[\s\-]*Line\b/gi, 'X Line'],
  [/X[\s\-]*라인/g, 'X Line'],
  [/\bGT[\s\-]*Line\b/gi, 'GT-Line'],
  [/GT[\s\-]*라인/g, 'GT-Line'],
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
