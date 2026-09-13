/**
 * 상품리스트용 원자 (projection) — raw 원자(product) + policy 조인 → 상품리스트 칸 + «형식통일».
 *
 * ★사장님 2026-09-08 — 「상품리스트용 원자가 따로 있어야 한다」 · 「원자에 박아놔」.
 *   raw 원자(products·policy)는 슈퍼셋(형식 섞여도 됨). 시트는 이 «상품리스트용 원자»를 그대로 뿌린다.
 *   여기서 ① 상품리스트 칸을 «고르고» ② 형식을 «규격대로 통일»(돈=한글 단위) ③ 정책을 policy_code로 조인해 «박는다».
 *   ⇒ 「공급사 시트 정책 칸이 비어 다 빠진다」·「10만원 vs 100000 형식 제각각」 둘 다 여기서 종결.
 *
 * 정본 규격 = docs/원자-원천지도.md 「소비처별 원자」.
 */

/**
 * 돈 → 한글 단위 문자열 (사장님 2026-09-08 「1억원 5천만원 이런 식으로 · 근데 100만원부터는 100만원 이렇게」).
 *   · 1천만원 이상 = 억/천만 단위 — 1억원 · 1억5천만원 · 5천만원 · 1천만원
 *   · 1천만원 미만 = 만원 단위 — 900만원 · 100만원 · 50만원 · 10만원  (★「백만원」 안 씀: 1,000,000 = 100만원)
 *   · 돈이 아닌 값(「없음」·「차량가액」·「협의」·「무심사」·빈칸)은 «그대로» 둔다.
 *   · raw 가 숫자(1000000)든 한글(100만원)든 콤마(100,000)든 → 같은 «100만원»으로 통일.
 */
export function moneyKR(input: unknown): string {
  const won = parseWon(input);
  if (won == null) return String(input ?? '').trim();   // 돈 아님 — 그대로
  if (won === 0) return '0원';
  if (won % 10000 !== 0) return won.toLocaleString('en-US') + '원';   // 만원 미만 잔돈은 원 표기(드묾)
  const man = won / 10000;
  const eok = Math.floor(man / 10000);
  const rem = man % 10000;   // 0~9999 (만)
  let s = '';
  if (eok) s += `${eok}억`;
  if (rem) {
    if (rem % 1000 === 0) s += `${rem / 1000}천만`;              // 5000만 → 5천만
    else s += `${rem.toLocaleString('en-US')}만`;               // 100만 → 100만 · 1500만 → 1,500만
  }
  return `${s}원`;
}

/** 문자열/숫자 → 원(정수). 돈이 아니면 null(그대로 둔다). 한글 단위(억·천만·만)·콤마·맨숫자 다 받는다. */
export function parseWon(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : null;
  let s = String(input ?? '').trim();
  if (!s) return null;
  s = s.replace(/원\s*$/, '').replace(/\s+/g, '');
  // 맨숫자·콤마숫자
  if (/^\d{1,3}(,\d{3})+$/.test(s) || /^\d+$/.test(s)) return Number(s.replace(/,/g, ''));
  // 한글 단위 — 억 → 천만 → 만 순으로 뜯어 더한다(천만을 만보다 먼저 떼야 겹치지 않음)
  let won = 0; let hit = false;
  const eok = s.match(/(\d[\d,]*)억/); if (eok) { won += num(eok[1]) * 100_000_000; hit = true; s = s.replace(/\d[\d,]*억/, ''); }
  const cheonman = s.match(/(\d[\d,]*)천만/); if (cheonman) { won += num(cheonman[1]) * 10_000_000; hit = true; s = s.replace(/\d[\d,]*천만/, ''); }
  const man = s.match(/(\d[\d,]*)만/); if (man) { won += num(man[1]) * 10_000; hit = true; s = s.replace(/\d[\d,]*만/, ''); }
  const tail = s.match(/(\d[\d,]*)/); if (tail && hit) won += num(tail[1]);   // 「1억5천만 3000」 같은 꼬리
  return hit ? won : null;   // 「없음」·「차량가액」 등은 hit=false → null(그대로)
}
const num = (x: string) => Number(String(x).replace(/,/g, '')) || 0;

