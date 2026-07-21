/**
 * 마스터 variant label 교정 — 정수 리터만 .0 복원.
 * "가솔린 2"→"가솔린 2.0", "가솔린 2T 2WD"→"가솔린 2.0T 2WD".
 * EV kWh·이미 소수 있는 라벨은 그대로.
 */
import { readFileSync, writeFileSync } from 'fs';

const path = 'public/data/vehicle-master.json';
let text = readFileSync(path, 'utf8');
const data = JSON.parse(text) as {
  entries: { variants?: { label: string }[] }[];
};

function polish(s: string): string {
  return s.replace(/(^|[\s/+])(\d+)(T?)(?=\s|$)/g, (_, pre: string, n: string, t: string) => (
    Number(n) > 0 ? `${pre}${n}.0${t}` : `${pre}${n}${t}`
  ));
}

const map = new Map<string, string>();
let n = 0;
for (const e of data.entries || []) {
  for (const v of e.variants || []) {
    const next = polish(v.label);
    if (next !== v.label) {
      if (map.has(v.label) && map.get(v.label) !== next) {
        console.warn('CONFLICT', v.label, map.get(v.label), next);
        continue;
      }
      map.set(v.label, next);
      n++;
    }
  }
}

let patterns = 0;
for (const [oldL, newL] of map) {
  const re = new RegExp(`"label": "${oldL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
  const next = text.replace(re, `"label": "${newL}"`);
  if (next !== text) patterns++;
  text = next;
}
writeFileSync(path, text);
console.log(JSON.stringify({
  variantsTouched: n,
  uniqueLabels: map.size,
  patternsReplaced: patterns,
  samples: [...map.entries()].slice(0, 40),
}, null, 2));
