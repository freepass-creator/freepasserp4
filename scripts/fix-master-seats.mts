/**
 * 인승 SSOT — 세대(variants) 안에서 seat 값이 2종 이상일 때만 유지.
 * 전부 5인승 같은 단일값은 null (파워트레인에 인승 표기 안 함).
 * 카니발·팰리세이드·쏘렌토 등 7/9 갈리는 차만 남김.
 */
import fs from 'fs';

const path = 'public/data/vehicle-master.json';
const root = JSON.parse(fs.readFileSync(path, 'utf8')) as {
  entries: Array<{ model: string; sub_model: string; variants?: Array<{ seat?: number | null; label?: string }> }>;
};

let cleared = 0;
let keptMulti = 0;
const keptSamples: string[] = [];

for (const e of root.entries) {
  const vars = e.variants || [];
  if (!vars.length) continue;
  const seats = [...new Set(vars.map((v) => v.seat).filter((s): s is number => typeof s === 'number' && s > 0))];
  if (seats.length <= 1) {
    for (const v of vars) {
      if (v.seat != null) {
        v.seat = null;
        cleared++;
      }
    }
  } else {
    keptMulti++;
    if (keptSamples.length < 15) keptSamples.push(`${e.model} ${e.sub_model} → ${seats.sort((a, b) => a - b).join('/')}`);
  }
}

fs.writeFileSync(path, JSON.stringify(root, null, 2) + '\n');
console.log('cleared seat fields', cleared);
console.log('kept multi-seat gens', keptMulti);
console.log(keptSamples.join('\n'));
