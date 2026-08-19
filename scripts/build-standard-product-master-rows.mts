import { readFileSync, writeFileSync } from 'node:fs';
import { importSheetTable } from '../lib/domain/sheet-import';
import {
  productMasterSourceRowInfo,
  productMasterSupplierVehicleName,
} from '../lib/domain/product-master-sheet';

type Rec = Record<string, unknown>;
type TrimRecord = {
  trim_row_key: string;
  management_status: string;
  verification_status: string;
  usage_tier: string;
  maker: string;
  sub_model: string;
  powertrain: string;
  trim: string;
  fuel?: string;
  displacement_l?: number | null;
  turbo?: boolean | null;
  drivetrain?: string | null;
  seats?: number | null;
  trim_aliases?: string[];
};

const arg = (name: string, fallback = '') => {
  const prefix = `--${name}=`;
  return (process.argv.find((value) => value.startsWith(prefix)) || '').slice(prefix.length) || fallback;
};
const input = arg('input');
const output = arg('out', 'tmp/standard-product-master-rows.json');
const providerCode = arg('code');
const providerName = arg('name');
const policyCode = arg('policy', '(프리패스 기본)');
const sourceLabel = arg('source-label', '공급사 제공시트 → 프리패스 상품마스터');
if (!input || !providerCode || !providerName) throw new Error('--input, --code, --name 필수');

const snapshot = JSON.parse(readFileSync(input, 'utf8')) as { values?: unknown[][]; linksByPlate?: Record<string, string> };
const table = (snapshot.values || []).map((row) => row.map((value) => String(value ?? '')));
if (table.length < 2) throw new Error('원본 표가 비었습니다.');
const master = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: Rec[] } | Rec[];
const trimArtifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records?: TrimRecord[] };
const records = trimArtifact.records || [];
const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const compact = (value: unknown) => clean(value).replace(/\s+/g, '').toLowerCase();
const plate = (value: unknown) => clean(value).replace(/\s/g, '');
const header = table[0].map(clean);
const index = (name: string) => header.findIndex((value) => compact(value) === compact(name));
const statusIndex = index('배차상태');
const plateIndex = index('차량번호');
if (statusIndex < 0 || plateIndex < 0) throw new Error('배차상태/차량번호 헤더가 없습니다.');

// importSheetTable의 동일 파서·스냅을 쓰되, 출고불가 행도 상품마스터 이력으로 보존하기 위해
// 미리보기 복제본에서만 상태를 출고가능으로 바꾼다. 원본 상태는 아래에서 다시 넣는다.
const previewTable = table.map((row, rowIndex) => {
  if (!rowIndex) return [...row];
  const copy = [...row];
  if (plate(copy[plateIndex])) copy[statusIndex] = '출고가능';
  return copy;
});
const imported = importSheetTable(previewTable, {
  providerCode,
  entries: (Array.isArray(master) ? master : master.entries || []) as never,
  acceptAssignedPendingPlate: true,
});
const productByPlate = new Map(imported.products.map((product) => [plate(product.car_number), product as Rec]));

function fuelSignal(value: unknown): string {
  const source = compact(value);
  if (/전기|ev/.test(source)) return '전기';
  if (/하이브리드|hev|e-tech/.test(source)) return '하이브리드';
  if (/lpg|lpi/.test(source)) return 'lpg';
  if (/디젤|경유/.test(source)) return '디젤';
  if (/가솔린|휘발유/.test(source)) return '가솔린';
  return '';
}

function displacementSignal(value: unknown): number | null {
  const match = compact(value).match(/(?:^|[^\d])(\d(?:\.\d))(?=t|가솔린|디젤|lpg|lpi|하이브리드|$)/);
  return match ? Number(match[1]) : null;
}

