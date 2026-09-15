import {
  compactPlate,
  explicitDeposit,
  explicitMoney,
  explicitNumber,
  policyCodeFromRow,
  text,
  withProvenance,
  type AdapterResult,
  type AtomSource,
  type FieldProvenance,
  type FreepassAtom,
  type RawSupplierRow,
  type RentTerm,
  type RentVariant,
  type SupplierAdapter,
} from '../domain/supplier-adapter';

const VERSION = '1.0.0';

const STANDARD_TERMS: readonly RentTerm[] = [1, 6, 12, 24, 36, 48, 60];

function pick(raw: RawSupplierRow, ...headers: string[]): { header: string; value: unknown } {
  for (const header of headers) {
    const value = raw[header];
    if (text(value)) return { header, value };
  }
  return { header: headers[0] || '', value: undefined };
}

function preferOurs(raw: RawSupplierRow, ours: string, ...sourceHeaders: string[]): { header: string; value: unknown } {
  const refined = pick(raw, ours);
  if (text(refined.value)) return refined;
  return pick(raw, ...sourceHeaders);
}

function isStandardTerm(months: number): months is RentTerm {
  return (STANDARD_TERMS as readonly number[]).includes(months);
}

/**
 * 제공시트·정제시트 표준 열 어댑터.
 *
 * ERP4 시트 규칙과 같다: 기본은 우리 양식(`TEMPLATE_COLUMNS` + 정제칸). 헤더 이름이
 * 흔들려도 별칭만 허용하고, 비슷한 돈 칸·없는 기간은 추정하지 않는다.
 * 왼쪽 = 공급사 원문, 오른쪽 정제칸 = 우리 활용 원자. 정제칸에 값이 있으면 그걸 쓴다.
 */
export class ProvidedSheetAdapter implements SupplierAdapter {
  readonly sourceCode = 'PROVIDED';
  readonly adapterName = 'ProvidedSheetAdapter';
  readonly version = VERSION;

