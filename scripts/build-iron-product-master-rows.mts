import { readFileSync, writeFileSync } from 'node:fs';
import { productMasterSourceRowInfo } from '../lib/domain/product-master-sheet';

type PriceTerm = { rent?: number; deposit?: number };
type Product = Record<string, unknown> & {
  car_number?: string;
  maker?: string;
  model?: string;
  sub_model?: string;
  variant?: string;
  trim_name?: string;
  fuel_type?: string;
  year?: string;
  mileage?: number;
  options?: string;
  vehicle_status?: string;
  product_type?: string;
  price?: Record<string, PriceTerm>;
  image_urls?: string[];
  _raw_vehicle?: Record<string, unknown>;
};

type AuditItem = {
  externalId: string;
  sourceUrl: string;
  sold: boolean;
  product: Product;
  policySnapshot?: Record<string, unknown>;
};

type TrimRecord = {
  trim_row_key: string;
  management_status: string;
  verification_status: string;
  usage_tier: string;
  maker: string;
  model: string;
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

const args = new Map(process.argv.slice(2).map((value, index, all) => (
  value.startsWith('--') ? [value, all[index + 1] && !all[index + 1].startsWith('--') ? all[index + 1] : ''] : ['', '']
)));
const input = args.get('--input') || 'tmp/iron-product-master-audit.json';
const output = args.get('--out') || 'tmp/iron-product-master-rows.json';
const compact = (value: unknown) => String(value ?? '').replace(/\s+/g, '').toLowerCase();
const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

const audit = JSON.parse(readFileSync(input, 'utf8')) as { revision: string; items: AuditItem[] };
const trimArtifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: TrimRecord[] };
const records = trimArtifact.records || [];

function fuelSignal(value: string): string {
  const source = compact(value);
  if (/전기|ev/.test(source)) return '전기';
  if (/하이브리드|hev/.test(source)) return '하이브리드';
  if (/lpg|lpi/.test(source)) return 'lpg';
  if (/디젤|경유/.test(source)) return '디젤';
  if (/가솔린|휘발유/.test(source)) return '가솔린';
  return '';
}

function displacementSignal(value: string): number | null {
  const match = compact(value).match(/(?:^|[^\d])(\d(?:\.\d))(?=t|가솔린|디젤|lpg|lpi|하이브리드|$)/);
  return match ? Number(match[1]) : null;
}

function sourceTrim(product: Product, candidates: TrimRecord[]): string {
  const given = text(product.trim_name);
  if (given) return given;
  const haystack = compact([
    product._raw_vehicle?.title,
    product._raw_vehicle?.subtitle,
    product.variant,
  ].join(' '));
  const found = [...new Set(candidates.map((row) => row.trim).filter((trim) => trim && haystack.includes(compact(trim))))];
  return found.length === 1 ? found[0] : '';
}

function masterMatch(product: Product): { row: TrimRecord | null; reason: string } {
  let candidates = records.filter((row) => (
    compact(row.maker) === compact(product.maker)
    && compact(row.sub_model) === compact(product.sub_model)
  ));
  if (!candidates.length) return { row: null, reason: '차종코드 미매칭' };

  const source = [product._raw_vehicle?.title, product._raw_vehicle?.subtitle, product.variant, product.fuel_type].map(text).join(' ');
  const fuel = fuelSignal(source);
  const displacement = displacementSignal(source);
  const drivetrain = /4wd|awd/i.test(source) ? '4WD' : /2wd/i.test(source) ? '2WD' : '';
  const seats = Number(source.match(/(\d+)\s*인승/)?.[1] || 0);
  const turbo = /\d(?:\.\d)?\s*t(?:\b|가솔린)|터보/i.test(source);
  const trim = sourceTrim(product, candidates);

  if (fuel) candidates = candidates.filter((row) => fuelSignal(row.fuel || row.powertrain) === fuel);
  if (displacement != null) candidates = candidates.filter((row) => Math.abs(Number(row.displacement_l || 0) - displacement) < 0.05);
  if (turbo) candidates = candidates.filter((row) => Boolean(row.turbo));
  if (drivetrain) candidates = candidates.filter((row) => !row.drivetrain || compact(row.drivetrain) === compact(drivetrain));
  if (seats) candidates = candidates.filter((row) => !row.seats || Number(row.seats) === seats);
  if (trim) candidates = candidates.filter((row) => (
    compact(row.trim) === compact(trim)
    || (row.trim_aliases || []).some((alias) => compact(alias) === compact(trim))
  ));

  const uniqueKeys = [...new Map(candidates.map((row) => [row.trim_row_key, row])).values()];
  if (uniqueKeys.length !== 1) {
    return { row: null, reason: uniqueKeys.length ? `차종 후보 ${uniqueKeys.length}개` : '차종코드 미매칭' };
  }
  return { row: uniqueKeys[0], reason: '' };
}

