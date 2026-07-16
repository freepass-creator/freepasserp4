/**
 * /api/extract-photos — 구글드라이브 폴더 URL → 이미지 URL 리스트 (v3 api/extract-photos 이식).
 *   GET ?url={driveFolderUrl}&size={px} → { ok, urls[], count, source }
 *   · 공개 폴더 = embeddedfolderview HTML 스크래핑(키 불필요)  · DRIVE_API_KEY 있으면 Drive API 병행.
 * v3 매물의 photo_link(드라이브 폴더 336건)를 v4에서 "동일하게" 사진으로 풀기 위한 서버 해석기.
 * 반환 URL(drive thumbnail)은 클라이언트에서 /api/img 프록시로 감싼다(CORS·referrer 회피).
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// isomorphic — client(lib/domain/product-photos) 와 동일 규칙
export function extractDriveFolderId(value: string): string {
  if (!value) return '';
  const s = String(value).trim();
  for (const re of [/\/folders\/([a-zA-Z0-9_-]+)/, /\/drive\/.*?\/([a-zA-Z0-9_-]{20,})/]) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

async function driveApi(folderId: string, size: string, apiKey: string): Promise<string[]> {
  const q = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
  const api = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&key=${apiKey}&fields=files(id)&pageSize=200&orderBy=name`;
  const r = await fetch(api, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Drive API ${r.status}`);
  const d = await r.json();
  return (Array.isArray(d.files) ? d.files : []).filter((f: { id?: string }) => f?.id).map((f: { id: string }) => `https://drive.google.com/thumbnail?id=${f.id}&sz=w${size}`);
}

// 공개 폴더 HTML 스크래핑 — 키·활성화 불필요("링크 있는 모든 사용자" 공개 시 동작).
async function scrapeFolder(folderId: string, size: string): Promise<string[]> {
  const tryUrls = [
    `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`,
    `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
    `https://drive.google.com/drive/folders/${folderId}`,
  ];
  for (const u of tryUrls) {
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

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const src = params.get('url') || '';
  const size = /^\d+$/.test(params.get('size') || '') ? params.get('size')! : '1280';
  const folderId = extractDriveFolderId(src);
  if (!folderId) return NextResponse.json({ ok: false, error: '지원하지 않는 사진 소스' }, { status: 400 });
  try {
    const key = process.env.DRIVE_API_KEY;
    let urls: string[] = [];
    if (key) { try { urls = await driveApi(folderId, size, key); } catch { /* 스크래핑 fallback */ } }
    if (!urls.length) urls = await scrapeFolder(folderId, size);
    return NextResponse.json({ ok: true, urls, count: urls.length, source: 'drive' }, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), urls: [] }, { status: 502 });
  }
}
