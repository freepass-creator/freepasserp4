import type { EntityRecord } from '@/lib/intake/entities';
import { normFuel } from '@/lib/domain/vehicle-master-format';
import { isForbiddenAsVariant } from '@/lib/domain/vehicle-field-guards';
import { masterVariantLabel, seatAxisMatters } from '@/lib/domain/vehicle-master-options';
import type { MasterEntry, MasterVariant } from '@/lib/domain/vehicle-master-types';

/** vehicle-defaults.DRIVE_* 와 동일 문자열 — 순환 import 금지라 여기만 리터럴. */
const DRIVE_2WD = '2WD';
const DRIVE_4WD = '4WD';

export type MasterVariantScoreDeps = {
  norm: (value: unknown) => string;
  normDrive: (value: unknown) => string;
  /** 공급사 명시값이 아니라 빈칸 기본 힌트로 채운 축 — 하드 충돌로 판정하지 않는다. */
  defaulted?: { seats?: boolean; drive_type?: boolean };
};

export type MasterVariantScoreResult = {
  variant: MasterVariant | undefined;
  seatMatters: boolean;
  /** 공급사가 명시한 원자가 이 세부모델의 어떤 조합에도 없는 경우. */
  conflicts: Array<'fuel_type' | 'engine_cc' | 'seats' | 'drive_type' | 'turbo'>;
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

/**
 * ★파워트레인 «사양명(라인)» 어휘.
 *
 * 공급사와 엔카는 파워트레인을 **용량이 아니라 이 말로** 부른다
 * (엔카 Badge:「롱레인지 AWD」·「1.2 RS」·「퍼포먼스 AWD」).
 * 마스터 variant 라벨에도 이 말을 넣었으니, 원문에서도 같은 잣대로 읽어야 이어진다.
 *
 * ⚠「GT」는 **「GT라인」과 다른 등급**이다. 뒤에 라인/Line 이 붙으면 그건 트림이므로 제외한다.
 */
const LINE_VOCAB: Array<{ key: string; re: RegExp }> = [
  { key: '롱레인지', re: /롱\s*레인지|long\s*range/i },
  { key: '스탠다드', re: /스탠\s*다드|스탠\s*더드|standard/i },
  { key: '퍼포먼스', re: /퍼포먼스|performance/i },
  { key: 'RS', re: /(^|[^a-z])rs([^a-z]|$)/i },
  { key: 'ACTIV', re: /(^|[^a-z])activ(e)?([^a-z]|$)|액티브/i },
  { key: 'GT', re: /(^|[^a-z])gt(?!\s*(라인|line))([^a-z]|$)/i },
];
const lineOf = (text: unknown): Set<string> => {
  const t = String(text ?? '');
  const out = new Set<string>();
  if (!t) return out;
  for (const { key, re } of LINE_VOCAB) if (re.test(t)) out.add(key);
  return out;
};

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
  const ccRaw = Number(String(product.engine_cc ?? '').replace(/,/g, '')) || 0;
  const displacement = ccRaw >= 100 ? ccRaw / 1000 : (ccRaw >= 0.6 ? ccRaw : 0);
  const wantedSeats = Number(product.seats) > 0 ? Number(product.seats) : 0;
  const wantedDrive = deps.normDrive(product.drive_type);
  const seatMatters = seatAxisMatters(entry);
  /** 원문이 부르는 라인 — 파워트레인 칸에 세부등급이 잘못 들어온 값은 무시. */
  const variantSignal = isForbiddenAsVariant(product.variant) ? '' : String(product.variant ?? '');
  const blobLines = lineOf(`${signalBlob} ${variantSignal}`);
  // 기본 조합이 마스터에 있으면 그걸 선호(신호 없을 때). 없으면 세부모델 modeSeat.
  // seatAxisMatters=false(레이·모닝 승용)면 인승 힌트·가산 없음.
  const def = defaultVariant(entry);
  const defaultSeat = seatMatters
    ? (def?.seat != null && def.seat > 0 ? def.seat : modeSeat(entry.variants || []))
    : null;

  /**
   * 계단식 조합 선택의 핵심: 공급사가 명시한 원자는 «가점»이 아니라 후보 제거 조건이다.
   *
   * 예전 점수식은 `디젤 2.2 7인승`이 있어도 다른 가솔린·9인승 조합을 후보로 남겼고,
   * 기본값 보너스가 더 크면 그쪽이 이길 수 있었다. 이제 연료 → 배기량 → 인승 → 구동 순서로
   * 실제 마스터 조합을 좁힌다. 한 단계가 0건이면 이전 후보를 억지로 버리지 않고 충돌을 반환해
   * 상위 차종은 보존하되 최종 결과는 사람 검수로 보낸다.
   */
  let candidates = [...(entry.variants || [])];
  const conflicts: MasterVariantScoreResult['conflicts'] = [];
  const constrain = (
    field: MasterVariantScoreResult['conflicts'][number],
    enabled: boolean,
    comparable: (variant: MasterVariant) => boolean,
    matches: (variant: MasterVariant) => boolean,
  ) => {
    if (!enabled || !candidates.length) return;
    const comparableCandidates = candidates.filter(comparable);
    if (!comparableCandidates.length) return;
    const hits = comparableCandidates.filter(matches);
    if (hits.length) candidates = hits;
    else conflicts.push(field);
  };

  constrain(
    'fuel_type',
    !!fuel,
    (candidate) => !!normFuel(candidate.fuel || masterVariantLabel(candidate)),
    (candidate) => {
      const candidateFuel = normFuel(candidate.fuel || masterVariantLabel(candidate));
      return candidateFuel === fuel || candidateFuel.includes(fuel) || fuel.includes(candidateFuel);
    },
  );
  constrain(
    'engine_cc',
    displacement > 0,
    (candidate) => candidate.displacement_l != null && candidate.displacement_l > 0,
    // 공급사 cc 반올림·제조사 표기 차이를 감안하되 다른 배기량 급은 섞지 않는다.
    (candidate) => candidate.displacement_l != null && Math.abs(candidate.displacement_l - displacement) <= 0.2,
  );
  constrain(
    'seats',
    seatMatters && wantedSeats > 0 && deps.defaulted?.seats !== true,
    (candidate) => candidate.seat != null && candidate.seat > 0,
    (candidate) => candidate.seat === wantedSeats,
  );
  constrain(
    'drive_type',
    !!wantedDrive && deps.defaulted?.drive_type !== true,
    (candidate) => !!deps.normDrive(candidate.drivetrain),
    (candidate) => deps.normDrive(candidate.drivetrain) === wantedDrive,
  );

  // 라인명(N Line·GT·RS…)도 명시되어 실제 후보가 있으면 그 조합만 남긴다.
  if (blobLines.size && candidates.length > 1) {
    const lineHits = candidates.filter((candidate) => {
      const mine = lineOf(masterVariantLabel(candidate));
      return mine.size > 0 && [...mine].some((line) => blobLines.has(line));
    });
    if (lineHits.length) candidates = lineHits;
  }
  if (wantTurbo && candidates.length > 1) {
    const turboHits = candidates.filter((candidate) => candidate.turbo === true);
    if (turboHits.length) candidates = turboHits;
  }

  let variant: MasterVariant | undefined;
  if (candidates.length) {
    // 모든 명시 조건을 통과한 후보가 하나면 점수 경쟁 없이 그 조합이 답이다.
    if (candidates.length === 1) {
      return { variant: candidates[0], seatMatters, conflicts };
    }
    // 남은 후보 중 마스터 기본 조합이 하나면 누락 축의 기본값으로 사용한다.
    const narrowedDefault = candidates.find((candidate) => candidate.default === true);
    if (narrowedDefault) {
      return { variant: narrowedDefault, seatMatters, conflicts };
    }

    variant = candidates.map((candidate) => {
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

      /**
       * ★사양명(라인)을 원문에서 읽어 그 파워트레인으로 보낸다.
       *
       * 이게 없으면 트랙스 19대가 라인 구분 없이 「가솔린 1.2」로 뭉친다 —
       * 마스터에 「가솔린 1.2 RS」를 만들어 놔도 갈 길이 없었다(실측 2026-08-09).
       * 구동(+2.5)과 같은 무게다. 둘 다 공급사가 «명시»한 축이다.
       *
       * 원문에 라인 말이 아예 없으면 아무것도 하지 않는다 — 없는 신호를 만들지 않는다.
       */
      if (blobLines.size) {
        const mine = lineOf(masterVariantLabel(candidate));
        if (mine.size) {
          if ([...mine].some((w) => blobLines.has(w))) score += 2.5;
          else score -= 1.5;   // 원문이 «다른 라인»을 부르고 있다
        }
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

  return { variant, seatMatters, conflicts };
}
