import type { EntityRecord } from '@/lib/intake/entities';
import { moneyOrRateText, moneyOrRateWon } from './policy-money-rate';
import type { EsignTemplate } from '@/lib/domain/esign-templates';
import { isStockedProduct, priceList, priceVariants, vehicleName, type Price } from '@/lib/domain/product';

const S = (value: unknown) => String(value ?? '').trim();
const digits = (value: unknown) => S(value).replace(/\D/g, '');
const ageNumber = (value: unknown): number => Number(S(value).match(/(\d{2})/)?.[1] || 0);

export function productKey(product: EntityRecord | null | undefined): string {
  return S(product?.product_code || product?._key);
}

export function productMatchesTemplate(product: EntityRecord, template: EsignTemplate | null): boolean {
  if (!template) return false;
  return productContractKind(product) === template.contractKind;
}

/**
 * 이 차가 렌트인가 구독인가 — 계약서 종류를 «사람이 고르지 않고» 차량이 정한다(사장님 2026-08-20).
 *   상품구분이 비어 있으면 렌트로 본다(프리패스 기본 상품이 렌트).
 */
export function productContractKind(product: EntityRecord | null | undefined): '렌탈' | '구독' {
  return /구독/.test(S(product?.product_type || product?.contract_type)) ? '구독' : '렌탈';
}

/**
 * 시트 「운영정책」 첫 줄 라벨이 차량의 정책코드 칸에 그대로 들어간 것 —
 * 「(프리패스 기본)」은 정책코드가 아니라 «공급사 고유 정책 없이 프리패스 기본을 따른다»는 표시다.
 * 실측 2026-08-20: 출고가능 276대 중 114대가 이 라벨이었다.
 */
export function isBasePolicyLabel(code: unknown): boolean {
  return /^\(?\s*프리패스\s*기본\s*\)?$/.test(S(code));
}

export type VehiclePolicyPick = {
  policy: EntityRecord | null;
  /** 어떻게 정했나 — 화면이 «자동인지 사람이 골라야 하는지»를 이 값으로 말한다. */
  how: '차량 정책' | '공급사 정책' | '미정';
};

/**
 * ★차량이 정책을 데려온다(사장님 2026-08-20 「차량선택(정책없으면 정책까지 선택)」).
 *   ① 차량의 정책코드로 그 공급사 정책을 찾으면 그것
 *   ② 못 찾거나 「(프리패스 기본)」이면 — 그 차 상품구분(렌트/구독)에 맞는 공급사 정책이 **하나뿐일 때만** 그것
 *   ③ 그래도 못 정하면 미정 → 화면에서 사람이 고른다. 찍어서 고르지 않는다(남의 조건이 계약서에 실린다).
 */
export function resolveVehiclePolicy(
  product: EntityRecord | null | undefined,
  providerPolicies: EntityRecord[],
): VehiclePolicyPick {
  if (!product) return { policy: null, how: '미정' };
  const code = S(product.policy_code);
  if (code && !isBasePolicyLabel(code)) {
    const hit = providerPolicies.find((row) => S(row.policy_code) === code || S(row._key) === code);
    if (hit) return { policy: hit, how: '차량 정책' };
  }
  const kind = productContractKind(product);
  const sameKind = providerPolicies.filter((row) => {
    const type = S(row.policy_type);
    if (!type) return true;
    return kind === '구독' ? /구독/.test(type) : !/구독/.test(type);
  });
  if (sameKind.length === 1) return { policy: sameKind[0], how: '공급사 정책' };
  return { policy: null, how: '미정' };
}

/** 계약서에 바로 배정할 수 있는 차량. 즉시출고는 출고가능과 같은 가용 재고로 본다. */
export function isContractAvailableVehicle(product: EntityRecord): boolean {
  const status = S(product.vehicle_status).replace(/\s/g, '');
  return (status === '즉시출고' || status === '출고가능')
    && !S(product.locked_by_contract);
}

/**
 * 계약서에 배정할 차량 후보.
 * ★`template` 은 이제 «선택»이다(사장님 2026-08-20 순서: 회사 → 차량 → …).
 *   계약서 종류를 아직 모르는 단계에서도 그 공급사 출고가능 차량을 다 보여 주고, 종류는 고른 차가 정한다.
 *   기발행 계약을 다시 여는 등 종류가 이미 정해진 자리에서는 예전처럼 그 종류만 걸러 준다.
 */
