/**
 * **원자 한 대 → 판매시트 «한 줄».** 상품리스트(F01)와 채널시트(F86)가 **같은 이 함수**를 쓴다.
 *
 * > 사장님 2026-09-09 「당겨오는 거는 **원자 쪽에서** 당겨오는 거고 … **그 갖고 온 원자에서 다 주는** 거잖아」
 *
 * ⚠⚠ 실측 2026-09-09 — F86(하허호)이 원자가 아니라 **F01 «시트»를 다시 읽어** 줄을 만들고 있었다
 *   (`values/'탭'!A1:CZ3000`). 원자 → F01 시트 → F86 시트로 **다리가 하나 더** 있었던 것이다.
 *   그러면 ㉠ F01 발행이 실패한 회차엔 F86 이 «옛 시트»를 베끼고,
 *        ㉡ F01 이 잘못 실은 값을 F86 이 그대로 물려받고,
 *        ㉢ 정렬·요금 규칙이 두 벌로 적혀 있어(양쪽에 같은 코드가 따로) 한쪽만 고치면 갈린다.
 *   ⇒ **둘 다 원자에서 만든다.** 줄 만드는 법이 한 벌이면 갈릴 자리가 없다.
 *
 * ★**열 «이름»은 여전히 F01 시트가 정한다** — 우리가 규격을 새로 만들지 않는다(사장님 「이미 정답이 있는데」).
 *   시트에서 읽는 것은 **머리글 한 줄**뿐이고, 값은 전부 원자가 준다.
 *
 * ★넘겨받는 «문맥»(정책·공급사명·계좌·티카링크·인기순)은 부르는 쪽이 한 번 모아서 넣는다 —
 *   모으는 길이 둘로 갈리면 같은 차가 시트마다 다른 값을 갖는다.
 */
import { readFileSync } from 'node:fs';
import { autoplusDepositRuleText } from './sales-published-tabs';
import { isDepositColumn } from './sales-sheet-format';
import { groupPoliciesByProvider, autoPolicyCode } from './supplier-policy-link';

const S = (v: unknown) => String(v ?? '').trim();

/** 부르는 쪽이 모아서 넣는 문맥 — 어느 발행기든 «같은 것»을 넣어야 값이 같아진다. */
export type SalesRowContext = {
  /** 원자 → 그 차의 정책(공급사 「운영정책」). `supplier-policy-link` 규칙으로 고른 것. */
  policyOf: (v: any) => any;
  /** 공급사코드 → 회사 이름(문패 정본). 못 찾으면 «비운다» — 코드로 때우지 않는다. */
  nameByProvider: Map<string, string>;
  /** 공급사코드 → 전용계좌 한 줄. */
  acctByProvider: Map<string, string>;
  /** 이름을 못 찾은 공급사 — 세어서 부르는 쪽이 알린다. */
  unnamedProviders: Map<string, number>;
};

const NKEY = (c: unknown) => S(c).replace(/\s/g, '');


/**
 * ★★**«문맥»도 한 곳에서 모은다** — 정책·공급사명·전용계좌·티카링크.
 *
 * ⚠ 실측 2026-09-09 — F86 은 공급사 이름을 «제 나름대로» 또 모으고 있었다(문패 + `v4/partners`).
 *   같은 것을 두 군데서 모으면 한쪽만 고쳐졌을 때 **같은 차가 시트마다 다른 회사로** 선다.
 *   실제로 F01 은 이름을 못 찾으면 «비우는데» F86 은 그 빈칸을 「(공급사 없음)」 탭으로 묶어 내보냈다.
 * ⇒ 모으는 길도 한 벌. 부르는 쪽은 Firestore 원자(`policy`·`partner`)만 준다.
 */
