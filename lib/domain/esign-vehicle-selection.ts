import type { EntityRecord } from '@/lib/intake/entities';
import { moneyOrRateText, moneyOrRateWon } from './policy-money-rate';
import type { EsignTemplate } from '@/lib/domain/esign-templates';
import { isStockedProduct, priceList, vehicleName, type Price } from '@/lib/domain/product';

const S = (value: unknown) => String(value ?? '').trim();
const digits = (value: unknown) => S(value).replace(/\D/g, '');
const ageNumber = (value: unknown): number => Number(S(value).match(/(\d{2})/)?.[1] || 0);

export function productKey(product: EntityRecord | null | undefined): string {
  return S(product?.product_code || product?._key);
}

export function productMatchesTemplate(product: EntityRecord, template: EsignTemplate | null): boolean {
  if (!template) return false;
  const type = S(product.product_type || product.contract_type);
  if (!type) return template.contractKind === '렌탈';
  return template.contractKind === '렌탈' ? /렌트/.test(type) : /구독/.test(type);
}

/** 계약서에 바로 배정할 수 있는 차량. 즉시출고는 출고가능과 같은 가용 재고로 본다. */
export function isContractAvailableVehicle(product: EntityRecord): boolean {
  const status = S(product.vehicle_status).replace(/\s/g, '');
  return (status === '즉시출고' || status === '출고가능')
    && !S(product.locked_by_contract);
}

export function searchContractVehicles(
  products: EntityRecord[],
  providerCode: string,
  template: EsignTemplate | null,
  query: string,
): EntityRecord[] {
  const normalized = S(query).replace(/\s/g, '').toLowerCase();
  if (!providerCode || !template) return [];
  const numberQuery = digits(normalized);
  return products
    .filter((product) => S(product.provider_company_code) === providerCode)
    .filter((product) => productMatchesTemplate(product, template))
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
