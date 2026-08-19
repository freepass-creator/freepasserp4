/**
 * 정액·정률 겸용 정책값 한 곳 읽기 — 「10만원」 / 「대여료의 10%」 / 「월 대여료 2개월분」 / 불가 / 무료 / 협의.
 *
 * ★왜 있나(사장님 2026-08-19)
 *   공급사마다 정액인 곳과 정률인 곳이 있다(추가주행 금액·연령 하향 요금·추가운전 요금·승계수수료·중도해지 위약금).
 *   시트는 「정액 00만원 또는 대여료의 00%」 한 칸으로 받고(policy-value-spec money_or_rate), ERP 정책관리도 같은 글자를 담는다.
 *   그 글자를 **돈으로 굳히는 곳**(연령 하향 가산·위약금 계산)과 **글로 싣는 곳**(계약서·요약)이 여기 하나만 부른다.
 *
 * ★옛 값도 읽는다 — 정책관리에 숫자로 들어 있던 것(100000 = 10만원 · 0.3 = 30%).
 *   어느 쪽인지는 필드가 말한다: `legacy: 'won'`(연령 하향·추가운전·승계) / `legacy: 'rate'`(위약금).
 */
export type MoneyOrRate =
  | { kind: 'won'; won: number }
  | { kind: 'rate'; rate: number }        // 0.1 = 10%
  | { kind: 'months'; months: number }    // 월 대여료 N개월분
  | { kind: 'none' }                      // 없음 · 무료
  | { kind: 'na' }                        // 불가
  | { kind: 'consult' }                   // 협의
  | { kind: 'text'; raw: string }         // 못 읽음 — 글자 그대로
  | { kind: 'empty' };

const S = (v: unknown) => String(v ?? '').trim();

function wonOf(text: string): number | null {
  // 한글 숫자 — 「1천5백만원」=15,000,000 · 「1억5천만원」 · 「1.5억원」 · 「500,000원」 · 「10만원」
  const c = text.replace(/\s|,/g, '').replace(/원$/, '');
  if (!c || !/^[\d.억천백십만]+$/.test(c) || !/\d/.test(c)) return null;
  let total = 0, sub = 0, seen = false;
  for (const m of c.matchAll(/(\d+(?:\.\d+)?)?(억|만|천|백|십)?/g)) {
    if (!m[0]) continue;
    seen = true;
    const n = m[1] !== undefined ? Number(m[1]) : (m[2] ? 1 : 0);
    switch (m[2]) {
      case '억': total += (sub + (m[1] !== undefined ? n : 0)) * 1e8; sub = 0; break;
      case '만': total += (sub + (m[1] !== undefined ? n : 0)) * 1e4; sub = 0; break;
      case '천': sub += n * 1000; break;
      case '백': sub += n * 100; break;
      case '십': sub += n * 10; break;
      default: sub += n;
    }
  }
  if (!seen) return null;
  return Math.round((total + sub) * 1000) / 1000;
}

export function parseMoneyOrRate(value: unknown, opts: { legacy?: 'won' | 'rate' } = {}): MoneyOrRate {
  if (value === null || value === undefined) return { kind: 'empty' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value === 0) return value === 0 ? { kind: 'none' } : { kind: 'empty' };
    if (opts.legacy === 'rate' || (value > 0 && value < 1)) return { kind: 'rate', rate: value <= 1 ? value : value / 100 };
    return { kind: 'won', won: Math.round(value) };
  }
  const raw = S(value);
  if (!raw) return { kind: 'empty' };
  const c = raw.replace(/\s/g, '');
  if (/^(없음|무료|미부과|0|0원|0%)$/.test(c)) return { kind: 'none' };
  if (/^(불가|불가능|해당없음)$/.test(c)) return { kind: 'na' };
  if (/^(협의|별도협의)$/.test(c)) return { kind: 'consult' };
  const pct = c.replace(/^1인당/, '').match(/^(?:월?대여료의?|잔여대여료의?|잔여기간대여료의?)?(\d+(?:\.\d+)?)%$/);
  if (pct) return { kind: 'rate', rate: Number(pct[1]) / 100 };
  const months = c.match(/^(?:월?대여료)?(\d+)개월(?:분|치)?$/);
  if (months) return { kind: 'months', months: Number(months[1]) };
  const won = wonOf(c.replace(/^1인당/, '').replace(/^월/, ''));
  if (won !== null) {
    // 숫자만 적힌 옛 값 — 「0.3」은 비율, 「100000」은 원
    if (/^\d+(\.\d+)?$/.test(c) && (opts.legacy === 'rate' || won < 1)) return { kind: 'rate', rate: Number(c) <= 1 ? Number(c) : Number(c) / 100 };
    if (won === 0) return { kind: 'none' };
    return { kind: 'won', won };
  }
  return { kind: 'text', raw };
}

