/**
 * Row-level ERP vehicle master generated from the Google Sheet SSOT.
 *
 * Unlike the legacy grouped vehicle-master.json, every record retains the
 * permanent trim_row_key and exact specification axes needed to identify one
 * selectable vehicle trim.
 */

const S = (value: unknown) => String(value ?? '').trim();
const numberOrNull = (value: unknown): number | null => {
  const normalized = S(value).replace(/,/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
const aliases = (value: unknown) => [...new Set(S(value).split(/[|,;]/).map(S).filter(Boolean))];

export const MASTER_MANAGEMENT_STATUSES = ['보강대기', '검증중', '확정', '제외'] as const;
export const MASTER_VERIFICATION_STATUSES = ['미검증', '1차확인', '교차확인', '확정'] as const;

export type MasterManagementStatus = typeof MASTER_MANAGEMENT_STATUSES[number];
export type MasterVerificationStatus = typeof MASTER_VERIFICATION_STATUSES[number];
export type VehicleTrimUsageTier = 'blocked' | 'manual' | 'automatic';

export type VehicleTrimMasterRecord = {
  trim_row_key: string;
  master_id: string;
  powertrain_seq: number;
  trim_seq: number;
  management_status: MasterManagementStatus;
  verification_status: MasterVerificationStatus;
  usage_tier: VehicleTrimUsageTier;
  market_status: '신차' | '중고차' | '';
  origin: string;
  maker: string;
  model: string;
  sub_model: string;
  powertrain: string;
  trim: string;
  generation_name: string;
  development_code: string;
  production_start: string;
  production_end: string;
  model_year_start: string;
  model_year_end: string;
  fuel: string;
  engine_cc: number | null;
  displacement_l: number | null;
  turbo: boolean | null;
  drivetrain: string;
  seats: number | null;
  battery_kwh: number | null;
  trim_aliases: string[];
  evidence_url: string;
  evidence_note: string;
  data_as_of: string;
};

export type VehicleTrimMasterArtifact = {
  schema_version: 1;
  source: {
    spreadsheet_id: string;
    sheet_name: string;
    range: 'A:AD';
  };
  data_as_of: string;
  row_count: number;
  manual_assignable_count: number;
  automatic_assignable_count: number;
  blocked_count: number;
  records: VehicleTrimMasterRecord[];
};

export const vehicleTrimUsageTier = (
  management: MasterManagementStatus,
  verification: MasterVerificationStatus,
): VehicleTrimUsageTier => {
  if (management === '확정' && verification === '확정') return 'automatic';
  if (management === '검증중' && (verification === '1차확인' || verification === '교차확인')) return 'manual';
  return 'blocked';
};

export function buildVehicleTrimMasterArtifact(
  values: unknown[][],
  spreadsheetId: string,
  sheetName: string,
): VehicleTrimMasterArtifact {
  if (!values.length) throw new Error('차종마스터 값이 비어 있습니다.');
  const header = (values[0] || []).map(S);
  const at = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`차종마스터 필수 열을 찾지 못했습니다: ${name}`);
    return index;
  };
  const c = {
    management: at('관리상태'), verification: at('검증상태'), market: at('신차/중고차'), origin: at('원산지'),
    maker: at('제조사'), model: at('모델'), subModel: at('세부모델'), powertrain: at('파워트레인'), trim: at('세부트림'),
    code: at('트림행키'), masterId: at('마스터ID'), powertrainSeq: at('파워트레인순번'), trimSeq: at('트림순번'),
    generation: at('세대명'), development: at('개발코드'), productionStart: at('생산시작'), productionEnd: at('생산종료'),
    yearStart: at('연식시작'), yearEnd: at('연식종료'), fuel: at('연료'), cc: at('정확배기량(cc)'),
    displacement: at('표시배기량(L)'), turbo: at('터보'), drivetrain: at('구동방식'), seats: at('인승'),
    battery: at('배터리(kWh)'), trimAliases: at('트림별칭'), evidenceUrl: at('근거URL'), evidenceNote: at('근거메모'),
    dataAsOf: at('데이터기준일'),
  };

  const records: VehicleTrimMasterRecord[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex] || [];
    const code = S(row[c.code]);
    if (!code) continue;
    if (seen.has(code)) errors.push(`행 ${rowIndex + 1}: 중복 트림행키 ${code}`);
    seen.add(code);
    const management = S(row[c.management]) as MasterManagementStatus;
    const verification = S(row[c.verification]) as MasterVerificationStatus;
    if (!(MASTER_MANAGEMENT_STATUSES as readonly string[]).includes(management)) errors.push(`행 ${rowIndex + 1}: 허용되지 않은 관리상태 ${management}`);
    if (!(MASTER_VERIFICATION_STATUSES as readonly string[]).includes(verification)) errors.push(`행 ${rowIndex + 1}: 허용되지 않은 검증상태 ${verification}`);
    const powertrainSeq = numberOrNull(row[c.powertrainSeq]);
    const trimSeq = numberOrNull(row[c.trimSeq]);
    if (!powertrainSeq || !trimSeq) errors.push(`행 ${rowIndex + 1}: 순번 누락 ${code}`);
    records.push({
      trim_row_key: code,
      master_id: S(row[c.masterId]),
      powertrain_seq: powertrainSeq || 0,
      trim_seq: trimSeq || 0,
      management_status: management,
      verification_status: verification,
      usage_tier: vehicleTrimUsageTier(management, verification),
      market_status: S(row[c.market]) as VehicleTrimMasterRecord['market_status'],
      origin: S(row[c.origin]),
      maker: S(row[c.maker]),
      model: S(row[c.model]),
      sub_model: S(row[c.subModel]),
      powertrain: S(row[c.powertrain]),
      trim: S(row[c.trim]),
      generation_name: S(row[c.generation]),
      development_code: S(row[c.development]),
      production_start: S(row[c.productionStart]),
      production_end: S(row[c.productionEnd]),
      model_year_start: S(row[c.yearStart]),
      model_year_end: S(row[c.yearEnd]),
      fuel: S(row[c.fuel]),
      engine_cc: numberOrNull(row[c.cc]),
      displacement_l: numberOrNull(row[c.displacement]),
      turbo: S(row[c.turbo]) === '예' ? true : S(row[c.turbo]) === '아니오' ? false : null,
      drivetrain: S(row[c.drivetrain]),
      seats: numberOrNull(row[c.seats]),
      battery_kwh: numberOrNull(row[c.battery]),
      trim_aliases: aliases(row[c.trimAliases]),
      evidence_url: S(row[c.evidenceUrl]),
      evidence_note: S(row[c.evidenceNote]),
      data_as_of: S(row[c.dataAsOf]),
    });
  }
  if (errors.length) throw new Error(`차종마스터 생성 차단 (${errors.length}건)\n${errors.slice(0, 30).join('\n')}`);

  records.sort((a, b) => a.trim_row_key.localeCompare(b.trim_row_key));
  const dataAsOf = records.map((record) => record.data_as_of).filter(Boolean).sort().at(-1) || '';
  const manual = records.filter((record) => record.usage_tier === 'manual').length;
  const automatic = records.filter((record) => record.usage_tier === 'automatic').length;
  return {
    schema_version: 1,
    source: { spreadsheet_id: spreadsheetId, sheet_name: sheetName, range: 'A:AD' },
    data_as_of: dataAsOf,
    row_count: records.length,
    manual_assignable_count: manual,
    automatic_assignable_count: automatic,
    blocked_count: records.length - manual - automatic,
    records,
  };
}

