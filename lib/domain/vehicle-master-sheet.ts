/**
 * **라이브 원천대장 「차종마스터」를 읽는 한 곳 — ERP `차종코드`(mf- 트림행키).**
 *
 * ★차명·제원 사전은 `public/data/vehicle-master.json`(규격채택)이다. 엔카 원자 시트는 시세 행키용.
 *   이 파일은 상품마스터·공급사 「차종코드」 칸이 쓰는 **mf- 키 책**이다. 여기 ID를 엔카 시트로 바꾸지 마라.
 *   이 탭에는 **쓰지 않는다** (`assertNotLiveVehicleMasterTabWrite`). 코드 의미 변경·재사용 금지.
 *
 * ★왜(사장님 2026-08-14 — 「그 차에 대해서 코드를 박아두면 절대 틀릴 일이 없음.
 *   차량번호에 코드 박아두면 되잖아」)
 *
 *   차종은 차번마다 한 번 정하면 안 바뀐다. 그런데 코드가 없으면 발행할 때마다 이름으로
 *   «알아맞혀야» 하고, 알아맞히는 한 언젠가는 틀린다. 실제로 하루에 세 번 틀렸다 —
 *   배터리 용량이 배기량으로(77400) · 파워트레인 44대 뒤집힘 · 세대 오판 27대.
 *   차번에 코드를 박으면 그 셋이 **생길 자리 자체가 없어진다.**
 *
 * ★코드는 **트림행키** — `mf-002.md-036.sm-ka4::v01::t01`
 *   (`마스터ID::파워트레인순번::트림순번`). 제조사부터 세부트림까지 한 줄로 정해진다.
 *
 * ⚠ **원천은 시트다.** `public/data/vehicle-master.json` 이 아니다 —
 *   그 파일에는 트림행키도 정확배기량도 없고, 같은 라벨(「디젤 2.2」)이 두 번 나와
 *   파워트레인을 구별할 방법이 없다. 시트에는 순번이 있어 구별된다.
 * ⚠ 신규 후보는 상태 정책을 통과한 행만 쓴다. `검증중/1차확인·교차확인`은 수동 선택,
 *   `확정/확정`은 자동 선택까지 허용하고 나머지는 과거 코드 조회에만 남긴다.
 * ⚠ 라이브 「차종마스터」 탭에는 쓰지 않는다(`assertNotLiveVehicleMasterWrite`).
 */

import { ENCAR_MASTER_SHEET_ID } from './legacy-sheets';
import { resolvePowertrainLabel } from './vehicle-powertrain-label';
import {
  vehicleTrimUsageTier,
  type MasterManagementStatus,
  type MasterVerificationStatus,
  type VehicleTrimUsageTier,
} from './vehicle-trim-master';
export { ENCAR_MASTER_SHEET_ID, assertNotLiveVehicleMasterWrite } from './legacy-sheets';
export { assertNotLiveVehicleMasterTabWrite } from './vehicle-master-lock';

const S = (v: unknown) => String(v ?? '').trim();

/** 문서 — 사장님이 만든 원천대장. 탭 「차종마스터」가 트림 단위 표다. */
export const MASTER_SHEET_ID = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';
export const MASTER_TAB = '차종마스터';

/** 한 줄이 곧 «한 차종»이다. 여기 있는 값이 상품시트 차종 칸의 정본이 된다. */
export type MasterRow = {
  code: string;          // 트림행키
  masterId: string;
  maker: string; model: string; subModel: string; powertrain: string; trim: string;
  fuel: string;
  /** 정확배기량(cc). 전기차는 빈 문자열이 정상이다 — 배터리 용량을 여기 넣지 마라. */
  cc: string;
  driveType: string; seat: string; batteryKwh: string;
  state: string;         // 관리상태 — 보강대기 / 검증중 / 확정 / 제외
  verificationState: string;
  usageTier: VehicleTrimUsageTier;
};

