/**
 * 플랫폼·브랜드명 SSOT. UI·메타·PWA·로그인 전부 이 문자열. (내부 스토리지키·v3브리지명과 무관)
 * 워드마크 이분(명함·CI센터): freepass(600·main) + erp.com(300·base) — ci_center/teamjpk_명함제작.html
 */
export const BRAND_MAIN = 'freepass';
export const BRAND_SUB = 'erp.com';
export const BRAND = `${BRAND_MAIN}${BRAND_SUB}`;

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