export type SalesRowDeps = {
  /** Firestore `policy` 원자. 문서 ID는 `_key`로 함께 넘긴다. */
  policies: Array<Record<string, any>>;
  /** Firestore `partner` 원자. 문서 ID는 `_key`로 함께 넘긴다. */
  partners: Array<Record<string, any>>;
  /** 공급사 표기 통일(`companyAlias`) — 도메인 순환참조를 피해 부르는 쪽이 넣는다. */
  companyAlias: (s: string) => string;
};

export async function loadSalesRowContext(deps: SalesRowDeps): Promise<SalesRowContext> {
  const { companyAlias } = deps;
  const policies = deps.policies;
  // 코드 정규화 — 접미사 앞자리 0 차이 흡수(RP031_S1 ↔ RP031_S01). 사장님 2026-09-03 실측 123대.
  const normCode = (c: unknown) => S(c).toLowerCase().replace(/_([a-z]+)0*(\d+)/g, '_$1$2');
  const polByCode = new Map<string, any>();     // policy_code 필드
  const polByKey = new Map<string, any>();      // 노드 키
  const polByNorm = new Map<string, any>();     // 정규화 코드(퍼지)
  const provPolicies = new Map<string, any[]>();
  for (const p of policies) {
    if (!p || typeof p !== 'object') continue;
    const k = S((p as any)._key);
    polByKey.set(k, p); polByNorm.set(normCode(k), p);
    const code = S((p as any).policy_code);
    if (code) { polByCode.set(code, p); polByNorm.set(normCode(code), p); }
    const prov = S((p as any).provider_company_code);
    if (prov) { const a = provPolicies.get(prov) || []; if (!a.includes(p)) a.push(p); provPolicies.set(prov, a); }
  }
  // ★정책 매칭 = 화면(resolveAtom)과 «같은 규칙»(supplier-policy-link) — 시트=화면이 되게(사장님 2026-09-08 「자꾸 갈린다」).
  //   공급사 정책 1개→자동 · 여럿이면 «렌트/구독 버킷»으로 번호판별 상품구분에 맞춰 고름 · 모호(공통렌트+재렌트 겹침)면 빈칸(안 씌운다).
  const byProvider = groupPoliciesByProvider(policies);
  const policyOf = (v: any) => {
    const direct = polByCode.get(S(v.policy_code)) || polByKey.get(S(v.policy_code)) || polByNorm.get(normCode(v.policy_code));
    if (direct) return direct;
    const code = autoPolicyCode(v, byProvider);   // 공급사 매칭(1개→자동·렌트/구독 버킷) — 못 정하면 ''(빈칸)
    return (code && (polByCode.get(code) || polByKey.get(code))) || {};
  };
  const unnamedProviders = new Map<string, number>();
  const acctByProvider = new Map<string, string>();
  const nameByProvider = new Map<string, string>();
  {
    for (const p of deps.partners) {
      if (!p || typeof p !== 'object') continue;
      const code = S((p as any).partner_code) || S((p as any).provider_company_code);
      const acct = [S((p as any).bank_name), S((p as any).bank_account), S((p as any).bank_holder)].filter(Boolean).join(' ');
      // ★공급사명 = 발행기 ⑥(publish-origin-tab)의 `who` 와 «똑같은 값»으로(companyAlias). 표기가 다르면 ⑥의 shrink 가드가 오판한다(코덱스 2026-09-04).
      const raw = S((p as any).partner_name) || S((p as any).name);
      const nm = companyAlias(raw) || raw;
      if (code && acct) acctByProvider.set(code, acct);
      if (code && nm) nameByProvider.set(code, nm);
    }
    console.log(`전용계좌 ${acctByProvider.size}개 · 공급사명 ${nameByProvider.size}개 로드`);
  }

  return { policyOf, nameByProvider, acctByProvider, unnamedProviders };
}


// 탭 배정 = 발행기 규칙
export const tabOf = (v: any): string => {
  const prov = S(v.provider_company_code), pt = S(v.product_type);
  if (prov === 'RP012' && pt === '픽업구독') return '픽업구독';
  if (prov === 'RP012' && pt.includes('구독')) return '손오공구독';
  if (prov === 'RP023') return '오플구독';
  return '상품리스트';
};
export const TAB_ORDER = ['상품리스트', '손오공구독', '픽업구독', '오플구독'] as const;

