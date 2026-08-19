/**
 * 파워트레인 «합침 라벨» — 시트 열을 없앤 뒤에도 artifact·fiveKey 가 쓸 문자열.
 *
 * 우선순위: 시트 칸(있을 때) → 직전 artifact 보존값 → 원자축 합성(신규·빈칸).
 * 원자축만으로는 기존 표기(자동5단·콰트로·T 유무)를 100% 재현하지 못하므로
 * 열 삭제 적용 시에는 반드시 prior 보존값을 넘겨 라벨 회귀를 막는다.
 */

const S = (value: unknown) => String(value ?? '').trim();

export type PowertrainLabelAxes = {
  fuel?: unknown;
  displacement_l?: unknown;
  turbo?: boolean | null | unknown;
  drivetrain?: unknown;
  battery_kwh?: unknown;
};

const formatDisplacement = (value: unknown): string => {
  if (value === null || value === undefined || S(value) === '') return '';
  const n = typeof value === 'number' ? value : Number(S(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return S(value);
  // 3 → 3.0, 2.5 → 2.5 (시트 표기와 맞추기)
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
};

const turboFlag = (value: unknown): boolean => {
  if (value === true) return true;
  const text = S(value);
  return text === '예' || text === '터보' || /^t$/i.test(text);
};

/** 신규·빈칸용 합성. 기존 라벨 재현이 목적이 아니다. */
export function composePowertrainLabel(axes: PowertrainLabelAxes): string {
  const fuel = S(axes.fuel);
  const drive = S(axes.drivetrain);
  const mid = formatDisplacement(axes.displacement_l);
  const turbo = turboFlag(axes.turbo);
  if (!fuel && !mid && !drive) return '';
  if (fuel === '전기' || /전기|수소/.test(fuel)) {
    return [fuel || '전기', drive].filter(Boolean).join(' ');
  }
  const displacement = mid ? `${mid}${turbo ? 'T' : ''}` : '';
  return [fuel, displacement, drive].filter(Boolean).join(' ');
}

export function resolvePowertrainLabel(input: {
  sheetLabel?: unknown;
  priorLabel?: unknown;
  axes: PowertrainLabelAxes;
}): string {
  const fromSheet = S(input.sheetLabel);
  if (fromSheet) return fromSheet;
  const fromPrior = S(input.priorLabel);
  if (fromPrior) return fromPrior;
  return composePowertrainLabel(input.axes);
}

/** 시트 행 + 헤더에서 라벨 해석(열 유무 모두). */
export function powertrainLabelFromMasterRow(
  headers: readonly string[],
  row: readonly unknown[],
  priorLabel?: unknown,
): string {
  const at = (name: string) => headers.map(S).indexOf(name);
  const pick = (name: string) => {
    const index = at(name);
    return index < 0 ? '' : row[index];
  };
  const turboRaw = S(pick('터보'));
  return resolvePowertrainLabel({
    sheetLabel: pick('파워트레인'),
    priorLabel,
    axes: {
      fuel: pick('연료'),
      displacement_l: pick('표시배기량(L)'),
      turbo: turboRaw === '예' ? true : turboRaw === '아니오' ? false : null,
      drivetrain: pick('구동방식'),
      battery_kwh: pick('배터리(kWh)'),
    },
  });
}
