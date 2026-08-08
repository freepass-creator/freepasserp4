/**
 * 인승·구동·배기(displacement) 축이 있는 세부모델 — 현재 default 조합 전수.
 *   npx tsx scripts/audit-master-default-axes.mts
 *   npx tsx scripts/audit-master-default-axes.mts --csv
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { choicesOf } from '../lib/domain/vehicle-defaults';
import { defaultVariant } from '../lib/domain/vehicle-master-variant';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

const master = (JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')).entries || []) as MasterEntry[];
const S = (v: unknown) => String(v ?? '').trim();
const csv = process.argv.includes('--csv');

type Row = {
  maker: string;
  model: string;
  sub: string;
  years: string;
  seatAxis: string;
  driveAxis: string;
  dispAxis: string;
  defFuel: string;
  defDisp: string;
  defSeat: string;
  defDrive: string;
  source: 'default' | 'none';
};

const rows: Row[] = [];
for (const e of master) {
  const vs = e.variants || [];
  if (!vs.length) continue;
  const seats = [...new Set(vs.map((v) => v.seat).filter((s): s is number => s != null && s > 0))].sort((a, b) => a - b);
  const drives = [...new Set(vs.map((v) => S(v.drivetrain)).filter(Boolean))];
  const disps = [...new Set(vs.map((v) => v.displacement_l).filter((d): d is number => d != null && d > 0))].sort((a, b) => a - b);
  const seatAxis = seats.length >= 2;
  const driveAxis = drives.length >= 2;
  const dispAxis = disps.length >= 2;
  // 인승·구동·배기 중 하나라도 «고를 축»이 있는 세대만
  if (!seatAxis && !driveAxis && !dispAxis) continue;

  const d = defaultVariant(e);
  rows.push({
    maker: e.maker,
    model: e.model,
    sub: e.sub_model,
    years: `${e.year_start || '?'}-${e.year_end || '?'}`,
    seatAxis: seatAxis ? seats.join('/') : '-',
    driveAxis: driveAxis ? drives.join('/') : '-',
    dispAxis: dispAxis ? disps.join('/') : '-',
    defFuel: d ? S(d.fuel) : '',
    defDisp: d?.displacement_l != null ? String(d.displacement_l) : '',
    defSeat: d?.seat != null ? String(d.seat) : '',
    defDrive: d ? S(d.drivetrain) || '' : '',
    source: d ? 'default' : 'none',
  });
}

rows.sort((a, b) => a.maker.localeCompare(b.maker, 'ko') || a.model.localeCompare(b.model, 'ko') || a.sub.localeCompare(b.sub, 'ko'));

const noDef = rows.filter((r) => r.source === 'none');
console.log(`\n══ 인승/구동/배기 축 있는 세부모델 ${rows.length} ══`);
console.log(`  default 있음 ${rows.length - noDef.length} · 없음 ${noDef.length}\n`);

let prev = '';
for (const r of rows) {
  const head = `${r.maker} · ${r.model}`;
  if (head !== prev) {
    console.log(`\n■ ${head}`);
    prev = head;
  }
  const def = r.source === 'none'
    ? '(기본 없음)'
    : [r.defFuel, r.defDisp && `${r.defDisp}L`, r.defSeat && `${r.defSeat}인`, r.defDrive || null].filter(Boolean).join(' · ');
  console.log(
    `  ${r.sub.padEnd(28)} ${r.years.padEnd(12)} 인승[${r.seatAxis.padEnd(8)}] 구동[${r.driveAxis.padEnd(8)}] 배기[${r.dispAxis.padEnd(12)}] → ${def}`,
  );
}

if (csv || true) {
  const lines = [
    'maker,model,sub_model,years,seats,drives,displacements,def_fuel,def_disp,def_seat,def_drive',
    ...rows.map((r) =>
      [r.maker, r.model, r.sub, r.years, r.seatAxis, r.driveAxis, r.dispAxis, r.defFuel, r.defDisp, r.defSeat, r.defDrive]
        .map((x) => `"${String(x).replace(/"/g, '""')}"`)
        .join(','),
    ),
  ];
  writeFileSync('tmp/master-default-axes.csv', `\uFEFF${lines.join('\n')}\n`, 'utf8');
}

// 요약 JSON (콘솔 인코딩 이슈 회피)
const seatSummary: Record<string, string[]> = {};
for (const r of rows) {
  if (r.seatAxis === '-') continue;
  const list = seatSummary[r.model] || (seatSummary[r.model] = []);
  list.push(`${r.sub}|축=${r.seatAxis}|기본=${r.defSeat || '-'}인|${r.defFuel} ${r.defDisp}L ${r.defDrive}`);
}
const driveSummary: Record<string, { n: number; twowd: number; four: number; none: number }> = {};
for (const r of rows) {
  if (r.driveAxis === '-') continue;
  const cur = driveSummary[r.model] || { n: 0, twowd: 0, four: 0, none: 0 };
  cur.n++;
  if (r.defDrive === '2WD') cur.twowd++;
  else if (r.defDrive === '4WD' || r.defDrive === 'AWD') cur.four++;
  else cur.none++;
  driveSummary[r.model] = cur;
}
writeFileSync(
  'tmp/master-default-axes-summary.json',
  JSON.stringify({
    total: rows.length,
    withDefault: rows.length - noDef.length,
    withoutDefault: noDef.length,
    withoutDefaultSamples: noDef.slice(0, 40).map((r) => `${r.maker} ${r.sub} seats=${r.seatAxis} drive=${r.driveAxis} disp=${r.dispAxis}`),
    seatSummary,
    driveSummary,
  }, null, 2),
  'utf8',
);
console.log(`wrote tmp/master-default-axes.csv · tmp/master-default-axes-summary.json (${rows.length} rows)`);