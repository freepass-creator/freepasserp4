/**
 * 구동 형제 패턴 자동 채움 — 「가솔린 3.8」빈 + 「가솔린 3.8 AWD」있음 → 2WD
 * 상시 AWD SUV(X5 등)는 건너뜀 (2WD 발명 금지).
 *
 *   npx tsx scripts/fill-master-drive-sibling.mts
 *   APPLY=1 npx tsx scripts/fill-master-drive-sibling.mts
 *   YEAR_MIN=2016 APPLY=1 npx tsx scripts/fill-master-drive-sibling.mts  (PLAN 10년)
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const FILE = 'public/data/vehicle-master.json';
const apply = S(process.env.APPLY) === '1';
const YEAR_MIN = Number(process.env.YEAR_MIN) || 2019;

const MAJOR = /^(현대|기아|제네시스|쉐보레|르노|쌍용|KG모빌리티|BMW|벤츠|아우디|테슬라|볼보|미니|폭스바겐)$/i;

/** 국내 판매가 사실상 사륜만인 SUV — 빈 칸에 2WD를 넣지 않는다 */
const ALWAYS_AWD = /^(X[3-7]\b|SQ[578]\b|RSQ)/i;

const DRIVE_SUFF = /\s*(4WD|AWD|2WD|RWD|xDrive|4MATIC|콰트로|4모션)\s*$/i;
const driveOf = (lab: string): string => {
  const m = lab.match(DRIVE_SUFF);
  return m ? m[1].toUpperCase().replace('XDRIVE', 'xDrive').replace('4MATIC', '4MATIC') : '';
};
const baseOf = (lab: string) => lab.replace(DRIVE_SUFF, '').replace(/\s+/g, ' ').trim();

const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { entries: Rec[] };
let filled = 0;
const samples: string[] = [];
const skipped: string[] = [];

console.log(`YEAR_MIN=${YEAR_MIN}`);
for (const e of doc.entries || []) {
  const end = Number(e.year_end) || 9999;
  if (end < YEAR_MIN) continue;
  if (!MAJOR.test(S(e.maker))) continue;
  const sub = S(e.sub_model);
  if (ALWAYS_AWD.test(sub)) {
    const miss = ((e.variants || []) as Rec[]).filter((v) => !S(v.drivetrain));
    if (miss.length) skipped.push(`${sub} ×${miss.length} (상시AWD 스킵)`);
    continue;
  }

  const vars = (e.variants || []) as Rec[];
  const driven = vars.filter((v) => S(v.drivetrain) || driveOf(S(v.label)));
  if (!driven.length) continue;

  for (const v of vars) {
    if (S(v.drivetrain)) continue;
    const lab = S(v.label);
    if (!lab) continue;
    if (driveOf(lab)) {
      // 라벨에만 구동이 있으면 필드만 채움
      const d = driveOf(lab);
      const canon = /xDrive|4MATIC|AWD|4WD|콰트로|4모션/i.test(d) ? (d.includes('xDrive') ? 'xDrive' : d.includes('4MATIC') ? '4MATIC' : /AWD|4WD/.test(d) ? 'AWD' : d)
        : /RWD/i.test(d) ? 'RWD' : '2WD';
      v.drivetrain = canon;
      filled++;
      samples.push(`${sub} · ${lab} → drivetrain=${canon} (라벨동기)`);
      continue;
    }
    const base = baseOf(lab);
    const sib = vars.find((x) => {
      if (x === v) return false;
      const xl = S(x.label);
      const xb = baseOf(xl);
      if (xb !== base) return false;
      const xd = S(x.drivetrain) || driveOf(xl);
      return /AWD|4WD|xDrive|4MATIC|콰트로|4모션/i.test(xd);
    });
    if (!sib) continue;
    const isTesla = /테슬라/i.test(S(e.maker));
    const drive = isTesla ? 'RWD' : '2WD';
    v.drivetrain = drive;
    if (!lab.includes(drive)) v.label = `${lab} ${drive}`;
    filled++;
    samples.push(`${sub} · ${lab} → ${v.label} drivetrain=${drive} (형제 ${S(sib.label)})`);
  }
}

console.log(`채움 ${filled}칸`);
for (const s of samples.slice(0, 50)) console.log(' ', s);
if (samples.length > 50) console.log(`  … +${samples.length - 50}`);
console.log(`\n상시AWD 스킵 ${skipped.length}세대`);
for (const s of skipped.slice(0, 20)) console.log(' ', s);

if (!apply) {
  console.log('\n(미리보기 — APPLY=1 반영)');
  process.exit(0);
}
copyFileSync(FILE, `${FILE}.bak`);
writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`\n반영 · 백업 ${FILE}.bak`);
