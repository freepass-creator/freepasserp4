import type { VehicleTrimMasterRecord } from './vehicle-trim-master';

export type ProductCoverageEvidenceRow = {
  row: number;
  provider: string;
  category: string;
  candidate_keys: string[];
  signal_conflicts: string[];
  audit_axes: Record<string, unknown>;
  source_clues: Record<string, unknown>;
};

export const RAY_2027_OFFICIAL_SOURCE = {
  maker: '기아',
  model: 'The 2027 Ray',
  document_version: 'price_ray_202608',
  checked_at: '2026-08-16',
  url: 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_ray.pdf',
  note: '승용·1인승 밴·2인승 밴의 기본가와 선택품목 가격을 동일 공식표 안에서 교차대조',
} as const;

export const RAY_2027_OFFICIAL_PRICE_RULES = [
  {
    id: 'ray-2027-passenger-prestige-drivewise-navigation',
    trim: '프레스티지', options: ['드라이브와이즈', '내비게이션'], total: 18_950_000,
    target: 'mf-002.md-058.sm-tam-ray-gas-2027-korea__the-2027-ray::v01::t02',
    calculation: '18,150,000 + 300,000 + 500,000 = 18,950,000',
  },
  {
    id: 'ray-2027-passenger-prestige-navigation',
    trim: '프레스티지', options: ['내비게이션'], total: 18_650_000,
    target: 'mf-002.md-058.sm-tam-ray-gas-2027-korea__the-2027-ray::v01::t02',
    calculation: '18,150,000 + 500,000 = 18,650,000',
  },
  {
    id: 'ray-2027-passenger-trendy-comfort1-navigation',
    trim: '트렌디', options: ['컴포트1', '내비게이션'], total: 17_600_000,
    target: 'mf-002.md-058.sm-tam-ray-gas-2027-korea__the-2027-ray::v01::t01',
    calculation: '15,550,000 + 600,000 + 1,450,000 = 17,600,000',
  },
] as const;

const S = (value: unknown) => String(value ?? '').trim();
const compact = (value: unknown) => S(value).toLowerCase().replace(/[Ⅰⅰ]/g, '1').replace(/[^0-9a-z가-힣]+/g, '');
const price = (value: unknown) => Number(value) || 0;

export function normalizedRayOptionTokens(value: unknown): string[] {
  const normalized = S(value).replace(/[Ⅰⅰ]/g, '1').replace(/^\s*기본형\s*[-:]?\s*/i, '');
  return normalized.split(/[,/+·]/).map(compact).filter(Boolean).sort();
}

export function decideRayOfficialPriceEvidence(
  row: ProductCoverageEvidenceRow,
  trimByKey: ReadonlyMap<string, VehicleTrimMasterRecord>,
) {
  if (row.provider !== 'RP004' || row.category !== '다중 자동후보' || row.signal_conflicts.length) return null;
  if (S(row.audit_axes.registration_month) !== '2026-08') return null;
  const actualOptions = normalizedRayOptionTokens(row.source_clues.option);
  const matched = RAY_2027_OFFICIAL_PRICE_RULES.filter((rule) => (
    compact(row.source_clues.trim) === compact(rule.trim)
    && price(row.source_clues.vehicle_price) === rule.total
    && JSON.stringify(actualOptions) === JSON.stringify(rule.options.map(compact).sort())
  ));
  if (matched.length !== 1) return null;
  const rule = matched[0]!;
  if (!row.candidate_keys.includes(rule.target)) {
    throw new Error(`공식 가격 후보가 기존 후보집합에 없음 row ${row.row}`);
  }
  const target = trimByKey.get(rule.target);
  if (!target || target.usage_tier !== 'automatic' || target.management_status !== '확정'
    || target.verification_status !== '확정' || target.seats !== 5 || target.body_configuration !== '승용') {
    throw new Error(`공식 가격 대상키 계약 불일치: ${rule.target}`);
  }
  return { rule, target };
}
