/**
 * 플랫폼·브랜드명 SSOT. UI·메타·PWA·로그인 전부 이 문자열. (내부 스토리지키·v3브리지명과 무관)
 * 워드마크 이분(명함·CI센터): freepass(600·main) + erp.com(300·base) — ci_center/teamjpk_명함제작.html
 */
export const BRAND_MAIN = 'freepass';
export const BRAND_SUB = 'erp.com';
export const BRAND = `${BRAND_MAIN}${BRAND_SUB}`;

/**
 * **워드마크 서체 = Exo 2** — 명함·CI센터가 쓰는 그 서체다(`ci_center/index.html`).
 *
 * ⚠ 우리 이름을 «본문 서체(Pretendard)»로 적으면 그건 CI 가 아니라 그냥 글자다.
 *   2026-09-07 까지 손님 홈페이지 머리띠의 「✕ freepass」가 그랬다 — 사장님
 *   「**프리패스도 CI 있는데 그거 반영 전혀 안 했고**」.
 * ★`app/layout.tsx` 가 Exo 2 300·500·600 을 이미 싣고 있다. 새로 부를 것 없다.
 * ★소문자다 — `freepass` 는 명함·로그인 화면과 같이 언제나 소문자로 적는다.
 */
export const BRAND_FONT = "'Exo 2','Pretendard',sans-serif";

/**
 * **프리패스 마크(체크) 정본** — `public/icon.svg`(브라우저·PWA 아이콘)와 **같은 좌표**다.
 *
 * ★왜 여기 두나 — 마크를 «색을 입혀» 그려야 하는 자리가 생겼다(손님 홈페이지의 동반 표기는
 *   아주 연한 톤이라 남색 원본을 그대로 못 쓴다). `<img src="/icon.svg">` 로는 톤을 못 바꾸고,
 *   화면마다 path 를 베껴 적으면 아이콘과 마크가 갈린다.
 * ⚠ `public/icon.svg` 를 고치면 **여기도 같이 고친다.** `npm run check:brand` 가 둘을 맞대 본다.
 */
export const BRAND_MARK = {
  box: 512,
  /** 판(모서리 둥근 네모)의 반지름·색 — 아이콘은 남색 판에 흰 체크다. */
  rx: 96,
  plate: '#1B2A4A',
  /** 체크 — 꼭짓점 (128,264)-(208,344)-(384,168), 선 굵기 52(반경 26). */
  check: 'M128 264 l80 80 L384 168',
  checkWidth: 52,
} as const;

/**
 * 한 줄 소개 SSOT — 검색결과 제목·OG·구조화 데이터가 전부 이 문자열을 쓴다.
 * 여기만 고치면 세 곳이 같이 바뀐다(따로 적으면 어느 하나가 옛 문구로 남는다).
 */
export const BRAND_TAGLINE = '장기렌터카 영업지원 플랫폼';

/**
 * 검색결과 설명 SSOT — 구글이 **실제로 쓸 만한 길이**여야 한다.
 * 짧고 일반적이면 구글은 이걸 버리고 본문에서 스스로 만든다 — 실제로 매물표의
 * 열 제목(「차량번호, 상태, 구분 … 1개월, 12개월」)이 설명으로 뜬 적이 있다.
 */
export const BRAND_DESCRIPTION = '여러 렌터카사의 매물을 한 곳에 모아 표준화하고, 견적 산출부터 계약·정산까지 한 화면에서 처리하는 장기렌터카 영업지원 플랫폼입니다. 영업 파트너는 영업에만 집중합니다.';

/**
 * 제품 표시버전 SSOT — 화면(메뉴 하단) 노출용. 배포 때 semver로 올린다:
 *   MAJOR(앞) = 호환깨짐·풀체인지 / MINOR(중간) = 기능추가·구조개편 / PATCH(끝) = 버그픽스·소소한 것.
 * (package.json version 은 레포 내부값이라 별개)
 */
export const VERSION = '4.0.0';

/**
 * 빌드 태그 — git 커밋수(#147…) 우선, 없으면 짧은 SHA. next.config가 빌드 시 주입.
 * 누가 커밋/배포해도 매 빌드 자동 갱신 → 배포된 게 맞는지 화면에서 바로 확인.
 */
const BUILD_NO = process.env.NEXT_PUBLIC_BUILD_NO || '';
const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA || '';
export const BUILD = BUILD_NO ? `#${BUILD_NO}` : BUILD_SHA;
