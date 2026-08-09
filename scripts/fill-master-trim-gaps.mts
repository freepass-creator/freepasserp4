/**
 * 근거 있는 트림만 append — 아이오닉5 스탠다드(엔카·공급사 원문), GV80 기본형.
 *   APPLY=1 npx tsx scripts/fill-master-trim-gaps.mts
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const FILE = 'public/data/vehicle-master.json';
const apply = S(process.env.APPLY) === '1';

const PLANS: Array<{ sub: string; trims: string[]; variants?: string[] }> = [
  // 엔카 badge 스탠다드 + 공급사 「…스탠다드 19인치(E-VALUE+)」(10호3899)
  { sub: '더 뉴 아이오닉5 NE', trims: ['스탠다드'], variants: ['전기 롱레인지'] },
  // 원문 「기본형」 — 마스터엔 「기본」만 있어 못 붙음(104호3665)
  { sub: 'GV80 JX1', trims: ['기본형'], variants: ['디젤 3.0 AWD', '가솔린 2.5 AWD', '가솔린 2.5 2WD', '가솔린 3.5 AWD', '가솔린 3.5 2WD'] },
  // 원문 「…2WD 기본형」(141호4798) — RG3 트림칸에 기본형 없음(entry+전 variant)
  { sub: 'G80 RG3', trims: ['기본형'] },
  // 엔트리엔 SLX 있는데 가솔린 노드엔 SLX 스페셜만 → 「모닝 5도어 SLX 오토」못 붙음(54나7852)
  { sub: '뉴모닝 SA', trims: ['SLX'], variants: ['가솔린 1.0'] },
  // 엔트리엔 SE · 전기 노드엔 E 클래식/JCW만 → 「미니 에이스맨 SE」(10하8034)
  { sub: '에이스맨 1세대', trims: ['SE'], variants: ['전기'] },
  // 원문 「…5인승 기본형」(109호3486) — RS4에 블랙·세부등급없음만
  { sub: 'G90 RS4', trims: ['기본형'] },
  // 원문 「K5 LPI 2.0 트렌디」(101하1394) — LPG 노드에 LPI 트렌디 없음(가솔린에만 트렌디)
  { sub: 'K5 TF', trims: ['LPI 트렌디'], variants: ['LPG 2.0'] },
  // 원문 trim=「트렌디」·fuel LPG(161하1284) — LPG 2.0 2WD 노드에 트렌디 없음
  { sub: '스포티지 NQ5', trims: ['트렌디'], variants: ['LPG 2.0 2WD'] },
  // 로체(2005~)는 공급 7년 범위 밖 — append 대상 아님
];

const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { entries: Rec[] };
let added = 0;
const samples: string[] = [];

const addTrim = (arr: unknown, trim: string, where: string) => {
  const list = Array.isArray(arr) ? arr.map(S) : [];
  if (list.includes(trim)) return list;
  added++;
  samples.push(`${where} + ${trim}`);
  return [...list, trim];
};

for (const plan of PLANS) {
  for (const e of doc.entries || []) {
    if (S(e.sub_model) !== plan.sub) continue;
    e.trims = addTrim(e.trims, plan.trims[0], plan.sub);
    for (const want of plan.trims.slice(1)) e.trims = addTrim(e.trims, want, plan.sub);
    for (const v of (e.variants || []) as Rec[]) {
      const label = S(v.label);
      if (plan.variants && !plan.variants.includes(label)) continue;
      for (const t of plan.trims) v.trims = addTrim(v.trims, t, `${plan.sub}/${label}`);
    }
  }
}

console.log(`추가 ${added}칸`);
for (const s of samples) console.log(' ', s);
if (!apply) {
  console.log('\n(미리보기 — APPLY=1 반영)');
  process.exit(0);
}
copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`\n반영 · 백업 ${FILE}.bak`);
