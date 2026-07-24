import { type NextRequest } from 'next/server';
import { lookup } from 'node:dns/promises';
import { allowedHost, isPrivateOrLocalIp } from '@/lib/net/proxy-hosts';

// 외부 이미지 프록시 — Drive/lh3/모던렌트카 등 cross-origin 이미지의 CORS·referrer·핫링크 차단 우회.
// v3 api/img.js 대응. 우리 오리진으로 재서빙 → <img src="/api/img?url=…"> 가 모바일서도 뜸.
// ⚠ SSRF 차단: 인증 없는 공개 라우트라 host allowlist(정당 이미지 원본)만 프록시. 그 외 403.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url || !/^https?:\/\//i.test(url)) return new Response('bad url', { status: 400 });
  if (!allowedHost(url, 'img')) return new Response('host not allowed', { status: 403 });
  try {
    let current = url;
    let upstream: Response | null = null;
    for (let hop = 0; hop <= 5; hop++) {
      const host = allowedHost(current, 'img');
      if (!host) return new Response('redirect host not allowed', { status: 403 });
      const addresses = await lookup(host, { all: true, verbatim: true });
      if (!addresses.length || addresses.some((a) => isPrivateOrLocalIp(a.address))) {
        return new Response('private address not allowed', { status: 403 });
      }
      upstream = await fetch(current, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; freepass/1.0)', Accept: 'image/*,*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });
      if (upstream.status < 300 || upstream.status >= 400) break;
      const location = upstream.headers.get('location');
      if (!location) return new Response('bad redirect', { status: 502 });
      current = new URL(location, current).toString();
      upstream = null;
    }
    if (!upstream) return new Response('too many redirects', { status: 508 });
    if (!upstream.ok || !upstream.body) return new Response(`upstream ${upstream.status}`, { status: 502 });
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(ct)) return new Response('not an image', { status: 415 });
    return new Response(upstream.body, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
}
