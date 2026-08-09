import { readFileSync, writeFileSync } from 'node:fs';

const doc = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries = (Array.isArray(doc) ? doc : doc.entries) || [];
const MAJOR = /^(현대|기아|제네시스|쉐보레|르노|쌍용|KG모빌리티|BMW|벤츠|아우디|테슬라|볼보|미니|폭스바겐)$/i;
const isNo = (t: unknown) => {
  const n = String(t || '').toLowerCase().replace(/\s/g, '');
  return !n || n.includes('세부등급없음') || n === '없음' || n === '-' || n === '—';
};

function band(minEnd: number) {
  const empty: string[] = [];
  let drive = 0;
  const byMaker: Record<string, number> = {};
  for (const e of entries) {
    const end = Number(e.year_end) || 9999;
    if (end < minEnd) continue;
    if (!MAJOR.test(String(e.maker || ''))) continue;
    const trims = new Set<string>();
    for (const t of e.trims || []) if (!isNo(t)) trims.add(String(t).trim());
    for (const v of e.variants || []) for (const t of v.trims || []) if (!isNo(t)) trims.add(String(t).trim());
    if (!trims.size) {
      const m = String(e.maker);
      byMaker[m] = (byMaker[m] || 0) + 1;
      empty.push(`${m}|${e.sub_model}|${e.year_start}-${e.year_end}`);
    }
    const vars = e.variants || [];
    const has = vars.some((v: { drivetrain?: string }) => String(v.drivetrain || '').trim());
    if (has) drive += vars.filter((v: { drivetrain?: string }) => !String(v.drivetrain || '').trim()).length;
  }
  // only in 2016-2018 band (10y minus 7y)
  return { empty: empty.length, driveLeft: drive, byMaker, samples: empty };
}

const y7 = band(2019);
const y10 = band(2016);
const only10 = y10.samples.filter((s) => !y7.samples.includes(s));
const out = {
  y7: { empty: y7.empty, driveLeft: y7.driveLeft, byMaker: y7.byMaker },
  y10: { empty: y10.empty, driveLeft: y10.driveLeft, byMaker: y10.byMaker },
  deltaEmpty: y10.empty - y7.empty,
  deltaDrive: y10.driveLeft - y7.driveLeft,
  only2016_2018: only10,
};
writeFileSync('tmp/scope-7vs10.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