/** 이 정책값이 «돈이 있다»(청구 대상)인가 — 정액·정률·개월분. */
export function moneyOrRateCharges(value: unknown, opts?: { legacy?: 'won' | 'rate' }): boolean {
  const k = parseMoneyOrRate(value, opts).kind;
  return k === 'won' || k === 'rate' || k === 'months';
}

/**
 * 돈으로 굳힌다. 정률·개월분은 기준액(월 대여료 등)이 있어야 한다 — 없으면 null(굳힐 수 없음).
 *   연령 하향 가산: moneyOrRateWon(policy.age_lowering_cost, monthlyRent, { legacy: 'won' })
 */
export function moneyOrRateWon(value: unknown, baseWon: number | null | undefined, opts?: { legacy?: 'won' | 'rate' }): number | null {
  const p = parseMoneyOrRate(value, opts);
  if (p.kind === 'won') return p.won;
  if (p.kind === 'none') return 0;
  const base = Number(baseWon) || 0;
  if (p.kind === 'rate') return base > 0 ? Math.round(base * p.rate) : null;
  if (p.kind === 'months') return base > 0 ? Math.round(base * p.months) : null;
  return null;
}

export function wonLabel(won: number): string {
  if (won >= 1e8 && won % 10_000 === 0) {
    const eok = Math.floor(won / 1e8);
    const rest = won - eok * 1e8;
    return rest ? `${eok}억 ${(rest / 10_000).toLocaleString()}만원` : `${eok}억원`;
  }
  if (won >= 10_000 && won % 10_000 === 0) return `${(won / 10_000).toLocaleString()}만원`;
  return `${won.toLocaleString()}원`;
}

/**
 * 사람이 읽는 글로 — 계약서·요약·영업 화면.
 *   rateBase: 정률의 기준 문구(「대여료의」 / 「잔여 대여료의」) · per: 앞에 붙는 단위(「1인당 월」)
 *   noneText/naText/consultText: 없음·불가·협의를 어떻게 부를지(칸마다 다르다 — 「별도 비용 없음」·「승계 불가」)
 */
export function moneyOrRateText(value: unknown, opts: {
  legacy?: 'won' | 'rate'; rateBase?: string; per?: string; suffix?: string;
  noneText?: string; naText?: string; consultText?: string; wonStyle?: 'label' | 'comma';
} = {}): string {
  const p = parseMoneyOrRate(value, { legacy: opts.legacy });
  const per = opts.per ? `${opts.per} ` : '';
  const suffix = opts.suffix || '';
  switch (p.kind) {
    case 'won': return `${per}${opts.wonStyle === 'comma' ? `${p.won.toLocaleString()}원` : wonLabel(p.won)}${suffix}`;
    case 'rate': {
      const pct = Math.round(p.rate * 1000) / 10;
      return `${per}${opts.rateBase || '대여료의'} ${Number.isInteger(pct) ? pct : pct.toFixed(1)}%${suffix}`;
    }
    case 'months': return `${per}월 대여료 ${p.months}개월분${suffix}`;
    case 'none': return opts.noneText ?? '없음';
    case 'na': return opts.naText ?? '불가';
    case 'consult': return opts.consultText ?? '협의';
    case 'text': return p.raw;
    default: return '';
  }
}

/** 정률의 퍼센트 숫자(30) — 옛 계약서 칸(「__%」)이 필요할 때만. 정률이 아니면 null. */
export function moneyOrRatePercent(value: unknown, opts?: { legacy?: 'won' | 'rate' }): number | null {
  const p = parseMoneyOrRate(value, opts);
  return p.kind === 'rate' ? Math.round(p.rate * 1000) / 10 : null;
}
