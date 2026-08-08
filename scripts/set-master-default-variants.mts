/**
 * 차종마스터에 세부모델당 **기본 조합**(variant.default) 1개를 찍는다.
 *
 * 우선순위(스냅 쪽 SSOT와 동일):
 *   1) 공급사가 명시한 인승·구동·연료 → 그 조합
 *   2) 비어 있을 때만 여기 default 조합을 가져옴
 *
 * 큐레이션 근거(웹·가격표, 엔트리/기본 옵션):
 *   · 카니발 신형 KA4: 가솔린 3.5 · 9인승 (2026 디젤 단종)
 *   · 팰리세이드 LX3: 가솔린 2.5 · 9인승 · 2WD
 *   · 쏘렌토 MQ4 / 싼타페 MX5급: **5인승**이 기본, 6·7은 옵션 · 2WD
 *   · 그랜저 GN7: 가솔린 2.5 · 2WD
 *
 * fallback 은 **인승축 또는 구동축이 있는 세부모델만** (승용 무축은 안 찍음).
 *
 *   npx tsx scripts/set-master-default-variants.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { modeSeat } from '../lib/domain/vehicle-master-variant';
import type { MasterEntry, MasterVariant } from '../lib/domain/vehicle-master-types';

const PATH = 'public/data/vehicle-master.json';
const S = (v: unknown) => String(v ?? '').trim();

type PickFn = (variants: MasterVariant[]) => MasterVariant | undefined;

function pick(
  vs: MasterVariant[],
  pred: (v: MasterVariant) => boolean,
): MasterVariant | undefined {
  return vs.find(pred);
}

/** 2WD 선호 · 없으면 구동 없는 것 · 마지막에 아무거나 */
function prefer2wd(vs: MasterVariant[], extra?: (v: MasterVariant) => boolean): MasterVariant | undefined {
  const pool = extra ? vs.filter(extra) : vs;
  if (!pool.length) return undefined;
  return pool.find((v) => S(v.drivetrain) === '2WD')
    || pool.find((v) => !S(v.drivetrain))
    || pool[0];
}

