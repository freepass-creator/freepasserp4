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
import { SONOGONG_DEPOSIT_POLICY } from '../domain/deposit-policy';
import { isRentPlate } from '../domain/sonokong-product-kind';

const VERSION = '1.0.0';

function pick(raw: RawSupplierRow, ...headers: string[]): { header: string; value: unknown } {
  for (const header of headers) {
    const value = raw[header];
    if (text(value)) return { header, value };
  }
  return { header: headers[0] || '', value: undefined };
}

export class SonogongAdapter implements SupplierAdapter {
  readonly sourceCode = 'SONOGONG';
  readonly adapterName = 'SonogongAdapter';
  readonly version = VERSION;

  adapt(raw: RawSupplierRow, source: Partial<AtomSource> = {}): AdapterResult {
    const provenance: FieldProvenance = {};
    const issues: AdapterResult['issues'] = [];

    const plate = pick(raw, '차량번호', '차번');
    const vin = pick(raw, '차대번호', 'VIN');
    const maker = pick(raw, '제조사', '메이커');
    const model = pick(raw, '모델', '모델명', '차명');
    const trim = pick(raw, '트림', '세부트림');
    const rawName = pick(raw, '차명', '차명(정제)', '차명(세부모델+트림)');
    const status = pick(raw, '판매상태', '배차상태', '상태', '출고현황');
    const productType = pick(raw, '물품종류', '상품구분', '구분', '분류');
    const year = pick(raw, '년식', '연식', '최초등록일');
    const km = pick(raw, '주행거리', 'Km', 'KM');
    const fuel = pick(raw, '연료');
    const displacement = pick(raw, '배기량');
    const sourceDepositRule = pick(raw, '보증금 반납형', '장기보증');

    const atom: FreepassAtom = {
      source: {
        supplierCode: source.supplierCode || this.sourceCode,
        supplierName: source.supplierName || '손오공',
        spreadsheetId: source.spreadsheetId,
        tab: source.tab,
        row: source.row,
        adapter: this.adapterName,
        adapterVersion: this.version,
      },
      plateNumber: compactPlate(plate.value) || undefined,
      vin: text(vin.value).replace(/\s+/g, '') || undefined,
      status: text(status.value) || undefined,
      /**
       * ★렌트 여부는 원문 「구분」 칸을 그대로 믿지 않고 번호판(하·허·호)으로 검증·보정한다
       * (실측 2026-09-15, lib/domain/sonokong-product-kind.ts). 렌트번호판인데 원문이 렌트로
       * 안 적었거나 그 반대면 issues 에 남기고 번호판을 우선한다 — 원천 표기 오류가 그대로
       * 상품구분에 새는 것을 막는다.
       */
      productType: (() => {
        const raw = text(productType.value);
        const plateIsRent = isRentPlate(compactPlate(plate.value));
        const rawSaysRent = /렌트/.test(raw);
        if (plateIsRent && !rawSaysRent) return '중고렌트';
        if (!plateIsRent && rawSaysRent) return raw; // 렌트 아닌 번호판이라도 원천이 명시했으면 존중, issue 로만 남김
        return raw || undefined;
      })(),
      maker: text(maker.value) || undefined,
      model: text(model.value) || undefined,
      trim: text(trim.value) || undefined,
      rawName: text(rawName.value) || undefined,
      year: text(year.value) || undefined,
      km: explicitNumber(km.value),
      fuel: text(fuel.value) || undefined,
      displacement: explicitNumber(displacement.value),
      shortDeposit: explicitMoney(raw['금액보증금']),
      // 손오공 장기보증은 고정 숫자가 아니라 기간별 월대여료에 대한 계산 규칙이다.
      longDeposit: undefined,
      depositPolicy: SONOGONG_DEPOSIT_POLICY,
      rent: {
        12: explicitMoney(raw['12개월 반납형'] ?? raw['12개월']),
        24: explicitMoney(raw['24개월 반납형'] ?? raw['24개월']),
        36: explicitMoney(raw['36개월 반납형'] ?? raw['36개월']),
        48: explicitMoney(raw['48개월 반납형'] ?? raw['48개월']),
        60: explicitMoney(raw['60개월 반납형'] ?? raw['60개월']),
      },
      provenance,
    };

    const provenancePairs: Array<[string, { header: string; value: unknown }, string?]> = [
      ['plateNumber', plate, '공백 제거'], ['vin', vin, '공백 제거'], ['maker', maker], ['model', model],
      ['trim', trim], ['rawName', rawName], ['status', status], ['productType', productType], ['year', year],
      ['km', km, '숫자 변환'], ['fuel', fuel], ['displacement', displacement, '숫자 변환'],
    ];
    for (const [field, src, transform] of provenancePairs) {
      withProvenance(provenance, field, src.header, src.value, transform);
    }
    withProvenance(provenance, 'shortDeposit', '금액보증금', raw['금액보증금'], '숫자 외 문자 제거 후 금액 변환');
    withProvenance(
      provenance,
      'depositPolicy',
      sourceDepositRule.header,
      sourceDepositRule.value || SONOGONG_DEPOSIT_POLICY.label,
      `SSOT 표준 규칙: ${SONOGONG_DEPOSIT_POLICY.label}`,
    );
    for (const term of [12, 24, 36, 48, 60] as const) {
      const returnHeader = `${term}개월 반납형`;
      const fallbackHeader = `${term}개월`;
      const header = text(raw[returnHeader]) ? returnHeader : fallbackHeader;
      withProvenance(provenance, `rent.${term}`, header, raw[header], '숫자 외 문자 제거 후 금액 변환');
    }

    if (!atom.plateNumber && !atom.vin) {
      issues.push({ level: 'error', code: 'NO_IDENTITY', message: '차량번호와 차대번호가 모두 없습니다.' });
    }
    {
      const plateIsRent = isRentPlate(atom.plateNumber);
      const rawSaysRent = /렌트/.test(text(productType.value));
      if (plateIsRent !== rawSaysRent) {
        issues.push({
          level: 'warning',
          code: 'RENT_PLATE_MISMATCH',
          message: `번호판(${atom.plateNumber || '?'})이 ${plateIsRent ? '렌트(하·허·호)인데' : '렌트가 아닌데'} 원문 구분은 「${text(productType.value) || '(빈칸)'}」입니다 — 번호판을 우선했습니다.`,
          field: 'productType',
        });
      }
    }
    if (!atom.model && !atom.rawName) {
      issues.push({ level: 'warning', code: 'NO_MODEL', message: '모델/차명이 없어 판매 노출 대상이 될 수 없습니다.', field: 'model' });
    }
    if (!Object.values(atom.rent).some((v) => typeof v === 'number' && v > 0)) {
      issues.push({ level: 'warning', code: 'NO_RENT', message: '손오공 반납형 기간별 대여료가 하나도 없습니다.', field: 'rent' });
    }

    return { atom, issues };
  }
}

export const sonogongAdapter = new SonogongAdapter();
