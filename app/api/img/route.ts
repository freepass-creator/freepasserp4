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
    /**
     * 확장자로 타입을 되살린다 — 원본 서버가 헤더를 틀리게 주는 경우가 실제로 있다.
     *
     * 실측(2026-08-07): 모던렌트카 S3(`moren-images.s3…`)가 `.jpg` 를 `application/octet-stream`
     * 으로 서빙한다. 2MB 짜리 진짜 JPEG 인데 헤더만 틀린 것이라, 415 로 막으면 아이카·손오공·
     * 웰릭스 매물 사진이 통째로 안 보인다. 우리가 고칠 수 없는 남의 서버 설정이다.
     *
     * ★svg 는 절대 통과시키지 않는다 — 스크립트를 품을 수 있어 이미지가 아니라 문서다.
     *   호스트는 이미 화이트리스트(proxy-hosts)로 좁혀져 있고, 여기서는 «확장자가 사진»일 때만
     *   타입을 붙여 준다. 확장자마저 없으면 원래대로 막는다.
     */
    const EXT_TYPES: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
    };
    let contentType = ct;
    if (!/^image\//i.test(ct)) {
      const ext = (new URL(current).pathname.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
      const guessed = EXT_TYPES[ext];
      if (!guessed) return new Response('not an image', { status: 415 });
      contentType = guessed;
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': contentType,
        // 스니핑으로 다른 타입이 되는 걸 막는다 — 타입을 우리가 정해 주는 만큼 더 단단히 잠근다.
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
}