import { canonProductType } from './product';
import { SALES_COLUMNS } from './sales-sheet-mapping';

/** policy 원자 → 상품리스트 정책 칸. legacy 결합칸(「한도 / 면책」)을 그대로, 단일 돈칸은 한글 단위. */
function policyCells(p: Record<string, unknown> | undefined): Record<string, string> {
  const S = (v: unknown) => String(v ?? '').trim();
  if (!p) return {};
  return {
    '대인': S(p.personal_injury_limit_deductible_legacy) || S(p.property_compensation_limit),
    '대물': S(p.property_limit_deductible_legacy) || [S(p.property_compensation_limit), S(p.property_deductible)].filter(Boolean).join(' / '),
    '자손': [S(p.self_body_accident), S(p.self_body_deductible)].filter(Boolean).join(' / '),
    '무보험': S(p.uninsured_limit_deductible_legacy) || [S(p.uninsured_damage), S(p.uninsured_deductible)].filter(Boolean).join(' / '),
    '자차': S(p.own_damage_limit_deductible_legacy) || (() => { const mn = S(p.own_damage_min_deductible), mx = S(p.own_damage_max_deductible); const ded = mn && mx ? (mn === mx ? mn : `${mn}~${mx}`) : (mn || mx); return [S(p.own_damage_compensation), ded].filter(Boolean).join(' / '); })(),
    '정책UID': S(p.policy_code),
    '정책명': S(p.policy_name) || S(p.term_name),   // ★사장님 2026-09-08 「정책명 해놔도 원자로 반영해주면 금방 확인」 — 코드(UID)와 «이름» 둘 다 낸다
    '심사조건': S(p.screening_criteria),
    '대여지역': S(p.rental_region),
    '분납': S(p.installment_allowed),
    '중도해지 1년미만': S(p.penalty_condition),
    '승계': [S(p.succession_allowed), moneyKR(p.succession_fee)].filter((x) => x && x !== '0원').join(' · '),
    '운전자범위': S(p.personal_driver_scope),
    '정비': S(p.replacement_car_policy),
  };
}

/** price 객체(기간_주행 → {rent,deposit}) → 대여료 월별·보증금 칸. 돈은 한글 단위.
 *  ⚠ 한 기간에 주행밴드가 여럿(2만·3만)이면 «주행 낮은 것»을 쓴다 — ★이 선택 규칙은 사장님 확인 필요.
 *  ⚠ 단기보증=12개월 deposit · 장기보증=36(없으면 60/48/24) deposit — ★이 매핑도 확인 필요. */
function rentCells(price: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!price || typeof price !== 'object') return out;
  const byTerm = new Map<string, { km: number; rent?: number; deposit?: number }[]>();
  for (const [k, v] of Object.entries(price as Record<string, { rent?: number; deposit?: number }>)) {
    const [term, km] = String(k).split('_');
    if (!term) continue;
    (byTerm.get(term) || byTerm.set(term, []).get(term)!).push({ km: parseInt(km || '0', 10) || 0, rent: v?.rent, deposit: v?.deposit });
  }
  const pick = (t: string) => (byTerm.get(t) || []).slice().sort((a, b) => a.km - b.km)[0];
  for (const t of ['1', '6', '12', '24', '36', '48', '60']) { const e = pick(t); if (e?.rent != null) out[`${t}개월`] = moneyKR(e.rent); }
  const short = pick('12') || pick('6') || pick('1'); const long = pick('36') || pick('60') || pick('48') || pick('24');
  if (short?.deposit != null) out['단기보증'] = moneyKR(short.deposit);
  if (long?.deposit != null) out['장기보증'] = moneyKR(long.deposit);
  return out;
}

