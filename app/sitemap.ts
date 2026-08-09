import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';

/**
 * 검색에 실려도 되는 페이지만 적는다 — 브랜드 진입점과 법적 문서뿐이다.
 *
 * 업무화면·손님 링크는 여기 없다(robots.ts 에서도 막는다). 사이트맵은 «와서 봐 달라»는
 * 목록이라, 여기에 적는 순간 크롤러를 그리로 부르는 것이 된다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${BRAND}`;
  const now = new Date();
  return [
    { url: base, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
