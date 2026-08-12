/**
 * /api/extract-photos — 사진 소스(드라이브 폴더·모던렌트카·오토플러스) → 이미지 URL 리스트 (v3 이식).
 *   GET ?url={src}&size={px} → { ok, urls[], count, source }
 *   · drive.google.com 폴더 = 공개폴더 HTML 스크래핑(키 불필요) + Drive API(DRIVE_API_KEY 있으면 병행)
 *   · moderentcar.co.kr / autoplus.co.kr = 상세페이지 HTML 스크래핑(화이트리스트만, SSRF 방지)
 * v3 매물의 photo_link(드라이브 270·모던렌트카 65)를 v4에서 "동일하게" 사진으로 푼다.
 * 반환 URL은 클라이언트에서 /api/img 프록시로 감싼다(CORS·referrer 회피).
 */
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { sign } from 'node:crypto';

export const runtime = 'nodejs';

const SCRAPABLE_HOSTS = ['moderentcar.co.kr', 'autoplus.co.kr'];
const SHORTENER_HOSTS = ['tinyurl.com', 'bit.ly'];
type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
let driveTokenCache: { value: string; expiresAt: number } | null = null;

async function driveAccessToken(): Promise<string> {
  if (driveTokenCache && driveTokenCache.expiresAt > Date.now() + 60_000) return driveTokenCache.value;
  let raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    const file = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    if (file) raw = await readFile(file, 'utf8');
  }
  if (!raw) return '';
  const account = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!account.client_email || !account.private_key) return '';
  const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), account.private_key.replace(/\\n/g, '\n')).toString('base64url');
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth2:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number };
  if (!response.ok || !body.access_token) return '';
  driveTokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(300, Number(body.expires_in) || 3600) * 1000,
  };
  return body.access_token;
}

async function driveServiceAccount(folderId: string, size: string): Promise<string[]> {
  const token = await driveAccessToken();
  if (!token) return [];
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id)', pageSize: '1000', orderBy: 'name',
    supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return [];
  const body = await response.json().catch(() => ({})) as { files?: { id?: string }[] };
  return (body.files || []).flatMap((file) => file.id
    ? [`https://drive.google.com/thumbnail?id=${file.id}&sz=w${size}`]
    : []);
}
const DRIVE_KEY = process.env.DRIVE_API_KEY || ''; // 없으면 공개폴더 HTML 스크래핑만(키 불필요)

function extractDriveFolderId(value: string): string {
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

function isShortenerHost(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl);
    return u.protocol === 'https:' && SHORTENER_HOSTS.includes(u.hostname.toLowerCase());
  } catch { return false; }
}

/**
 * 공급사 시트의 단축 링크를 한 단계만 푼다. 임의 목적지를 따라가지 않고, 응답의 Location이
 * 기존 사진 허용 대상(Drive 폴더·모던렌트카·오토플러스)일 때만 이후 요청을 허용한다.
 */
async function expandSupportedShortUrl(src: string): Promise<string> {
  if (!isShortenerHost(src)) return src;
  const response = await fetch(src, {
    method: 'HEAD',
    redirect: 'manual',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FreepassERP/4.0)' },
    signal: AbortSignal.timeout(5000),
  });
  const location = response.headers.get('location');
  if (!location) return '';
  const target = new URL(location, src).toString();
  const drive = !!extractDriveFolderId(target) && target.includes('drive.google.com');
  return drive || isScrapableHost(target) ? target : '';
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
    const resolvedSrc = await expandSupportedShortUrl(src);
    if (!resolvedSrc) return NextResponse.json({ ok: true, urls: [], count: 0, source: 'unsupported' }, { headers: cache });
    const folderId = extractDriveFolderId(resolvedSrc);
    if (folderId && resolvedSrc.includes('drive.google.com')) {
      // 회사 Drive 백업 폴더는 익명 HTML에 파일 ID가 노출되지 않을 수 있다.
      // 서비스 계정 조회를 먼저 쓰고, 외부 공개 폴더는 기존 방식으로 이어서 해석한다.
      let urls: string[] = await driveServiceAccount(folderId, size).catch(() => []);
      if (!urls.length && DRIVE_KEY) { try { urls = await driveApi(folderId, size); } catch { /* 스크래핑 fallback */ } }
      if (!urls.length) urls = await scrapeFolder(folderId, size);
      return NextResponse.json({ ok: true, urls, count: urls.length, source: 'drive' }, { headers: cache });
    }
    if (isScrapableHost(resolvedSrc)) {
      const urls = await scrapePage(resolvedSrc);
      return NextResponse.json({ ok: true, urls, count: urls.length, source: 'scrape' }, { headers: cache });
    }
    return NextResponse.json({ ok: true, urls: [], count: 0, source: 'unsupported' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), urls: [] }, { status: 502 });
  }
}
