import type { EntityRecord } from '@/lib/intake/entities';
import { kmDisplay } from '@/lib/format';
import { vehicleNameOf, vehicleNameParts } from '@/lib/domain/vehicle-name';
import {
  fuelDisplay, fuelEmbeddedCc, yearDisplay,
} from '@/lib/domain/vehicle-master-match';

/**
 * 배기량 cc → 리터 표시 «2.5·1.6» (사장님 2026-09-05 「배기량을 1.6 이렇게 변환해서 표시 · 원자 값은 그대로」).
 * 원자의 engine_cc(cc)는 안 바꾼다 — 표시만 리터로. 세부모델·연료와 나란히 놓여 «어떤 연료의 어떤 배기량」이 한눈에.
 * 0·전기(cc 없음)는 빈칸(배터리 용량이 그 자리를 대신).
 */
export function displacementL(cc: unknown): string {
  const n = Number(cc) || 0;
  if (n <= 0) return '';
  return (Math.round(n / 100) / 10).toFixed(1);
}

/** 카드 2줄 표기 — 굵은 줄(제조사+모델) + 회색 보조줄(파워트레인·트림·추가표기). 조립은 vehicle-name.ts SSOT. */
export function idParts(product: EntityRecord): { idMain: string; idExt: string } {
  const p = vehicleNameParts({ kind: 'product', product }, { tier: 'full' });
  const main = [p.maker, p.main].filter(Boolean).join(' ');
  return { idMain: main || p.plate || '미등록 차량', idExt: p.ext };
}

/**
 * 좁은 화면 한 줄 표기 = T2.
 *
 * ⚠ 예전엔 여기서 **제조사 토큰을 통째로 뺐다.** 파인더는 모바일이면 무조건 이 경로라
 * 폰에서는 제조사가 구조적으로 절대 안 보였고, 같은 차가 손님 카탈로그(데스크톱 경로)에서는
 * 제조사와 함께 보였다. 폭 문제는 제조사를 지워서가 아니라 **등급을 낮춰서** 푼다.
 */
export function idMobile(product: EntityRecord): string {
  return vehicleNameOf({ kind: 'product', product }, { tier: 'full' });
}

export function specLine(product: EntityRecord): string {
  const year = yearDisplay(product.year);
  const fuel = fuelDisplay(product.fuel_type);
  const engineCc = Number(product.engine_cc) || fuelEmbeddedCc(product.fuel_type);
  return [
    year,
    kmDisplay(product.mileage),
    fuel,
    product.drive_type && String(product.drive_type),
    displacementL(engineCc),
    product.seats && `${product.seats}인승`,
    product.ext_color && `외장 ${product.ext_color}`,
    product.int_color && String(product.int_color) !== '-' && `내장 ${product.int_color}`,
    product.vehicle_class && String(product.vehicle_class),
  ].filter(Boolean).join(' · ');
}

export function cardYear(product: EntityRecord): string {
  return yearDisplay(product.year) || '미입력';
}

export function cardFuel(product: EntityRecord): string {
  return fuelDisplay(product.fuel_type) || '미입력';
}

export function cardMileage(product: EntityRecord): string {
  return kmDisplay(product.mileage) || '미입력';
}

function cardEngineCc(product: EntityRecord): string {
  const value = Number(product.engine_cc) || fuelEmbeddedCc(product.fuel_type);
  if (!Number.isFinite(value) || value <= 0) return '미입력';
  return displacementL(value);
}

/**
 * ★**차량번호 옆 원자 차례 — 연식 · 주행거리 · 연료 · 배기량(전기는 배터리용량) · 구동방식**
 *   (사장님 2026-08-28 「차량번호 옆으로 연식 주행거리 연료 배기량 이런 거 · 배터리용량이나
 *    구동방식 순서대로 · **있는 거라도**」).
 *
 *   ⚠ **있는 것만 쓴다.** 빈 칸은 구분자째 뺀다 — `-` 를 고정으로 찍으면 모든 줄이 「· -」로 끝나고
 *     그 폭 때문에 앞의 주행거리가 잘린다. 대시 폴백은 표(DetailGrid·KV)에서만 쓴다.
 *
 *   ⚠ **배기량 자리는 전기차에서 배터리 용량이 든다.** 전기차에 `engine_cc` 가 비는 건 정상이라
 *     그동안 이 자리가 늘 비어 있었다. 상세 「동력」 줄과 같은 규칙이다(product.ts `ccLabel`) —
 *     두 곳이 다른 규칙을 쓰면 같은 차가 화면마다 다른 제원을 보인다.
 *
 *   차례를 여기 한 곳에서 정한다. 부르는 쪽(목록·카드·상세 머리)이 각자 적으면 화면마다 갈린다 —
 *   실제로 연료가 목록에서만 빠져 있던 적이 있다(2026-08-19 → 08-20 되살림).
 */
export function specAtoms(product: EntityRecord): string[] {
  const kwh = Number(product.battery_capacity) || 0;
  const cc = Number(product.engine_cc) || fuelEmbeddedCc(product.fuel_type);
  const power = kwh > 0 ? `${kwh}kWh` : displacementL(cc);
  return [
    yearDisplay(product.year),
    kmDisplay(product.mileage),
    fuelDisplay(product.fuel_type) || String(product.fuel_type || '').trim(),
    power,
    String(product.drive_type || '').trim(),
  ].filter(Boolean).map(String);
}

/** 위 차례를 한 줄로. 목록·카드·차번 옆이 전부 이걸 쓴다. */
export function specAtomsLine(product: EntityRecord): string {
  return specAtoms(product).join(' · ');
}

export function specLineCard(product: EntityRecord): string {
  return specAtomsLine(product);
}

export function cardTitle(product: EntityRecord, _mobileNarrow = false): string {
  return vehicleNameOf({ kind: 'product', product }, { tier: 'short', omitMaker: true, fallback: 'plate' });
}

/** 차번 옆 한 줄 — 차례는 `specAtoms` 가 정한다(연식 · 주행 · 연료 · 배기량 · 구동). */
export function plateSpecLine(product: EntityRecord): string {
  return specAtomsLine(product);
}
