/**
 * Cached 상품마스터의 blocked 차종키 참조를 신규 영구키와 대조한다. 읽기 전용.
 *
 * 입력에는 차량번호가 있으므로 결과는 커밋 대상이 아닌 tmp/ 아래에만 쓴다.
 * Sheet/registry/RTDB write 없음. 기존 영구키 의미 변경 없음.
 *
 * 실행: npx tsx scripts/audit-blocked-product-key-replacements.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { VehicleTrimMasterArtifact, VehicleTrimMasterRecord } from '../lib/domain/vehicle-trim-master';

type CoverageRow = {
  row: number; car_number: string; provider: string; current_code: string;
  current_tier: string; supplier_vehicle_name: string;
};
type Coverage = { generated_at: string; rows: CoverageRow[] };
const S = (value: unknown) => String(value ?? '').trim();
const compact = (value: unknown) => S(value).replace(/[\s·._()\[\]/-]+/g, '').toLowerCase();
const arg = (name: string, fallback: string) =>
  (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const inputPath = resolve(arg('input', 'tmp/product-master-vehicle-coverage.json'));
const outputPath = resolve(arg('out', 'tmp/blocked-product-key-replacements.json'));

const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as VehicleTrimMasterArtifact;
const coverage = JSON.parse(readFileSync(inputPath, 'utf8')) as Coverage;
const byKey = new Map(artifact.records.map((record) => [record.trim_row_key, record]));

const dateSignalsFrom = (raw: string) => {
  const registrationMatch = raw.match(/최초등록\s*(?:일)?\s*[:·]?\s*(20\d{2}|\d{2})(?:년|[.\-/])?\s*(\d{1,2})?/i);
  const registration = registrationMatch?.[1];
  const stated = raw.match(/연식\s*[:·]?\s*(20\d{2}|\d{2})(?=[년.\-/\s]|$)/i)?.[1]
    || raw.match(/\b(20\d{2}|\d{2})\s*MY\b/i)?.[1];
  const expand = (value?: string) => value ? (value.length === 2 ? 2000 + Number(value) : Number(value)) : undefined;
  const registered = expand(registration);
  const modelYear = expand(stated);
  const year = registered && modelYear && Math.abs(registered - modelYear) > 2 ? registered : (modelYear || registered);
  const month = registered && Number(registrationMatch?.[2]);
  return { year, registered_ym: registered && month >= 1 && month <= 12
    ? `${registered}-${String(month).padStart(2, '0')}` : undefined };
};
const rangeHasDate = (record: VehicleTrimMasterRecord, date: { year?: number; registered_ym?: string }) => {
  if (!date.year) return false;
  if (date.registered_ym) {
    const start = /^\d{4}-\d{2}$/.test(S(record.production_start)) ? record.production_start : `${date.year}-01`;
    const end = record.production_end === '현재' ? '9999-12'
      : (/^\d{4}-\d{2}$/.test(S(record.production_end)) ? record.production_end : `${date.year}-12`);
    return date.registered_ym >= start && date.registered_ym <= end;
  }
  const start = Number(S(record.production_start).slice(0, 4));
  const end = record.production_end === '현재' ? 9999 : Number(S(record.production_end).slice(0, 4));
  return Number.isFinite(start) && Number.isFinite(end) && date.year >= start && date.year <= end;
};
const fuelFrom = (raw: string) => {
  if (/전기|\bev\b/i.test(raw)) return '전기';
  if (/수소/i.test(raw)) return '수소';
  if (/하이브리드|\bhev\b/i.test(raw)) return '하이브리드';
  if (/lpg|lpi|lpe/i.test(raw)) return 'LPG';
  if (/디젤|경유/i.test(raw)) return '디젤';
  if (/가솔린|휘발유|\bgsl\b/i.test(raw)) return '가솔린';
  return '';
};
const ccFrom = (raw: string) => {
  const value = raw.match(/배기(?:량)?\s*[:·]?\s*([\d,]+)/i)?.[1];
  return value ? Number(value.replace(/,/g, '')) : undefined;
};
const driveFrom = (raw: string) => {
  if (/\b(?:awd|4wd)\b/i.test(raw)) return 'AWD';
  if (/\brwd\b/i.test(raw)) return 'RWD';
  if (/\b(?:2wd|fwd)\b/i.test(raw)) return '2WD';
  return '';
};
const seatsFrom = (raw: string) => Number(raw.match(/(\d{1,2})\s*인승/i)?.[1]) || undefined;
const ccMatches = (actual: number | null, stated?: number) => !stated || actual === stated
  || (!!actual && Math.abs(actual - stated) <= 5 && Math.round(actual / 100) === Math.round(stated / 100));
const trimMentioned = (record: VehicleTrimMasterRecord, raw: string) => {
  const haystack = compact(raw);
  const names = [record.trim, ...record.trim_aliases]
    .map(compact).filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length);
  return names.some((name) => haystack.includes(name));
};
const immutableSummary = (record: VehicleTrimMasterRecord) => ({
  key: record.trim_row_key, usage_tier: record.usage_tier,
  maker: record.maker, model: record.model, sub_model: record.sub_model,
  generation_name: record.generation_name, development_code: record.development_code,
  production_start: record.production_start, production_end: record.production_end,
  fuel: record.fuel, engine_cc: record.engine_cc, turbo: record.turbo,
  drivetrain: record.drivetrain, seats: record.seats,
  battery_kwh: record.battery_kwh, powertrain: record.powertrain, trim: record.trim,
});

const details = coverage.rows.filter((row) => row.current_tier === 'blocked').map((row) => {
  const old = byKey.get(row.current_code);
  if (!old) throw new Error(`coverage의 blocked key가 artifact에 없음: ${row.current_code}`);
  const raw = row.supplier_vehicle_name;
  const sourceDate = dateSignalsFrom(raw);
  const explicit = {
    ...sourceDate, fuel: fuelFrom(raw), engine_cc: ccFrom(raw),
    drivetrain: driveFrom(raw), seats: seatsFrom(raw),
  };
  const pool = artifact.records.filter((candidate) => candidate.usage_tier !== 'blocked'
    && candidate.maker === old.maker && candidate.model === old.model);
  const candidates = pool.filter((candidate) => rangeHasDate(candidate, explicit)
    && (!explicit.fuel || compact(candidate.fuel) === compact(explicit.fuel))
    && ccMatches(candidate.engine_cc, explicit.engine_cc)
    && (!explicit.drivetrain || compact(candidate.drivetrain).includes(compact(explicit.drivetrain)))
    && (!explicit.seats || candidate.seats === explicit.seats)
    && trimMentioned(candidate, raw));
  const automatic = candidates.filter((candidate) => candidate.usage_tier === 'automatic');
  const singlePreservedAxesMatch = automatic.length === 1
    && ccMatches(automatic[0].engine_cc, explicit.engine_cc ?? old.engine_cc ?? undefined)
    && compact(automatic[0].drivetrain).includes(compact(explicit.drivetrain || old.drivetrain))
    && automatic[0].seats === (explicit.seats ?? old.seats);
  let classification: '안전한 1:1 교체 후보' | '교체 불가' | '추가정보 필요';
  let reason: string;
  if (automatic.length === 1 && candidates.length === 1 && explicit.year && explicit.fuel && singlePreservedAxesMatch) {
    classification = '안전한 1:1 교체 후보';
    reason = '원문 연도·연료 및 명시된 불변축과 트림이 생산기간 내 단일 automatic 키에만 일치';
  } else if (!explicit.year || !explicit.fuel) {
    classification = '추가정보 필요';
    reason = !explicit.year ? '원문에서 신뢰 가능한 연도/최초등록을 확인할 수 없음'
      : '원문에서 연료를 확정할 수 없음';
  } else if (!candidates.length) {
    classification = '교체 불가';
    reason = '확인된 원문 불변축·트림·생산기간을 동시에 만족하는 비차단 키가 없음';
  } else {
    classification = '추가정보 필요';
    reason = `${candidates.length}개 후보가 남거나 automatic 단일성/원문 연료 조건이 충족되지 않음`;
  }
  const replacement = classification === '안전한 1:1 교체 후보' ? automatic[0] : undefined;
  return {
    row: row.row, car_number: row.car_number, provider: row.provider,
    supplier_vehicle_name: raw, current_blocked_key: old.trim_row_key,
    blocked_immutable: {
      maker: old.maker, model: old.model, sub_model: old.sub_model,
      production_start: old.production_start, production_end: old.production_end,
      fuel: old.fuel, engine_cc: old.engine_cc, drivetrain: old.drivetrain,
      seats: old.seats, powertrain: old.powertrain, trim: old.trim,
    },
    blocked_evidence_note: old.evidence_note,
    parsed_source_axes: explicit,
    classification, reason,
    replacement_key: replacement?.trim_row_key || null,
    replacement_immutable: replacement ? immutableSummary(replacement) : null,
    safe_axis_evidence: replacement ? {
      maker: { source: 'blocked assignment', value: old.maker, candidate: replacement.maker, match: old.maker === replacement.maker },
      model: { source: 'blocked assignment + supplier name', value: old.model, candidate: replacement.model, match: old.model === replacement.model },
      generation_and_period: {
        source: explicit.registered_ym ? 'supplier first registration YYYY-MM' : 'supplier year',
        value: explicit.registered_ym || explicit.year, candidate_generation: replacement.generation_name,
        candidate_sub_model: replacement.sub_model, production_start: replacement.production_start,
        production_end: replacement.production_end, match: rangeHasDate(replacement, explicit),
      },
      fuel: { source: 'supplier name', value: explicit.fuel, candidate: replacement.fuel, match: compact(explicit.fuel) === compact(replacement.fuel) },
      engine_cc: { source: explicit.engine_cc ? 'supplier name' : 'preserved blocked assignment', value: explicit.engine_cc ?? old.engine_cc, candidate: replacement.engine_cc, match: ccMatches(replacement.engine_cc, explicit.engine_cc ?? old.engine_cc ?? undefined) },
      drivetrain: { source: explicit.drivetrain ? 'supplier name' : 'preserved blocked assignment', value: explicit.drivetrain || old.drivetrain, candidate: replacement.drivetrain, match: compact(replacement.drivetrain).includes(compact(explicit.drivetrain || old.drivetrain)) },
      seats: { source: explicit.seats ? 'supplier name' : 'preserved blocked assignment', value: explicit.seats ?? old.seats, candidate: replacement.seats, match: replacement.seats === (explicit.seats ?? old.seats) },
      trim: { source: 'supplier name', value: raw, candidate: replacement.trim, match: trimMentioned(replacement, raw) },
    } : null,
    candidate_keys: candidates.map((candidate) => candidate.trim_row_key),
  };
});

const counts = Object.fromEntries([...details.reduce((map, row) => {
  map.set(row.classification, (map.get(row.classification) || 0) + 1);
  return map;
}, new Map<string, number>())]);
const report = {
  generated_at: new Date().toISOString(), input: inputPath,
  policy: '원문 등록연월/연도·연료 필수, 명시축과 미명시 preserved blocked assignment 축 완전일치, 생산기간 월 경계 포함, 트림명 일치, 단일 automatic 후보만 안전 교체',
  counts, blocked_reference_rows: details.length, details,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ counts, blocked_reference_rows: details.length, output: outputPath }, null, 2));
if (details.length !== 119) throw new Error(`예상 blocked 참조 119대와 다름: ${details.length}`);
