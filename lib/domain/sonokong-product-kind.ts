/**
 * ★★**손오공 상품구분 = 이 함수 «한 곳»에서만 정한다.**
 *
 * 사장님 2026-09-15 「손오공 상품중에 ssot에서 렌트는 중고렌트라고 해줘야지」로 시작해
 * 「중고렌트가 41대나 된다고?? 차량번호 잘 확인해봐」로 바로잡힌 두 단계 수정.
 *
 * ① 1차 시도 — 원천 `중고` 플래그로 갈랐다: `버킷==='SON_NO_KONG' && 중고===true` → 중고렌트.
 *    **틀렸다.** 실측(SON_NO_KONG & 중고=true 37건)에서 렌트 번호판(하·허·호)은 7건뿐이고
 *    나머지 30건은 「로·소·더·무·루·어·주·조·다·보·노·버」 같은 «자가용» 번호판이었다
 *    (68로3197 최초등록 2021-08 주행 33,297km — 그냥 중고 «자가용»이지 렌트카가 아니다).
 *    원천의 `중고`는 «사용감 있는 차»를 뜻할 뿐 «렌트 등록 여부»와 무관했다.
 *
 * ② 한국 렌터카(사업용) 번호판은 **하·허·호 세 글자만** 쓴다(자동차관리법 시행규칙).
 *    그래서 상품구분은 «번호판 글자»로 가른다 — `중고` 플래그를 더는 보지 않는다:
 *    ```
 *      TCAR_EXTERNAL              →  픽업구독   (버킷이 우선 — 사장님 2026-08-28)
 *      SON_NO_KONG + 렌트번호판   →  중고렌트   (하·허·호)
 *      SON_NO_KONG + 그 밖 번호판 →  오공구독
 *      그 밖 버킷 + 렌트번호판    →  중고렌트
 *      그 밖 버킷 + 그 밖 번호판  →  (미분류 — 빈칸)
 *    ```
 * ★「중고구독」표기는 없다(사장님 2026-09-11) — 상품구분 7캐논엔 오공구독·중고렌트만 있다.
 */
/**
 * ★★사장님 2026-09-15 「손오공은 신차가 없어 — 신차 있으면 내가 알려줄테니까」.
 *   손오공(RP012) 원천에서 나오는 차는 «전부 중고»(오공구독·중고렌트·픽업구독) —
 *   신차렌트·신차구독은 이 함수가 절대 찍지 않는다. 신차가 실제로 생기면 사장님이
 *   먼저 알려주시는 별도 지시 사항이지, 원천 필드로 자동 추정하지 않는다.
 */
export const SONOKONG_HAS_NEW_CAR_LINEUP = false;

export type SonokongProductKindInput = { 버킷?: unknown; 차번?: unknown };
export type SonokongProductKind = '픽업구독' | '오공구독' | '중고렌트' | '';

/** 한국 렌터카(사업용) 번호판 글자 — 이 셋만 렌트카다(자가용·택시는 다른 글자를 쓴다). */
const RENT_PLATE_LETTERS = new Set(['하', '허', '호']);

/** 차량번호 «NN(N)+한글자+NNNN» 꼴에서 그 한글자를 꺼낸다. 못 읽으면 빈 문자열(렌트로 오판하지 않는다). */
function plateLetter(carNumber: unknown): string {
  const m = String(carNumber ?? '').trim().match(/([가-힣])\s*\d{4}$/);
  return m ? m[1] : '';
}

export function isRentPlate(carNumber: unknown): boolean {
  return RENT_PLATE_LETTERS.has(plateLetter(carNumber));
}

export function sonokongProductKind(c: SonokongProductKindInput): SonokongProductKind {
  const bucket = String(c.버킷 ?? '').trim();
  const rentPlate = isRentPlate(c.차번);
  if (bucket === 'TCAR_EXTERNAL') return '픽업구독';
  if (bucket === 'SON_NO_KONG') return rentPlate ? '중고렌트' : '오공구독';
  return rentPlate ? '중고렌트' : '';
}
