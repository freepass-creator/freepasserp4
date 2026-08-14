import type { EntityRecord } from '@/lib/intake/entities';
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
    // 계약 입력은 판매 카탈로그가 아니다. 회사 재고라면 대여료가 아직 없어도 먼저 보여 주고,
    // 이번 계약의 최종 대여료·보증금은 직원이 직접 확정할 수 있어야 한다.
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

export function contractDriverAgeOptions(policy: EntityRecord | null | undefined): DriverAgeOption[] {
  if (!policy) return [];
  const basic = ageNumber(policy.basic_driver_age);
  const lowered = ageNumber(policy.driver_age_lowering);
  const surcharge = Math.max(0, Number(policy.age_lowering_cost) || 0);
  const ages = [basic, lowered].filter((age, index, rows) => age >= 18 && age <= 80 && rows.indexOf(age) === index);
  return ages.sort((a, b) => b - a).map((age) => ({
    age,
    label: `만 ${age}세 이상`,
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
