import { COMPANY_HOME_HTML } from './content';

/**
 * **freepassmobility.com 대문 = 회사 소개 홈페이지.**
 *
 * ★2026-09-16 사장님 「프리패스모빌리티.com 은 화이트라벨(가게) 말고 원래 회사 홈페이지로
 *   돌리고, 거기 서비스 바로가기를 누르면 ERP(freepasserp.com)로 가게 하라」.
 * ★내용은 `freepasshomepage` 저장소(정본)를 그대로 옮긴 정적 HTML이다 — 로직은 없고
 *   자산 경로만 이 프로젝트의 `/homepage-assets/*` 로 바꿨다. 정본이 바뀌면 이 파일도 같이 옮긴다.
 * ★상수로 박아 둔다(런타임 fs 읽기 아님) — 서버리스 함수는 트레이싱 안 된 파일을 못 읽는다.
 * ★라우팅은 `middleware.ts` 가 한다 — `freepassmobility.com`/`www.` 의 `/` 만 이 라우트로
 *   다시 쓴다(rewrite). 채널 주소(`/freepass` 등 `sitePath`)는 그대로 `/shop` 으로 간다 — 안 건드린다.
 */
export async function GET() {
  return new Response(COMPANY_HOME_HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
