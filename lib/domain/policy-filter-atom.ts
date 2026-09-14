import { POLICY_COLUMN_FIELDS } from './supplier-template-sheet';
import { POLICY_VALUE_RULE_BY_NAME, formatWon, normalizePolicyValue, parseWon, type PolicyValueKind } from './policy-value-spec';
import { parseMoneyOrRate } from './policy-money-rate';

const S = (value: unknown) => String(value ?? '').trim();

export type PolicyFilterValue = {
  kind: PolicyValueKind | 'empty' | 'unknown' | 'none' | 'na' | 'consult' | 'won' | 'rate' | 'months';
  status: 'confirmed' | 'normalized' | 'review' | 'empty';
  display: string;
  won?: number;
  rate_bps?: number;
  months?: number;
  km_per_year?: number;
  age?: number;
  days?: number;
  count?: number;
  value?: string | boolean;
};

export type PolicyFilterAtom = {
  schema_version: 'policy_filter_v1';
  normalization_status: 'confirmed' | 'normalized' | 'review';
  normalization_review_fields: string[];
  values: Record<string, PolicyFilterValue>;
};

const legacyMoneyKind = (field: string): 'rate' | 'won' =>
  field === 'early_termination_rate_under1y' || field === 'early_termination_rate_over1y' ? 'rate' : 'won';

function typedValue(name: string, field: string, raw: unknown): PolicyFilterValue {
  const rule = POLICY_VALUE_RULE_BY_NAME[name];
  if (!rule || raw === null || raw === undefined || raw === '') return { kind: 'empty', status: 'empty', display: '' };
  const normalized = normalizePolicyValue(name, raw);

  if (rule.kind === 'money_or_rate' || rule.kind === 'driver_fee') {
    const parsed = parseMoneyOrRate(raw, { legacy: legacyMoneyKind(field) });
    const parsedStatus = normalized.status === 'same' ? 'confirmed' : 'normalized';
    if (parsed.kind === 'won') return { kind: 'won', status: parsedStatus, display: formatWon(parsed.won), won: parsed.won };
    if (parsed.kind === 'rate') {
      const percent = Math.round(parsed.rate * 10_000) / 100;
      return { kind: 'rate', status: parsedStatus, display: `${rule.rateLabel || ''}${percent}%`, rate_bps: Math.round(parsed.rate * 10_000) };
    }
    if (parsed.kind === 'months') return { kind: 'months', status: parsedStatus, display: `월 대여료 ${parsed.months}개월분`, months: parsed.months };
    if (parsed.kind === 'none' || parsed.kind === 'na' || parsed.kind === 'consult') {
      const display = parsed.kind === 'none' ? '없음' : parsed.kind === 'na' ? '불가' : '협의';
      return { kind: parsed.kind, status: parsedStatus, display };
    }
    if (normalized.status !== 'review') return { kind: rule.kind, status: normalized.status === 'fixed' ? 'normalized' : 'confirmed', display: normalized.value, value: normalized.value };
    return { kind: 'unknown', status: 'review', display: S(raw) };
  }
  if (normalized.status === 'review') return { kind: 'unknown', status: 'review', display: S(raw) };
  const display = normalized.value;
  const status = normalized.status === 'fixed' ? 'normalized' : 'confirmed';
  if (rule.kind === 'money') {
    if (display === '없음') return { kind: 'none', status, display };
    if (display === '불가') return { kind: 'na', status, display };
    if (display === '협의') return { kind: 'consult', status, display };
    const won = parseWon(display);
    return won === null ? { kind: 'unknown', status: 'review', display: S(raw) } : { kind: 'won', status, display, won };
  }
  if (rule.kind === 'percent') {
    const match = display.match(/([\d.]+)%/);
    return match ? { kind: 'percent', status, display, rate_bps: Math.round(Number(match[1]) * 100) } : { kind: 'unknown', status: 'review', display: S(raw) };
  }
  if (rule.kind === 'km') {
    if (display === '무제한' || display === '협의') return { kind: display === '협의' ? 'consult' : 'km', status, display, value: display };
    const km = Number(display.replace(/[^\d]/g, ''));
    return km > 0 ? { kind: 'km', status, display, km_per_year: km } : { kind: 'unknown', status: 'review', display: S(raw) };
  }
  if (rule.kind === 'age_min' || rule.kind === 'age_max' || rule.kind === 'age_upto') {
    if (display === '불가' || display === '협의' || display === '제한없음') return { kind: display === '불가' ? 'na' : display === '협의' ? 'consult' : rule.kind, status, display, value: display };
    const age = Number(display.match(/\d+/)?.[0]);
    return age > 0 ? { kind: rule.kind, status, display, age } : { kind: 'unknown', status: 'review', display: S(raw) };
  }
  if (rule.kind === 'days' || rule.kind === 'count' || rule.kind === 'per_year_count') {
    if (/^(없음|무제한|협의)$/.test(display)) return { kind: display === '협의' ? 'consult' : rule.kind, status, display, value: display };
    const number = Number(display.match(/\d+/)?.[0]);
    if (!(number >= 0)) return { kind: 'unknown', status: 'review', display: S(raw) };
    return rule.kind === 'days'
      ? { kind: rule.kind, status, display, days: number }
      : { kind: rule.kind, status, display, count: number };
  }
  if (rule.kind === 'check') return { kind: 'check', status, display, value: display === 'TRUE' };
  return { kind: rule.kind, status, display, value: display };
}

/** ERP 정책 문서의 기존 필드를 필터 가능한 고정 타입 원자로 투영한다. 원문은 이 함수가 수정하지 않는다. */
export function buildPolicyFilterAtom(policy: Record<string, unknown>): PolicyFilterAtom {
  const values: Record<string, PolicyFilterValue> = {};
  const review: string[] = [];
  let normalized = false;
  for (const { name, field } of POLICY_COLUMN_FIELDS) {
    const typed = typedValue(name, field, policy[field]);
    if (typed.status === 'empty') continue;
    values[field] = typed;
    if (typed.status === 'review') review.push(field);
    if (typed.status === 'normalized') normalized = true;
  }
  return {
    schema_version: 'policy_filter_v1',
    normalization_status: review.length ? 'review' : normalized ? 'normalized' : 'confirmed',
    normalization_review_fields: review,
    values,
  };
}
