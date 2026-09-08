const compact = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, '');

/**
 * 공급사 차명 안에 실제로 적힌 차종·트림 어휘를 비교하는 공통 토큰 규격.
 *
 * - NFKC로 전각문자·로마숫자(Ⅱ 등)를 정규화한다.
 * - 한글/영문/숫자 경계를 분리해 `Sport`가 `Sportage` 안에서 잡히거나
 *   `Platinum`이 `PlatinumPlus` 안에서 잡히는 부분일치를 막는다.
 * - 감사기와 회귀검사가 같은 규칙을 사용해 정규화 드리프트를 막는다.
 */
export function vehicleEvidenceTokens(value: unknown): string[] {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/([가-힣])([a-z0-9])/g, '$1 $2')
    .replace(/([a-z0-9])([가-힣])/g, '$1 $2')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2');
  return normalized.match(/[a-z0-9가-힣]+/g) || [];
}

const collapseAdjacentKoreanTokens = (tokens: string[]): string[] => {
  const collapsed: string[] = [];
  for (const token of tokens) {
    if (/^[가-힣]+$/.test(token) && /^[가-힣]+$/.test(collapsed.at(-1) || '')) {
      collapsed[collapsed.length - 1] += token;
    } else collapsed.push(token);
  }
  return collapsed;
};

const containsTokenSequence = (source: string[], wanted: string[]): boolean => {
  if (!source.length || !wanted.length) return false;
  for (let offset = 0; offset <= source.length - wanted.length; offset += 1) {
    if (wanted.every((token, index) => source[offset + index] === token)) return true;
  }
  return false;
};

const containsFlexibleKoreanSequence = (source: string[], wanted: string[]): boolean => {
  for (let offset = 0; offset < source.length; offset += 1) {
    let cursor = offset;
    let matched = true;
    for (const expected of wanted) {
      if (/^[가-힣]+$/.test(expected)) {
        let combined = '';
        while (cursor < source.length && /^[가-힣]+$/.test(source[cursor] || '')
          && combined.length < expected.length) {
          combined += source[cursor];
          cursor += 1;
        }
        if (combined !== expected) { matched = false; break; }
      } else if (source[cursor] === expected) cursor += 1;
      else { matched = false; break; }
    }
    if (matched) return true;
  }
  return false;
};

/** expected 전체 토큰이 evidence 안에 연속해서 있을 때만 명시 근거로 인정한다. */
export function hasBoundedVehiclePhrase(evidence: unknown, expected: unknown): boolean {
  const source = vehicleEvidenceTokens(evidence);
  const wanted = vehicleEvidenceTokens(expected);
  return containsTokenSequence(source, wanted)
    // 공급사와 공식표의 한글 띄어쓰기는 흔히 다르다. 한글 토큰끼리만 합쳐
    // `베스트 셀렉션 I`와 `베스트셀렉션Ⅰ`를 같게 보되 영문 부분일치는 허용하지 않는다.
    || containsFlexibleKoreanSequence(source, collapseAdjacentKoreanTokens(wanted));
}

/** 짧은 트림을 긴 트림의 완전명으로 오인하지 않기 위한 후보군 접두 관계 검사. */
export function isStrictVehiclePhrasePrefix(shorter: unknown, longer: unknown): boolean {
  const leftRaw = vehicleEvidenceTokens(shorter);
  const rightRaw = vehicleEvidenceTokens(longer);
  const left = collapseAdjacentKoreanTokens(leftRaw);
  const right = collapseAdjacentKoreanTokens(rightRaw);
  const tokenPrefix = left.length > 0 && left.length < right.length
    && left.every((token, index) => token === right[index]);
  // 한글 인접 토큰은 띄어쓰기 차이를 흡수하며 하나로 합쳐진다. 이때 양쪽이
  // 한 토큰이 되어도 `프레스티지` < `프레스티지스페셜` 관계는 보존한다.
  const pureKoreanPrefix = left.length === 1 && right.length === 1
    && /^[가-힣]+$/.test(left[0] || '')
    && /^[가-힣]+$/.test(right[0] || '')
    && (right[0] || '').startsWith(left[0] || '')
    && (left[0] || '').length < (right[0] || '').length;
  return tokenPrefix || pureKoreanPrefix;
}

/**
 * 후보 어휘 중 공급사 원문에 실제로 적힌 가장 구체적인 완전 어휘만 반환한다.
 * 원문이 `프레스티지 스페셜`이면 접두 트림 `프레스티지`는 제거하지만,
 * 원문이 정확히 `프레스티지`이면 더 긴 트림을 추정하지 않는다.
 */
export function mostSpecificBoundedVehiclePhrases(
  evidence: unknown,
  expectedValues: unknown[],
): string[] {
  const unique = [...new Set(expectedValues.map((value) => String(value ?? '').trim()).filter(Boolean))];
  const matched = unique.filter((value) => hasBoundedVehiclePhrase(evidence, value));
  const specific = matched
    .filter((value) => !matched.some((other) => (
      value !== other && isStrictVehiclePhrasePrefix(value, other)
    )));
  const maxTokens = Math.max(0, ...specific.map((value) => vehicleEvidenceTokens(value).length));
  return specific
    // 한 차량에 서로 다른 후보 트림이 함께 잡히면 더 구체적인 완전명을 우선한다.
    // 토큰 수가 같은 두 트림은 어느 쪽도 추정하지 않고 모두 남긴다.
    .filter((value) => vehicleEvidenceTokens(value).length === maxTokens)
    .sort((left, right) => (
      vehicleEvidenceTokens(right).length - vehicleEvidenceTokens(left).length
      || right.length - left.length
      || left.localeCompare(right, 'ko')
    ));
}

export type VehicleRangeClass = 'long_range' | 'standard' | '';

