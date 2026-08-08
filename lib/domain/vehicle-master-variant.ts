import type { EntityRecord } from '@/lib/intake/entities';
import { normFuel } from '@/lib/domain/vehicle-master-format';
import { masterVariantLabel, seatAxisMatters } from '@/lib/domain/vehicle-master-options';
import type { MasterEntry, MasterVariant } from '@/lib/domain/vehicle-master-types';

/** vehicle-defaults.DRIVE_* 와 동일 문자열 — 순환 import 금지라 여기만 리터럴. */
const DRIVE_2WD = '2WD';
const DRIVE_4WD = '4WD';

export type MasterVariantScoreDeps = {
  norm: (value: unknown) => string;
  normDrive: (value: unknown) => string;
};

export type MasterVariantScoreResult = {
  variant: MasterVariant | undefined;
  seatMatters: boolean;
};

export function modeSeat(variants: MasterVariant[]): number | null {
  const counts = new Map<number, number>();
  for (const variant of variants) {
    if (variant.seat == null || !(variant.seat > 0)) continue;
    counts.set(variant.seat, (counts.get(variant.seat) || 0) + 1);
  }
  let best: number | null = null;
  let count = -1;
  for (const [seat, current] of counts) {
    if (current > count || (current === count && best != null && seat > best)) {
      count = current;
      best = seat;
    }
  }
  return best;
}

export function modeSeatForModel(entries: MasterEntry[], model: string): number | null {
  if (!model) return null;
  return modeSeat(entries.filter((entry) => entry.model === model).flatMap((entry) => entry.variants || []));
}

/** 세부모델에 미리 찍어 둔 기본 조합. 없으면 undefined(휴리스틱으로 넘어감). */
export function defaultVariant(entry: MasterEntry | null | undefined): MasterVariant | undefined {
  const hit = (entry?.variants || []).find((v) => v.default === true);
  return hit;
}

export function selectMasterVariant(
  product: EntityRecord,
  entry: MasterEntry,
  /** 호출 시그니처 유지(세부모델 modeSeat 로 충분 — 모델 전역 집계 안 씀). */
  _entries: MasterEntry[],
  _lockedModel: string | null,
  signalBlob: string,
  wantTurbo: boolean,
  deps: MasterVariantScoreDeps,
): MasterVariantScoreResult {
  const fuel = normFuel(product.fuel_type);
  const displacement = (Number(product.engine_cc) || 0) / 1000;
  const wantedSeats = Number(product.seats) > 0 ? Number(product.seats) : 0;
  const wantedDrive = deps.normDrive(product.drive_type);
  const seatMatters = seatAxisMatters(entry);
  // 기본 조합이 마스터에 있으면 그걸 선호(신호 없을 때). 없으면 세부모델 modeSeat.
  // seatAxisMatters=false(레이·모닝 승용)면 인승 힌트·가산 없음.
  const def = defaultVariant(entry);
  const defaultSeat = seatMatters
    ? (def?.seat != null && def.seat > 0 ? def.seat : modeSeat(entry.variants || []))
    : null;

  let variant: MasterVariant | undefined;
  if (entry.variants?.length) {
    variant = entry.variants.map((candidate) => {
      let score = 0;
      const candidateFuel = normFuel(candidate.fuel);
      if (fuel && candidateFuel === fuel) score += 2;
      else if (fuel && candidateFuel && (candidateFuel.includes(fuel) || fuel.includes(candidateFuel))) score += 1;
      else if (fuel && candidateFuel) score -= 3;

      if (displacement && candidate.displacement_l) {
        score += Math.max(0, 1 - Math.abs(candidate.displacement_l - displacement) * 1.2);
      }

      // 공급사가 명시한 연료·배기·인승·구동이 있으면 그걸 고른다.
      // 기본 조합(default)은 «해당 축 신호가 없을 때만» 가져온다.
      if (wantedDrive && candidate.drivetrain) {
        const drive = deps.normDrive(candidate.drivetrain);
        // 공급사 2WD/4WD 명시는 기본 구동보다 우선.
        if (drive === wantedDrive) score += 2.5;
        else score -= 1.2;
      } else if (!wantedDrive && candidate.drivetrain) {
        const drive = deps.normDrive(candidate.drivetrain);
        if (def?.drivetrain && deps.normDrive(def.drivetrain) === drive) score += 0.7;
        else if (drive === DRIVE_2WD) score += 0.5;
        else if (drive === DRIVE_4WD) score -= 0.25;
      }

      if (seatMatters && wantedSeats && candidate.seat) {
        // 공급사(칸·차명「7인승」)가 밝힌 인승은 기본 조합보다 항상 우선.
        if (candidate.seat === wantedSeats) score += 2.5;
        else score -= 1.2;
      } else if (seatMatters && !wantedSeats && defaultSeat != null && candidate.seat === defaultSeat) {
        score += 0.45;
      }

      // default 가산은 공급사 연료·배기 신호가 없을 때만 강하게.
      // (인승·구동 힌트는 snapDefaultHints 가 «빈 축만» 채운 뒤라 여기서 다시 세지 않음)
      if (candidate.default) {
        const supplierPower = !!(fuel || displacement);
        score += supplierPower ? 0 : 2.2;
      }

      if (wantTurbo) score += candidate.turbo ? 1.2 : -0.8;
      else if (candidate.turbo) score -= 0.15;

      const label = masterVariantLabel(candidate);
      if (label && deps.norm(signalBlob).includes(deps.norm(label))) score += 1.5;
      return { variant: candidate, score };
    }).sort((left, right) => right.score - left.score)[0]?.variant;
  }

  return { variant, seatMatters };
}
