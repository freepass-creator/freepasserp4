/**
 * 차종분류 한 칸 + 코드. 크기·구분을 나눠 붙이지 않는다.
 *
 * 판매시트 「차종구분」은 이 표의 **label** 을 그대로 싣는다(vc-15 → 준대형 세단).
 * 코드는 영구 — 삭제·재사용 금지. 새 조합은 맨 뒤에 번호를 붙인다.
 */
export type VehicleClassEntry = { code: `vc-${string}`; label: string };

export const VEHICLE_CLASS_CATALOG = [
  { code: 'vc-01', label: '경형 해치백' },
  { code: 'vc-02', label: '경형 SUV' },
  { code: 'vc-03', label: '경형 MPV' },
  { code: 'vc-04', label: '소형 세단' },
  { code: 'vc-05', label: '소형 SUV' },
  { code: 'vc-06', label: '소형 해치백' },
  { code: 'vc-07', label: '소형화물' },
  { code: 'vc-08', label: '준중형 세단' },
  { code: 'vc-09', label: '준중형 SUV' },
  { code: 'vc-10', label: '준중형 해치백' },
  { code: 'vc-11', label: '중형 세단' },
  { code: 'vc-12', label: '중형 SUV' },
  { code: 'vc-13', label: '중형 MPV' },
  { code: 'vc-14', label: '중형 픽업' },
  { code: 'vc-15', label: '준대형 세단' },
  { code: 'vc-16', label: '준대형 SUV' },
  { code: 'vc-17', label: '대형 세단' },
  { code: 'vc-18', label: '대형 SUV' },
  { code: 'vc-19', label: '대형 MPV' },
  { code: 'vc-20', label: '승합' },
] as const satisfies readonly VehicleClassEntry[];

export const VEHICLE_CLASS_LABELS = VEHICLE_CLASS_CATALOG.map((row) => row.label);

/** 옛 크기만 표기 → 조합 한 칸. 차형이 갈리는 경형·소형은 붙이지 않는다. */
const CLASS_ALIASES: Record<string, string> = {
  '대형 rv': '대형 MPV',
  '중형 rv': '중형 MPV',
  '픽업': '중형 픽업',
  '준대형': '준대형 세단',
  '대형': '대형 세단',
  '중형': '중형 세단',
  '준중형': '준중형 세단',
};

const fold = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const key = (value: unknown) => fold(value).toLowerCase();

const BY_CODE = new Map<string, string>(VEHICLE_CLASS_CATALOG.map((row) => [row.code, row.label]));
const BY_LABEL = new Map<string, string>(VEHICLE_CLASS_CATALOG.map((row) => [key(row.label), row.code]));

export function isVehicleClassCode(value: unknown): boolean {
  return /^vc-\d{2}$/.test(fold(value));
}

export function vehicleClassLabelFromCode(code: unknown): string {
  return BY_CODE.get(fold(code) as `vc-${string}`) || '';
}

export function canonVehicleClassLabel(raw: unknown): string {
  const text = fold(raw);
  if (!text) return '';
  if (isVehicleClassCode(text)) return vehicleClassLabelFromCode(text);
  const aliased = CLASS_ALIASES[key(text)] || text;
  if (BY_LABEL.has(key(aliased))) return VEHICLE_CLASS_CATALOG.find((row) => key(row.label) === key(aliased))!.label;
  return aliased;
}

export function vehicleClassCodeFromLabel(raw: unknown): string {
  const label = canonVehicleClassLabel(raw);
  return BY_LABEL.get(key(label)) || '';
}

/** 판매시트가 싣는 값 — 코드면 글자, 글자면 캐논. */
export function vehicleClassDisplay(raw: unknown): string {
  return canonVehicleClassLabel(raw);
}
