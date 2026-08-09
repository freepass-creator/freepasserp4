/**
 * PLAN 10년(2016~) / 7년(2019~) 국산·주요 트림빈 → 정상빈 버킷
 *   YEAR_MIN=2016 npx tsx scripts/_probe-master-done-classify.mts
 *   YEAR_MIN=2019 npx tsx scripts/_probe-master-done-classify.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const MAJOR = /^(현대|기아|제네시스|쉐보레|르노|쌍용|KG모빌리티|BMW|벤츠|아우디|테슬라|볼보|미니|폭스바겐)$/i;
const ALWAYS_AWD = /^(X[3-7]\b|SQ[578]\b|RSQ)/i;
const YEAR_MIN = Number(process.env.YEAR_MIN) || 2016;

const isNoTrim = (t: string) => {
  const n = t.toLowerCase().replace(/\s+/g, '');
  return !n || n === '(세부등급없음)' || n === '세부등급없음' || n === '없음' || n === '-' || n === '—';
};

const doc = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: Rec[] = (Array.isArray(doc) ? doc : doc.entries) || [];

const empty: { maker: string; sub: string; years: string; bucket: string; why: string }[] = [];
const driveLeft: { sub: string; label: string; bucket: string }[] = [];

for (const e of entries) {
  const end = Number(e.year_end) || 9999;
  if (end < YEAR_MIN) continue;
  const maker = S(e.maker);
  if (!MAJOR.test(maker)) continue;
  const sub = S(e.sub_model);
  const trims = new Set<string>();
  for (const t of e.trims || []) if (S(t) && !isNoTrim(S(t))) trims.add(S(t));
  for (const v of e.variants || []) for (const t of v.trims || []) if (S(t) && !isNoTrim(S(t))) trims.add(S(t));

  if (!trims.size) {
    let bucket = '정상빈_재고미소';
    let why = '공급 재고·등급 근거 없음 · 트림 발명 안 함';
    if (/제네시스/i.test(maker)) {
      bucket = '정상빈_제네시스';
      why = '제네시스 현행 세부등급 없음(사장님 확인)';
    } else if (/쏘울 EV|씨드|텔루라이드/.test(sub)) {
      bucket = '정상빈_재고미소';
      why = '국내 렌트 재고 미소·라인업 껍데기';
    }
    empty.push({ maker, sub, years: `${e.year_start || '?'}-${e.year_end || '?'}`, bucket, why });
  }

  const vars = (e.variants || []) as Rec[];
  const hasDrive = vars.some((v) => S(v.drivetrain));
  if (!hasDrive) continue;
  for (const v of vars) {
    if (S(v.drivetrain)) continue;
    const bucket = ALWAYS_AWD.test(sub) ? '정상빈_상시AWD' : '정상빈_구동모호';
    driveLeft.push({ sub, label: S(v.label) || '(라벨없음)', bucket });
  }
}

const buckets: Record<string, number> = {};
for (const r of empty) buckets[r.bucket] = (buckets[r.bucket] || 0) + 1;
const driveBuckets: Record<string, number> = {};
for (const r of driveLeft) driveBuckets[r.bucket] = (driveBuckets[r.bucket] || 0) + 1;

mkdirSync('tmp', { recursive: true });
const out = {
  yearMin: YEAR_MIN,
  emptyTrimMajor: empty,
  emptyTrimBuckets: buckets,
  driveLeftMajor: driveLeft,
  driveLeftBuckets: driveBuckets,
  classified100: Object.keys(buckets).every((k) => k.startsWith('정상빈_'))
    && (Object.keys(driveBuckets).length === 0
      || Object.keys(driveBuckets).every((k) => k.startsWith('정상빈_'))),
};
writeFileSync(`tmp/master-done-${YEAR_MIN}y-classify.json`, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({
  yearMin: YEAR_MIN,
  emptyTrim: empty.length,
  emptyTrimBuckets: buckets,
  driveLeft: driveLeft.length,
  driveLeftBuckets: driveBuckets,
  classified100: out.classified100,
}, null, 2));