export type MasterBook = {
  byCode: Map<string, MasterRow>;
  /** 다섯 값 → 코드들. 하나면 그걸 쓰고, 여럿이면 **못 정한 것**이다. */
  byFive: Map<string, string[]>;
  /**
   * ★**연료·배기량·트림으로 잇는 열쇠.** 파워트레인 «라벨»은 표기가 갈린다 —
   *   시트는 「가솔린 2.5 FWD」, 우리 스냅은 「가솔린 2.5 2WD」다. 라벨로만 맞추면
   *   실측 2026-08-14 기준 476대 중 131대(27%)밖에 안 붙었다.
   *   **숫자는 표기가 안 흔들린다** — 2497cc 는 어디서나 2497이다.
   */
  bySpec: Map<string, string[]>;
  /** 자동 부여에 쓸 수 있는 「확정/확정」 행만 모은 색인. */
  confirmedByFive: Map<string, string[]>;
  confirmedBySpec: Map<string, string[]>;
  rows: MasterRow[];
};

/** 다섯 값을 하나의 열쇠로. 띄어쓰기·대소문자 차이로 안 갈리게 턴다. */
export const fiveKey = (maker: unknown, model: unknown, subModel: unknown, powertrain: unknown, trim: unknown) =>
  [maker, model, subModel, powertrain, trim].map((v) => S(v).replace(/\s+/g, ' ').toLowerCase()).join('|');

/** 연료·배기량·트림 열쇠. 구동방식은 **넣지 않는다** — 표기가 갈려서(2WD↔FWD) 뒤에서 가른다. */
/**
 * ★배기량은 **리터로 반올림해** 견준다.
 * ⚠ 시트는 «정확배기량»(2,999cc)이고 우리 스냅은 «표시배기량»(3,000cc)이다.
 *   숫자를 그대로 견주면 한 대도 안 맞는다 — 실측 2026-08-14. 둘 다 3.0L 로 보면 맞는다.
 */
export const liters = (cc: unknown) => {
  const n = Number(S(cc).replace(/[^\d]/g, ''));
  return n > 0 ? (Math.round(n / 100) / 10).toFixed(1) : '';
};

export const specKey = (maker: unknown, model: unknown, subModel: unknown, fuel: unknown, cc: unknown, trim: unknown) =>
  [maker, model, subModel, fuel, liters(cc), trim]
    .map((v) => S(v).replace(/\s+/g, ' ').toLowerCase()).join('|');

/**
 * 구동방식을 세 갈래로만 본다 — 앞·뒤·네바퀴.
 * ⚠ 시트는 FWD/AWD/RWD, 스냅은 2WD/4WD/AWD/4MATIC 을 쓴다. 글자로 견주면 절대 안 맞는다.
 * ⚠ 「2WD」는 앞일 수도 뒤일 수도 있다. 그래서 **열쇠에 안 넣고** 후보를 가를 때만 쓴다.
 */
export const driveClass = (v: unknown): 'front' | 'rear' | 'all' | '' => {
  const s = S(v).toUpperCase();
  if (/AWD|4WD|4MATIC|4MOTION|XDRIVE|QUATTRO|사륜/.test(s)) return 'all';
  if (/FWD|전륜/.test(s)) return 'front';
  if (/RWD|후륜/.test(s)) return 'rear';
  if (/2WD/.test(s)) return '';     // 앞뒤를 모른다 — 모르는 것을 안다고 하지 않는다
  return '';
};

