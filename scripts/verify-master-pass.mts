/**
 * 차종마스터 레인 회귀 검증 — id/MMS/exact/G80/GN7/영문트림/인승 정책.
 * 실행: npx tsx scripts/_verify-master-pass.mts
 */
import { readFileSync } from 'fs';
import {
  resolveExactMasterPath,
  snapToMaster,
  canonMasterTrim,
  variantSeatsDiffer,
  masterVariantOptionLabel,
} from '../lib/domain/vehicle-master-match.ts';

const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as
  | { entries: any[] }
  | any[];
const master = Array.isArray(raw) ? raw : raw.entries;
const issues: string[] = [];
const ok: string[] = [];

// ── 1. Master integrity ──
const idMap = new Map<string, number>();
for (const e of master) idMap.set(e.id, (idMap.get(e.id) ?? 0) + 1);
const dupIds = [...idMap].filter(([, c]) => c > 1);
if (dupIds.length) issues.push(`dup ids: ${dupIds.length} groups`);
else ok.push(`unique ids (${master.length})`);

const mms = new Map<string, number>();
for (const e of master) {
  const k = `${e.maker}\0${e.model}\0${e.sub_model || ''}`;
  mms.set(k, (mms.get(k) ?? 0) + 1);
}
const dupMms = [...mms].filter(([, c]) => c > 1);
if (dupMms.length) issues.push(`dup maker+model+sub: ${dupMms.length}`);
else ok.push('unique maker+model+sub');

let emptyGen = 0;
let seatFilled = 0;
let seatNull = 0;
const multiSeatGens: string[] = [];
for (const e of master) {
  if (!String(e.gen_code || '').trim()) emptyGen++;
  const seats = [
    ...new Set(
      (e.variants || [])
        .map((v: any) => v.seat)
        .filter((s: any) => s != null && s > 0),
    ),
  ];
  for (const v of e.variants || []) {
    if (v.seat != null && v.seat > 0) seatFilled++;
    else seatNull++;
  }
  if (seats.length > 1) {
    multiSeatGens.push(`${e.maker} ${e.model} ${e.sub_model || ''} [${seats.join('/')}]`);
  }
}
ok.push(`empty gen_code: ${emptyGen} (name-only match OK)`);
ok.push(`seat filled ${seatFilled} / null ${seatNull}; multi-seat gens ${multiSeatGens.length}`);

let exactFail = 0;
for (const e of master) {
  const r = resolveExactMasterPath(master, {
    maker: e.maker,
    model: e.model,
    sub_model: e.sub_model || '',
    year: e.year_start,
    catalog_id: e.id,
  } as any);
  if (!r) {
    exactFail++;
    if (exactFail <= 3) issues.push(`exact fail: ${e.id}`);
  }
}
if (exactFail) issues.push(`exact self-check fails: ${exactFail}`);
else ok.push('exact self-check 0 fails');

// ── 2. Regression cases (snapToMaster = 실경로) ──
{
  const r = snapToMaster(
    { maker: '제네시스', model: 'G80', year: 2022, catalog_id: '', variant: '', trim_name: '', sub_model: '' } as any,
    master,
  );
  if (!r) issues.push('G80: no snap');
  else if (/electrified|전기/i.test(r.sub_model || '')) issues.push(`G80: got EV ${r.sub_model}`);
  else if (r.gen_code !== 'RG3') issues.push(`G80: gen ${r.gen_code}`);
  else ok.push(`G80 RG3 ICE (${r.confidence})`);
}
{
  const r = snapToMaster(
    { maker: '현대', model: '그랜저', year: 2023, catalog_id: '', variant: '', trim_name: '', sub_model: '' } as any,
    master,
  );
  if (!r) issues.push('그랜저 GN7: no snap');
  else if (/더\s*뉴/.test(r.sub_model || '')) issues.push(`그랜저: got 더뉴 ${r.sub_model}`);
  else if (r.gen_code !== 'GN7') issues.push(`그랜저: gen ${r.gen_code}`);
  else ok.push(`그랜저 GN7 (${r.confidence})`);
}

// Venue EN trim
{
  const snapped = snapToMaster(
    {
      maker: '현대',
      model: '베뉴',
      year: 2021,
      catalog_id: '',
      sub_model: '',
      variant: '',
      trim_name: 'Premium',
      trim_extra: '',
    } as any,
    master,
  );
  if (!snapped) issues.push('Venue snap fail');
  else if (snapped.trim_name !== '프리미엄') issues.push(`Venue snap trim=${snapped.trim_name}`);
  else ok.push(`Venue Premium→프리미엄 (${snapped.confidence})`);
}

