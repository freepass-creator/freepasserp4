import type { MasterEntry, SnapDefaultAtoms } from '@/lib/domain/vehicle-master-types';
import { seatAxisMatters } from '@/lib/domain/vehicle-master-options';
import { defaultVariant, modeSeat } from '@/lib/domain/vehicle-master-variant';

export type { SnapDefaultAtoms };

/**
 * 차명·빈 신호일 때 **어느 마스터 조합을 가져올 것인가**.
 *
 * 규칙: 입력을 채우지 않는다. 마스터에 있는 조합만 고른다.
 *   · variant.default 가 있으면 그걸 기본 조합으로 쓴다.
 *   · 없으면 축 휴리스틱(구동≥2 → 2WD, 인승≥2 → modeSeat).
 *   · 선택지 없는 축(승용 인승 등) → 적지 않는다.
 */

const S = (v: unknown) => String(v ?? '').trim();

export const DRIVE_2WD = '2WD';
export const DRIVE_4WD = '4WD';

/** 구동 표기 규격 — 재고에 6가지로 갈려 있었다(2WD·AWD·4WD·xDrive·콰트로·4MATIC). */
export function canonDrive(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase().replace(/\s/g, '');
  if (!s) return '';
  if (/4WD|AWD|4륜|사륜|네바퀴|4MATIC|XDRIVE|콰트로|QUATTRO|FOUR/.test(s)) return DRIVE_4WD;
  if (/2WD|전륜|후륜|FF|FR|이륜|FWD|RWD/.test(s)) return DRIVE_2WD;
  return '';
}

export type VehicleChoices = {
  /** 그 세부모델이 실제로 고를 수 있는 구동 — 둘 이상이면 이름에 적는다. */
  drives: string[];
  /** 고를 수 있는 인승 — 둘 이상이면 이름에 적는다. */
  seats: string[];
};

const cache = new Map<string, VehicleChoices>();

function entryOf(subModel: unknown, entries: MasterEntry[]): MasterEntry | undefined {
  const key = S(subModel);
  if (!key) return undefined;
  return entries.find((e) => S(e.sub_model) === key);
}

/** 마스터 선택지 중 대표 인승 — default 조합 seat → 없으면 최빈(modeSeat). */
export function representativeSeat(subModel: unknown, entries: MasterEntry[]): string {
  const entry = entryOf(subModel, entries);
  if (!entry) return '';
  const def = defaultVariant(entry);
  if (def?.seat != null && def.seat > 0) return String(def.seat);
  const mode = modeSeat(entry.variants || []);
  return mode != null ? String(mode) : '';
}

/** 기본 조합의 구동 — default.drivetrain → 없으면 2WD(축 있을 때). */
export function representativeDrive(subModel: unknown, entries: MasterEntry[]): string {
  const entry = entryOf(subModel, entries);
  if (!entry) return '';
  const { drives } = choicesOf(subModel, entries);
  if (drives.length < 1) return '';
  const def = defaultVariant(entry);
  const fromDef = canonDrive(def?.drivetrain);
  if (fromDef && drives.includes(fromDef)) return fromDef;
  if (drives.length === 1) return drives[0];
  return drives.includes(DRIVE_2WD) ? DRIVE_2WD : drives[0];
}

/** 세부모델이 무엇을 고를 수 있는가. 마스터에 없으면 빈 목록(=적지 않는다). */
export function choicesOf(subModel: unknown, entries: MasterEntry[]): VehicleChoices {
  const key = S(subModel);
  if (!key) return { drives: [], seats: [] };
  const hit = cache.get(key);
  if (hit) return hit;
  const entry = entryOf(key, entries);
  const variants = entry?.variants || [];
  const drives = [...new Set(variants.map((v) => canonDrive(v.drivetrain)).filter(Boolean))];
  const seats = [...new Set(variants.map((v) => S(v.seat)).filter((x) => x && x !== '0'))];
  const out: VehicleChoices = { drives, seats };
  cache.set(key, out);
  return out;
}

/**
 * 이름에 적을 구동 — **고를 수 있을 때만.**
 * 선택지가 하나뿐이면 적지 않는다(당연한 값이라 이름만 길어진다).
 * 적힌 값이 없는데 선택지가 있으면 2륜으로 본다 — 4륜은 값이 올라가는 사양이라 반드시 적힌다.
 */
export function driveForName(raw: unknown, subModel: unknown, entries: MasterEntry[]): string {
  const { drives } = choicesOf(subModel, entries);
  if (drives.length < 2) return '';
  return canonDrive(raw) || DRIVE_2WD;
}

