const compact = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, '');

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
