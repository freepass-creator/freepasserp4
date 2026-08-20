/**
 * **공급사 재고 줄에 딸린 조건 칸(대인·대물·자차·자손·무보험·연주행·분납·21세·23세·1만+·정비·운전자범위·전용계좌·기타) → 정책.**
 *
 * `scripts/build-policies-from-sheets.mts`(2026-08-10, ERP 정책 생성)의 해석기를 그대로 떼어 왔다 —
 * 같은 글자를 두 군데서 다르게 읽으면 ERP 정책과 정제시트 정책 탭이 갈린다.
 *   · 「50만 / 무한」은 순서가 공급사마다 반대다 → «무한·억이 든 쪽»이 한도.
 *   · 맨숫자는 만원(「100」=100만원), 여섯 자리부터 원(「150,000」).
 *   · 자차 「차량/50~100」 = 보상기준 / 면책 하한~상한.
 *
 * ★두 벌을 준다 — ERP 필드(`policyFieldsFrom`)와 정제시트 「정책」 탭 열 이름(`policyTabRowFrom`, 표기는 `policy-value-spec` 규격).
 *   정책 탭 값은 «영업자·계약서가 보는 글자»라 표기 규격을 반드시 거친다.
 */
import { formatWon, normalizePolicyValue } from './policy-value-spec';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();