/** 「차종마스터」 탭 값 표 → 코드책. */
export function readMasterSheet(rows: string[][]): MasterBook {
  const book: MasterBook = {
    byCode: new Map(), byFive: new Map(), bySpec: new Map(),
    confirmedByFive: new Map(), confirmedBySpec: new Map(), rows: [],
  };
  if (!rows.length) return book;
  const hdr = (rows[0] || []).map(S);
  const at = (n: string) => hdr.indexOf(n);
  const c = {
    code: at('트림행키'), mid: at('마스터ID'), maker: at('제조사'), model: at('모델'), sub: at('세부모델'),
    pt: at('파워트레인'), trim: at('세부트림'), fuel: at('연료'), cc: at('정확배기량(cc)'),
    displacement: at('표시배기량(L)'), turbo: at('터보'),
    drive: at('구동방식'), seat: at('인승'), kwh: at('배터리(kWh)'),
    state: at('관리상태'), verification: at('검증상태'),
  };
  if (c.code < 0) return book;
  const pick = (r: string[], i: number) => (i >= 0 ? S(r[i]) : '');
  for (const r of rows.slice(1)) {
    const code = pick(r, c.code);
    if (!code) continue;
    const state = pick(r, c.state);
    const verificationState = pick(r, c.verification);
    const usageTier = vehicleTrimUsageTier(
      state as MasterManagementStatus,
      verificationState as MasterVerificationStatus,
    );
    const turboRaw = pick(r, c.turbo);
    const powertrain = resolvePowertrainLabel({
      sheetLabel: pick(r, c.pt),
      axes: {
        fuel: pick(r, c.fuel),
        displacement_l: pick(r, c.displacement),
        turbo: turboRaw === '예' ? true : turboRaw === '아니오' ? false : null,
        drivetrain: pick(r, c.drive),
        battery_kwh: pick(r, c.kwh),
      },
    });
    const row: MasterRow = {
      code, masterId: pick(r, c.mid),
      maker: pick(r, c.maker), model: pick(r, c.model), subModel: pick(r, c.sub),
      powertrain, trim: pick(r, c.trim), fuel: pick(r, c.fuel),
      // ⚠ 숫자만 남긴다. 「1,999cc」처럼 적힌 줄이 섞여 있다.
      cc: pick(r, c.cc).replace(/[^\d]/g, ''),
      driveType: pick(r, c.drive), seat: pick(r, c.seat).replace(/[^\d]/g, ''),
      batteryKwh: pick(r, c.kwh), state, verificationState, usageTier,
    };
    book.byCode.set(code, row);
    book.rows.push(row);
    // 차단 행은 신규 후보에서 뺀다. 과거 이력 조회(byCode)에는 남겨 코드의 의미를 보존한다.
    if (row.usageTier === 'blocked') continue;
    const k = fiveKey(row.maker, row.model, row.subModel, row.powertrain, row.trim);
    book.byFive.set(k, [...(book.byFive.get(k) || []), code]);
    const sk = specKey(row.maker, row.model, row.subModel, row.fuel, row.cc, row.trim);
    book.bySpec.set(sk, [...(book.bySpec.get(sk) || []), code]);
    if (row.usageTier === 'automatic') {
      book.confirmedByFive.set(k, [...(book.confirmedByFive.get(k) || []), code]);
      book.confirmedBySpec.set(sk, [...(book.confirmedBySpec.get(sk) || []), code]);
    }
  }
  return book;
}

/** 어떻게 정했나 — 조용히 틀린 코드가 박히지 않게 밖에서 셀 수 있어야 한다. */
export type CodePick = {
  code: string;
  /**
   * 왜 못 정했는지까지 돌려준다. 「없음」 하나로 뭉뚱그리면 **마스터에 뭘 더 넣어야 하는지**를
   * 알 수 없다 — 세부모델이 통째로 없는 것과 트림 이름만 다른 것은 할 일이 전혀 다르다.
   */
  how: '하나' | '여럿' | '세부모델없음' | '트림없음' | '배기량안맞음' | '없음';
  candidates: string[];
};

export type MasterMatchAxes = {
  drivetrain?: unknown;
  seats?: unknown;
  batteryKwh?: unknown;
};

/** 그 세부모델이 마스터에 있기는 한가 — 없으면 «마스터에 넣을 차»다. */
function hasSubModel(book: MasterBook, maker: unknown, model: unknown, subModel: unknown, automaticOnly = false) {
  const k = [maker, model, subModel].map((v) => S(v).replace(/\s+/g, ' ').toLowerCase()).join('|');
  return book.rows.some((r) => (automaticOnly ? r.usageTier === 'automatic' : r.usageTier !== 'blocked')
    && [r.maker, r.model, r.subModel].map((v) => S(v).replace(/\s+/g, ' ').toLowerCase()).join('|') === k);
}

