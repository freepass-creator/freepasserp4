/**
 * 서버 프록시 라우트(/api/img·/api/sheet) SSRF 차단 — 정당 외부 호스트만 허용.
 * 클라 toProxiedImage의 PROXY_HOSTS_RE와 정합(같은 원본만 감쌈). 여기 없는 호스트는 403.
 * allowlist 방식이라 내부IP·localhost·메타데이터·임의 도메인은 자동 차단됨.
 */

/**
 * 이미지 원본: 구글계열(lh3·drive·googleapis·firebasestorage) + 파트너(autoplus·moderentcar·티카) + moren S3
 *
 * ★**티카(롯데렌터카 이미지 서버 `img-mycarsave.lotterentacar.net`)** 는 2026-09-01 에 넣었다 —
 *   사장님 「상품리스트에 티카 거는 **그냥 티카 링크를 그대로** 걸고, ERP 에서는 **티카에 있는 사진만
 *   연동해서** 그냥 볼 수 있게끔」. 즉 픽업(T카) 331대는 **드라이브로 옮기지 않는다.**
 *   실측 2026-09-01: 핫링크 차단이 없어 참조를 걸어도 200 이지만, 프록시를 태워 두면
 *   저쪽이 referrer 정책을 바꿔도 안 깨진다.
 */
const IMG_ALLOW = /(^|\.)(googleusercontent\.com|drive\.google\.com|googleapis\.com|firebasestorage\.app|autoplus\.co\.kr|moderentcar\.co\.kr|lotterentacar\.net)$|^moren-images\.s3[a-z0-9.-]*\.amazonaws\.com$/i;

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

/** DNS 결과까지 포함한 서버측 차단용 IP 판정. */
export function isPrivateOrLocalIp(ip: string): boolean {
  const v = ip.toLowerCase().split('%')[0];
  if (v === '::1' || v === '::' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const parts = (mapped || v).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