// soft-fail unknown variant
{
  const ice = master.find(
    (e: any) =>
      e.maker === '제네시스' &&
      e.model === 'G80' &&
      e.gen_code === 'RG3' &&
      !/electrified|전기/i.test(e.sub_model || ''),
  );
  const r = resolveExactMasterPath(master, {
    maker: '제네시스',
    model: 'G80',
    sub_model: ice?.sub_model,
    year: 2022,
    catalog_id: ice?.id,
    variant: '없는파워트레인',
    trim_name: '',
  } as any);
  if (r && r.variantIndex >= 0) issues.push('exact should soft-fail unknown variant');
  else if (r && r.variantIndex < 0) ok.push('exact soft-fail unknown variant (keep gen)');
  else issues.push('exact lost gen on unknown variant');
}

// ── 3. Seat policy ──
{
  const carnival = master.find(
    (e: any) => e.model === '카니발' && variantSeatsDiffer(e.variants),
  );
  const sonata = master.find((e: any) => e.model === '쏘나타' && e.variants?.length);
  if (carnival) {
    const label = masterVariantOptionLabel(carnival.variants[0], carnival.variants);
    if (!/인승/.test(label)) issues.push(`Carnival should show seat: ${label}`);
    else ok.push(`Carnival seat in label`);
  } else issues.push('no multi-seat Carnival found');
  if (sonata) {
    const label = masterVariantOptionLabel(sonata.variants[0], sonata.variants);
    if (/인승/.test(label) && !variantSeatsDiffer(sonata.variants)) {
      issues.push(`Sonata should NOT show seat: ${label}`);
    } else ok.push('Sonata no spurious seat');
  }
}

// ── 4. canonMasterTrim aliases ──
const aliasCases: [string, string][] = [
  ['Premium', '프리미엄'],
  ['Modern Plus', '모던 플러스'],
  ['FLUX', '플럭스'],
  [' Exclusive ', '익스클루시브'],
  ['Inspiration', '인스퍼레이션'],
  ['N Line', 'N라인'],
];
for (const [en, ko] of aliasCases) {
  const got = canonMasterTrim(en);
  if (got !== ko) issues.push(`alias ${JSON.stringify(en)}→${got} want ${ko}`);
}
if (!aliasCases.some(([en, ko]) => canonMasterTrim(en) !== ko)) {
  ok.push(`TRIM_EN_KO aliases ${aliasCases.length}`);
}

// ── 5. brand isolation (한줄+브랜드 혼입) ──
{
  const r = snapToMaster(
    {
      maker: '제네시스',
      model: 'G80 2.5T AWD 가솔린',
      year: 2022,
      catalog_id: '',
      variant: '',
      trim_name: '',
      sub_model: '',
    } as any,
    master,
  );
  if (r && r.maker === '제네시스' && r.model === 'G80' && !/electrified|전기/i.test(r.sub_model || '')) {
    ok.push(`G80 brand isolation (${r.confidence})`);
  } else {
    issues.push(`G80 brand leak: ${r ? `${r.maker} ${r.model} ${r.sub_model}` : 'fail'}`);
  }
}

// ── 6. Master KO trims + domestic marketing Latin (엔진코드 GDI/DOHC 제외) ──
{
  const marketingEn = /^(premium|modern|exclusive|inspiration|prestige|noblesse|x[\s-]?line|gt[\s-]?line|n[\s-]?line|flux)$/i;
  const domesticLatin: string[] = [];
  const masterTrims = new Set<string>();
  for (const e of master) {
    for (const t of [...(e.trims || []), ...(e.variants || []).flatMap((v: any) => v.trims || [])]) {
      const s = String(t).trim();
      if (!s || /\(세부/.test(s) || s === '없음') continue;
      masterTrims.add(s);
      if (e.origin === '국산' && marketingEn.test(s)) domesticLatin.push(`${e.model}:${s}`);
    }
  }
  const samples = ['프리미엄', '모던', '플럭스', '인스퍼레이션', '익스클루시브', 'X라인', 'GT라인'];
  const covered = samples.filter((ko) => [...masterTrims].some((t) => t === ko || t.includes(ko))).length;
  ok.push(`master KO trim samples: ${covered}/${samples.length}`);
  if (domesticLatin.length) {
    issues.push(`domestic still has EN marketing trims: ${domesticLatin.slice(0, 8).join(', ')}`);
  } else {
    ok.push('domestic marketing trims Koreanized (X/GT/N Line)');
  }
}

const report = {
  ok,
  issues,
  multiSeatSample: multiSeatGens.slice(0, 8),
  verdict: issues.length === 0 ? 'PASS' : 'FAIL',
};
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exit(1);