/**
 * 이름에 적을 인승 — **인승 축이 있을 때만**(세부모델 variants 인승 ≥2).
 * 적힌 값이 없으면 그 세부모델 대표 인승(modeSeat). 단일·무축은 공란.
 */
export function seatsForName(raw: unknown, subModel: unknown, entries: MasterEntry[]): string {
  const entry = entryOf(subModel, entries);
  if (entry && !seatAxisMatters(entry)) return '';
  const { seats } = choicesOf(subModel, entries);
  if (seats.length < 2) return '';
  return S(raw) || representativeSeat(subModel, entries) || seats[0];
}

/**
 * 시트의 «인승» 칸 — 인승 축(≥2)일 때만 빈 칸을 대표값으로 채운다.
 * 승용처럼 축이 없으면 비운다(단일 인승도 발명하지 않음).
 */
export function seatsValue(raw: unknown, subModel: unknown, entries: MasterEntry[]): string {
  const given = S(raw);
  if (given) return given;
  const entry = entryOf(subModel, entries);
  if (entry && !seatAxisMatters(entry)) return '';
  const { seats } = choicesOf(subModel, entries);
  if (seats.length < 2) return '';
  return representativeSeat(subModel, entries) || seats[0];
}

/** 시트의 «구동» 칸 — 선택지가 있으면 채우고, 없으면 비운다(없는 축을 만들지 않는다). */
export function driveValue(raw: unknown, subModel: unknown, entries: MasterEntry[]): string {
  const canon = canonDrive(raw);
  if (canon) return canon;
  return representativeDrive(subModel, entries);
}

/**
 * snap 전 — 공급사가 비운 축만 마스터 기본 조합에서 가져온다.
 * 이미 적힌 인승·구동은 그대로 둔다(덮어쓰지 않음). 저장값은 아님.
 */
export function snapDefaultHints(
  product: { seats?: unknown; drive_type?: unknown },
  entry: MasterEntry,
  entries: MasterEntry[],
): { seats: string; drive_type: string; filled: SnapDefaultAtoms } {
  const sub = entry.sub_model;
  const filled: SnapDefaultAtoms = {};
  const givenSeats = S(product.seats);
  const givenDrive = canonDrive(product.drive_type);

  const seats = givenSeats || seatsValue('', sub, entries);
  if (!givenSeats && seats) filled.seats = true;

  const drive = givenDrive || driveValue('', sub, entries);
  if (!givenDrive && drive) filled.drive_type = true;

  return { seats, drive_type: drive, filled };
}

/**
 * 차명 조립 — **고를 수 있는 것만 적고, 같은 말을 두 번 적지 않는다.**
 *
 *   세부모델 + 파워트레인(연료·배기량 · 고를 수 있으면 인승·구동) + 세부트림
 *   예) 「카니발 KA4 디젤 2.2 9인승 프레스티지」·「그랜저 GN7 가솔린 2.5 2WD」
 *
 * 이관 스크립트·검사·화면이 각자 조립하면 같은 차가 곳곳에서 다르게 보인다. 여기 하나만 쓴다.
 */
export function composeVehicleName(
  p: {
    sub_model?: unknown; model?: unknown; variant?: unknown;
    seats?: unknown; drive_type?: unknown; trim_name?: unknown;
  },
  entries: MasterEntry[],
): string {
  const variantText = S(p.variant);
  const seats = seatsForName(p.seats, p.sub_model, entries);
  const drive = driveForName(p.drive_type, p.sub_model, entries);
  const has = (token: string) => !!token && variantText.replace(/\s/g, '').includes(token.replace(/\s/g, ''));
  const power = [
    variantText,
    seats && !has(`${seats}인승`) ? `${seats}인승` : '',
    drive && !has(drive) ? drive : '',
  ].filter(Boolean).join(' ');

  /**
   * 트림에 세부모델이 다시 들어 있는 경우가 있다 — 「A6 e-트론」의 트림이 「기본 A6 e-트론」이다.
   * 그대로 이으면 「A6 e-트론 … 기본 A6 e-트론」이 된다. 마스터를 고치는 대신 조립에서 걷는다 —
   * 「HG220 프리미엄」·「GT 320d」처럼 모델 조각을 품은 «진짜 트림»이 많아 데이터로는 못 가른다.
   */
  const main = S(p.sub_model) || S(p.model);
  let trim = S(p.trim_name);
  if (main && trim.includes(main)) trim = trim.replace(main, '').replace(/\s+/g, ' ').trim();

  const parts: string[] = [];
  for (const part of [main, power, trim]) {
    if (!part) continue;
    if (parts.some((x) => x.includes(part))) continue;
    parts.push(part);
  }
  return parts.join(' ');
}