/** 상품리스트에 «보여지는» 원자 구성 — raw product(+policy 조인) → 69칸. 돈은 한글 단위로 통일. */
export function buildProductListRow(product: Record<string, unknown>, policyByCode?: Map<string, Record<string, unknown>>, providerNames?: Map<string, string>, overridesByCode?: Map<string, Record<string, string>>): Record<string, string> {
  const S = (v: unknown) => String(v ?? '').trim();
  const pol = policyByCode?.get(S(product.policy_code));
  // ★공급사 = «회사명»(짧은 이름). 코드(RP012)는 보조일 뿐 — 원자엔 회사명을 붙인다(사장님 2026-09-08 「회사코드 안 쓴다·회사명 만들어 붙인다」).
  const provCode = S(product.provider_company_code) || S(product.partner_code);
  const provName = S(product.provider_name) || providerNames?.get(provCode) || provCode;
  // ★할증·연령 = supplier-policy-overrides(사장님 확인값 = 최우선). 공급사별. 원천지도 §5.
  const ov = overridesByCode?.get(provCode) || {};
  // ★원문은 구조화 객체 {차명, 옵션}(487/500) — 통째로 읽으면 [object Object]. 하위 필드를 뽑는다(문자열이면 그대로).
  const wm = product.원문 as unknown;
  const 차명원문 = wm && typeof wm === 'object' ? S((wm as Record<string, unknown>).차명) : S(wm);
  const 옵션원문 = wm && typeof wm === 'object' ? S((wm as Record<string, unknown>).옵션) : '';
  const row: Record<string, string> = {};
  for (const c of SALES_COLUMNS) row[c] = '';   // ★69칸 전부 내보낸다 — 채운 칸/빈 칸이 한눈에 보이게(사장님 「빠진거 많음」)
  Object.assign(row, {
    // ⑥상태(바뀌는 값) — 원자 그대로
    '배차상태': S(product.vehicle_status),
    '구분': canonProductType(product.product_type),
    // ①식별
    '차량번호': S(product.car_number),
    '공급사': provName,   // 회사명(짧은 이름). 코드는 보조.
    // ②차량(제원)
    '제조사': S(product.maker), '모델': S(product.model), '세부모델': S(product.sub_model), '세부트림': S(product.trim_name),
    '외장': S(product.ext_color), '내장': S(product.int_color),
    '연식': S(product.year), 'Km': S(product.mileage), '연료': S(product.fuel_type),
    '배기량': S(product.engine_cc), '차종구분': S(product.vehicle_class),
    '원산지': S(product.origin), '구동': S(product.drive_type), '인승': S(product.seats),
    '배터리용량': S(product.battery_capacity), '최초등록': S(product.first_registration_date),
    '사진': S(product.photo_link),
    // ③선택옵션 · 원문
    '차명(원문)': 차명원문, '옵션(원문)': 옵션원문 || S(product.options),
    // ④요금 — 대여료·보증금은 원자 `price` 객체에 «있다»(기간_주행 → {rent,deposit}). 한글 단위로.
    ...rentCells(product.price),
    // 소비자가격 = 차량 판매가(대여료 아님). 원자에 별도 필드 없으면 빈칸(대여료 price 객체를 쓰면 안 됨).
    '소비자가격': moneyKR(product.consumer_price ?? product.msrp ?? ''),
    // ⑤계약조건(정책) — policy_code 조인. ⚠ 오플구독 등 «구독»은 policy_code 없음 → 정책 빈다(사장님 「정책 다 빠진」).
    ...policyCells(pol),
    // 할증·연령 = 오버라이드(사장님 확인값 최우선). 값이 없으면 «오버라이드 대기»(사장님이 알게 되는 대로 박음, 원천지도 §5).
    '1만+': S(ov['1만+']), '21세+': S(ov['21세+']), '23세+': S(ov['23세+']),
    '기본연령': S(ov['기본연령']), '최소연령': S(ov['최소연령']), '최대연령': S(ov['최대연령']),
  });
  return row;
}

/** 상품리스트 칸 중 «돈»이라 한글 단위로 통일할 칸(대여료 원자화되면 월별·보증금도 추가). */
export const MONEY_COLUMNS = ['소비자가격', '단기보증', '장기보증', '1개월', '6개월', '12개월', '24개월', '36개월', '48개월', '60개월', '탁송비', '추가운전 요금'] as const;
