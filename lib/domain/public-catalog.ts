/**
 * 손님 공개면(`/q`·`/catalog`)에 내보낼 값만 고르는 화이트리스트 — 순수 함수.
 *
 * ★왜 필요한가
 *   fp4 의 손님 페이지는 브라우저가 RTDB 를 **직접** 읽게 돼 있었다. 규칙이 인증을 요구하므로
 *   비로그인 손님에게는 401 이 떨어져 «견적을 찾을 수 없습니다»만 보였다(2026-07-30 QA · 2026-08-28 실측).
 *   규칙을 열어 해결하면 원가·수수료·회원까지 함께 새므로, erp3(`api/catalog-feed.js`)와 같이
 *   **서버가 서비스계정으로 읽고 걸러서** 준다. RTDB 규칙은 한 줄도 건드리지 않는다.
 *
 * ★막아야 하는 것은 **영업 수수료**다 — `fee_rate`(공급사율) · `agent_payout_rate`(영업자 지급율).
 *   이 둘은 매물이 아니라 **파트너·회원**에 있고(`settlement-engine.resolveRates`), 이 API 는
 *   파트너를 아예 읽지 않으며 회원에서는 담당자 표시용(이름·전화)만 뽑는다 — 구조적으로 못 샌다.
 *   그래도 화이트리스트를 유지하는 이유는 나중에 매물에 그런 필드가 생겨도 자동으로 막히게 하려는 것이다.
 *
 * ★내부메모(`partner_memo`)·공급사코드(`provider_company_code`)는 손님이 볼 값이 아니라 뺀다.
 *   원가(`vehicle_price`)는 이 사업에 아예 없는 개념이고 실제로도 683대 전부 비어 있다(실측 2026-08-08).
 *   차대번호(`vin`)는 손님에게 보여도 되는 값이다(사장님 확인) — 실차를 특정하는 정보다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { kmValue } from '@/lib/format';
import { applyPolicyDefaults } from '@/lib/domain/policy-defaults';
import { scrapableSources } from '@/lib/domain/product-photos';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** 손님에게 보여도 되는 정책 필드 — 보험·계약조건·연령. 심사·신용·수수료 등 내부값은 없다. */
const PUBLIC_POLICY_FIELDS = [
  'policy_name', 'policy_type',
  'insurance_included',
  'injury_compensation_limit', 'injury_deductible',
  'property_compensation_limit', 'property_deductible',
  'self_body_accident', 'self_body_deductible',
  'personal_injury_compensation_limit', 'personal_injury_deductible',
  'uninsured_damage', 'uninsured_compensation_limit', 'uninsured_deductible',
  'own_damage_compensation', 'own_damage_repair_ratio', 'own_damage_compensation_rate',
  'own_damage_min_deductible', 'own_damage_max_deductible',
  'annual_roadside_assistance', 'roadside_assistance',
  'annual_mileage', 'max_annual_mileage', 'mileage_upcharge_per_10000km',
  'deposit_installment', 'deposit_card_payment', 'rental_card_payment', 'payment_method', 'payment_timing',
  'penalty_condition', 'rental_region', 'delivery_fee',
  /*
   * ★★`screening_criteria`(심사조건) — **2026-09-05 사장님이 「계속 띄워요」 하셔서 열었다.**
   *   그전까지 손님 화면에 안 나갔고, 정책 정본(`policy-tier`)도 내부용으로 적어 두었다.
   *   ⚠ **계약서에는 여전히 안 실린다** — 그건 `exposure: 'internal'` 이 지킨다(전자계약이 그 값으로 고른다).
   *   ⚠ 화면이 내보내는 것은 원문이 아니라 `creditDisplay` 가 **셋 중 하나로 접은 값**이다
   *     (무심사 / 신용조회 / 소득확인 — 사장님 2026-08-19 확정). 상품 조건이지 사람 평가가 아니다.
   */
  'screening_criteria',
  'basic_driver_age', 'driver_age_lowering', 'age_lowering_cost', 'driver_age_upper_limit', 'license_period',
  'personal_driver_scope', 'business_driver_scope',
  'additional_driver_allowance_count', 'additional_driver_cost',
  'maintenance_service',
  // 사고 나면 손님이 가장 먼저 묻는 값 — 상세 「정비 · 대차」가 쓴다(2026-08-20).
  'replacement_car_policy',
] as const;

/** 손님에게 보여도 되는 매물 필드 — 차량 스펙과 대여 조건. */
const PUBLIC_PRODUCT_FIELDS = [
  'car_number', 'vin', 'maker', 'model', 'sub_model', 'trim_name', 'trim_extra', 'variant',
  'vehicle_class', 'year', 'first_registration_date', 'fuel_type', 'engine_type',
  'ext_color', 'int_color', 'drive_type', 'seats', 'transmission', 'usage',
  /*
   * ★`battery_capacity` 를 넣는다(2026-09-05). 사장님 「배터리 정보 — 전기차에만 해당이 되겠지?」
   *   ERP 원자에는 있는 값인데(`atom-fields`·재고시트·판매축에 다 있다) 이 목록에 없어서
   *   **손님 화면까지 오지를 못했다.** 배기량이 없는 전기차에 그 자리를 드는 값이라,
   *   빠지면 전기차 제원이 한 칸 비어 보인다.
   * ⚠ 스펙 값이라 손님이 봐도 되는 것이다 — 수수료·원가와 성격이 다르다.
   */
  'battery_capacity',
  'options', 'product_type', 'vehicle_status', 'accident_history',
  'cert_car_name', 'location', 'note',
  'insurance_included', 'annual_mileage',
] as const;

