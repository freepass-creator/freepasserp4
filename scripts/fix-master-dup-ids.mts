/**
 * 차종마스터 id 중복 수정 — 같은 sm-* id를 쓰는 페이스리프트·EV·쿠페 등이
 * 픽커/exact path에서 첫 항목만 잡혀 "마스터에 없음"처럼 보이던 버그.
 * gen_code(RG3 등)는 세대코드라 공유 가능. id만 유일하게.
 */
import fs from 'fs';

const path = 'public/data/vehicle-master.json';
const root = JSON.parse(fs.readFileSync(path, 'utf8')) as { entries?: unknown[] } | unknown[];
const arr = (Array.isArray(root) ? root : (root as { entries: unknown[] }).entries) as Array<{
  id: string; maker: string; model: string; sub_model: string; gen_code: string; title?: string;
  [k: string]: unknown;
}>;

function slug(sub: string): string {
  return String(sub || '')
    .toLowerCase()
    .replace(/일렉트리파이드|electrified/gi, 'ev')
    .replace(/더\s*뉴|올\s*뉴|뉴\s*/g, 'new-')
    .replace(/[^0-9a-z가-힣]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'x';
}

const byId = new Map<string, typeof arr>();
for (const e of arr) {
  const a = byId.get(e.id) || [];
  a.push(e);
  byId.set(e.id, a);
}

let fixed = 0;
const used = new Set(arr.map((e) => e.id));
for (const [id, group] of byId) {
  if (group.length < 2) continue;
  // 첫 항목은 기존 id 유지, 나머지에 고유 접미사
  for (let i = 1; i < group.length; i++) {
    const e = group[i];
    let next = `${id}__${slug(e.sub_model)}`;
    let n = 2;
    while (used.has(next)) {
      next = `${id}__${slug(e.sub_model)}-${n++}`;
    }
    used.add(next);
    e.id = next;
    fixed++;
  }
}

// 재검증
const check = new Map<string, number>();
for (const e of arr) check.set(e.id, (check.get(e.id) || 0) + 1);
const still = [...check.entries()].filter(([, n]) => n > 1);
if (still.length) {
  console.error('still dups', still.slice(0, 10));
  process.exit(1);
}

if (Array.isArray(root)) {
  fs.writeFileSync(path, JSON.stringify(root, null, 2) + '\n');
} else {
  (root as { entries: unknown[] }).entries = arr;
  fs.writeFileSync(path, JSON.stringify(root, null, 2) + '\n');
}

const g80 = arr.filter((e) => e.model === 'G80');
console.log(`fixed ${fixed} duplicate ids; entries ${arr.length}; unique ids ${check.size}`);
console.log('G80 after:');
for (const e of g80) console.log(`  ${e.id} | ${e.sub_model} | ${e.gen_code}`);