/** 전기차 세부모델의 Long Range/Standard 직접 표기만 읽는다. */
export function vehicleRangeClass(value: unknown): VehicleRangeClass {
  const text = String(value ?? '').normalize('NFKC');
  if (/롱\s*레인지|long\s*range/i.test(text)) return 'long_range';
  if (/스탠다드|standard/i.test(text)) return 'standard';
  return '';
}

export type VehicleBodyForm = 'coupe' | 'van' | 'passenger' | '';

/** 차명에 직접 적힌 차체형태만 읽는다. 공란에서 차체형태를 추정하지 않는다. */
export function vehicleBodyForm(value: unknown): VehicleBodyForm {
  const text = String(value ?? '').normalize('NFKC');
  if (/쿠페|coupe/i.test(text)) return 'coupe';
  if (/\bvan\b|밴/i.test(text)) return 'van';
  if (/승용|passenger/i.test(text)) return 'passenger';
  return '';
}

/** 공급사 표시 차명의 `2.5T`·`R2.0` 같은 직접 파워트레인 표기를 cc로 읽는다. */
export function explicitVehicleDisplacementCc(value: unknown): number {
  const text = String(value ?? '').normalize('NFKC');
  const match = /(?:^|[^0-9])(?:R\s*)?([1-6]\.\d)\s*(?:T|가솔린|디젤|LPG|LPI|GDI|HEV|하이브리드)?/i.exec(text);
  return match ? Math.round(Number(match[1]) * 1000) : 0;
}

/** "17년식"/"2017-03" 같은 입력에서 네 자리 연식을 복원한다. */
export function parseYear(value: unknown): number {
  const match = /(\d{2,4})/.exec(String(value ?? ''));
  if (!match) return 0;
  const year = Number(match[1]);
  return year > 1900 ? year : year < 50 ? 2000 + year : 1900 + year;
}

/** 연식 표시 SSOT — "24년식"·"2017-03" → "24년"·"17년". */
export function yearDisplay(value: unknown): string {
  const year = parseYear(value);
  return year > 0 ? `${String(year % 100).padStart(2, '0')}년` : '';
}

/**
 * 손님 화면용 연식 — **네 자리 그대로**("2019"). 업무동 `yearDisplay` 와 «일부러» 다르다.
 *
 * 콕핏은 줄이 좁아 두 자리(「19년」)로 줄이는 게 이득이지만, 손님이 차 이름 앞에서 보는 연식은
 * 중고차 마켓이 다 네 자리다(현대인증중고차·티카·리본카 실측 2026-09-04). 두 자리로 쓰면
 * 「26년 엑센트」처럼 **트림 숫자와 섞여** 무슨 뜻인지 한 번 더 생각하게 된다.
 * ⚠ 그렇다고 `yearDisplay` 를 바꾸면 업무동 목록 줄이 다 벌어진다 — 그래서 함수를 나눈다.
 */
export function yearFullDisplay(value: unknown): string {
  const year = parseYear(value);
  return year > 0 ? String(year) : '';
}

export const FUEL_ALIAS: Record<string, string> = {
  휘발유: '가솔린',
  가솔린: '가솔린',
  경유: '디젤',
  디젤: '디젤',
  엘피지: 'lpg',
  lpg: 'lpg',
  하이브리드: '하이브리드',
  hev: '하이브리드',
  전기: '전기',
  ev: '전기',
  수소: '수소',
};

/** 연료 뒤에 배기량이 붙은 실데이터까지 정규화한다. */
export function normFuel(value: unknown): string {
  const normalized = compact(value);
  if (FUEL_ALIAS[normalized]) return FUEL_ALIAS[normalized];
  for (const key of Object.keys(FUEL_ALIAS)) {
    if (normalized.includes(key)) return FUEL_ALIAS[key];
  }
  return normalized;
}

/** 원문 토큰 중 해당 차종 마스터에 실제 존재하는 개발코드만 남긴다. */
export function recognizedDevelopmentCodes(rawCodes: unknown[], knownCodes: unknown[]): string[] {
  const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase();
  const known = new Set(knownCodes.map(normalize).filter(Boolean));
  return [...new Set(rawCodes.map(normalize).filter((code) => code && known.has(code)))];
}

/** 연료 표시 SSOT — "가솔린1.0"·"LPG3.0" → 가솔린·LPG. */
export function fuelDisplay(value: unknown): string {
  const normalized = normFuel(value);
  if (!normalized || normalized === '-') return '';
  if (normalized === 'lpg') return 'LPG';
  if (normalized === '가솔린' || normalized === '디젤' || normalized === '하이브리드' || normalized === '전기' || normalized === '수소') {
    return normalized;
  }
  return '';
}

/** 제조사 표시 SSOT — 법인 접미사를 제거한다. */
export function makerDisplay(value: unknown): string {
  const source = String(value || '').trim();
  if (!source) return '';
  let display = source
    .replace(/코리아/gi, '')
    .replace(/모빌리티/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  // KG모빌리티 → KGM. 「KG」 만 남기면 브랜드로 안 읽힌다(옛 쌍용 표기와도 안 이어진다).
  if (/^kgm?$/i.test(display)) display = 'KGM';
  return display || source;
}

/** 연료칸에 붙은 배기량을 cc 단위로 추출한다. */
export function fuelEmbeddedCc(value: unknown): number {
  if (!fuelDisplay(value)) return 0;
  const match = /(\d+(?:\.\d+)?)/.exec(String(value ?? '').replace(/,/g, ''));
  if (!match) return 0;
  const displacement = Number(match[1]);
  if (!Number.isFinite(displacement) || displacement <= 0) return 0;
  return displacement >= 100 ? Math.round(displacement) : Math.round(displacement * 1000);
}
