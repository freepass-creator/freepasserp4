/**
 * 서버 프록시 라우트(/api/img·/api/sheet) SSRF 차단 — 정당 외부 호스트만 허용.
 * 클라 toProxiedImage의 PROXY_HOSTS_RE와 정합(같은 원본만 감쌈). 여기 없는 호스트는 403.
 * allowlist 방식이라 내부IP·localhost·메타데이터·임의 도메인은 자동 차단됨.
 */

// 이미지 원본: 구글계열(lh3·drive·googleapis·firebasestorage) + 파트너(autoplus·moderentcar) + moren S3
const IMG_ALLOW = /(^|\.)(googleusercontent\.com|drive\.google\.com|googleapis\.com|firebasestorage\.app|autoplus\.co\.kr|moderentcar\.co\.kr)$|^moren-images\.s3[a-z0-9.-]*\.amazonaws\.com$/i;

// 시트: 구글 독스/게시 CSV 호스트만
const SHEET_ALLOW = /(^|\.)(docs\.google\.com|googleusercontent\.com|google\.com)$/i;

/** URL 문자열 → 허용 호스트면 hostname, 아니면 null(형식오류·비허용 모두 null). */
export function allowedHost(url: string, kind: 'img' | 'sheet'): string | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    host = u.hostname;
  } catch {
    return null;
  }
  const re = kind === 'img' ? IMG_ALLOW : SHEET_ALLOW;
  return re.test(host) ? host : null;
}
