import type { EntityRecord } from '@/lib/intake/entities';
import { normFuel } from '@/lib/domain/vehicle-master-format';
import { masterVariantLabel, variantSeatsDiffer } from '@/lib/domain/vehicle-master-options';
import type { MasterEntry, MasterVariant } from '@/lib/domain/vehicle-master-types';

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

export function selectMasterVariant(
  product: EntityRecord,
  entry: MasterEntry,
  entries: MasterEntry[],
  lockedModel: string | null,
  signalBlob: string,
  wantTurbo: boolean,
  deps: MasterVariantScoreDeps,
): MasterVariantScoreResult {
  const fuel = normFuel(product.fuel_type);
  const displacement = (Number(product.engine_cc) || 0) / 1000;
  const wantedSeats = Number(product.seats) > 0 ? Number(product.seats) : 0;
  const wantedDrive = deps.normDrive(product.drive_type);
  const seatMatters = variantSeatsDiffer(entry.variants);
  const modelModeSeat = seatMatters
    ? lockedModel
      ? modeSeatForModel(entries, lockedModel)
      : modeSeat(entry.variants || [])
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

      if (wantedDrive && candidate.drivetrain) {
        const drive = deps.normDrive(candidate.drivetrain);
        if (drive === wantedDrive) score += 1.5;
        else score -= 1;
      } else if (!wantedDrive && candidate.drivetrain) {
        const drive = deps.normDrive(candidate.drivetrain);
        if (drive === '2WD') score += 0.5;
        else if (drive === '4WD') score -= 0.25;
      }

      if (seatMatters && wantedSeats && candidate.seat) {
        if (candidate.seat === wantedSeats) score += 1.5;
        else score -= 0.6;
      } else if (seatMatters && !wantedSeats && modelModeSeat != null && candidate.seat === modelModeSeat) {
        score += 0.45;
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
