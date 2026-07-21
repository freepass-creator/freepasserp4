/**
 * 마스터 트림에 흔한 영문 병기 추가 — 공급사 Premium/FLUX 등이 한글만 있는 세대에 매칭되도록.
 * 이미 있으면 스킵. 한글 SSOT 유지 + 영문 선택지 병행.
 */
import fs from 'fs';

const path = 'public/data/vehicle-master.json';
const PAIR: [string, string][] = [
  ['스마트', 'Smart'],
  ['모던', 'Modern'],
  ['모던 플러스', 'Modern Plus'],
  ['프리미엄', 'Premium'],
  ['플럭스', 'FLUX'],
  ['인스퍼레이션', 'Inspiration'],
  ['익스클루시브', 'Exclusive'],
  ['프레스티지', 'Prestige'],
  ['노블레스', 'Noblesse'],
  ['시그니처', 'Signature'],
  ['캘리그래피', 'Calligraphy'],
  ['르블랑', 'Le Blanc'],
  ['트렌디', 'Trendy'],
  ['럭셔리', 'Luxury'],
  ['스타일', 'Style'],
  ['코어', 'Core'],
];

const root = JSON.parse(fs.readFileSync(path, 'utf8')) as {
  entries: Array<{ trims?: string[]; variants?: Array<{ trims?: string[] }>; model?: string; sub_model?: string }>;
};

function enrich(list: string[] | undefined): { next: string[]; added: number } {
  if (!list?.length) return { next: list || [], added: 0 };
  const set = new Set(list);
  let added = 0;
  for (const [ko, en] of PAIR) {
    if (set.has(ko) && !set.has(en)) { set.add(en); added++; }
    if (set.has(en) && !set.has(ko)) { set.add(ko); added++; }
  }
  return { next: [...set], added };
}

let n = 0;
for (const e of root.entries) {
  const a = enrich(e.trims);
  if (a.added) { e.trims = a.next; n += a.added; }
  for (const v of e.variants || []) {
    const b = enrich(v.trims);
    if (b.added) { v.trims = b.next; n += b.added; }
  }
}

fs.writeFileSync(path, JSON.stringify(root, null, 2) + '\n');
console.log('english/korean trim pairs added', n);
const venue = root.entries.find((e) => e.model === '베뉴');
console.log('Venue trims', venue?.trims, venue?.variants?.[0]?.trims);
