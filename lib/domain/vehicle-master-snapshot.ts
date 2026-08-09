import type { EntityRecord } from '@/lib/intake/entities';

/** 차종 변환 추적 필드 — 원본·이력·감사 diff 공용. */
export const SNAP_TRACK_KEYS = [
  'maker', 'model', 'sub_model', 'variant', 'trim_name', 'year',
  'fuel_type', 'engine_cc', 'seats', 'drive_type', 'vehicle_class',
] as const;

export type SnapTrackKey = (typeof SNAP_TRACK_KEYS)[number];

export const SNAP_TRACK_LABEL: Record<SnapTrackKey, string> = {
  maker: '제조사',
  model: '모델',
  sub_model: '세부모델',
  variant: '파워트레인',
  // 차종 5단계 이름은 원자 사전(entities.ts)이 정본이다 — 제조사·모델·세부모델·파워트레인·세부트림.
  trim_name: '세부트림',
  year: '연식',
  fuel_type: '연료',
  engine_cc: '배기량',
  seats: '인승',
  drive_type: '구동',
  vehicle_class: '차종분류',
};

export type RawVehicle = Partial<Record<SnapTrackKey, string>>;

export type SnapHistoryEntry = {
  at: number;
  confidence: string;
  source?: string;
  from: RawVehicle;
  to: RawVehicle;
};

export function pickSnapTrack(rec: EntityRecord | RawVehicle): RawVehicle {
  const output: RawVehicle = {};
  for (const key of SNAP_TRACK_KEYS) {
    const value = String((rec as EntityRecord)[key] ?? '').trim();
    if (value) output[key] = value;
  }
  return output;
}

/** 최초 공급/입력 원본 — 이미 있으면 유지, 없으면 현재값 스냅샷. */
export function captureRawVehicle(rec: EntityRecord): RawVehicle {
  if (rec._raw_vehicle && typeof rec._raw_vehicle === 'object') {
    return rec._raw_vehicle as RawVehicle;
  }
  return pickSnapTrack(rec);
}

/** 원본과 현재 값 중 바뀐 필드만 반환한다. */
export function snapFieldDiffs(raw: RawVehicle | null | undefined, current: EntityRecord): {
  key: SnapTrackKey;
  label: string;
  from: string;
  to: string;
}[] {
  if (!raw) return [];
  const output: { key: SnapTrackKey; label: string; from: string; to: string }[] = [];
  for (const key of SNAP_TRACK_KEYS) {
    const from = String(raw[key] ?? '').trim();
    const to = String(current[key] ?? '').trim();
    if (from === to || (!from && !to)) continue;
    output.push({ key, label: SNAP_TRACK_LABEL[key], from: from || '—', to: to || '—' });
  }
  return output;
}

export function appendSnapHistory(
  rec: EntityRecord,
  from: RawVehicle,
  to: RawVehicle,
  confidence: string,
  source?: string,
): SnapHistoryEntry[] {
  const changedFrom: RawVehicle = {};
  const changedTo: RawVehicle = {};
  for (const key of SNAP_TRACK_KEYS) {
    const before = String(from[key] ?? '').trim();
    const after = String(to[key] ?? '').trim();
    if (before === after) continue;
    if (before) changedFrom[key] = before;
    if (after) changedTo[key] = after;
  }
  const previous = Array.isArray(rec._snap_history)
    ? rec._snap_history as SnapHistoryEntry[]
    : [];
  if (!Object.keys(changedFrom).length && !Object.keys(changedTo).length) {
    return previous.slice(-10);
  }
  const entry: SnapHistoryEntry = {
    at: Date.now(),
    confidence,
    source,
    from: changedFrom,
    to: changedTo,
  };
  return [...previous, entry].slice(-10);
}