const CURATED: Record<string, PickFn> = {
  // —— 레이 / 모닝: 승용·밴은 세부모델이 다름(인승 축 아님). 밴은 `… 밴`.
  // 승용 default 는 연료만(인승 표기 안 함). 밴 default 는 2인승 라인.
  '더 뉴 레이 TAM': (vs) => pick(vs, (v) => S(v.fuel) === '가솔린') || vs[0],
  '더 뉴 레이 TAM (2017~2022)': (vs) => pick(vs, (v) => S(v.fuel) === '가솔린') || vs[0],
  '레이 TAM': (vs) => pick(vs, (v) => S(v.fuel) === '가솔린') || vs[0],
  '더 뉴 레이 TAM 밴': (vs) => pick(vs, (v) => (v.seat ?? 0) === 2) || vs[0],
  '더 뉴 레이 TAM (2017~2022) 밴': (vs) => pick(vs, (v) => (v.seat ?? 0) === 2) || vs[0],
  '레이 TAM 밴': (vs) => pick(vs, (v) => (v.seat ?? 0) === 2) || vs[0],
  '모닝 JA': (vs) => pick(vs, (v) => S(v.fuel) === '가솔린') || vs[0],
  '모닝 어반 JA': (vs) => pick(vs, (v) => S(v.fuel) === '가솔린') || vs[0],
  '올 뉴 모닝 JA': (vs) => pick(vs, (v) => S(v.fuel) === '가솔린') || vs[0],
  '올 뉴 모닝 TA': (vs) => pick(vs, (v) => S(v.fuel) === '가솔린') || vs[0],
  '더 뉴 모닝 TA': (vs) => pick(vs, (v) => S(v.fuel) === '가솔린') || vs[0],
  '뉴모닝 SA': (vs) => pick(vs, (v) => S(v.fuel) === '가솔린') || vs[0],
  '모닝 JA 밴': (vs) => pick(vs, (v) => (v.seat ?? 0) === 2) || vs[0],
  '모닝 어반 JA 밴': (vs) => pick(vs, (v) => (v.seat ?? 0) === 2) || vs[0],
  '올 뉴 모닝 JA 밴': (vs) => pick(vs, (v) => (v.seat ?? 0) === 2) || vs[0],
  '올 뉴 모닝 TA 밴': (vs) => pick(vs, (v) => (v.seat ?? 0) === 2) || vs[0],
  '더 뉴 모닝 TA 밴': (vs) => pick(vs, (v) => (v.seat ?? 0) === 2) || vs[0],
  '뉴모닝 SA 밴': (vs) => pick(vs, (v) => (v.seat ?? 0) === 2) || vs[0],

  // —— 카니발 ——
  '더 뉴 카니발 KA4': (vs) =>
    pick(vs, (v) => S(v.fuel) === '가솔린' && v.displacement_l === 3.5 && v.seat === 9),
  '카니발 KA4': (vs) =>
    pick(vs, (v) => S(v.fuel) === '디젤' && Number(v.displacement_l) === 2.2 && v.seat === 9)
    || pick(vs, (v) => S(v.fuel) === '가솔린' && v.displacement_l === 3.5 && v.seat === 9),
  '더 뉴 카니발 YP': (vs) =>
    pick(vs, (v) => S(v.fuel) === '디젤' && Number(v.displacement_l) === 2.2 && v.seat === 9),
  '올 뉴 카니발 YP': (vs) =>
    pick(vs, (v) => S(v.fuel) === '디젤' && Number(v.displacement_l) === 2.2 && v.seat === 9),
  '카니발 R VQ': (vs) =>
    pick(vs, (v) => v.seat === 11)
    || prefer2wd(vs),
  '그랜드 카니발 VQ': (vs) =>
    pick(vs, (v) => v.seat === 11)
    || prefer2wd(vs),

  // —— 팰리세이드 ——
  '팰리세이드 LX3': (vs) =>
    pick(vs, (v) => S(v.fuel) === '가솔린' && S(v.drivetrain) === '2WD' && v.seat === 9),
  '더 뉴 팰리세이드 LX2': (vs) => prefer2wd(vs, (v) => v.seat === 7),
  '팰리세이드 LX2': (vs) => prefer2wd(vs, (v) => v.seat === 7),

  // —— 그랜저 (인승 축 없음, 구동만) ——
  '그랜저 GN7': (vs) =>
    pick(vs, (v) => S(v.fuel) === '가솔린' && v.displacement_l === 2.5 && S(v.drivetrain) === '2WD'),
  '더 뉴 그랜저 GN7': (vs) =>
    pick(vs, (v) => S(v.fuel) === '가솔린' && v.displacement_l === 2.5 && S(v.drivetrain) === '2WD'),
  '디 올 뉴 그랜저 GN7': (vs) =>
    pick(vs, (v) => S(v.fuel) === '가솔린' && v.displacement_l === 2.5 && S(v.drivetrain) === '2WD'),

  // —— 쏘렌토: 5인승이 기본, 6·7은 유료 옵션 · 2WD ——
  '더 뉴 쏘렌토 MQ4': (vs) => prefer2wd(vs, (v) => v.seat === 5) || prefer2wd(vs),
  '쏘렌토 MQ4': (vs) => prefer2wd(vs, (v) => v.seat === 5) || prefer2wd(vs),
  '더 뉴 쏘렌토 UM': (vs) => prefer2wd(vs, (v) => v.seat === 5) || prefer2wd(vs),
  '올 뉴 쏘렌토 UM': (vs) => prefer2wd(vs, (v) => v.seat === 5) || prefer2wd(vs),

  // —— 싼타페: MX5·최근은 5인승 기본 · 2WD ——
  '디 올 뉴 싼타페 MX5': (vs) => prefer2wd(vs, (v) => !v.seat || v.seat === 5) || prefer2wd(vs),
  '더 뉴 싼타페 TM': (vs) => prefer2wd(vs, (v) => v.seat === 5) || prefer2wd(vs),
  '싼타페 TM': (vs) => prefer2wd(vs, (v) => v.seat === 5) || prefer2wd(vs),
  '싼타페 더 프라임 DM': (vs) => prefer2wd(vs, (v) => v.seat === 5) || prefer2wd(vs),
  '싼타페 DM': (vs) => prefer2wd(vs, (v) => v.seat === 5) || prefer2wd(vs),
  '싼타페 CM': (vs) => prefer2wd(vs),
  '싼타페 SM': (vs) => prefer2wd(vs, (v) => v.seat === 5) || prefer2wd(vs),

  // —— 스포티지 / 투싼 / 코나 / 싼타페급 콤팩트: 구동만 → 2WD ——
  '더 뉴 스포티지 NQ5': (vs) => prefer2wd(vs),
  '스포티지 NQ5': (vs) => prefer2wd(vs),
  '스포티지 더 볼드 QL': (vs) => prefer2wd(vs),
  '스포티지 QL': (vs) => prefer2wd(vs),
  '더 뉴 투싼 NX4': (vs) => prefer2wd(vs),
  '투싼 NX4': (vs) => prefer2wd(vs),
  '더 뉴 투싼 TL': (vs) => prefer2wd(vs),
  '디 올 뉴 코나 SX2': (vs) => prefer2wd(vs),
  '더 뉴 코나 OS': (vs) => prefer2wd(vs),
  '코나 OS': (vs) => prefer2wd(vs),

  // —— 스타리아 / 카니발급 RV: 투어러 엔트리 흔히 9 ——
  '더 뉴 스타리아 US4': (vs) => prefer2wd(vs, (v) => v.seat === 9) || prefer2wd(vs, (v) => v.seat === 11) || prefer2wd(vs),
  '스타리아 US4': (vs) => prefer2wd(vs, (v) => v.seat === 9) || prefer2wd(vs),

  // —— 모하비 / 토레스 ——
  '모하비 더 마스터 HM': (vs) => pick(vs, (v) => v.seat === 7) || prefer2wd(vs),
  '더 뉴 모하비 HM': (vs) => prefer2wd(vs),
  '모하비 HM': (vs) => prefer2wd(vs),
  '더 뉴 토레스 J116/J140': (vs) => prefer2wd(vs, (v) => v.seat === 5) || prefer2wd(vs),
  '토레스 J100': (vs) => prefer2wd(vs),

  // —— K8 / G80 구동 ——
  '더 뉴 K8 GL3': (vs) => prefer2wd(vs),
  'K8 GL3': (vs) => prefer2wd(vs),
  'G80 RG3': (vs) =>
    pick(vs, (v) => S(v.fuel) === '가솔린' && v.displacement_l === 2.5 && S(v.drivetrain) === '2WD')
    || prefer2wd(vs),
};

