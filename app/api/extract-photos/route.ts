/**
 * /api/extract-photos — 사진 소스(드라이브 폴더·모던렌트카·오토플러스) → 이미지 URL 리스트 (v3 이식).
 *   GET ?url={src}&size={px} → { ok, urls[], count, source }
 *   · drive.google.com 폴더 = 공개폴더 HTML 스크래핑(키 불필요) + Drive API(DRIVE_API_KEY 있으면 병행)
 *   · moderentcar.co.kr / autoplus.co.kr = 상세페이지 HTML 스크래핑(화이트리스트만, SSRF 방지)
 * v3 매물의 photo_link(드라이브 270·모던렌트카 65)를 v4에서 "동일하게" 사진으로 푼다.
 * 반환 URL은 클라이언트에서 /api/img 프록시로 감싼다(CORS·referrer 회피).
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SCRAPABLE_HOSTS = ['moderentcar.co.kr', 'autoplus.co.kr'];
const DRIVE_KEY = process.env.DRIVE_API_KEY || ''; // 없으면 공개폴더 HTML 스크래핑만(키 불필요)

export function extractDriveFolderId(value: string): string {
  if (!value) return '';
  const s = String(value).trim();
  for (const re of [/\/folders\/([a-zA-Z0-9_-]+)/, /\/drive\/.*?\/([a-zA-Z0-9_-]{20,})/]) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

function isScrapableHost(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    return SCRAPABLE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch { return false; }
}

async function driveApi(folderId: string, size: string): Promise<string[]> {
  const q = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
  const api = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&key=${DRIVE_KEY}&fields=files(id)&pageSize=200&orderBy=name`;
  const r = await fetch(api, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Drive API ${r.status}`);
  const d = await r.json();
  return (Array.isArray(d.files) ? d.files : []).filter((f: { id?: string }) => f?.id).map((f: { id: string }) => `https://drive.google.com/thumbnail?id=${f.id}&sz=w${size}`);
}

// 공개 폴더 HTML 스크래핑 — 키·활성화 불필요("링크 있는 모든 사용자" 공개 시 동작).
async function scrapeFolder(folderId: string, size: string): Promise<string[]> {
  for (const u of [
    `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`,
    `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
    `https://drive.google.com/drive/folders/${folderId}`,
  ]) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(8000), redirect: 'follow' });
      if (!r.ok) continue;
      const html = await r.text();
      const ids = new Set<string>();
      for (const re of [/\/file\/d\/([a-zA-Z0-9_-]{20,})/g, /thumbnail\?id=([a-zA-Z0-9_-]{20,})/g, /"([a-zA-Z0-9_-]{28,44})",\["\d+",/g]) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) if (m[1] && m[1] !== folderId) ids.add(m[1]);
      }
      if (ids.size) return [...ids].map((id) => `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`);
    } catch { /* 다음 URL */ }
  }
  return [];
}

// 외부 상세페이지(모던렌트카·오토플러스) HTML → 차량 이미지 URL. 로고/썸네일 제외.
async function scrapePage(pageUrl: string): Promise<string[]> {
  const host = new URL(pageUrl).hostname.toLowerCase();
  const resp = await fetch(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`페이지 로드 실패 HTTP ${resp.status}`);
  const html = (await resp.text()).slice(0, 8 * 1024 * 1024);
  const out: string[] = []; const seen = new Set<string>();
  const add = (raw: string) => { let u = String(raw || '').trim(); if (!u) return; if (u.startsWith('http://')) u = 'https://' + u.slice(7); if (seen.has(u)) return; seen.add(u); out.push(u); };
  if (host.includes('moderentcar.co.kr')) {
    const re = /["'](https?:\/\/moren-images\.s3[^"'\s]+?\.(?:jpg|jpeg|png|webp))["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) { const u = m[1]; if (u.includes('/thumb/') || !u.includes('/data/files/')) continue; add(u); }
  } else {
    const bad = ['logo', 'favicon', 'sprite', 'btn_', '/adm/', '/assets/ico', '/icon/'];
    for (const attr of ['data-src', 'data-original', 'data-lazy', 'data-bg', 'data-image', 'src']) {
      const re = new RegExp(`${attr}=["'](https?:\\/\\/[^"'\\s]+?\\.(?:jpg|jpeg|png|webp))["']`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) { const u = m[1]; if (bad.some((b) => u.toLowerCase().includes(b))) continue; add(u); }
    }
    const bgRe = /background(?:-image)?\s*:\s*url\(["']?(https?:\/\/[^"')]+?\.(?:jpg|jpeg|png|webp))["']?\)/gi;
    let bm: RegExpExecArray | null;
    while ((bm = bgRe.exec(html)) !== null) { const u = bm[1]; if (!bad.some((b) => u.toLowerCase().includes(b))) add(u); }
    const aRe = /href=["'](https?:\/\/[^"'\s]+?\.(?:jpg|jpeg|png|webp))["']/gi;
    let am: RegExpExecArray | null;
    while ((am = aRe.exec(html)) !== null) { const u = am[1]; if (!bad.some((b) => u.toLowerCase().includes(b))) add(u); }
  }
  return out;
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const src = (params.get('url') || '').trim();
  const size = /^\d+$/.test(params.get('size') || '') ? params.get('size')! : '1280';
  if (!src) return NextResponse.json({ ok: false, urls: [] }, { status: 400 });
  const cache = { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' };
  try {
    const folderId = extractDriveFolderId(src);
    if (folderId && src.includes('drive.google.com')) {
      let urls: string[] = [];
      if (DRIVE_KEY) { try { urls = await driveApi(folderId, size); } catch { /* 스크래핑 fallback */ } }
      if (!urls.length) urls = await scrapeFolder(folderId, size);
      return NextResponse.json({ ok: true, urls, count: urls.length, source: 'drive' }, { headers: cache });
    }
    if (isScrapableHost(src)) {
      const urls = await scrapePage(src);
      return NextResponse.json({ ok: true, urls, count: urls.length, source: 'scrape' }, { headers: cache });
    }
    return NextResponse.json({ ok: true, urls: [], count: 0, source: 'unsupported' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), urls: [] }, { status: 502 });
  }
}
