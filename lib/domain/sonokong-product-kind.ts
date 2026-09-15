/**
 * ★★**손오공 상품구분(렌트 여부) = 이 함수 «한 곳»에서만 정한다.**
 *
 * 실측 2026-09-15 — 원천이 준 「중고」·「구분」 표기를 그대로 믿으면 안 된다. 원천 API 덤프에서
 * `버킷==='SON_NO_KONG'`인 차 중 `중고=true` 37건을 봤더니 렌트번호판(하·허·호)은 7건뿐이고
 * 나머지 30건은 「로·소·더·무·루」 같은 자가용 번호판이었다(예 68로3197 — 최초등록 2021-08·
 * 주행 33,297km, 그냥 중고 «자가용»이지 렌트카가 아니다). 원천의 「중고」 플래그는 사용감을
 * 뜻할 뿐 렌트 등록 여부와 무관했다.
 *
 * 한국 렌터카(사업용) 번호판은 **하·허·호 세 글자만** 쓴다(자동차관리법 시행규칙). 렌트 여부는
 * 이 글자로 검증·보정한다 — 원천 표기(시트의 「구분」 칸이든 API의 「중고」 플래그든)를 그대로
 * 믿지 않는다.
 */
export type SonokongProductKindInput = { 버킷?: unknown; 차번?: unknown };
export type SonokongProductKind = '픽업구독' | '오공구독' | '중고렌트' | '';

/** 한국 렌터카(사업용) 번호판 글자 — 이 셋만 렌트카다(자가용·택시는 다른 글자를 쓴다). */
const RENT_PLATE_LETTERS = new Set(['하', '허', '호']);

/** 차량번호 «NN(N)+한글자+NNNN» 꼴에서 그 한글자를 꺼낸다. 못 읽으면 빈 문자열(렌트로 오판하지 않는다). */
function plateLetter(plateNumber: unknown): string {
  const m = String(plateNumber ?? '').trim().match(/([가-힣])\s*\d{4}$/);
  return m ? m[1] : '';
}

export function isRentPlate(plateNumber: unknown): boolean {
  return RENT_PLATE_LETTERS.has(plateLetter(plateNumber));
}

/** API 덤프(버킷+차번) 입력용. ingest-supplier-to-firestore.mts 가 쓴다. */
export function sonokongProductKind(c: SonokongProductKindInput): SonokongProductKind {
  const bucket = String(c.버킷 ?? '').trim();
  const rentPlate = isRentPlate(c.차번);
  if (bucket === 'TCAR_EXTERNAL') return '픽업구독';
  if (bucket === 'SON_NO_KONG') return rentPlate ? '중고렌트' : '오공구독';
  return rentPlate ? '중고렌트' : '';
}
