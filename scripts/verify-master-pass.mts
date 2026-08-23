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
import { selectMasterVariant } from '../lib/domain/vehicle-master-variant.ts';

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
  const entry = {
    maker: '테스트', model: '정확배기', sub_model: '정확배기 X1', gen_code: 'X1',
    year_start: '2020', year_end: '현재', variants: [
      { label: '가솔린 A', fuel: '가솔린', engine_cc: 1591, displacement_l: 1.6, turbo: false, drivetrain: '2WD', seat: 5, battery_kwh: null, trims: [] },
      { label: '가솔린 B', fuel: '가솔린', engine_cc: 1598, displacement_l: 1.6, turbo: false, drivetrain: '2WD', seat: 5, battery_kwh: null, trims: [] },
    ],
  } as any;
  const { variant } = selectMasterVariant(
    { fuel_type: '가솔린', engine_cc: '1598' } as any,
    entry,
    [entry],
    entry.model,
    '',
    false,
    { norm: (v) => String(v || '').replace(/\s+/g, '').toLowerCase(), normDrive: (v) => String(v || '') },
  );
  if (variant?.engine_cc !== 1598) issues.push(`exact cc priority: ${variant?.engine_cc || 'none'}`);
  else ok.push('exact engine_cc priority');
}
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
  ['N라인', 'N Line'],
  ['n-line', 'N Line'],
  ['X라인', 'X Line'],
  ['H-픽', 'H-PICK'],
  ['H-Pick', 'H-PICK'],
  ['모던 N라인', '모던 N Line'],
  ['GT라인', 'GT Line'],
  ['N', 'N'],
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

