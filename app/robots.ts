import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';

/**
 * 검색엔진에게 «무엇을 봐도 되는가»를 알려 준다. 이게 없어서 지금까지는 아무 제한이 없었다.
 *
 * ★robots.txt 는 색인을 «막지» 못한다
 *   크롤링을 줄일 뿐이고, 다른 곳에 링크가 걸리면 색인될 수 있다. 진짜 차단은 페이지의
 *   noindex 다(/q·/sign 레이아웃). 둘을 같이 쓴다 — robots 로 안 오게 하고, noindex 로 못 싣게.
 *
 * ★로그인 화면들도 막는 이유
 *   색인돼 봐야 크롤러에겐 빈 껍데기라 브랜드 검색 결과만 지저분해진다.
 *   실제로 지금 구글에 뜨는 설명이 그 부작용이다(옛 크롤에서 긁은 표 헤더 나열).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/q/', // 손님 견적 — 담당자가 뿌리는 링크. 찾아지는 것이 아니다
        '/sign/', // 전자서명 — 주민번호·면허·서명이 들어가는 입력창
        '/api/',
        '/chat',
        '/inventory',
        '/members',
        '/settlement',
        '/settings',
        '/esign',
        '/m', // 영업자 업무화면
      ],
    },
    sitemap: `https://${BRAND}/sitemap.xml`,
    host: `https://${BRAND}`,
  };
}
