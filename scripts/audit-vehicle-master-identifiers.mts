/** 차종마스터 식별력 감사: 누락은 보강 대기, 모순만 실패 처리한다. */
import { readFileSync } from 'node:fs';
import type { MasterEntry, MasterVariant } from '../lib/domain/vehicle-master-types';

const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const entries = Array.isArray(raw) ? raw : (raw.entries || []);
const ym = /^\d{4}-(0[1-9]|1[0-2])$/;
const year = (value: unknown) => Number(String(value || '').slice(0, 4)) || 0;
const isElectric = (variant: MasterVariant) => /전기|\bEV\b/i.test(`${variant.fuel} ${variant.label}`);
const inTenYearScope = (entry: MasterEntry) => (entry.year_end === '현재' ? 9999 : year(entry.year_end)) >= new Date().getFullYear() - 10;
const missing = {
  productionMonth: [] as string[], genCode: [] as string[], variants: [] as string[],
  exactCc: [] as string[], battery: [] as string[], drivetrain: [] as string[],
  seat: [] as string[], trims: [] as string[],
};
const contradictions: string[] = [];

for (const entry of entries.filter(inTenYearScope)) {
  const key = `${entry.maker} | ${entry.model} | ${entry.sub_model}`;
  if (!ym.test(entry.production_start || '') || !(entry.production_end === '현재' || ym.test(entry.production_end || ''))) missing.productionMonth.push(key);
  if (!String(entry.gen_code || '').trim()) missing.genCode.push(key);
  if (!(entry.variants || []).length) missing.variants.push(key);
  if (entry.production_start && entry.production_end && entry.production_end !== '현재' && entry.production_start > entry.production_end) contradictions.push(`${key}: production ${entry.production_start} > ${entry.production_end}`);
  for (const variant of entry.variants || []) {
    const vKey = `${key} | ${variant.label}`;
    if (isElectric(variant)) { if (!(Number(variant.battery_kwh) > 0)) missing.battery.push(vKey); }
    else if (!(Number(variant.engine_cc) > 0)) missing.exactCc.push(vKey);
    if (!String(variant.drivetrain || '').trim()) missing.drivetrain.push(vKey);
    if (!(Number(variant.seat) > 0)) missing.seat.push(vKey);
    if (!(variant.trims || []).length) missing.trims.push(vKey);
    if (variant.engine_cc != null && (!Number.isInteger(variant.engine_cc) || variant.engine_cc < 0 || variant.engine_cc > 10000)) contradictions.push(`${vKey}: invalid engine_cc=${variant.engine_cc}`);
  }
}

const counts = Object.fromEntries(Object.entries(missing).map(([key, values]) => [key, values.length]));
console.log(JSON.stringify({
  scope: '최근 10년 생산 가능 세부모델', entries: entries.filter(inTenYearScope).length,
  missing: counts,
  samples: Object.fromEntries(Object.entries(missing).map(([key, values]) => [key, values.slice(0, 12)])),
  contradictions,
  verdict: contradictions.length ? 'FAIL' : Object.values(counts).some(Boolean) ? 'NEEDS_ENRICHMENT' : 'PASS',
}, null, 2));
if (contradictions.length) process.exit(1);
