/**
 * 「프리패스 상품리스트」 Google Sheet — 서버 읽기 대상 SSOT.
 *
 * ERP는 로그인·역할을 확인한 뒤 서버에서 Sheets API로 읽어 화면 안의 표로 표시한다.
 * 브라우저에 Google Sheets URL을 주거나 iframe을 붙이면 ERP 권한과 Google 공유 권한이
 * 분리되어 의도치 않은 공개·로그인 문제를 만들 수 있으므로, 화면용 공개 주소는 정의하지 않는다.
 *
 * 환경변수로 덮을 수 있게 둔 이유: 스테이징에서 운영 시트를 덮어쓰지 않기 위해서다.
 * (NEXT_PUBLIC_ 접두사라 화면 번들에 들어간다 — 공개 링크라 비밀이 아니다)
 */
export const PRODUCT_SHEET_ID = String(
  process.env.NEXT_PUBLIC_PRODUCT_SHEET_ID || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs',
).trim();