/** 「50만」·「1천5백」·「1억」·「150,000」 → 원. 못 읽으면 0. 맨숫자는 만원(여섯 자리부터 원). */
export function wonOf(v: unknown): number {
  const s = S(v).replace(/\s/g, '');
  if (!s || /^(없음|x|X|-|불가|무한)$/.test(s)) return 0;
  let total = 0; let matched = false;
  const eok = /([\d.]+)억/.exec(s); if (eok) { total += Number(eok[1]) * 100_000_000; matched = true; }
  const cheon = /([\d.]+)천/.exec(s); if (cheon) { total += Number(cheon[1]) * 10_000_000; matched = true; }
  const baek = /([\d.]+)백/.exec(s); if (baek) { total += Number(baek[1]) * 1_000_000; matched = true; }
  const man = /([\d,]+)만/.exec(s); if (man) { total += Number(man[1].replace(/,/g, '')) * 10_000; matched = true; }
  if (matched) return total;
  if (/원$/.test(s)) { const n = Number(s.replace(/[^\d]/g, '')); return Number.isFinite(n) ? n : 0; }
  const plain = /^[\d,]+$/.exec(s);
  if (!plain) return 0;
  const n = Number(plain[0].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 100_000 ? n * 10_000 : n;
}
const looksLikeLimit = (v: string) => /무한|억/.test(v.replace(/\s/g, ''));
/** 「50만 / 무한」 → 면책·한도. 순서 무관 — 무한·억이 든 쪽이 한도, 둘 다 아니면 큰 쪽. */
export function splitPair(v: unknown): { deductible: number; limit: string } {
  const s = S(v);
  const parts = s.split('/').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return { deductible: 0, limit: s };
  const [a, b] = parts;
  if (looksLikeLimit(b) && !looksLikeLimit(a)) return { deductible: wonOf(a), limit: b };
  if (looksLikeLimit(a) && !looksLikeLimit(b)) return { deductible: wonOf(b), limit: a };
  return wonOf(a) >= wonOf(b) ? { deductible: wonOf(b), limit: a } : { deductible: wonOf(a), limit: b };
}
/** 「무한」·「1억」 → 「무한」·「1억원」·「1천5백만원」(policy-value-spec 표기). */
export function limitLabel(v: unknown): string {
  const s = S(v).replace(/\s/g, '');
  if (!s || s === '없음') return '';
  if (/무한/.test(s)) return '무한';
  const n = wonOf(s);
  return n ? formatWon(n) : s;
}
/** 「2만km」·「무제한」 → 「연 20,000km」. */
export function mileageLabel(v: unknown): string {
  const s = S(v).replace(/\s/g, '');
  if (!s) return '';
  if (/무제한/.test(s)) return '무제한';
  const m = /([\d.]+)만/.exec(s);
  if (m) return `연 ${(Number(m[1]) * 10_000).toLocaleString('ko-KR')}km`;
  const n = Number(s.replace(/[^\d]/g, ''));
  return n ? `연 ${n.toLocaleString('ko-KR')}km` : s;
}
/** 21세·23세 두 칸 → 연령인하 수준·월 요금. */
export function ageLowering(a21: unknown, a23: unknown): { level: string; cost: number } {
  const ok = (v: unknown) => { const s = S(v).replace(/\s/g, ''); return !!s && !/^(불가|x|X|-|없음)$/.test(s); };
  if (ok(a21)) return { level: '만 21세까지', cost: wonOf(a21) };
  if (ok(a23)) return { level: '만 23세까지', cost: wonOf(a23) };
  return { level: '불가', cost: 0 };
}
export const yesNo = (v: unknown, yes: string, no: string) => {
  const s = S(v).replace(/\s/g, '');
  if (!s) return '';
  return /^(x|X|불가|없음|미제공|미포함)$/.test(s) ? no : yes;
};

/** 조건 열 한 행 → ERP 정책 필드. 읽은 것만 담는다. (`build-policies-from-sheets.policyFrom` 과 같은 규칙) */
export function policyFieldsFrom(hdr: string[], row: string[]): Rec {
  const at = (re: RegExp) => { const i = hdr.findIndex((h) => re.test(S(h))); return i >= 0 ? S(row[i]) : ''; };
  const injury = splitPair(at(/^대인/));
  const property = splitPair(at(/^대물/));
  const self = splitPair(at(/^자손/));
  const ownRaw = S(at(/^자차/));
  const ownParts = ownRaw.split('/').map((x) => x.trim()).filter(Boolean);
  const ownBase = ownParts.length > 1 ? ownParts[0] : '';
  const own = ownParts.length > 1 ? ownParts.slice(1).join('/') : ownRaw;
  const ownRange = own.split('~').map((x) => x.trim());
  const age = ageLowering(at(/^21세/), at(/^23세/));
  const out: Rec = {};
  const put = (k: string, v: unknown) => { if (v !== '' && v !== 0 && v != null) out[k] = v; };
  put('injury_compensation_limit', limitLabel(injury.limit));
  put('injury_deductible', injury.deductible);
  put('property_compensation_limit', limitLabel(property.limit));
  put('property_deductible', property.deductible);
  put('self_body_accident', limitLabel(self.limit));
  put('self_body_deductible', self.deductible);
  // 무보험 「없음」은 «가입 안 함»이라는 실제 정보다 — 한도만 읽는 limitLabel 이 떨어뜨리므로 따로 살린다.
  const uninsuredRaw = at(/^무보험/);
  put('uninsured_damage', limitLabel(uninsuredRaw) || (/^(없음|x|-)$/i.test(uninsuredRaw.replace(/\s/g, '')) ? '없음' : ''));
  if (ownRange.length === 2) { put('own_damage_min_deductible', wonOf(ownRange[0])); put('own_damage_max_deductible', wonOf(ownRange[1])); }
  else if (own) { put('own_damage_min_deductible', wonOf(own)); put('own_damage_max_deductible', wonOf(own)); }
  if (ownBase) put('own_damage_compensation', /시세/.test(ownBase) ? '시세 기준' : /차량/.test(ownBase) ? '차량가 기준' : '');
  put('annual_mileage', mileageLabel(at(/^연주행|^약정주행/)));
  put('mileage_upcharge_per_10000km', wonOf(at(/^1만\+|^1만km/)));
  put('driver_age_lowering', age.level);
  put('age_lowering_cost', age.cost);
  put('deposit_installment', yesNo(at(/^분납/), '가능', '불가'));
  put('maintenance_service', yesNo(at(/^정비/), '제공', '미제공'));   // 사장님 2026-08-20 표기(정규화기가 「연N회오일」까지 읽는다)
  put('personal_driver_scope', at(/^운전자범위|^운전범위/));
  put('bank_account', at(/^전용계좌|^계좌/));
  put('notes', at(/^기타$|^비고|^특이사항/));
  return out;
}

/** 조건 칸이 하나라도 있는 머리행인가 — 없으면 정책을 만들 근거가 없다. */
export function hasPolicyColumns(hdr: string[]): boolean {
  return hdr.some((h) => /^(대인|대물|자차|자손|무보험|연주행|약정주행|분납|21세|23세|1만\+|정비|운전자범위|전용계좌|계좌)/.test(S(h)));
}

/**
 * ERP 정책 필드 → 정제시트 「정책」 탭 열 이름 → 값(표기 규격 적용).
 * 무보험이 비면 「없음」으로 두지 않는다 — 시트에 없는 값은 지어내지 않는다.
 */
export function policyTabRowFrom(fields: Rec): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (name: string, v: unknown) => {
    const raw = typeof v === 'number' ? (v > 0 ? formatWon(v) : '') : S(v);
    if (!raw) return;
    const r = normalizePolicyValue(name, raw);
    out[name] = r.value || raw;
  };
  put('대인보상한도', fields.injury_compensation_limit);
  put('대인면책금', fields.injury_deductible);
  put('대물보상한도', fields.property_compensation_limit);
  put('대물면책금', fields.property_deductible);
  put('자손보상', fields.self_body_accident);
  put('자손면책금', fields.self_body_deductible);
  put('무보험보상', fields.uninsured_damage);
  put('자차최소면책금', fields.own_damage_min_deductible);
  put('자차최대면책금', fields.own_damage_max_deductible);
  put('자차보상한도', fields.own_damage_compensation === '차량가 기준' ? '차량가액' : fields.own_damage_compensation === '시세 기준' ? '시세' : '');
  put('기본주행', fields.annual_mileage);
  put('추가주행 금액', fields.mileage_upcharge_per_10000km);
  put('연령인하', fields.driver_age_lowering);
  put('연령 하향 요금', fields.age_lowering_cost);
  put('보증금분납', fields.deposit_installment);
  put('정비', fields.maintenance_service);
  put('개인운전자범위', fields.personal_driver_scope);
  put('전용계좌', fields.bank_account);
  put('특이사항', fields.notes);
  return out;
}

/** 정책 동일성 열쇠 — 돈이 걸린 칸만(이름·메모는 달라도 같은 정책). `build-policies-from-sheets.SAME_KEYS` 와 같다. */
export const POLICY_SAME_KEYS = ['injury_compensation_limit', 'injury_deductible',
  'property_compensation_limit', 'property_deductible',
  'self_body_accident', 'self_body_deductible', 'uninsured_damage',
  'own_damage_min_deductible', 'own_damage_max_deductible', 'annual_mileage'] as const;
export function policySameKey(fields: Rec): string {
  return JSON.stringify(POLICY_SAME_KEYS.map((k) => {
    const v = fields[k];
    if (k === 'annual_mileage') {
      const t = S(v).replace(/[\s,]/g, '');
      if (/무제한/.test(t)) return -1;
      const man = /([\d.]+)만/.exec(t);
      return man ? Number(man[1]) * 10_000 : Number(t.replace(/[^\d]/g, '')) || 0;
    }
    return typeof v === 'number' ? v : (wonOf(v) || S(v).replace(/\s/g, ''));
  }));
}