export function searchContractVehicles(
  products: EntityRecord[],
  providerCode: string,
  template: EsignTemplate | null,
  query: string,
): EntityRecord[] {
  const normalized = S(query).replace(/\s/g, '').toLowerCase();
  const numberQuery = digits(normalized);
  return products
    .filter((product) => !providerCode || S(product.provider_company_code) === providerCode)
    .filter((product) => !template || productMatchesTemplate(product, template))
    // 계약서에 배정하는 선택창이므로 판매 카탈로그와 달리 출고가능 재고만 노출한다.
    // 대여료가 아직 없어도 차량은 보여 주고 이번 계약에서 최종 금액을 직접 확정한다.
    .filter(isContractAvailableVehicle)
    .filter(isStockedProduct)
    .filter((product) => {
      if (!normalized) return true;
      const plate = S(product.car_number).replace(/\s/g, '').toLowerCase();
      if (plate.includes(normalized)) return true;
      if (numberQuery && digits(plate).includes(numberQuery)) return true;
      const vehicleSearchText = [
        vehicleName(product),
        product.maker,
        product.model,
        product.sub_model,
        product.trim_name,
        product.trim,
        product.grade,
        product.vehicle_name,
        product.model_name,
        product.car_name,
      ].map(S).join(' ').replace(/\s/g, '').toLowerCase();
      return vehicleSearchText.includes(normalized);
    })
    .sort((a, b) => S(a.car_number).localeCompare(S(b.car_number), 'ko'));
}

export type ContractVehicleSnapshot = {
  productCode: string;
  carNumber: string;
  vehicleName: string;
  modelYear: string;
  fuel: string;
  options: string;
  colorExterior: string;
  currentMileage: string;
};

export function contractVehicleSnapshot(product: EntityRecord): ContractVehicleSnapshot {
  return {
    productCode: productKey(product),
    carNumber: S(product.car_number),
    vehicleName: vehicleName(product),
    modelYear: S(product.year),
    fuel: S(product.fuel_type),
    options: S(product.options),
    colorExterior: S(product.ext_color),
    currentMileage: S(product.mileage),
  };
}

export type DriverAgeOption = { age: number; label: string; surcharge: number };

export type ContractMileageOption = {
  /** 계약서에 남기는 사람 읽기용 약정. */
  label: string;
  /** 상품 가격표 원본 키. 없으면 정책 가산으로 계산한 가격이다. */
  priceVariantKey: string;
  mileageSurcharge: number;
  source: '상품 가격표' | '정책 가산';
};

function mileageKm(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const raw = S(value).replace(/,/g, '').toLowerCase();
  const man = raw.match(/(\d+(?:\.\d+)?)\s*만/);
  if (man) return Math.round(Number(man[1]) * 10_000);
  const km = raw.match(/(\d+(?:\.\d+)?)\s*km/);
  return km ? Math.round(Number(km[1])) : 0;
}

function mileageLabel(value: unknown): string {
  const km = mileageKm(value);
  if (!km) return S(value);
  return km % 10_000 === 0 ? `연 ${km / 10_000}만km` : `연 ${km.toLocaleString('ko-KR')}km`;
}

/**
 * 계약의 약정주행거리는 자유입력이 아니다. 차량 가격표에 기간별 선택값이 있으면 그것을
 * 그대로 쓰고, 없을 때만 정책이 명시한 1만km 상향요금으로 기본+1만 옵션을 만든다.
 */
export function contractMileageOptions(
  product: EntityRecord | null | undefined,
  months: number,
  policy: EntityRecord | null | undefined,
): ContractMileageOption[] {
  if (!product || !months) return [];
  const variants = priceVariants(product).filter((price) => price.m === months && mileageKm(price.mileage) > 0);
  if (variants.length) return variants.map((price) => ({
    label: mileageLabel(price.mileage),
    priceVariantKey: price.key,
    mileageSurcharge: 0,
    source: '상품 가격표',
  }));

  const base = mileageKm(policy?.annual_mileage);
  const baseLabel = mileageLabel(policy?.annual_mileage);
  if (!base || !baseLabel) return [];
  const baseRent = priceList(product).find((price) => price.m === months)?.rent || 0;
  const upcharge = Math.max(0, moneyOrRateWon(policy?.mileage_upcharge_per_10000km, baseRent, { legacy: 'won' }) || 0);
  const options: ContractMileageOption[] = [{
    label: baseLabel,
    priceVariantKey: '',
    mileageSurcharge: 0,
    source: '정책 가산',
  }];
  if (upcharge > 0) options.push({
    label: mileageLabel(base + 10_000),
    priceVariantKey: '',
    mileageSurcharge: upcharge,
    source: '정책 가산',
  });
  return options;
}

