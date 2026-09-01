/**
 * **공급사 상세페이지 → 차량 사진 주소.** 긁는 규칙의 **단일출처(SSOT)**.
 *
 * ★왜 여기로 모았나 — 2026-09-01 까지 이 규칙이 **두 벌**이었다:
 *   `app/api/extract-photos/route.ts`(화면이 쓰는 것)와 `scripts/adopt-web-photos.mts`(드라이브로
 *   가져올 때 쓰는 것). 스크립트 머리엔 「앱과 **같은 것**을 쓴다」고 적혀 있었지만 실제로는 복사본이라
 *   한쪽만 고치면 갈라졌다. 실제로 갈라져 있었다 — 앱에는 있는 background·href 규칙이 스크립트엔 없었다.
 *   **화면에 뜨는 사진과 우리가 받아 두는 사진이 다르면** 그건 같은 차의 다른 사진이 된다.
 *
 * ★사장님 2026-09-01 「**모던렌터카 링크가 올라왔으면 그건 구글드라이브에 올려서** 올려 줘야지」
 *   — 남의 페이지를 계속 가리키지 않는다. 매물이 팔리면 페이지째 사라지고 우리 사진도 같이 사라진다.
 */

/** 상세페이지를 긁어도 되는 곳(SSRF 방지 화이트리스트). */
export const SCRAPABLE_HOSTS = ['moderentcar.co.kr', 'autoplus.co.kr', 'ironrentcar.com'] as const;

export function isScrapableHost(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    return SCRAPABLE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch { return false; }
}

/** 차 사진이 아닌 것 — og-image(공유용 대표그림)·매뉴얼 스캔이 섞이면 첫 장이 엉뚱해진다. */
const BAD = ['logo', 'favicon', 'sprite', 'btn_', '/adm/', '/assets/ico', '/icon/', 'og-image', 'manual'];
const isBad = (u: string) => BAD.some((b) => u.toLowerCase().includes(b));

/**
 * 상세페이지 HTML → 차량 이미지 URL 목록. 로고·썸네일은 뺀다.
 * @param timeoutMs 화면(10초)보다 스크립트(15초)를 길게 줄 수 있다.
 */
export async function scrapePage(pageUrl: string, timeoutMs = 10_000): Promise<string[]> {
  const host = new URL(pageUrl).hostname.toLowerCase();
  const resp = await fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`페이지 로드 실패 HTTP ${resp.status}`);
  const html = (await resp.text()).slice(0, 8 * 1024 * 1024);

  const out: string[] = []; const seen = new Set<string>();
  const add = (raw: string) => {
    let u = String(raw || '').trim(); if (!u) return;
    if (u.startsWith('http://')) u = 'https://' + u.slice(7);
    if (seen.has(u)) return; seen.add(u); out.push(u);
  };

  if (host.includes('moderentcar.co.kr')) {
    // 모던렌트카는 moren-images S3 의 `/data/files/` 원본만 받는다(썸네일 `/thumb/` 제외).
    const re = /["'](https?:\/\/moren-images\.s3[^"'\s]+?\.(?:jpg|jpeg|png|webp))["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) { const u = m[1]; if (u.includes('/thumb/') || !u.includes('/data/files/')) continue; add(u); }
    return out;
  }

  for (const attr of ['data-src', 'data-original', 'data-lazy', 'data-bg', 'data-image', 'src']) {
    const re = new RegExp(`${attr}=["'](https?:\\/\\/[^"'\\s]+?\\.(?:jpg|jpeg|png|webp))["']`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) { const u = m[1]; if (!isBad(u)) add(u); }
  }
  const bgRe = /background(?:-image)?\s*:\s*url\(["']?(https?:\/\/[^"')]+?\.(?:jpg|jpeg|png|webp))["']?\)/gi;
  let bm: RegExpExecArray | null;
  while ((bm = bgRe.exec(html)) !== null) { const u = bm[1]; if (!isBad(u)) add(u); }
  const aRe = /href=["'](https?:\/\/[^"'\s]+?\.(?:jpg|jpeg|png|webp))["']/gi;
  let am: RegExpExecArray | null;
  while ((am = aRe.exec(html)) !== null) { const u = am[1]; if (!isBad(u)) add(u); }

  /**
   * ★**위 규칙이 한 장도 못 찾았을 때만** 한 겹 더 본다 — 되던 곳(오토플러스)의 결과를 바꾸지 않기 위해서다.
   *   요즘 사이트는 사진을 `<img src>` 로 안 내놓는다: 아이언렌트카는 Next.js 라
   *   `_next/image?url=<퍼센트인코딩된 진짜주소>&w=384` 꼴이고 진짜 주소는 supabase 스토리지에 있다.
   *   그래서 옛 규칙으로는 **0장**이었고, ERP 엔 상세페이지 주소가 박혀 `<img src=페이지>` 로
   *   **깨져 보였다**(2026-09-01 실측 4대). 푸니 23장이 나온다(HTTP 200 · image/webp).
   */
  if (!out.length) {
    for (const m of html.matchAll(/_next\/image\?url=([^"'&\s]+)/gi)) {
      let u = ''; try { u = decodeURIComponent(m[1].replace(/&amp;/g, '&')); } catch { u = ''; }
      if (u && /^https?:\/\//.test(u) && !isBad(u)) add(u);
    }
    // 따옴표·공백으로 끊기는 «맨» 이미지 주소(JSON 페이로드 안에 그대로 있는 경우)
    for (const m of html.matchAll(/https?:\/\/[^"'\s\\]+?\.(?:jpg|jpeg|png|webp|avif)/gi)) {
      if (!isBad(m[0])) add(m[0]);
    }
  }
  return out;
}