  adapt(raw: RawSupplierRow, source: Partial<AtomSource> = {}): AdapterResult {
    const provenance: FieldProvenance = {};
    const issues: AdapterResult['issues'] = [];

    const plate = pick(raw, '차량번호', '차번');
    const vin = pick(raw, '차대번호', 'VIN');
    const maker = preferOurs(raw, '제조사(정제)', '제조사', '메이커', '브랜드');
    const model = preferOurs(raw, '모델', '모델명');
    const subModel = pick(raw, '세부모델');
    const trim = pick(raw, '세부트림', '트림');
    const rawName = pick(raw, '차명(세부모델+트림)', '차명(원문)', '차명', '차량명');
    const status = pick(raw, '상태', '배차상태', '판매상태', '출고상태', '출고현황');
    const productType = pick(raw, '분류', '상품구분', '구분');
    const year = pick(raw, '연식', '년식', '차량연식');
    const km = pick(raw, '주행거리', 'Km', 'KM');
    const fuel = preferOurs(raw, '연료(정제)', '연료');
    const displacement = preferOurs(raw, '배기량(정제)', '배기량');

    const rent: Partial<Record<RentTerm, number>> = {};
    const rentVariants: RentVariant[] = [];
    const claimedHeaders = new Set<string>();

    for (const term of STANDARD_TERMS) {
      const header = `${term}개월`;
      const amount = explicitMoney(raw[header]);
      if (amount === undefined) continue;
      rent[term] = amount;
      claimedHeaders.add(header);
      withProvenance(provenance, `rent.${term}`, header, raw[header], '숫자 외 문자 제거 후 금액 변환');
    }

    for (const header of Object.keys(raw)) {
      if (claimedHeaders.has(header)) continue;
      const compact = header.replace(/\s+/g, '');
      const variant = /^(\d+)개월(\d+)만$/.exec(compact);
      const extraTerm = /^(\d+)개월$/.exec(compact);
      const amount = explicitMoney(raw[header]);
      if (amount === undefined) continue;
      if (variant) {
        const termMonths = Number(variant[1]);
        const annualKm = Number(variant[2]) * 10_000;
        rentVariants.push({ termMonths, annualKm, amount, sourceHeader: header });
        withProvenance(
          provenance,
          `rentVariants.${header}`,
          header,
          raw[header],
          `기간 ${termMonths}개월 · 연 ${annualKm.toLocaleString('ko-KR')}km`,
        );
        continue;
      }
      if (extraTerm && header === `${extraTerm[1]}개월`) {
        const termMonths = Number(extraTerm[1]);
        if (isStandardTerm(termMonths)) continue;
        rentVariants.push({ termMonths, amount, sourceHeader: header });
        withProvenance(provenance, `rentVariants.${header}`, header, raw[header], '숫자 외 문자 제거 후 금액 변환');
      }
    }

    const atom: FreepassAtom = {
      source: {
        supplierCode: source.supplierCode || this.sourceCode,
        supplierName: source.supplierName,
        spreadsheetId: source.spreadsheetId,
        tab: source.tab,
        row: source.row,
        adapter: this.adapterName,
        adapterVersion: this.version,
      },
      plateNumber: compactPlate(plate.value) || undefined,
      vin: text(vin.value).replace(/\s+/g, '') || undefined,
      status: text(status.value) || undefined,
      productType: text(productType.value) || undefined,
      maker: text(maker.value) || undefined,
      model: text(model.value) || undefined,
      subModel: text(subModel.value) || undefined,
      trim: text(trim.value) || undefined,
      rawName: text(rawName.value) || undefined,
      year: text(year.value) || undefined,
      km: explicitNumber(km.value),
      fuel: text(fuel.value) || undefined,
      displacement: explicitNumber(displacement.value),
      shortDeposit: explicitDeposit(raw['단기보증']),
      longDeposit: explicitDeposit(raw['장기보증']),
      policyCode: policyCodeFromRow(raw, provenance),
      rent,
      ...(rentVariants.length ? { rentVariants } : {}),
      provenance,
    };

    const provenancePairs: Array<[string, { header: string; value: unknown }, string?]> = [
      ['plateNumber', plate, '공백 제거'], ['vin', vin, '공백 제거'], ['maker', maker], ['model', model],
      ['subModel', subModel], ['trim', trim], ['rawName', rawName], ['status', status], ['productType', productType],
      ['year', year], ['km', km, '숫자 변환'], ['fuel', fuel], ['displacement', displacement, '숫자 변환'],
    ];
    for (const [field, src, transform] of provenancePairs) {
      withProvenance(provenance, field, src.header, src.value, transform);
    }
    withProvenance(provenance, 'shortDeposit', '단기보증', raw['단기보증'], '빈칸=미입력 · 무보증/0=0원');
    withProvenance(provenance, 'longDeposit', '장기보증', raw['장기보증'], '빈칸=미입력 · 무보증/0=0원');

    if (!atom.plateNumber && !atom.vin) {
      issues.push({ level: 'error', code: 'NO_IDENTITY', message: '차량번호와 차대번호가 모두 없습니다.' });
    }
    if (!atom.model && !atom.rawName) {
      issues.push({ level: 'warning', code: 'NO_MODEL', message: '모델/차명이 없어 판매 노출 대상이 될 수 없습니다.', field: 'model' });
    }
    const hasRent = Object.values(atom.rent).some((v) => typeof v === 'number' && v > 0)
      || (atom.rentVariants?.some((v) => v.amount > 0) ?? false);
    if (!hasRent) {
      issues.push({ level: 'warning', code: 'NO_RENT', message: '판매 가능한 기간 대여료가 하나도 없습니다.', field: 'rent' });
    }

    return { atom, issues };
  }
}

export const providedSheetAdapter = new ProvidedSheetAdapter();