function axisOf(variants: MasterVariant[]): { seats: boolean; drives: boolean; disps: boolean } {
  const seats = new Set(variants.map((v) => v.seat).filter((s): s is number => s != null && s > 0));
  const drives = new Set(variants.map((v) => S(v.drivetrain)).filter(Boolean));
  const disps = new Set(variants.map((v) => v.displacement_l).filter((d): d is number => d != null && d > 0));
  return { seats: seats.size >= 2, drives: drives.size >= 2, disps: disps.size >= 2 };
}

function fallbackPick(variants: MasterVariant[]): MasterVariant | undefined {
  const axis = axisOf(variants);
  // 인승·구동·배기 중 하나라도 고를 축이 있어야 default 찍음
  if (!axis.seats && !axis.drives && !axis.disps) return undefined;
  if (!variants.length) return undefined;
  if (variants.length === 1) return variants[0];

  const mode = axis.seats ? modeSeat(variants) : null;
  // 밴(2인)보다 승용(≥4) 선호 — 레이/모닝 fallback 오탐 방지
  const passengerMode = axis.seats
    ? modeSeat(variants.filter((v) => (v.seat ?? 0) >= 4))
    : null;
  const wantSeat = passengerMode ?? mode;

  const scored = variants.map((v) => {
    let s = 0;
    if (wantSeat != null && v.seat === wantSeat) s += 3;
    if (axis.drives && S(v.drivetrain) === '2WD') s += 2;
    if (S(v.fuel) === '가솔린') s += 1.2;
    if (S(v.fuel) === '하이브리드') s += 0.8;
    if (S(v.fuel) === '디젤') s += 0.3;
    if (S(v.fuel) === 'LPG') s += 0.2;
    // 배기 축만 있는 승용: 작은 배기(엔트리) 약간 선호
    if (axis.disps && !axis.seats && v.displacement_l != null) {
      const max = Math.max(...variants.map((x) => x.displacement_l || 0));
      s += Math.max(0, 1 - (v.displacement_l / Math.max(max, 0.1)));
    }
    if ((v.seat ?? 0) === 2 && wantSeat != null && wantSeat >= 4) s -= 2;
    return { v, s };
  }).sort((a, b) => b.s - a.s);
  return scored[0]?.v;
}

function main() {
  const raw = JSON.parse(readFileSync(PATH, 'utf8'));
  const entries = (raw.entries || raw) as MasterEntry[];
  let curated = 0;
  let fallback = 0;
  let skipped = 0;
  let cleared = 0;

  for (const e of entries) {
    const variants = e.variants || [];
    for (const v of variants) {
      if (v.default) {
        delete v.default;
        cleared++;
      }
    }
    if (!variants.length) {
      skipped++;
      continue;
    }

    const pickFn = CURATED[e.sub_model];
    const chosen = pickFn ? pickFn(variants) : fallbackPick(variants);
    if (!chosen) {
      skipped++;
      continue;
    }
    chosen.default = true;
    if (pickFn) curated++;
    else fallback++;
  }

  writeFileSync(PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  console.log(`\n기본 조합 마킹 · curated ${curated} · fallback ${fallback} · skip(무축등) ${skipped} · cleared ${cleared}`);
  console.log(`→ ${PATH}\n`);

  for (const sub of Object.keys(CURATED)) {
    const e = entries.find((x) => x.sub_model === sub);
    const d = e?.variants?.find((v) => v.default);
    console.log(
      `  ${sub.padEnd(26)} ${d ? `${d.fuel} ${d.displacement_l ?? ''} ${d.seat ?? '-'}인 ${d.drivetrain ?? '-'}`.trim() : '(서브모델 없음/미매칭)'}`,
    );
  }
  console.log('');
}

main();
