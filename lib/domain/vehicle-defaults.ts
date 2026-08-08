import type { MasterEntry } from '@/lib/domain/vehicle-master-types';

/**
 * 차명에 **무엇까지 적을 것인가** — 차종마스터가 정한다.
 *
 * 규칙 하나로 정리된다: **고를 수 있는 것만 적는다.**
 *   · 그랜저 GN7 은 2륜·4륜을 «고를 수 있으므로» 구동을 적는다.
 *   · 카니발 KA4 는 9·7·11·4인승을 «고를 수 있으므로» 인승을 적는다.
 *   · 쏘나타 DN8 은 둘 다 선택지가 없으므로 아무것도 안 적는다 — 적으면 이름만 길어진다.
 *   · 승용에 인승을 안 적는 이유도 「5인승이라서」가 아니라 «고를 게 없어서»다.
 *
 * 판단 근거는 어림짐작이 아니라 마스터의 `variants[].drivetrain` · `variants[].seat` 이다.
 * 모델이 새로 나와 선택지가 생기면 마스터만 고치면 되고 여기 코드는 그대로다.
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

/** 세부모델이 무엇을 고를 수 있는가. 마스터에 없으면 빈 목록(=적지 않는다). */
export function choicesOf(subModel: unknown, entries: MasterEntry[]): VehicleChoices {
  const key = S(subModel);
  if (!key) return { drives: [], seats: [] };
  const hit = cache.get(key);
  if (hit) return hit;
  const entry = entries.find((e) => S((e as { sub_model?: string }).sub_model) === key);
  const variants = (entry as { variants?: { drivetrain?: unknown; seat?: unknown }[] } | undefined)?.variants || [];
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
 * 이름에 적을 인승 — **고를 수 있을 때만.**
 * 적힌 값이 없으면 마스터 선택지 중 가장 흔한 것(첫 값)으로 본다 —
 * 카니발이라고만 적혀 와도 9인승인 게 사실이다.
 */
export function seatsForName(raw: unknown, subModel: unknown, entries: MasterEntry[]): string {
  const { seats } = choicesOf(subModel, entries);
  if (seats.length < 2) return '';
  return S(raw) || seats[0];
}

/** 시트의 «인승» 칸 — 이름에 안 적는 차라도 값 자체는 채워 준다(거르기·확인용). */
export function seatsValue(raw: unknown, subModel: unknown, entries: MasterEntry[]): string {
  const given = S(raw);
  if (given) return given;
  const { seats } = choicesOf(subModel, entries);
  return seats.length === 1 ? seats[0] : '';
}

/** 시트의 «구동» 칸 — 선택지가 있으면 채우고, 없으면 비운다(없는 축을 만들지 않는다). */
export function driveValue(raw: unknown, subModel: unknown, entries: MasterEntry[]): string {
  const canon = canonDrive(raw);
  if (canon) return canon;
  const { drives } = choicesOf(subModel, entries);
  if (drives.length === 1) return drives[0];
  return drives.length >= 2 ? DRIVE_2WD : '';
}


/**
 * 차명 조립 — **고를 수 있는 것만 적고, 같은 말을 두 번 적지 않는다.**
 *
 *   세부모델 + 파워트레인(연료·배기량 · 고를 수 있으면 인승·구동) + 세부트림
 *   「카니발 KA4 디젤 2.2 9인승 프레스티지」
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

  const parts: string[] = [];
  for (const part of [S(p.sub_model) || S(p.model), power, S(p.trim_name)]) {
    if (!part) continue;
    if (parts.some((x) => x.includes(part))) continue;
    parts.push(part);
  }
  return parts.join(' ');
}