// ★옵션 정리(사장님 2026-09-04) — 「-」·「.」처럼 텍스트/영문/숫자가 없으면 선택옵션 없음(빈칸).
const cleanOpt = (s: string): string => /[가-힣A-Za-z0-9]/.test(S(s)) ? S(s) : '';

// ── 열 이름 → 값 ──
const money = (v: unknown) => { const n = Number(String(v).replace(/[,\s]/g, '')); return n ? n.toLocaleString() : (v == null || v === '' ? '' : S(v)); };
// 면책금·한도 단위 표기 — 「1억/50」→「1억원 / 50만원」, 「3천/50」→「3천만원 / 50만원」, 「무한/없음/차량」은 그대로.
const fmtUnit = (s: string): string => {
  s = S(s);
  if (!s || /무한|없음|차량|미가입|불가|가능|협의|전국|일부|본인|가족|사업자|개인|오일|미제공|신용|무심사/.test(s)) return s;
  if (/억\s*원?$/.test(s)) return s.replace(/\s*원$/, '') + '원';           // 1억 → 1억원
  if (/천\s*만?\s*원?$/.test(s)) return s.replace(/\s*만?\s*원?$/, '') + '만원'; // 2천 → 2천만원
  if (/^\d+(?:\s*[~\-]\s*\d+)?\s*만?\s*원?$/.test(s)) return s.replace(/\s*만?\s*원?$/, '').replace(/\s/g, '') + '만원'; // 50 / 50~100 → 만원
  return s;
};
const fmtLimit = (raw: string): string => S(raw).split('/').map((p) => fmtUnit(p.trim())).filter(Boolean).join(' / ');
const priceCell = (price: any, col: string): string => {
  if (!price || typeof price !== 'object') return '';
  const P = price as Record<string, any>;
  const rentK = (k: string) => (P[k]?.rent != null ? money(P[k].rent) : '');
  /**
   * ★**보증금 0 은 «0」이라 적지 않는다.**
   *   ⚠ 2026-09-08 실측 — 시트에 「장기보증=0」이 서 있었다. 0원은 사람이 쓰는 말이 아니다 —
   *   보증금이 없는 상품이면 원천이 **「무보증」**이라 적어 준다(`deposit_note`). 그 말을 쓰게
   *   여기서는 빈 값을 돌려주고, 부르는 쪽이 원천의 말로 채운다. 말이 없으면 빈칸이고 문지기가 잡는다.
   */
  /**
   * ★★**단기보증 = 1·6·12개월 · 장기보증 = 24개월 이상** (사장님 2026-09-08
   *   「단기보증 1 6 12 장기보증 24 36 48 60 이게 기본 대여료 칸 구분이지」).
   *   ⚠ 2026-09-08(코덱스가 잡았다) — 코드가 **12를 장기 쪽에서** 찾고 단기는 1·6만 봤다.
   *   매뉴얼이 경고해 둔 바로 그 자리다 — 「12개월을 장기에 넣으면 단기가 통째로 빈다」.
   */
  const 장기 = ['60', '48', '36', '24'] as const;
  const 단기 = ['1', '6', '12'] as const;
  const depAny = (suffix = '') => { for (const t of 장기) { const k = suffix ? `${t}${suffix}` : t; const d = P[k]?.deposit; if (d != null) return Number(d) > 0 ? money(d) : ''; } return ''; };
  const m = col.match(/(\d+)개월/);
  /**
   * ★★**보증금 칸은 «F01 의 열»이 정한다** — 우리가 규격을 새로 만들지 않는다.
   *   ⚠ 예전 주석은 `lib/domain/fee-shapes` 를 가리켰는데 **그 파일은 지웠다**(2026-09-08).
   *     규격을 따로 지어 봤다가 오플 탭 열을 두 벌로 만들어 시트를 깨뜨렸다 — 사장님 「이미 정답이 있는데」.
   *   ⚠ 예전엔 여기서 `60·48·36·24·12` 키만 뒤져서 **오플이 통째로 빠졌다**(키가 `12_2만` 꼴).
   *     원자엔 72대에 보증금이 있는데 시트 「보증금」 칸은 0/84 였다(실측 2026-09-08).
   *   ⇒ 칸 이름으로 축의 보증금 규칙을 찾아 쓴다. 못 찾으면 «옛 규칙»으로 떨어진다(하위호환).
   */
  if (/반납형\s*보증금|보증금\s*반납형|장기보증/.test(col)) return depAny();
  if (/인수형\s*보증금|보증금\s*인수형/.test(col)) return depAny('_인수형');
  if (/단기보증/.test(col)) { for (const t of 단기) { const d = P[t]?.deposit; if (d != null) return Number(d) > 0 ? money(d) : ''; } return ''; }
  if (m) {
    const n = m[1];
    if (/인수형/.test(col)) return rentK(`${n}_인수형`);
    if (/반납형/.test(col)) return rentK(n);
    if (/2만/.test(col)) return rentK(`${n}_2만`);
    if (/3만/.test(col)) return rentK(`${n}_3만`);
    return rentK(n);   // 상품리스트 N개월
  }
  return '';
};
const cardYN = (pm: string) => (/카드/.test(pm) ? '가능' : '');
// 정책 스키마 둘 다 흡수 — `*_legacy` 결합필드 우선, 없으면 «한도 / 자기부담」 분리필드로 조립.
const G = (pol: any, ...keys: string[]) => { for (const k of keys) if (S(pol[k])) return S(pol[k]); return ''; };
const combine = (pol: any, legacy: string, limit: string[], ded: string[]) => {
  const L = G(pol, legacy); if (L) return L;
  const a = G(pol, ...limit), b = G(pol, ...ded);
  return [a, b].filter(Boolean).join(' / ');
};
// ★공급사별 정책 정본 = 구형 공급사시트에서 학습(사장님 2026-09-03). 공급사코드 → 정책 열값.
const supPol: Record<string, Record<string, string>> = (() => { try { return JSON.parse(readFileSync('public/data/supplier-policies.json', 'utf8')); } catch { return {}; } })();
// ★사장님 확인 오버라이드(21세/23세/1만+ 등) — supplier-policies 보다 우선. 알게 되는 대로 이 파일에 넣는다.
const override: Record<string, Record<string, string>> = (() => { try { return JSON.parse(readFileSync('public/data/supplier-policy-overrides.json', 'utf8')); } catch { return {}; } })();
// 할증 표기(사장님 2026-09-04 「대여료 10% · 정액 10만원 이렇게, 21·23세도」) —
//   「0.1」→대여료 10% · 「10/12/7」(바 정수)→대여료 X% · 「3만/10만원」→정액 X만원 · 불가/협의/문의는 그대로.
//   바 정수를 «대여료 %»로 보는 근거: 손오공 1만+ 「0.1」(=10%)와 21세 「10」이 같은 단위 · 손오공=대여료 10% 확인.
//   정액인 곳은 원값에 「만」이 붙어 오거나(3만) 오버라이드로 박는다.
const fmtSurcharge = (s: string): string => {
  const t = S(s).replace(/\s/g, '');
  if (!t || /문의|협의|불가|없음|미가입|대여료|정액/.test(t)) return S(s);
  if (/만원?$/.test(t)) return `정액 ${t.replace(/원$/, '').replace(/만$/, '만원')}`;
  const n = Number(t.replace('%', ''));
  if (!isNaN(n) && n > 0 && n < 1) return `대여료 ${Math.round(n * 100)}%`;
  if (!isNaN(n) && n >= 1 && n < 100) return `대여료 ${n}%`;   // 바 정수 = 대여료 퍼센트
  if (/%$/.test(t)) return `대여료 ${t}`;
  return S(s);
};

