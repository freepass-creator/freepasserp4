import 'server-only';

/**
 * 공급사 사진 링크 → 실제 이미지 URL.
 *
 * 공급사는 사진을 «열»로 주지 않고 차량번호 셀에 링크를 건다(`sheet-visible-grid`).
 * 그 링크는 폴더 주소이거나 상세페이지라 `<img src>` 에 바로 못 넣는다. 여기서 풀어낸다.
 *   · drive.google.com/drive/folders/{id}  → 폴더 안 이미지 목록
 *   · moderentcar.co.kr 등 상세페이지        → 페이지 안 원본 이미지
 *
 * erp3 `api/extract-photos.js` 이식. 두 가지를 바꿨다 —
 *   1) 호스트 허용목록을 «이 파일 안»에 두지 않고 넓히지 않는다. 임의 URL 을 서버가 대신
 *      가져오는 기능은 SSRF 통로다. 아래 목록에 없는 주소는 그냥 거절한다.
 *   2) Drive 는 API 키가 있으면 API 를, 없으면 공개 폴더 HTML 을 읽는다. 키 없이도 돌아야
 *      운영에서 «사진만 안 나오는» 상태로 조용히 죽지 않는다.
 */

/** 상세페이지 스크래핑을 허용하는 호스트. 여기 없는 주소는 요청하지 않는다. */
const SCRAPABLE_HOSTS = ['moderentcar.co.kr', 'autoplus.co.kr'];
const DRIVE_FOLDER_RE = /drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/;
const DRIVE_OPEN_RE = /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/;

export type PhotoExtractResult = {
  urls: string[];
  source: 'drive-api' | 'drive-html' | 'scrape' | 'none';
};

export function driveFolderId(url: string): string {
  const raw = String(url || '');
  return raw.match(DRIVE_FOLDER_RE)?.[1] || raw.match(DRIVE_OPEN_RE)?.[1] || '';
}

function scrapable(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return SCRAPABLE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch { return false; }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/** 응답 본문을 상한까지만 읽는다 — 거대한 페이지가 함수를 잡아먹지 않게. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally { try { await reader.cancel(); } catch { /* 무시 */ } }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { merged.set(c, at); at += c.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

async function driveByApi(folderId: string, size: number, apiKey: string): Promise<string[]> {
  const q = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`
    + `&key=${encodeURIComponent(apiKey)}&fields=files(id)&pageSize=200&orderBy=name`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!r.ok) throw new Error(`Drive API ${r.status}`);
  const data = await r.json() as { files?: Array<{ id?: string }> };
  return (data.files || []).map((f) => f.id).filter(Boolean)
    .map((id) => `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`);
}

/** API 키 없이 — 공개 폴더의 embeddedfolderview HTML 에서 파일 id 만 긁는다. */
async function driveByHtml(folderId: string, size: number): Promise<string[]> {
  const candidates = [
    `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`,
    `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
  ];
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/g,
    /thumbnail\?id=([a-zA-Z0-9_-]{20,})/g,
    /"([a-zA-Z0-9_-]{28,44})",\["\d+",/g,
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
        cache: 'no-store',
      });
      if (!r.ok) continue;
      const html = await readCapped(r, 4 * 1024 * 1024);
      const ids = new Set<string>();
      for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) if (m[1] && m[1] !== folderId) ids.add(m[1]);
      }
      if (ids.size) return [...ids].map((id) => `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`);
    } catch { /* 다음 후보 */ }
  }
  return [];
}

/** 상세페이지에서 원본 이미지만 — 썸네일·로고·아이콘은 뺀다. */
async function scrapePage(pageUrl: string): Promise<string[]> {
  const r = await fetch(pageUrl, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`페이지 로드 실패 ${r.status}`);
  const html = await readCapped(r, 8 * 1024 * 1024);
  const host = new URL(pageUrl).hostname.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    let u = String(raw || '').trim();
    if (!u) return;
    if (u.startsWith('http://')) u = `https://${u.slice(7)}`;   // 배포는 https 고정 — mixed content 방지
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  if (host.includes('moderentcar.co.kr')) {
    // S3 원본만. /thumb/ 경로는 목록용 축소본이라 상세에 쓰지 않는다.
    const re = /["'](https?:\/\/moren-images\.s3[^"'\s]+?\.(?:jpg|jpeg|png|webp))["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) if (!/\/thumb\//i.test(m[1])) add(m[1]);
  }
  if (!out.length) {
    // 호스트별 규칙이 없으면 og:image 만 쓴다. 페이지의 모든 img 를 긁으면 로고까지 딸려온다.
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (og?.[1]) add(og[1]);
  }
  return out;
}

/**
 * 링크 하나를 이미지 목록으로 푼다. 실패는 예외 대신 빈 배열 — 사진이 없다고 동기화가
 * 멈추면 안 된다.
 */
export async function extractPhotoUrls(link: string, size = 1200): Promise<PhotoExtractResult> {
  const url = String(link || '').trim();
  if (!url) return { urls: [], source: 'none' };

  const folder = driveFolderId(url);
  if (folder) {
    const key = String(process.env.DRIVE_API_KEY || '').trim();
    if (key) {
      try { const urls = await driveByApi(folder, size, key); if (urls.length) return { urls, source: 'drive-api' }; }
      catch { /* HTML 로 폴백 */ }
    }
    const urls = await driveByHtml(folder, size);
    return { urls, source: urls.length ? 'drive-html' : 'none' };
  }

  if (!scrapable(url)) return { urls: [], source: 'none' };
  try {
    const urls = await scrapePage(url);
    return { urls, source: urls.length ? 'scrape' : 'none' };
  } catch {
    return { urls: [], source: 'none' };
  }
}
