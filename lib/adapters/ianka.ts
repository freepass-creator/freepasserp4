import {
  compactPlate,
  explicitMoney,
  explicitNumber,
  text,
  withProvenance,
  type AdapterResult,
  type AtomSource,
  type FieldProvenance,
  type FreepassAtom,
  type RawSupplierRow,
  type SupplierAdapter,
} from '../domain/supplier-adapter';

const VERSION = '1.0.0';

function pick(raw: RawSupplierRow, ...headers: string[]): { header: string; value: unknown } {
  for (const header of headers) {
    const value = raw[header];
    if (text(value)) return { header, value };
  }
  return { header: headers[0] || '', value: undefined };
}

export class IankaAdapter implements SupplierAdapter {
  readonly sourceCode = 'IANKA';
  readonly adapterName = 'IankaAdapter';
  readonly version = VERSION;

  adapt(raw: RawSupplierRow, source: Partial<AtomSource> = {}): AdapterResult {
    const provenance: FieldProvenance = {};
    const issues: AdapterResult['issues'] = [];

    const plate = pick(raw, '차량번호', '차번');
    const vin = pick(raw, '차대번호', 'VIN');
    const maker = pick(raw, '제조사', '메이커', '브랜드');
    const model = pick(raw, '모델', '모델명', '차종');
    const subModel = pick(raw, '세부모델');
    const trim = pick(raw, '세부트림', '트림');
    const rawName = pick(raw, '차명(원문)', '차명', '차량명');
    const status = pick(raw, '배차상태', '상태', '판매상태', '출고상태');
    const productType = pick(raw, '구분', '상품구분');
    const year = pick(raw, '연식', '년식');
    const km = pick(raw, 'Km', 'KM', '주행거리');
    const fuel = pick(raw, '연료');
    const displacement = pick(raw, '배기량');

    const atom: FreepassAtom = {
      source: {
        supplierCode: source.supplierCode || this.sourceCode,
        supplierName: source.supplierName || '이안카',
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

      // 금융 필드는 의미가 비슷한 다른 헤더로 절대 추정하지 않는다.
      // 이안카 원본에서 각 기간/보증금의 정확한 헤더만 읽는다.
      shortDeposit: explicitMoney(raw['단기보증']),
      longDeposit: explicitMoney(raw['장기보증']),
      rent: {
        1: explicitMoney(raw['1개월']),
        6: explicitMoney(raw['6개월']),
        12: explicitMoney(raw['12개월']),
        24: explicitMoney(raw['24개월']),
        36: explicitMoney(raw['36개월']),
        48: explicitMoney(raw['48개월']),
        60: explicitMoney(raw['60개월']),
      },
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
    for (const [field, header] of [
      ['shortDeposit', '단기보증'], ['longDeposit', '장기보증'], ['rent.1', '1개월'], ['rent.6', '6개월'],
      ['rent.12', '12개월'], ['rent.24', '24개월'], ['rent.36', '36개월'], ['rent.48', '48개월'], ['rent.60', '60개월'],
    ] as const) {
      withProvenance(provenance, field, header, raw[header], '숫자 외 문자 제거 후 금액 변환');
    }

    if (!atom.plateNumber && !atom.vin) {
      issues.push({ level: 'error', code: 'NO_IDENTITY', message: '차량번호와 차대번호가 모두 없습니다.' });
    }
    if (!atom.model && !atom.rawName) {
      issues.push({ level: 'warning', code: 'NO_MODEL', message: '모델/차명이 없어 판매 노출 대상이 될 수 없습니다.', field: 'model' });
    }
    if (!Object.values(atom.rent).some((v) => typeof v === 'number' && v > 0)) {
      issues.push({ level: 'warning', code: 'NO_RENT', message: '판매 가능한 기간 대여료가 하나도 없습니다.', field: 'rent' });
    }

    return { atom, issues };
  }
}

export const iankaAdapter = new IankaAdapter();
