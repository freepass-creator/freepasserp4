import type { EntityRecord } from '@/lib/intake/entities';
import { kmDisplay } from '@/lib/format';
import { vehicleNameOf, vehicleNameParts } from '@/lib/domain/vehicle-name';
import {
  fuelDisplay, fuelEmbeddedCc, yearDisplay, makerDisplay, isNoTrimLabel,
} from '@/lib/domain/vehicle-master-match';

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
    engineCc > 0 && `${engineCc.toLocaleString()}cc`,
    product.seats && `${product.seats}인승`,
    product.ext_color && `외장 ${product.ext_color}`,
    product.int_color && String(product.int_color) !== '-' && `내장 ${product.int_color}`,
    product.vehicle_class && String(product.vehicle_class),
  ].filter(Boolean).join(' · ');
}

function cardYear(product: EntityRecord): string {
  return yearDisplay(product.year) || '미입력';
}

function cardFuel(product: EntityRecord): string {
  return fuelDisplay(product.fuel_type) || '미입력';
}

function cardMileage(product: EntityRecord): string {
  return kmDisplay(product.mileage) || '미입력';
}

function cardEngineCc(product: EntityRecord): string {
  const value = Number(product.engine_cc) || fuelEmbeddedCc(product.fuel_type);
  if (!Number.isFinite(value) || value <= 0) return '미입력';
  return `${value.toLocaleString()}cc`;
}

export function specLineCard(product: EntityRecord): string {
  // 값 없는 칸은 구분자째 뺀다. '-'를 고정 출력하면 모든 행이 '· -'로 끝나고
  //  그 폭 때문에 앞의 주행거리가 잘린다. 대시 폴백은 표(DetailGrid·KV)에서만 쓴다.
  return [cardYear(product), cardFuel(product), cardMileage(product), cardEngineCc(product)].join(' · ');
}

export function cardTitle(product: EntityRecord, mobileNarrow = false): string {
  if (mobileNarrow) return idMobile(product);
  const { idMain, idExt } = idParts(product);
  return [idMain, idExt].filter(Boolean).join(' ');
}
