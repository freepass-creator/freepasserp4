/**
 * 견적을 **누가 보나** — 한 곳(SSOT).
 *
 * ★사장님 2026-09-06 「견적기는 영업자가 보낸 게 아니고 일단 **공급사들이 보는** 거고,
 *   영업자랑 손님이 보는 거는 원가 정보 빠진 거 좋은 거야」 →
 *   이어서 「일단 **메뉴 자체를 관리자랑 공급사만** 보게 해요. **아직 해당 없어**」.
 *
 * ★★2026-09-16 — **영업자가 들어온다.** 사장님 「이거도 분리해서 freepass-견적기로 하자.
 *   영업(자용으)로 해야 할 거고」. 2026-09-06 의 「아직 해당 없어」가 이날 풀렸다.
 *   ⇒ 물음이 **둘로 갈린다** — 「화면을 보나」(`canSeeEstimate`)와 「원가를 보나」(`showsCost`).
 *     영업자는 앞엣것만 참이다: 대여료·보증금·선납·만기인수는 보고,
 *     원가·매출·영업이익·손바뀜·잔가는 **화면에도 응답에도 없다.**
 *   ⚠ 숨기는 것만으로는 막은 게 아니다 — 원가를 못 보는 사람의 대여료는 **서버가 세서 값만** 보낸다
 *     (`/api/estimate/quote`). 원가 설정 자체가 브라우저로 내려가지 않는다.
 *
 * ★막는 곳이 셋이다. 하나만 막으면 막은 게 아니다.
 *     ㉠ 메뉴(항목)   `components/TopBar` SIMPLE_GROUPS·GROUPS 의 `roles`
 *                     — 웹 전체메뉴와 **폰 우측 햄버거**가 같은 명단을 쓴다
 *     ㉡ 문지기       `features/estimate/EstimateGate` — 주소로 직접 들어와도 막는다
 *     ㉢ 값           `/api/estimate/cost` GET 도 403
 *   메뉴에서만 숨기면 주소를 아는 사람은 그냥 들어오고, API 는 그냥 부른다.
 *   ⚠ 하단 홈바에는 견적이 **없다** — 하단은 역할과 무관한 «공통 셋»이다(사장님 2026-09-06
 *     「하단 메뉴는 다 공통 버튼이고 … 햄버거는 관리자 다르고 공급사 다르고」).
 *     갈리는 것을 하단에 두면 사람마다 탭 수가 달라진다.
 */

/** 견적 «화면»을 볼 수 있는 역할 — 영업자도 든다(원가는 아래 `showsCost` 가 따로 가른다).
 *  ⚠ 운영 역할값은 다섯이다(`lib/intake/entities` ROLES) — 영업자·공급사의 «관리자» 갈래까지 적는다. */
const ESTIMATE_ROLES = new Set<string>(['admin', 'provider', 'provider_admin', 'agent', 'agent_admin', 'agent_manager']);

/** **원가**(원가 분해·매출·영업이익·손바뀜·잔가)를 볼 수 있는 역할 — 관리자·공급사만. */
const COST_ROLES = new Set<string>(['admin', 'provider', 'provider_admin']);

/**
 * 이 사람이 견적을 보나.
 * ⚠ 모르는 역할·비로그인은 **아니다**(닫는 쪽이 기본값). 「모르면 열어 준다」로 두면
 *   역할이 하나 늘 때마다 원가가 새는 길이 하나 늘어난다.
 */
export function canSeeEstimate(role: string | null | undefined): boolean {
  return ESTIMATE_ROLES.has(String(role ?? ''));
}

/**
 * 이 사람에게 **원가를 보여 주나.**
 * ⚠ 여기서 거짓이면 화면이 원가 칸을 안 그리는 것으로 끝나지 않는다 —
 *   원가 설정을 **받아 오지도 않고**, 대여료는 서버가 세서 값만 받는다.
 */
export function showsCost(role: string | null | undefined): boolean {
  return COST_ROLES.has(String(role ?? ''));
}
