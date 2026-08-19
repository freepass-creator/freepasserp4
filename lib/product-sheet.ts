/**
 * 「프리패스 상품리스트」 구글시트 — 주소 SSOT.
 *
 * 우리가 쓰고(서버 → Sheets API), 영업자·공급사가 본다(브라우저 → 링크).
 * 쓰는 쪽과 보는 쪽이 각자 주소를 들고 있으면 언젠가 서로 다른 시트를 가리킨다.
 * 그래서 한 곳에서만 정의한다 — 스크립트도 화면도 여기를 import 한다.
 *
 * 환경변수로 덮을 수 있게 둔 이유: 스테이징에서 운영 시트를 덮어쓰지 않기 위해서다.
 * (NEXT_PUBLIC_ 접두사라 화면 번들에 들어간다 — 공개 링크라 비밀이 아니다)
 */
export const PRODUCT_SHEET_ID = String(
  process.env.NEXT_PUBLIC_PRODUCT_SHEET_ID || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs',
).trim();

/**
 * 「상품리스트」 탭 gid — 판매시트(영업자시트)의 발행 탭. 링크에 gid 를 박아 첫 탭이 아니라 상품리스트가 바로 열리게.
 * ★사장님 2026-08-19 「이게 상품리스트인데 엄한 상품리스트가 열리네」 — 옛 내보내기 시트(1G0tPyFI…「시트1」)를 가리키던 것을
 *   판매시트(1Y1Mx1Ec…)의 상품리스트 탭(gid 668539469)으로. 정본은 판매시트 하나다(docs/영업자시트-매뉴얼.md).
 */
export const PRODUCT_SHEET_GID = String(process.env.NEXT_PUBLIC_PRODUCT_SHEET_GID || '668539469').trim();

/** 사람이 여는 주소. 시트에서 엑셀 다운로드·필터·공유가 전부 된다. */
export const PRODUCT_SHEET_URL = `https://docs.google.com/spreadsheets/d/${PRODUCT_SHEET_ID}/edit?gid=${PRODUCT_SHEET_GID}#gid=${PRODUCT_SHEET_GID}`;

/** 시트에 쓰는 탭 이름 — 전량 재작성 대상. */
export const PRODUCT_SHEET_TAB = '시트1';
