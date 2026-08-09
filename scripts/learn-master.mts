/**
 * 마스터 학습 실행기 — 규칙 엔진(`lib/domain/master-learn.ts`)을 실데이터에 건다.
 *
 * 손으로 적은 목록을 대체한다. 넣을 것을 사람이 고르지 않고 **규칙이 뽑는다.**
 *
 *   npx tsx scripts/learn-master.mts                    (제안만)
 *   APPLY=1 npx tsx scripts/learn-master.mts            (마스터에 반영)
 *   MIN=5 YEARS=12 npx tsx scripts/learn-master.mts     (문턱·범위 바꿔서)
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import { realMasterTrims } from '../lib/domain/vehicle-master-options';
import { buildSubIndex, resolveSubModel } from '../lib/domain/vehicle-sub-resolve';
import {
  DEFAULT_RULES, proposeTrims, proposeVariants, type EncarTuple, type LearnRules,
} from '../lib/domain/master-learn';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const FILE = 'public/data/vehicle-master.json';
const rules: LearnRules = {
  minListings: Number(process.env.MIN) || DEFAULT_RULES.minListings,
  years: Number(process.env.YEARS) || DEFAULT_RULES.years,
  nowYear: Number(process.env.NOW) || DEFAULT_RULES.nowYear,
};

const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { entries: Rec[] };
const entries = doc.entries as unknown as MasterEntry[];
const cat: EncarTuple[] = JSON.parse(readFileSync('tmp/encar/catalog.json', 'utf8'));
const index = buildSubIndex(entries, rules.nowYear);

/** 엔카 세대 이름 → 우리 세대. 한 번만 풀고 재사용한다(4,606건이라 비싸다). */
const subCache = new Map<string, string | null>();
const subOf = (t: EncarTuple): string | null => {
  const key = `${t.maker}|${t.sub_model}|${t.year_min}|${t.year_max}`;
  if (subCache.has(key)) return subCache.get(key)!;
  const hit = resolveSubModel(index, S(t.maker), S(t.sub_model), Number(t.year_min), Number(t.year_max));
  subCache.set(key, hit.sub);
  return hit.sub;
};

const trimsOf = (sub: string): string[] => {
  const info = index.bySub.get(sub);
  return info ? info.trims : [];
};
const labelsOf = (sub: string): string[] => {
  const out: string[] = [];
  for (const e of entries) {
    if (S(e.sub_model) !== sub) continue;
    for (const v of e.variants || []) if (S(v.label)) out.push(S(v.label));
  }
  return out;
};
const yearEndOf = (sub: string): string => {
  const info = index.bySub.get(sub);
  return info && info.yearEnd ? String(info.yearEnd) : '현재';
};

const trims = proposeTrims(cat, trimsOf, yearEndOf, subOf, rules);
const variants = proposeVariants(cat, labelsOf, yearEndOf, subOf, rules);

console.log(`■ 마스터 학습 — 규칙으로 뽑은 제안 (문턱 ${rules.minListings}대 · 최근 ${rules.years}년)\n`);
console.log(`  트림 결손        ${String(trims.length).padStart(4)}건`);
console.log(`  파워트레인 축 결손  ${String(variants.length).padStart(4)}건\n`);

console.log('── 트림 결손 상위 15');
for (const p of trims.slice(0, 15)) {
  console.log(`  ${String(p.listings).padStart(5)}대  ${p.sub.slice(0, 22).padEnd(24)} 「${p.trim}」`);
  console.log(`            붙는 파워트레인: ${p.badges.slice(0, 3).join(' / ')}`);
}
console.log('\n── 파워트레인 축 결손 상위 12');
for (const p of variants.slice(0, 12)) {
  console.log(`  ${String(p.listings).padStart(5)}대  ${p.sub.slice(0, 22).padEnd(24)} 라인「${p.line}」  트림[${p.trims.slice(0, 4).join(', ')}]`);
}

const out = S(process.env.OUT) || 'tmp/encar/learn-proposal.csv';
mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync(out, `﻿${[
  ['구분', '세대', '값', '엔카매물수', '붙는파워트레인', '그아래트림', '근거'].join(','),
  ...trims.map((p) => ['트림결손', p.sub, p.trim, String(p.listings), p.badges.join(' / '), '', p.why].map(esc).join(',')),
  ...variants.map((p) => ['파워트레인축', p.sub, p.line, String(p.listings), p.badges.join(' / '), p.trims.join(' / '), p.why].map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\nCSV: ${out}`);

if (S(process.env.APPLY) !== '1') { console.log('\n(제안만 — 반영하려면 APPLY=1)'); process.exit(0); }

/**
 * 반영 — **덧붙이기만** 한다.
 * 트림은 그 트림이 실제로 붙어 나온 파워트레인에 넣는다(엔카 Badge 로 고른다).
 * 어느 variant 인지 못 고르면 세대 전체 목록에만 넣는다 — 엉뚱한 파워트레인에 심지 않는다.
 */
let added = 0;
const norm = (v: string) => v.toLowerCase().replace(/[\s\-_()/·.]/g, '');
for (const p of trims) {
  for (const e of doc.entries) {
    if (S(e.sub_model) !== p.sub) continue;
    if (!Array.isArray(e.trims)) e.trims = [];
    if (!(e.trims as string[]).some((t) => norm(S(t)) === norm(p.trim))) { (e.trims as string[]).push(p.trim); added++; }
    for (const v of (e.variants || []) as Rec[]) {
      const label = norm(S(v.label));
      // 그 트림이 붙어 나온 Badge 중 하나가 이 variant 를 가리키나
      const fits = p.badges.some((b) => {
        const nb = norm(b);
        return nb.includes(label) || label.includes(nb.replace(/[\d.]/g, '')) || false;
      });
      if (!fits) continue;
      if (!Array.isArray(v.trims)) v.trims = [];
      if (!(v.trims as string[]).some((t) => norm(S(t)) === norm(p.trim))) { (v.trims as string[]).push(p.trim); added++; }
    }
  }
}
copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`\n반영 ${added}곳 · 백업 ${FILE}.bak`);