/** 기간별 대여료 — 값이 있는 기간만. 음수·0은 버린다(0원 견적 방지). */
function publicPrice(price: unknown): Record<string, { rent: number; deposit: number }> {
  const out: Record<string, { rent: number; deposit: number }> = {};
  if (!price || typeof price !== 'object') return out;
  for (const [key, v] of Object.entries(price as Rec)) {
    const month = Number(String(key).split('_')[0]);
    if (!Number.isFinite(month) || month < 1 || month > 60) continue;
    const rent = N((v as Rec)?.rent);
    if (rent <= 0) continue;
    out[key] = { rent, deposit: N((v as Rec)?.deposit) };
  }
  return out;
}

/** 사진 — 배열·JSON문자열·레거시 키를 모아 중복 제거. */
function publicImages(p: Rec): string[] {
  const urls: string[] = [];
  for (const src of [p.image_urls, p.images, p.photos]) {
    if (!src) continue;
    let arr: unknown = src;
    if (typeof src === 'string') { try { arr = JSON.parse(src); } catch { continue; } }
    if (Array.isArray(arr)) for (const u of arr) if (u && typeof u === 'string') urls.push(u);
  }
  return [...new Set(urls)];
}

export function publicPolicy(policy: Rec | null | undefined): Rec | null {
  /**
   * 정책이 **붙어 있을 때만** 빈 항목을 프리패스 표준으로 보충한다.
   * 아예 안 붙은 매물은 «모르는 것»이라 지어내지 않는다(사장님 2026-08-28 「없으면 없다」).
   * 손님 화면에 지어낸 조건이 서면 그게 곧 약속이 된다 — 위 rtdb-records 의 같은 판단.
   */
  const effective = (policy && Object.keys(policy).length
    ? applyPolicyDefaults(policy).next
    : {}) as Rec;
  const out: Rec = {};
  for (const k of PUBLIC_POLICY_FIELDS) {
    const v = effective[k];
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** 매물 하나를 손님용으로 정제한다. 목록에 없는 필드는 «그냥 빠진다» — 기본값을 지어내지 않는다. */
export function sanitizeProductForGuest(key: string, p: Rec, policy?: Rec | null): EntityRecord {
  const out: Rec = { _key: key, product_code: S(p.product_code) || key };
  for (const f of PUBLIC_PRODUCT_FIELDS) {
    const v = p[f];
    if (v === null || v === undefined || v === '') continue;
    out[f] = v;
  }
  /* ★주행거리는 «콤마를 견디는» 읽개로 읽는다 — `Number('83,000')` 은 NaN 이다(`kmValue` 머리말). */
  out.mileage = kmValue(p.mileage);
  out.engine_cc = N(p.engine_cc);
  out.price = publicPrice(p.price);
  /*
   * 사진 — 저장된 직접 URL이 먼저고, 없으면 **미리 풀어 둔 캐시**(`photo_cache`)를 쓴다.
   *
   * 왜(2026-09-05 실측). 우리 사진의 절반 가까이는 이미지 주소가 아니라 드라이브 폴더·공급사
   * 상세페이지 «링크»다. 그걸 화면이 볼 때마다 풀면 한 건에 0.6~1.4초가 들고 **손님이 바뀔 때마다
   * 처음부터 다시 긁는다** — 첫 화면 서른 대면 마지막 카드까지 7초, 그동안은 회색 판이라
   * 손님은 「사진 없는 차」로 보고 지나간다. `scripts/cache-photo-urls.mts` 가 한 번 풀어 둔다.
   *
   * ★캐시는 **출처가 같을 때만** 쓴다(`scrapableSources` 로 «같은 기준»에서 뽑아 견준다 —
   *   `photo_link` 는 주소를 여럿 담을 수 있어 통째로 견주면 늘 어긋난다).
   *   공급사가 사진링크를 바꾸면 `src` 가 달라져 저절로 무효가 된다 —
   *   안 그러면 「바뀐 링크 · 옛 사진」이 굳는다. 그때는 `photo_link` 가 그대로 내려가고
   *   화면이 예전처럼 직접 푼다(느릴 뿐, 틀리지는 않는다).
   * ★`photo_cache` 자체는 손님에게 안 내보낸다 — 손님이 볼 값은 사진 주소뿐이다.
   */
  const images = publicImages(p);
  const cache = (p.photo_cache || {}) as { urls?: unknown; src?: unknown };
  const cached = Array.isArray(cache.urls)
    ? (cache.urls as unknown[]).filter((u): u is string => typeof u === 'string' && !!u)
    : [];
  const shown = images.length ? images
    : (cached.length && S(cache.src) === S(scrapableSources(p as EntityRecord)[0]) ? cached : []);
  if (shown.length) { out.image_urls = shown; out.image_url = shown[0]; }
  if (S(p.photo_link)) out.photo_link = S(p.photo_link);
  const pol = publicPolicy(policy);
  if (pol) out._policy = pol;
  return out as EntityRecord;
}

/** 담당 영업자 — 손님이 연락할 수 있을 만큼만. 이메일·uid·채널코드는 내보내지 않는다. */
export function sanitizeAgentForGuest(u: Rec | null | undefined): Rec | null {
  if (!u) return null;
  const name = S(u.name);
  const phone = S(u.phone || u.mobile || u.tel || u.contact);
  if (!name && !phone) return null;
  return { name, phone, company_name: S(u.company_name), title: S(u.title || u.position) };
}
