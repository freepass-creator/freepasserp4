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
  type RentVariant,
  type SupplierAdapter,
} from '../domain/supplier-adapter';
import { resolveAutoplusDepositPolicy } from '../domain/deposit-policy';

const VERSION = '1.1.0';

function pick(raw: RawSupplierRow, ...headers: string[]): { header: string; value: unknown } {
  for (const header of headers) {
    const value = raw[header];
    if (text(value)) return { header, value };
  }
  return { header: headers[0] || '', value: undefined };
}

const VARIANT_HEADERS: Array<{ header: string; termMonths: number; annualKm: number }> = [
  { header: '12개월2만', termMonths: 12, annualKm: 20_000 },
  { header: '12개월3만', termMonths: 12, annualKm: 30_000 },
  { header: '18개월2만', termMonths: 18, annualKm: 20_000 },
  { header: '18개월3만', termMonths: 18, annualKm: 30_000 },
  { header: '24개월2만', termMonths: 24, annualKm: 20_000 },
  { header: '24개월3만', termMonths: 24, annualKm: 30_000 },
  { header: '36개월2만', termMonths: 36, annualKm: 20_000 },
  { header: '36개월3만', termMonths: 36, annualKm: 30_000 },
];

export class AutoplusAdapter implements SupplierAdapter {
  readonly sourceCode = 'AUTOPLUS';
  readonly adapterName = 'AutoplusAdapter';
  readonly version = VERSION;

  adapt(raw: RawSupplierRow, source: Partial<AtomSource> = {}): AdapterResult {
    const provenance: FieldProvenance = {};
    const issues: AdapterResult['issues'] = [];

    const plate = pick(raw, '차량번호', '차번');
    const vin = pick(raw, '차대번호', 'VIN');
    const maker = pick(raw, '제조사', '제조사(정제)');
    const model = pick(raw, '모델명', '모델');
    const subModel = pick(raw, '세부모델');
    const trim = pick(raw, '세부트림');
    const rawName = pick(raw, '차명(세부모델+트림)', '차명(정제)', '차명');
    const status = pick(raw, '판매상태', '상태', '출고현황');
    const productType = pick(raw, '분류', '상품구분', '구분');
    const year = pick(raw, '연식', '차량연식', '최초등록일');
    const km = pick(raw, '주행거리', 'Km', 'KM');
    const fuel = pick(raw, '연료', '연료(정제)');
    const displacement = pick(raw, '배기량', '배기량(정제)');
    const depositPolicy = resolveAutoplusDepositPolicy(text(maker.value));

    const rentVariants: RentVariant[] = [];
    for (const spec of VARIANT_HEADERS) {
      const amount = explicitMoney(raw[spec.header]);
      if (amount === undefined) continue;
      rentVariants.push({
        termMonths: spec.termMonths,
        annualKm: spec.annualKm,
        amount,
        sourceHeader: spec.header,
      });
      withProvenance(
        provenance,
        `rentVariants.${spec.header}`,
        spec.header,
        raw[spec.header],
        `기간 ${spec.termMonths}개월 · 연 ${spec.annualKm.toLocaleString('ko-KR')}km`,
      );
    }

    const atom: FreepassAtom = {
      source: {
        supplierCode: source.supplierCode || this.sourceCode,
        supplierName: source.supplierName || '오토플러스',
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
      shortDeposit: explicitMoney(raw['단기보증']),
      longDeposit: explicitMoney(raw['장기보증']),
      depositPolicy,

      // 오토플러스는 기간+연주행거리 조합이 가격의 일부다.
      // 12개월2만과 12개월3만 중 하나를 임의로 standard rent[12]에 넣지 않는다.
      rent: {
        1: explicitMoney(raw['1개월']),
        6: explicitMoney(raw['6개월']),
        12: explicitMoney(raw['12개월']),
        24: explicitMoney(raw['24개월']),
        36: explicitMoney(raw['36개월']),
        48: explicitMoney(raw['48개월']),
        60: explicitMoney(raw['60개월']),
      },
      rentVariants,
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
    if (depositPolicy) {
      withProvenance(
        provenance,
        'depositPolicy',
        maker.header,
        maker.value,
        `SSOT 보증금 규칙 선택: ${depositPolicy.label}`,
      );
    }

    if (!atom.plateNumber && !atom.vin) {
      issues.push({ level: 'error', code: 'NO_IDENTITY', message: '차량번호와 차대번호가 모두 없습니다.' });
    }
    if (!atom.model && !atom.rawName) {
      issues.push({ level: 'warning', code: 'NO_MODEL', message: '모델/차명이 없어 판매 노출 대상이 될 수 없습니다.', field: 'model' });
    }
    if (!depositPolicy) {
      issues.push({ level: 'warning', code: 'NO_DEPOSIT_POLICY', message: '제조사가 없어 오토플러스 보증금 규칙을 결정할 수 없습니다.', field: 'depositPolicy' });
    }
    const hasAnyRent = Object.values(atom.rent).some((v) => typeof v === 'number' && v > 0)
      || rentVariants.some((v) => v.amount > 0);
    if (!hasAnyRent) {
      issues.push({ level: 'warning', code: 'NO_RENT', message: '판매 가능한 표준/변형 대여료가 하나도 없습니다.', field: 'rent' });
    }

    return { atom, issues };
  }
}

export const autoplusAdapter = new AutoplusAdapter();
