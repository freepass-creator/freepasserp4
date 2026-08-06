import type { EntityRecord } from '@/lib/intake/entities';

/** 차종 규격화에 사용하는 수집 신호 SSOT. */
export const VEHICLE_SIGNAL_KEYS = [
  'maker', 'model', 'sub_model', 'variant', 'trim_name', 'catalog_id',
  'vehicle_name', 'cert_car_name', 'type_number', 'engine_type',
  'year', 'first_registration_date',
  'fuel_type', 'engine_cc', 'seats', 'drive_type', 'transmission',
  'vehicle_class', 'options', 'partner_memo', 'usage',
  '_ocr_registration',
  /**
   * 매핑되지 않은 칸에서 «차종을 설명하는 글»만 골라 이어 붙인 것.
   *
   * 트림은 대부분의 공급사 시트에 «열이 없다»(실측 2026-08-07: 검수 47대 중 트림 42대 결측,
   * 그런데 못 잡은 열은 전부 보증금·기간요금 같은 계약 조건이었다). 트림은 열이 아니라
   * 차명 칸이나 이름 없는 설명 칸에 문장으로 섞여 있다 — 「더 뉴 K5 2.0 가솔린 프레스티지」.
   * 그래서 그 글을 신호로 넣는다. 금액·날짜·차번은 넣지 않는다(모델명과 겹쳐 오매칭을 만든다).
   */
  '_row_text',
] as const;

export type VehicleSignalKey = (typeof VEHICLE_SIGNAL_KEYS)[number];

/** 빈값을 제외하고 원본 차량 신호를 우선 수집한다. */
export function collectVehicleSignals(product: EntityRecord): string[] {
  const source: EntityRecord = { ...product };
  const raw = product._raw_vehicle;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of Object.keys(raw as object)) {
      const value = String((raw as EntityRecord)[key] ?? '').trim();
      if (value) source[key] = value;
    }
  }
  const signals: string[] = [];
  for (const key of VEHICLE_SIGNAL_KEYS) {
    const value = source[key];
    if (value == null || value === '') continue;
    const signal = String(value).trim();
    if (signal) signals.push(signal);
  }
  return signals;
}

export function vehicleSignalBlob(product: EntityRecord): string {
  return collectVehicleSignals(product).join(' ');
}

/** 최초 원본 신원·스펙을 현재 필드에 복원해 재스냅 입력을 만든다. */
export function withRawVehicleSignals(product: EntityRecord): EntityRecord {
  const raw = product._raw_vehicle;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return product;
  const output: EntityRecord = { ...product };
  for (const key of [
    'maker', 'model', 'sub_model', 'variant', 'trim_name', 'year',
    'fuel_type', 'engine_cc', 'seats', 'drive_type', 'vehicle_class',
    'catalog_id', 'vehicle_name', 'cert_car_name',
  ] as const) {
    const value = String((raw as EntityRecord)[key] ?? '').trim();
    if (value) output[key] = value;
  }
  return output;
}