export const makeCell = (ctx: SalesRowContext) => (col: string, v: any): string => {
  const pol = ctx.policyOf(v);
  const prov = S(v.provider_company_code);
  const sp = supPol[prov];
  const ov = override[prov];
  // 0) 사장님 확인값(오버라이드) — 어느 열이든 최우선. 알게 되는 대로 supplier-policy-overrides.json 에 넣는다.
  if (ov && S(ov[col])) return S(ov[col]);
  // ★기본연령(사장님 2026-09-04) — 전 공급사 만26세 이상.
  if (col === '기본연령') return '만26세 이상';
  // ★할증 열(1만+·21세+·23세+) — 「대여료 00% / 정액 00만원」으로 표기(사장님 2026-09-04).
  //   0.1→대여료 10%, 3만→정액 3만원. 애매한 정수(어디는 %·어디는 정액)는 원값 유지 → 확인되면 오버라이드로 박는다.
  if (col === '1만+') return fmtSurcharge(S(sp?.['1만+']) || S(pol.mileage_upcharge_per_10000km));
  if (col === '21세+' || col === '만21세') return fmtSurcharge(S(sp?.['21세']));
  if (col === '23세+' || col === '만23세') return fmtSurcharge(S(sp?.['23세']));
  // 1) 공급사시트 정책이 그 열을 갖고 있으면 그걸 최우선. 면책금 단위표기·가격 콤마.
  if (sp && col !== '전용계좌' && S(sp[col])) {
    const raw = S(sp[col]);
    if (/대인|대물|자손|무보험|자차/.test(col)) return fmtLimit(raw);
    if (/소비자가격|가격|금액/.test(col)) return money(raw);
    return raw;
  }
  const direct: Record<string, string> = {
    /**
     * ★★**배차상태는 `vehicle_status` 가 정본**이다 — `status` 가 아니다.
     *   ⚠ 2026-09-08 실측 — 여기서 `status` 를 쓰는 바람에, 두 칸이 갈린 차의 시트 값이
     *   문지기·손님 면과 **다른 말**을 했다(133호6494 시트「출고협의」↔ 원자「상품화중」).
     *   상태를 두 군데서 읽으면 어느 쪽이 진짜인지 화면이 말해 주지 않는다.
     *   규칙 SSOT = `docs/원자-내려보내기-로직.md` §1 「상태 칸을 두 벌로 두지 않는다」.
     */
    '배차상태': S(v.vehicle_status) || S(v.status), '구분': S(v.product_type), '차량번호': S(v.car_number),
    '제조사': S(v.maker), '모델': S(v.model), '세부모델': S(v.sub_model),
    // 세부트림 — snap 이 「기본형」을 버려 비지만, 원문에 기본형이면 그대로 표기(사장님 2026-09-03).
    '세부트림': S(v.trim_name) || (/기본\s*형|\b기본\b/.test(S(v['원문']?.['차명'])) ? '기본형' : ''),
    '외장': S(v.ext_color), '내장': S(v.int_color), '연식': S(v.year), 'Km': S(v.mileage),
    '연료': S(v.fuel_type), '배기량': S(v.engine_cc), '차종구분': S(v.vehicle_class),
    '차명(원문)': S(v['원문']?.['차명']), '옵션(원문)': cleanOpt(S(v['원문']?.['옵션'])),
    '원산지': S(v.origin), '구동': S(v.drive_type), '인승': S(v.seats), '배터리용량': S(v.battery_capacity),
    '최초등록': S(v.first_registration_date), '차고지': S(v.location), '사진': S(v.photo_link),
    '정책UID': S(v.policy_code),
    '대인': combine(pol, 'personal_injury_limit_deductible_legacy', ['injury_compensation_limit', 'personal_injury_compensation_limit'], ['injury_deductible', 'personal_injury_deductible']),
    '대물': combine(pol, 'property_limit_deductible_legacy', ['property_compensation_limit'], ['property_deductible']),
    '자손': combine(pol, 'self_body_limit_deductible_legacy', ['self_body_accident', 'self_body_compensation_limit'], ['self_body_deductible']),
    '무보험': combine(pol, 'uninsured_limit_deductible_legacy', ['uninsured_damage', 'uninsured_compensation_limit'], ['uninsured_deductible']),
    '자차': combine(pol, 'own_damage_limit_deductible_legacy', ['own_damage_compensation'], ['own_damage_min_deductible']),
    '심사조건': S(pol.screening_criteria), '대여지역': S(pol.rental_region),
    '1만+': S(pol.mileage_upcharge_per_10000km),
    '대여료 카드결제': cardYN(S(pol.payment_method)), '보증금 카드결제': cardYN(S(pol.payment_method)),
    '중도해지 1년미만': S(pol.penalty_condition), '중도해지 1년이상': S(pol.penalty_condition),
    '승계': S(pol.succession_allowed) + (pol.succession_fee ? ` (${money(pol.succession_fee)})` : ''),
  };
  if (col in direct) return direct[col];
  /**
   * ★★**「차번링크」도 «원자»가 준다** — 사장님 2026-09-09 「그 갖고 온 원자에서 다 주는 거잖아」.
   *   ⚠ 예전엔 발행할 때마다 손오공 재고시트의 「픽업재고」 탭을 다시 읽었다. 발행기가 원천을 읽으면
   *   그 시트가 잠깐 안 읽히는 회차엔 링크 228칸이 통째로 빈칸이 되는데 로그는 성공으로 찍힌다.
   *   ⇒ 수집기가 당길 때 같이 당겨 `tica_link` 로 박는다(`ingest-supplier-to-firestore` 손오공 리더).
   */
  if (col === '차번링크') return S(v.tica_link);
  if (col === '전용계좌') return ctx.acctByProvider.get(S(v.provider_company_code)) || '';   // 공급사 계좌
  /**
   * ★**공급사 칸에는 «이름»만 넣는다 — 코드는 안 넣는다** (사장님 2026-09-08).
   *   예전엔 이름을 못 찾으면 코드를 그대로 실었다. 그러면 영업자·채널이 「RP031」을 회사로 읽고,
   *   같은 회사가 «이안카»와 «RP031» 두 이름으로 갈려 세어진다(실측 310대).
   *   못 찾으면 **비우고 아래에서 목록으로 찍는다** — 지어내지도, 코드로 때우지도 않는다.
   */
  if (col === '공급사') {
    const code = S(v.provider_company_code);
    const nm = ctx.nameByProvider.get(code);
    if (!nm && code) ctx.unnamedProviders.set(code, (ctx.unnamedProviders.get(code) || 0) + 1);
    return nm || '';
  }
  /**
   * ★★**오플 「보증금」은 «금액이 아니라 말»이다** (사장님 2026-08-19 · 2026-09-08 「그냥 금액으로 넣는 게 아니라
   *   말로 넣으면 된다고」). 오플 시트에는 보증금 칸이 아예 없고, 보증금은 «산출 규칙»으로만 정해진다 —
   *   국산 = 월 대여료 ×2 · 수입 = 12개월 ×3, 18개월↑ ×6.
   *   정본 = `sales-published-tabs.autoplusDepositRuleText` (「금액을 계산하지 않고 규칙만 글자로 둔다」).
   *   ⚠ ⑯ 이 그 정본을 안 쓰고 금액을 찾다 못 찾아 **0/84 로 비워 두고 있었다**(실측 2026-09-08).
   *     숫자를 지어 넣으면 그게 곧 «우리가 만든 오류»다 — 기간마다 다른 값을 한 칸에 못 담는다.
   */
  if (col === '보증금' && S(v.provider_company_code) === 'RP023') return autoplusDepositRuleText(S(v.maker));
  if (/보증|개월|반납형|인수형|만km|장기보증/.test(col)) {
    const cell = priceCell(v.price, col);
    /**
     * ★★**보증금이 «말»로 적힌 것을 빈칸으로 두지 않는다** (사장님 2026-09-08 「보증금 잘 챙기고」).
     *   ⚠ 실측 — 아이카 96대 중 **50대**가 시트에서 보증금 빈칸이었는데, 원천엔 **「무보증」**이라 적혀 있었다.
     *   `won('무보증')=0` 이라 숫자로만 실은 탓이다. **빈칸은 「없다」가 아니라 「모른다」로 읽힌다** —
     *   영업자가 매번 전화로 물어야 한다. 원천이 말로 준 것은 그 말 그대로 싣는다(오플 규칙문구와 같은 결).
     *   ⚠ 단 **요금 칸에는 안 쓴다** — 보증금 칸에만.
     */
    if (!cell && isDepositColumn(col) && S(v.deposit_note)) return S(v.deposit_note);
    return cell;
  }
  return '';   // 소비자가격·그 밖 요금·연주행·탁송비·분납·사고다발 = 원천 없음(빈칸)
};