/**
 * 연령 하향 가산(월) — 「10만원」은 그대로, 「대여료의 10%」는 이번 계약 월 대여료로 굳힌다(사장님 2026-08-19 정액·정률 겸용).
 *   월 대여료를 아직 모르면 정률은 0으로 두고 라벨만 보인다 — 계약서에는 rentAmount 가 정해진 뒤 다시 계산돼 실린다.
 */
export function ageLoweringSurcharge(policy: EntityRecord | null | undefined, monthlyRent?: number | null): number {
  const won = moneyOrRateWon(policy?.age_lowering_cost, monthlyRent, { legacy: 'won' });
  return Math.max(0, won ?? 0);
}

/** 추가 운전자 요금은 고객과 A4 모두 같은 「1인당 월」로 읽히게 한다 — 「월 50,000원 / 1인」 · 「월 대여료의 5% / 1인」(정률, 사장님 2026-08-19). */
export function additionalDriverCostLabel(value: unknown): string {
  const raw = S(value);
  if (!raw) return '별도 비용 없음';
  return moneyOrRateText(raw, { legacy: 'won', per: '월', suffix: ' / 1인', wonStyle: 'comma', rateBase: '대여료의', noneText: '별도 비용 없음', consultText: '계약 전 별도 협의', naText: '추가 운전자 등록 불가' });
}

export function contractDriverAgeOptions(policy: EntityRecord | null | undefined, monthlyRent?: number | null): DriverAgeOption[] {
  if (!policy) return [];
  const basic = ageNumber(policy.basic_driver_age);
  const lowered = ageNumber(policy.driver_age_lowering);
  const upper = ageNumber(policy.driver_age_upper_limit);
  const surcharge = ageLoweringSurcharge(policy, monthlyRent);
  const ages = [basic, lowered].filter((age, index, rows) => (
    age >= 21 && age <= 80 && (!upper || age <= upper) && rows.indexOf(age) === index
  ));
  return ages.sort((a, b) => b - a).map((age) => ({
    age,
    label: `만 ${age}세 이상${upper >= age && upper <= 100 ? ` · 만 ${upper}세 이하` : ''}`,
    surcharge: basic && age < basic ? surcharge : 0,
  }));
}

export function exactContractPrice(product: EntityRecord | null | undefined, months: number): Price | null {
  if (!product || !months) return null;
  return priceList(product).find((price) => price.m === months) || null;
}

export function contractRentForAge(
  product: EntityRecord | null | undefined,
  months: number,
  policy: EntityRecord | null | undefined,
  driverAge: number,
): { rent: number; deposit: number; ageSurcharge: number } | null {
  const price = exactContractPrice(product, months);
  if (!price) return null;
  const option = contractDriverAgeOptions(policy).find((row) => row.age === driverAge);
  const ageSurcharge = option?.surcharge || 0;
  return { rent: price.rent + ageSurcharge, deposit: price.deposit, ageSurcharge };
}

/** 기간·약정주행·연령을 동시에 반영한, 계약 생성 직전의 월 대여료. */
export function contractRentForTerms(
  product: EntityRecord | null | undefined,
  months: number,
  policy: EntityRecord | null | undefined,
  driverAge: number,
  mileage: ContractMileageOption | null | undefined,
): { rent: number; deposit: number; ageSurcharge: number; mileageSurcharge: number; priceVariantKey: string } | null {
  if (!product || !months || !mileage) return null;
  const variant = mileage.priceVariantKey
    ? priceVariants(product).find((row) => row.key === mileage.priceVariantKey)
    : null;
  const base = variant || priceList(product).find((price) => price.m === months);
  if (!base) return null;
  const ageOption = contractDriverAgeOptions(policy, base.rent + mileage.mileageSurcharge).find((row) => row.age === driverAge);
  const ageSurcharge = ageOption?.surcharge || 0;
  return {
    rent: base.rent + mileage.mileageSurcharge + ageSurcharge,
    deposit: base.deposit,
    ageSurcharge,
    mileageSurcharge: mileage.mileageSurcharge,
    priceVariantKey: mileage.priceVariantKey,
  };
}
