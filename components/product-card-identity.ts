import type { EntityRecord } from '@/lib/intake/entities';
import { kmDisplay } from '@/lib/format';
import {
  fuelDisplay, fuelEmbeddedCc, yearDisplay, makerDisplay, isNoTrimLabel,
} from '@/lib/domain/vehicle-master-match';

export function idParts(product: EntityRecord): { idMain: string; idExt: string } {
  const trim = String(product.trim_name || '').trim();
  const extra = String(product.trim_extra || '').trim();
  return {
    idMain: [
      makerDisplay(product.maker) || product.maker,
      product.sub_model || product.model,
    ].filter(Boolean).join(' ') || String(product.car_number || '차량'),
    idExt: [
      product.variant,
      trim && !isNoTrimLabel(trim) ? trim : '',
      extra,
    ].filter(Boolean).join(' '),
  };
}

export function idMobile(product: EntityRecord): string {
  const trim = String(product.trim_name || '').trim();
  const extra = String(product.trim_extra || '').trim();
  return [
    product.sub_model || product.model,
    product.variant,
    trim && !isNoTrimLabel(trim) ? trim : '',
    extra,
  ].filter(Boolean).join(' ') || String(product.car_number || '차량');
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
  return yearDisplay(product.year) || '-';
}

function cardFuel(product: EntityRecord): string {
  return fuelDisplay(product.fuel_type) || '-';
}

function cardMileage(product: EntityRecord): string {
  return kmDisplay(product.mileage) || '-';
}

function cardEngineCc(product: EntityRecord): string {
  const value = Number(product.engine_cc) || fuelEmbeddedCc(product.fuel_type);
  if (!Number.isFinite(value) || value <= 0) return '-';
  return `${value.toLocaleString()}cc`;
}

export function specLineCard(product: EntityRecord): string {
  return [cardYear(product), cardFuel(product), cardMileage(product), cardEngineCc(product)].join(' · ');
}

export function cardTitle(product: EntityRecord, mobileNarrow = false): string {
  if (mobileNarrow) return idMobile(product);
  const { idMain, idExt } = idParts(product);
  return [idMain, idExt].filter(Boolean).join(' ');
}
