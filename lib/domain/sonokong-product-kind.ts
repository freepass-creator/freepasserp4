/**
 * ★★**손오공 상품구분 = 이 함수 «한 곳»에서만 정한다.**
 *
 * 실측 2026-09-15 — `버킷==='SON_NO_KONG'`이면 무조건 「오공구독」으로 찍던 규칙이 틀렸다.
 * SON_NO_KONG 버킷 안에도 «렌트»가 섞여 있다: 중고=true 37건 중 렌트번호판(하·허·호)은 7건뿐,
 * 나머지 30건은 「로·소·더·무·루」 같은 자가용 번호판이었다(예 68로3197 — 최초등록 2021-08,
 * 주행 33,297km, 그냥 중고 «자가용»이지 렌트카가 아니다). 원천의 `중고` 플래그는 «사용감»을
 * 뜻할 뿐 «렌트 등록 여부»와 무관했다.
 *
 * 한국 렌터카(사업용) 번호판은 **하·허·호 세 글자만** 쓴다(자동차관리법 시행규칙). 그래서
 * 상품구분은 «번호판 글자»로 가른다 — `중고` 플래그를 더는 보지 않는다:
 * ```
 *   TCAR_EXTERNAL              →  픽업구독   (버킷이 우선)
 *   SON_NO_KONG + 렌트번호판   →  중고렌트   (하·허·호)
 *   SON_NO_KONG + 그 밖 번호판 →  오공구독
 *   그 밖 버킷 + 렌트번호판    →  중고렌트
 *   그 밖 버킷 + 그 밖 번호판  →  (미분류 — 빈칸)
 * ```
 * ★「중고구독」표기는 쓰지 않는다 — 상품구분 7캐논엔 오공구독·중고렌트만 있다.
 */
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
