import { type NextRequest } from 'next/server';

// 외부 이미지 프록시 — Drive/lh3/모던렌트카 등 cross-origin 이미지의 CORS·referrer·핫링크 차단 우회.
// v3 api/img.js 대응. 우리 오리진으로 재서빙 → <img src="/api/img?url=…"> 가 모바일서도 뜸.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url || !/^https?:\/\//i.test(url)) return new Response('bad url', { status: 400 });
  try {
    const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; freepass/1.0)', Accept: 'image/*,*/*' }, redirect: 'follow' });
    if (!upstream.ok || !upstream.body) return new Response(`upstream ${upstream.status}`, { status: 502 });
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(ct)) return new Response('not an image', { status: 415 });
    return new Response(upstream.body, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
}