/**
 * ★★**줄 차례도 «한 벌»이다** — 매뉴얼 `docs/영업자시트-매뉴얼.md` 「기본 정렬」.
 *
 * ⚠ 실측 2026-09-09 — F01 과 F86 에 **같은 규칙이 따로** 적혀 있었다(F86 은 시트 «칸»으로 견주고,
 *   F01 은 «원자»로 견줬다). 한쪽만 고치면 같은 재고가 두 차례로 보인다 — 「왜 또 바뀌었냐」의 자리다.
 *
 * ★인기(`modelSold`)는 «팔린 것»(정산원장 실적) · 보조축(`modelCount`)은 «들고 있는 것»(재고 대수).
 *   둘은 다른 축이다 — 한 칸에 뭉치지 않는다(사장님 2026-09-08).
 */
export const compareSalesRows = (modelSold: Map<string, number>, modelCount: Map<string, number>) => (a: any, b: any): number => {
  const isNew = (v: any) => (/신차/.test(S(v.product_type)) ? 0 : 1);
  const sold = (v: any) => -(modelSold.get(S(v.model)) || 0);           // 많이 나간 차종이 위로(인기)
  const pop = (v: any) => -(modelCount.get(S(v.model)) || 0);           // 같은 실적이면 재고 많은 쪽(보조)
  /** 연식 — 「24년」·「2024」 섞여 들어온다. 숫자만 뽑아 두 자리는 2000년대로 편다. */
  const year = (v: any) => {
    const n = Number(S(v.year).replace(/[^0-9]/g, '').slice(0, 4));
    if (!Number.isFinite(n) || !n) return 0;
    return n < 100 ? 2000 + n : n;
  };
  const cheap = (v: any) => {
    const P = v.price && typeof v.price === 'object' ? v.price as Record<string, any> : null;
    if (!P) return Number.MAX_SAFE_INTEGER;
    const rents = Object.values(P).map((x: any) => Number(x?.rent)).filter((n) => Number.isFinite(n) && n > 0);
    return rents.length ? Math.min(...rents) : Number.MAX_SAFE_INTEGER;
  };
  const 묶음 = isNew(a) - isNew(b)
    || sold(a) - sold(b)
    || pop(a) - pop(b)
    || S(a.model).localeCompare(S(b.model), 'ko');
  if (묶음) return 묶음;
  /** 묶음 안 — 신차는 값, 중고는 연식이 먼저다. */
  const 안 = isNew(a) === 0 ? 0 : (year(b) - year(a));
  return 안 || cheap(a) - cheap(b)
    || S(a.provider_company_code).localeCompare(S(b.provider_company_code))
    || S(a.car_number).localeCompare(S(b.car_number));
};