function exactMaster(product: Rec): { row: TrimRecord | null; reason: string } {
  let candidates = records.filter((row) => (
    compact(row.maker) === compact(product.maker)
    && compact(row.sub_model) === compact(product.sub_model)
  ));
  if (!candidates.length) return { row: null, reason: '차종코드 미매칭' };
  const source = [product.variant, product.fuel_type, product.trim_name].map(clean).join(' ');
  const fuel = fuelSignal(source);
  const displacement = displacementSignal(source);
  const drive = /4wd|awd|4matic|콰트로/i.test(source) ? '4WD' : /2wd/i.test(source) ? '2WD' : '';
  const seats = Number(source.match(/(\d+)\s*인승/)?.[1] || 0);
  const trim = clean(product.trim_name);
  if (fuel) candidates = candidates.filter((row) => fuelSignal(row.fuel || row.powertrain) === fuel);
  if (displacement != null) candidates = candidates.filter((row) => Math.abs(Number(row.displacement_l || 0) - displacement) < 0.05);
  if (/\d(?:\.\d)?\s*t(?:\b|가솔린)|터보/i.test(source)) candidates = candidates.filter((row) => Boolean(row.turbo));
  if (drive) candidates = candidates.filter((row) => !row.drivetrain || compact(row.drivetrain) === compact(drive));
  if (seats) candidates = candidates.filter((row) => !row.seats || Number(row.seats) === seats);
  if (trim) candidates = candidates.filter((row) => (
    compact(row.trim) === compact(trim)
    || (row.trim_aliases || []).some((alias) => compact(alias) === compact(trim))
  ));
  const unique = [...new Map(candidates.map((row) => [row.trim_row_key, row])).values()];
  if (unique.length !== 1) return { row: null, reason: unique.length ? `차종 후보 ${unique.length}개` : '차종코드 미매칭' };
  return { row: unique[0], reason: '' };
}

const periods = [1, 6, 12, 18, 24, 36, 48, 60, 72, 84];
const sourceRows = table.slice(1).filter((row) => /^\d{2,3}[가-힣]\d{4}$/.test(plate(row[plateIndex])));
const outputRows = sourceRows.map((sourceRow) => {
  const key = plate(sourceRow[plateIndex]);
  const product = productByPlate.get(key);
  if (!product) throw new Error(`파서가 차량을 만들지 못했습니다: ${key}`);
  const match = exactMaster(product);
  const confirmed = Boolean(match.row
    && match.row.management_status === '확정'
    && match.row.verification_status === '확정'
    && match.row.usage_tier === 'automatic');
  const verification = confirmed ? '확정' : match.row ? '검수필요' : '미매칭';
  const price = product.price && typeof product.price === 'object' ? product.price as Record<string, { rent?: number; deposit?: number }> : {};
  const priceCells = periods.flatMap((period) => {
    const term = price[String(period)];
    return term?.rent ? [Number(term.rent), Number(term.deposit || 0) || ''] : ['', ''];
  });
  const productType = /신차/.test(clean(sourceRow[index('구분')])) ? '신차렌트'
    : /구독/.test(clean(sourceRow[index('구분')])) ? '구독' : '중고렌트';
  const rawInfo = productMasterSourceRowInfo({
    tab: arg('tab', '시트1'),
    headers: header,
    row: sourceRow,
  });
  return [
    key,
    providerName,
    productMasterSupplierVehicleName(rawInfo),
    match.row ? [match.row.sub_model, match.row.powertrain, match.row.trim].map(clean).filter(Boolean).join(' · ') : '',
    verification,
    confirmed ? '' : match.reason || '차종마스터 검수 필요',
    clean(sourceRow[index('옵션')]),
    clean(sourceRow[statusIndex]) || '출고협의',
    productType,
    confirmed ? '운영' : '검수필요',
    clean(snapshot.linksByPlate?.[key]),
    '',
    ...priceCells,
    ...Array(12).fill(''),
    policyCode,
    match.row?.trim_row_key || '',
    providerCode,
    '2026-08-15',
    sourceLabel,
    rawInfo,
  ];
});
if (outputRows.some((row) => row.length !== 50)) throw new Error('상품마스터 행 너비 오류');
const result = {
  counts: {
    source: sourceRows.length,
    confirmed: outputRows.filter((row) => row[4] === '확정').length,
    review: outputRows.filter((row) => row[4] === '검수필요').length,
    unmatched: outputRows.filter((row) => row[4] === '미매칭').length,
    noPrice: outputRows.filter((row) => !periods.some((_, i) => Number(row[12 + i * 2]) > 0)).length,
    noPhoto: outputRows.filter((row) => !row[10]).length,
  },
  importPreview: {
    imported: imported.imported,
    duplicate: imported.duplicateCount,
    invalid: imported.invalidCount,
    snap: imported.snap,
  },
  rows: outputRows,
};
writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({ output, ...result.counts, importPreview: result.importPreview }, null, 2));
for (const row of outputRows.filter((value) => value[4] !== '확정')) {
  console.log(`${row[0]} · ${row[2]} · ${row[4]} · ${row[5]}`);
}