/**
 * 다섯 값으로 코드를 정한다.
 * ⚠ **여럿이면 안 고른다.** 실측 2026-08-14: 다섯 값이 같은데 코드가 갈리는 조합이 98개다
 *   (카니발 KA4 「디젤 2.2 노블레스」가 v01·v02 둘 다에 있다 — 연식·사양이 달라 갈린 것).
 *   아무거나 박으면 그게 곧 «절대 안 틀린다»는 약속을 깨는 자리다.
 */
function pickMasterCodeByMode(
  book: MasterBook,
  maker: unknown, model: unknown, subModel: unknown, powertrain: unknown, trim: unknown,
  fuel?: unknown, cc?: unknown,
  axes: MasterMatchAxes = {},
  automaticOnly = false,
): CodePick {
  const byFive = automaticOnly ? book.confirmedByFive : book.byFive;
  const bySpec = automaticOnly ? book.confirmedBySpec : book.bySpec;
  /** ① 라벨이 그대로 맞으면 그게 제일 확실하다. */
  const byLabel = byFive.get(fiveKey(maker, model, subModel, powertrain, trim)) || [];
  if (byLabel.length === 1) return { code: byLabel[0], how: '하나', candidates: byLabel };

  const narrowByAxes = (keys: string[]) => {
    let narrowed = [...keys];
    const wantedDrive = driveClass(axes.drivetrain) || driveClass(powertrain);
    if (wantedDrive) narrowed = narrowed.filter((key) => driveClass(book.byCode.get(key)?.driveType) === wantedDrive);
    const wantedSeats = Number(S(axes.seats).replace(/[^\d]/g, '')) || 0;
    if (wantedSeats) narrowed = narrowed.filter((key) => Number(book.byCode.get(key)?.seat || 0) === wantedSeats);
    const wantedBattery = Number(S(axes.batteryKwh).replace(/[^\d.]/g, '')) || 0;
    if (wantedBattery) narrowed = narrowed.filter((key) => {
      const actual = Number(S(book.byCode.get(key)?.batteryKwh).replace(/[^\d.]/g, '')) || 0;
      return actual > 0 && Math.abs(actual - wantedBattery) < 0.11;
    });
    return narrowed;
  };
  if (byLabel.length > 1) {
    const narrowed = narrowByAxes(byLabel);
    if (narrowed.length === 1) return { code: narrowed[0], how: '하나', candidates: byLabel };
  }

  /**
   * ② 라벨이 안 맞으면 **연료·배기량·트림**으로 찾는다. 숫자는 표기가 안 흔들린다.
   *    후보가 여럿이면 구동방식으로 가른다 — 그래도 하나로 안 좁혀지면 **안 고른다.**
   */
  if (liters(cc) || S(fuel)) {
    const ks = bySpec.get(specKey(maker, model, subModel, fuel, cc, trim)) || [];
    if (ks.length === 1) return { code: ks[0], how: '하나', candidates: ks };
    if (ks.length > 1) {
      const narrowed = narrowByAxes(ks);
      if (narrowed.length === 1) return { code: narrowed[0], how: '하나', candidates: ks };
      return { code: '', how: '여럿', candidates: ks };
    }
  }
  if (byLabel.length > 1) return { code: '', how: '여럿', candidates: byLabel };
  /** 못 찾았으면 **어디서 갈렸는지**까지 짚어 준다. 그게 곧 사람이 할 일 목록이다. */
  if (!hasSubModel(book, maker, model, subModel, automaticOnly)) return { code: '', how: '세부모델없음', candidates: [] };
  const sameTrim = book.rows.some((r) => (automaticOnly ? r.usageTier === 'automatic' : r.usageTier !== 'blocked')
    && S(r.maker).toLowerCase() === S(maker).toLowerCase()
    && S(r.model).toLowerCase() === S(model).toLowerCase()
    && S(r.subModel).replace(/\s+/g, ' ').toLowerCase() === S(subModel).replace(/\s+/g, ' ').toLowerCase()
    && S(r.trim).replace(/\s+/g, ' ').toLowerCase() === S(trim).replace(/\s+/g, ' ').toLowerCase());
  return { code: '', how: sameTrim ? '배기량안맞음' : '트림없음', candidates: [] };
}