const periods = [1, 6, 12, 18, 24, 36, 48, 60, 72, 84];
const rows = audit.items.filter((item) => !item.sold).map((item) => {
  const product = item.product;
  const raw = product._raw_vehicle || {};
  const match = masterMatch(product);
  const isConfirmed = Boolean(match.row
    && match.row.management_status === '확정'
    && match.row.verification_status === '확정'
    && match.row.usage_tier === 'automatic');
  const verification = isConfirmed ? '확정' : match.row ? '검수필요' : '미매칭';
  const reason = isConfirmed ? '' : match.reason || '차종마스터 검수 필요';
  const sourceName = [raw.title, raw.variant || product.variant].map(text).filter(Boolean).join(' · ');
  const masterName = match.row
    ? [match.row.sub_model, match.row.powertrain, match.row.trim].map(text).filter(Boolean).join(' · ')
    : '';
  const price = product.price || {};
  const priceCells = periods.flatMap((period) => {
    const term = price[String(period)];
    return term?.rent ? [Number(term.rent), Number(term.deposit || 0) || ''] : ['', ''];
  });
  const priceSummary = Object.entries(price)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([period, term]) => (
      `${period}개월 대여료 ${Number(term.rent || 0).toLocaleString('ko-KR')}`
      + ` / 보증금 ${Number(term.deposit || 0).toLocaleString('ko-KR')}`
    ))
    .join(' · ');
  const policy = item.policySnapshot || {};
  const rawInfo = productMasterSourceRowInfo({
    tab: 'ironrentcar.com 상세',
    headers: [
      '원본종류', '차량번호', '외부ID', '상세URL', '판매상태', '차량구분',
      '공급사 제목', '상세 부제', '제조사', '모델', '세부모델', '파워트레인/변형',
      '세부트림', '연식', '연료', '외장', '내장', '옵션', '상품상태', '상품분류',
      '기간별 대여료/보증금', '가격원문(JSON)', '사진수', '사진링크 전체',
      '차종카탈로그ID', '파싱신뢰도', '웹원문(JSON)', '정책코드', '정책명',
      '운전자연령', '대인', '대물', '자손', '긴급출동', '자차', '연주행',
      '보증금/분납', '보험포함', '정책원문(JSON)',
    ],
    row: [
      '홈페이지 상세페이지', text(product.car_number), item.externalId, item.sourceUrl,
      item.sold ? '판매완료' : '활성', item.condition, text(raw.title), text(raw.subtitle),
      text(raw.maker) || text(product.maker), text(product.model), text(product.sub_model),
      text(raw.variant) || text(product.variant), text(raw.trim_name) || text(product.trim_name),
      text(product.year), text(product.fuel_type), text(product.ext_color), text(product.int_color),
      text(product.options), text(product.vehicle_status), text(product.product_type), priceSummary,
      JSON.stringify(price), Array.isArray(product.image_urls) ? product.image_urls.length : 0,
      Array.isArray(product.image_urls) ? product.image_urls.join(', ') : '', text(product.catalog_id),
      text(product._snap_confidence), JSON.stringify(raw), text(policy.policy_code),
      text(policy.policy_name), text(policy.basic_driver_age), text(policy.injury_compensation_limit),
      text(policy.property_compensation_limit), text(policy.self_body_accident),
      text(policy.annual_roadside_assistance), text(policy.own_damage_compensation),
      text(policy.annual_mileage), text(policy.deposit_installment), text(policy.insurance_included),
      JSON.stringify(policy),
    ],
  });
  return [
    text(product.car_number), '아이언', sourceName, masterName, verification, reason,
    text(product.options), text(product.vehicle_status) || '출고협의', text(product.product_type),
    isConfirmed ? '운영' : '검수필요', product.image_urls?.[0] || '', '',
    ...priceCells,
    ...Array(12).fill(''),
    text(item.policySnapshot?.policy_code) || 'RP006_WEB', match.row?.trim_row_key || '', 'RP006',
    '2026-08-15', 'ironrentcar.com 홈페이지 → 프리패스 상품마스터', rawInfo,
  ];
});

if (rows.some((row) => row.length !== 50)) throw new Error('상품마스터 행 너비가 50열이 아닙니다.');
const result = {
  revision: audit.revision,
  counts: {
    active: rows.length,
    confirmed: rows.filter((row) => row[4] === '확정').length,
    review: rows.filter((row) => row[4] === '검수필요').length,
    unmatched: rows.filter((row) => row[4] === '미매칭').length,
    nonStandardPeriod: rows.filter((row) => String(row[49]).includes('비표준기간:')).length,
  },
  rows,
};
writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({ output, revision: result.revision, ...result.counts }, null, 2));
for (const row of rows.filter((value) => value[4] !== '확정')) {
  console.log(`${row[0]} · ${row[2]} · ${row[4]} · ${row[5]}`);
}
