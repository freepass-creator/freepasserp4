import { redirect } from 'next/navigation';

/**
 * FreePassERP.com 기본 진입점의 최종 fallback.
 *
 * freepasserp.com 운영 도메인의 "/" 는 middleware 가 주소를 유지한 채 /shop 으로 rewrite 한다.
 * 이 파일은 미들웨어가 개입하지 않는 로컬·미리보기·직접 Next 실행에서도 같은 원칙을 지킨다:
 * **FreePassERP.com 메인 = 상품 보기, 로그인 현관 없음.**
 *
 * 과거 /login · /finder 등 업무 화면은 기존 링크 호환/보관을 위해 별도 경로로만 남을 수 있지만
 * FreePassERP.com 메인 진입이나 공개 상품 화면에서 그쪽으로 보내지 않는다.
 */
export default function Home() {
  redirect('/shop');
}