/** 직원의 수동 검색·선택용. 검증중/1차확인 이상만 후보로 보여 준다. */
export function pickMasterCode(
  book: MasterBook,
  maker: unknown, model: unknown, subModel: unknown, powertrain: unknown, trim: unknown,
  fuel?: unknown, cc?: unknown,
  axes: MasterMatchAxes = {},
): CodePick {
  return pickMasterCodeByMode(book, maker, model, subModel, powertrain, trim, fuel, cc, axes, false);
}

/** 무인 자동 부여용. 관리상태/검증상태가 모두 「확정」인 행만 선택한다. */
export function pickConfirmedMasterCode(
  book: MasterBook,
  maker: unknown, model: unknown, subModel: unknown, powertrain: unknown, trim: unknown,
  fuel?: unknown, cc?: unknown,
  axes: MasterMatchAxes = {},
): CodePick {
  return pickMasterCodeByMode(book, maker, model, subModel, powertrain, trim, fuel, cc, axes, true);
}

/**
 * 코드 → 상품시트 차종 칸.
 * ★**여기가 유일한 변환 자리다.** 배기량을 파워트레인 «글자»에서 긁는 짓을 다시 하지 마라 —
 *   시트에 「정확배기량(cc)」이 이미 있고, 전기차는 그 칸이 비어 있는 것이 정상이다.
 */
export function masterCells(row: MasterRow | undefined): Record<string, string> {
  if (!row) return {};
  return {
    '제조사(정제)': row.maker,
    '모델': row.model,
    '세부모델': row.subModel,
    '파워트레인': row.powertrain,
    '세부트림': row.trim,
    '배기량(정제)': row.cc,
    '배터리용량(정제)': row.batteryKwh && Number(row.batteryKwh) > 0
      ? String(Number(Number(row.batteryKwh).toFixed(2)))
      : '',
    '연료(정제)': row.fuel,
    '구동방식': row.driveType,
    /**
     * ★인승 — 정제칸 신설(2026-08-22 · 사장님 「구동 뒤에 인승 넣어줘」).
     *   원장 「인승」 열은 숫자만 남겨 두므로(readMasterSheet `seat`) 그대로 흘린다.
     *   그전까지 인승은 정제칸에 자리가 없어 ERP 스냅만 들고 있었고, 마스터 참조를 끊은 뒤로는 새 차가 못 채워졌다.
     */
    '인승': row.seat,
  };
}

/**
 * 세부모델 제원 — 라이브 코드 책에서 **값이 하나로 모일 때만**.
 * 트림이 없어도 연료·배기량·배터리·구동은 모이면 채운다. 갈리거나 없으면 빈값.
 */
export function uniqueBookSpecs(
  book: MasterBook,
  maker: unknown,
  model: unknown,
  subModel: unknown,
  hint?: { fuel?: string },
): { fuel?: string; engine_cc?: string; battery_kwh?: string; drive_type?: string } {
  const key = [maker, model, subModel].map((v) => S(v).replace(/\s+/g, ' ').toLowerCase()).join('|');
  let rows = book.rows.filter((r) => r.usageTier !== 'blocked'
    && [r.maker, r.model, r.subModel].map((v) => S(v).replace(/\s+/g, ' ').toLowerCase()).join('|') === key);
  const fuelHint = S(hint?.fuel);
  if (fuelHint) {
    const narrowed = rows.filter((r) => S(r.fuel) === fuelHint);
    if (narrowed.length) rows = narrowed;
  }
  if (!rows.length) return {};
  const one = (vals: string[]) => {
    const xs = vals.map((v) => S(v));
    if (!xs.length || xs.some((x) => !x)) return undefined;
    return new Set(xs).size === 1 ? xs[0] : undefined;
  };
  const kwh = (v: unknown) => {
    const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
    return n > 0 ? String(Number(n.toFixed(2))) : '';
  };
  return {
    fuel: one(rows.map((r) => r.fuel)),
    engine_cc: one(rows.map((r) => r.cc)),
    battery_kwh: one(rows.map((r) => kwh(r.batteryKwh))),
    drive_type: one(rows.map((r) => r.driveType)),
  };
}
