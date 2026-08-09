/**
 * 차종마스터 트림 보강 — **엔카 BadgeDetail 로 확인된 것만.**
 *
 * 사장님 승인 2026-08-09. 넣는 원칙:
 *   · 빈 자리에 **덧붙이기만** 한다. 기존 트림은 지우지도 바꾸지도 않는다.
 *   · 엔카 `BadgeDetail`(=진짜 트림)에 나온 것만. `Badge`(=파워트레인)는 트림이 아니다.
 *   · 어느 파워트레인에 넣을지도 엔카가 정한다 — 그 트림이 실제로 붙어 나온 Badge 로.
 *   · 표기는 우리 규격. 엔카의 「비즈니스 1」·「트렌디(렌터카)」 같은 꼬리표는 떼고
 *     마스터 이웃 트림 어투로 맞춘다.
 *
 * 뺀 것(엔카가 «트림이 아니다»라고 말해준 것):
 *   트랙스 크로스오버 RS  → badge「1.2 RS」 detail「(세부등급 없음)」. RS 는 라인이고
 *                          그 아래 세부등급이 「플러스」다 — 마스터에 이미 있다.
 *   아이오닉5 스탠다드    → badge「스탠다드」 detail「익스클루시브」. 배터리 사양이다.
 *
 *   npx tsx scripts/fill-master-trims.mts          (미리보기)
 *   APPLY=1 npx tsx scripts/fill-master-trims.mts  (반영)
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const FILE = 'public/data/vehicle-master.json';

/** 넣을 것 — 세대 · 트림 · 어느 파워트레인에(마스터 variant.label 일부) · 근거. */
const FILL: Array<{ sub: string; trim: string; variants: string[]; why: string }> = [
  {
    sub: 'K5 DL3', trim: '스탠다드', variants: ['LPG 2.0'],
    why: '엔카 「K5 3세대」 badge「2.0 LPI(렌터카용)」 detail「스탠다드」 149대 · 우리 재고 17대',
  },
  {
    sub: '쏘나타 디 엣지 DN8', trim: '비즈니스', variants: ['LPG 2.0'],
    why: '엔카 badge「2.0 LPG(렌터카)」 detail「비즈니스 1」 21대 · 우리 재고 15대 (꼬리표 「1」은 뗀다)',
  },
  {
    sub: 'K8 GL3', trim: '트렌디', variants: ['LPG 3.5'],
    why: '엔카 badge「3.5 LPG 2WD」 detail「트렌디(택시형)」 66 + 「트렌디(렌터카)」 33 = 99대',
  },
  {
    sub: 'K8 GL3', trim: '스탠다드', variants: ['LPG 3.5'],
    why: '엔카 badge「3.5 LPG 2WD」 detail「스탠다드(택시형)」 7 + 「스탠다드(렌터카)」 2 = 9대',
  },
  {
    // 엔카에 2WD 블랙은 한 대도 없다 — 있을 법해도 **근거 있는 데만** 넣는다.
    sub: 'G80 RG3', trim: '블랙', variants: ['가솔린 2.5T AWD', '가솔린 3.5T AWD'],
    why: '엔카 detail「블랙」 2.5T AWD 15 + 3.5T AWD 14 = 29대 · 사장님: G80 RG3 는 블랙만 있는 예외 트림',
  },
];

const raw = readFileSync(FILE, 'utf8');
const doc = JSON.parse(raw) as { entries: Rec[] };
const entries = doc.entries || [];
const apply = S(process.env.APPLY) === '1';

let added = 0; let skipped = 0;
for (const f of FILL) {
  const targets = entries.filter((e) => S(e.sub_model) === f.sub);
  if (!targets.length) { console.log(`✗ 세대 없음: ${f.sub}`); continue; }
  console.log(`\n■ ${f.sub} ← 「${f.trim}」`);
  console.log(`   근거: ${f.why}`);
  for (const e of targets) {
    // 1) 세대 전체 트림 목록(rollup)
    if (!Array.isArray(e.trims)) e.trims = [];
    if (e.trims.some((t: unknown) => S(t) === f.trim)) {
      console.log('   · 세대 목록: 이미 있음');
    } else { e.trims.push(f.trim); added++; console.log(`   · 세대 목록에 추가 (총 ${e.trims.length})`); }

    // 2) 그 트림이 실제로 붙는 파워트레인
    for (const v of (e.variants || []) as Rec[]) {
      const label = S(v.label);
      if (!f.variants.some((want) => label.includes(want))) continue;
      if (!Array.isArray(v.trims)) v.trims = [];
      if (v.trims.some((t: unknown) => S(t) === f.trim)) { console.log(`   · [${label}] 이미 있음`); skipped++; continue; }
      v.trims.push(f.trim);
      added++;
      console.log(`   · [${label}] 추가 → ${v.trims.join(' · ')}`);
    }
  }
}

console.log(`\n추가 ${added}곳 · 이미 있어 건너뜀 ${skipped}곳`);
if (!apply) { console.log('\n(미리보기만 — 반영하려면 APPLY=1)'); process.exit(0); }

copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`\n반영 완료 · 원본 백업 ${FILE}.bak`);
