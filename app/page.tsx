import { redirect } from 'next/navigation';

/**
 * **freepasserp.com 첫 화면 = 로그인 화면(원래대로).**
 *
 * ★사장님 2026-08-18 「그냥 원래대로 로그인 화면 나오게 하고 개통하자」 → '/' 는 /login 으로 보낸다.
 *   /login 은 세션이 있으면 스스로 /finder(상품찾기)로 넘긴다(app/login/page.tsx loginDestination) —
 *   그래서 회원은 '/' → 상품찾기, 손님·로그아웃은 로그인 화면. 「홈으로」(/) 링크도 같은 길.
 * ★08-15~18 「점검 중」 안내면(상품시트 입장·영업지원 매니저 연락처)은 걷었다 — 필요하면 git 이력(5384dd5·969497e).
 * ⚠ 서버 컴포넌트 redirect — 클라이언트 JS 없이 307. 여기에 화면을 그리지 않는다.
 */
export default function Home() {
  redirect('/login');
}