// ── 6. 등급어는 한글, 제조사 라틴 고유명은 라틴 정본 (엔진코드 GDI/DOHC 제외) ──
{
  const gradeEn = /^(premium|modern|exclusive|inspiration|prestige|noblesse|flux)$/i;
  const latinizedKo = /(N라인|X라인|GT라인|H-픽)/;
  const domesticGradeEn: string[] = [];
  const domesticLatinizedKo: string[] = [];
  const masterTrims = new Set<string>();
  for (const e of master) {
    for (const t of [...(e.trims || []), ...(e.variants || []).flatMap((v: any) => v.trims || [])]) {
      const s = String(t).trim();
      if (!s || /\(세부/.test(s) || s === '없음') continue;
      masterTrims.add(s);
      if (e.origin !== '국산') continue;
      if (gradeEn.test(s)) domesticGradeEn.push(`${e.model}:${s}`);
      if (latinizedKo.test(s)) domesticLatinizedKo.push(`${e.model}:${s}`);
    }
  }
  const samples = ['프리미엄', '모던', '플럭스', '인스퍼레이션', '익스클루시브', 'X Line', 'GT Line', 'N Line', 'H-PICK'];
  const covered = samples.filter((ko) => [...masterTrims].some((t) => t === ko || t.includes(ko))).length;
  ok.push(`master trim samples: ${covered}/${samples.length}`);
  if (domesticGradeEn.length) {
    issues.push(`domestic still has EN grade words: ${domesticGradeEn.slice(0, 8).join(', ')}`);
  } else {
    ok.push('domestic grade words Koreanized (Premium/Modern/…)');
  }
  if (domesticLatinizedKo.length) {
    issues.push(`domestic still Koreanized brand Latin: ${domesticLatinizedKo.slice(0, 8).join(', ')}`);
  } else {
    ok.push('brand Latin kept (H-PICK / N Line / X Line / GT Line)');
  }
  const avanteN = [...masterTrims].some((t) => t === 'N');
  const avanteNLine = [...masterTrims].some((t) => t === 'N Line' || t.includes('N Line'));
  if (avanteN && avanteNLine) ok.push('N ≠ N Line (both exist)');
  else issues.push(`N vs N Line split missing (N=${avanteN} N Line=${avanteNLine})`);
}

// ── 7. 공급사 차명 표기(2026-08-21) — 마스터에 있는 차를 표기 때문에 못 붙이면 안 된다 ──
{
  const cases: { label: string; rec: Record<string, unknown>; want: { model: string; sub?: string } }[] = [
    { label: '라브4', rec: { maker: '도요타', model: '라브4', vehicle_name: '라브4 하이브리드 2.5', year: 2021 }, want: { model: 'RAV4' } },
    { label: 'A6 C9', rec: { maker: '아우디', model: 'A6', vehicle_name: 'A6 C9 45 TFSI', year: 2026 }, want: { model: 'A6', sub: 'A6 C9' } },
    { label: 'SM7', rec: { maker: '르노', model: 'SM7', vehicle_name: 'SM7 노바 2.0 LPe', year: 2016 }, want: { model: 'SM7' } },
    { label: '엑센트 Accent', rec: { maker: '현대', model: 'Accent', vehicle_name: 'Accent 1.6', year: 2015 }, want: { model: '엑센트' } },
    { label: 'K5 TF', rec: { maker: '기아', model: 'K5', vehicle_name: 'K5 TF LPG 2.0', year: 2012 }, want: { model: 'K5', sub: 'K5 TF' } },
    { label: '200 1세대', rec: { maker: '크라이슬러', model: '200', vehicle_name: '200 1세대', year: 2012 }, want: { model: '200', sub: '200 1세대' } },
    { label: '캐스퍼 일렉트릭', rec: { maker: '현대', model: '캐스퍼', vehicle_name: '캐스퍼 일렉트릭 인스퍼레이션', year: 2025, fuel_type: '전기' }, want: { model: '캐스퍼', sub: '캐스퍼 일렉트릭 AX1e' } },
    { label: '디 올 뉴 아반떼', rec: { maker: '현대', model: '아반떼', vehicle_name: '디 올 뉴 아반떼 가솔린 2.0 인스퍼레이션', year: 2026 }, want: { model: '아반떼', sub: '아반떼 CN8' } },
    { label: '디 올뉴 싼타페', rec: { maker: '현대', model: '싼타페', vehicle_name: '디 올뉴 싼타페 가솔린 2.5 2WD 익스클루시브', year: 2026 }, want: { model: '싼타페', sub: '싼타페 MX5' } },
    { label: '더 뉴 니로 HEV', rec: { maker: '기아', model: '니로', vehicle_name: '더 뉴 니로 하이브리드 1.6 시그니처', year: 2026 }, want: { model: '니로', sub: '더 뉴 니로 SG2' } },
    { label: '스타리아 일렉트릭', rec: { maker: '현대', model: '스타리아', vehicle_name: '더 뉴 스타리아 일렉트릭 라운지 7인승', year: 2026, fuel_type: '전기' }, want: { model: '스타리아', sub: '더 뉴 스타리아 라운지 US4' } },
    { label: '아이오닉5 N', rec: { maker: '현대', model: '아이오닉5', vehicle_name: '아이오닉 5 N 에센셜', year: 2025, fuel_type: '전기' }, want: { model: '아이오닉5', sub: '아이오닉5 N' } },
    { label: '아이오닉5 NE', rec: { maker: '현대', model: '아이오닉5', sub_model: '아이오닉5 NE', vehicle_name: '아이오닉 5 Long Range 프레스티지', year: 2022, fuel_type: '전기' }, want: { model: '아이오닉5', sub: '아이오닉5 NE' } },
    { label: 'G80 RG3 FL', rec: { maker: '제네시스', model: 'G80', sub_model: 'G80 RG3 FL', vehicle_name: 'G80 RG3 2025 가솔린 2.5T AWD', year: 2025 }, want: { model: 'G80', sub: 'G80 RG3' } },
    { label: 'GV70 JK1 FL', rec: { maker: '제네시스', model: 'GV70', sub_model: 'GV70 JK1 FL', vehicle_name: '신형 GV70 2.5T 2WD', year: 2024 }, want: { model: 'GV70', sub: 'GV70 JK1' } },
    { label: 'GV80 JX1 FL', rec: { maker: '제네시스', model: 'GV80', sub_model: 'GV80 JX1 FL', vehicle_name: 'GV80 JX1 가솔린 3.5 AWD', year: 2024 }, want: { model: 'GV80', sub: 'GV80 JX1' } },
    { label: '쏘나타 디 엣지', rec: { maker: '현대', model: '쏘나타', sub_model: '쏘나타 DN8 디 엣지', vehicle_name: '디 엣지 쏘나타DN8 가솔린 2.0', year: 2024 }, want: { model: '쏘나타', sub: '쏘나타 디 엣지 DN8' } },
    { label: '모델 Y FL', rec: { maker: '테슬라', model: '모델 Y', sub_model: '모델 Y FL', vehicle_name: '모델 Y FL Long Range', year: 2025, fuel_type: '전기' }, want: { model: '모델 Y', sub: '모델 Y' } },
    { label: '모델 3 FL', rec: { maker: '테슬라', model: '모델 3', sub_model: '모델 3 FL', vehicle_name: '모델 3 FL Long Range', year: 2025, fuel_type: '전기' }, want: { model: '모델 3', sub: '모델 3' } },
  ];
  for (const c of cases) {
    const r = snapToMaster(c.rec as any, master);
    if (!r || r.model !== c.want.model) issues.push(`${c.label}: ${r ? `${r.maker} ${r.model} ${r.sub_model}` : 'no snap'}`);
    else if (c.want.sub && r.sub_model !== c.want.sub) issues.push(`${c.label}: sub ${r.sub_model}`);
    else ok.push(`${c.label} → ${r.model} ${r.sub_model} (${r.confidence})`);
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
