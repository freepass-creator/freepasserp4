import type { EntityRecord } from '@/lib/intake/entities';
import { NON_IDENTIFYING_FIELDS } from '@/lib/domain/vehicle-match-sources';

/** 차종 규격화에 사용하는 수집 신호 SSOT. */
export const VEHICLE_SIGNAL_KEYS = [
  'maker', 'model', 'sub_model', 'variant', 'trim_name',
  /**
   * 트림 칸에 들어온 «원문 문장». 규격 트림만 `trim_name` 에 남기고 원문은 여기로 옮기는데,
   * 신호에서 빠져 있으면 그 글자를 매처가 아예 못 본다 —
   * 실측(2026-08-08): 트림 정리 후 E-클래스가 W213 에서 1984년 W124 로 떨어졌다.
   * 이름에는 안 쓰지만 «세대를 가르는 근거»로는 반드시 읽어야 한다.
   */
  'trim_extra',
  'catalog_id',
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

/**
 * **어느 차인지**를 고를 때만 쓰는 좁은 신호 — 옵션·비고·자유문장을 뺀다.
 *
 * ★왜 갈라야 하나(실측 2026-08-09)
 *   빌린카 아반떼의 옵션 칸이 「아틀라스 화이트/N Line 전용 블랙 원톤(레드 스티치)」인데,
 *   이게 블롭에 섞이자 **아반떼가 「파사트」로, K5 가 「Q5」로** 붙었다. 옵션은 색상·편의장비 나열이라
 *   차종 근거가 될 수 없는데 모델 후보 점수에 들어가 수입차 라인업과 글자가 맞아버린다.
 *
 *   옵션·비고는 **트림 힌트로는** 여전히 쓴다(`vehicleSignalBlob`) — 「프레스티지」가 거기 적히기도 한다.
 *   가르는 기준은 «그 칸이 차를 특정하는가»다. 옵션은 특정하지 못한다.
 */
const MODEL_SIGNAL_EXCLUDE = new Set<string>(NON_IDENTIFYING_FIELDS);

export function vehicleModelSignalBlob(product: EntityRecord): string {
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
    if (MODEL_SIGNAL_EXCLUDE.has(key)) continue;
    const value = String(source[key] ?? '').trim();
    if (value) signals.push(value);
  }
  return signals.join(' ');
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
