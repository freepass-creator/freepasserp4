/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 상품 이미지 수집 — freepasserp3 core/product-photos.js 이식.
 *   · v3 실데이터 사진 필드(image_urls/images/photos/image_url 배열·JSON문자열·중첩) 재귀 정규화 + 토큰무시 dedup.
 *   · photo_link(외부 URL) 분리, 스크래핑 대상(Drive 폴더·모던렌트카)은 제외.
 *   · 외부 호스트(Drive/lh3/Firebase Storage 등)는 /api/img 프록시로 감싸 CORS·referrer 우회.
 */
import { type EntityRecord } from '@/lib/intake/entities';

const NEEDS_SERVER_RE = /drive\.google\.com\/(drive\/folders\/|drive\/u\/\d+\/folders\/)|moderentcar\.co\.kr|autoplus\.co\.kr/;
const PROXY_HOSTS_RE = /(^|\.)(googleusercontent\.com|drive\.google\.com|autoplus\.co\.kr|moderentcar\.co\.kr|moren-images\.s3[^.]*\.amazonaws\.com)$/;

/** 외부 이미지 URL → /api/img 프록시(cross-origin referrer/CORS/rate-limit 회피). data:/blob:/동일오리진/화이트리스트외는 그대로. */
export function toProxiedImage(url: string): string {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('/api/img') || url.startsWith('data:') || url.startsWith('blob:')) return url;
  try {
    const origin = typeof location !== 'undefined' ? location.origin : 'https://x/';
    const u = new URL(url, origin);
    if (typeof location !== 'undefined' && u.origin === location.origin) return url;
    if (!PROXY_HOSTS_RE.test(u.hostname)) return url; // firebasestorage 등은 직접(CORS 허용)
    return `/api/img?url=${encodeURIComponent(url)}`;
  } catch { return url; }
}

/** 토큰/쿼리 무시한 동일성 키 — Storage 토큰 다른 동일객체는 합치고, Drive id·lh3 path는 유지. */
function dedupKey(url: string): string {
  try {
    const s = String(url || '');
    if (s.startsWith('/api/img?')) { const m = s.match(/[?&]url=([^&]+)/); return m ? 'proxy:' + dedupKey(decodeURIComponent(m[1])) : s; }
    if (s.startsWith('data:')) return s; // data URI는 전체로 구분(앞부분 공통이라 slice 시 오합침)
    const u = new URL(s, typeof location !== 'undefined' ? location.origin : 'https://x/');
    if (u.hostname.endsWith('firebasestorage.googleapis.com') || u.hostname.endsWith('firebasestorage.app')) { const m = u.pathname.match(/\/o\/([^?]+)/); if (m) return 'fs:' + decodeURIComponent(m[1]); }
    if (u.hostname === 'drive.google.com') { const id = u.searchParams.get('id'); if (id) return 'drive:' + id; }
    if (/(^|\.)googleusercontent\.com$/.test(u.hostname)) return 'lh:' + u.pathname.replace(/=[swh]\d+(-[a-z]+)?$/, '');
    return u.origin + u.pathname + u.search;
  } catch { return url; }
}

/** 배열/객체/문자열/JSON문자열 모두 재귀로 펼쳐 유효 URL 배열(토큰무시 dedup). */
export function collectImages(value: any): string[] {
  const urls: string[] = [];
  const append = (input: any) => {
    if (input == null) return;
    if (Array.isArray(input)) { input.forEach(append); return; }
    if (typeof input === 'object') { Object.values(input).forEach(append); return; }
    const text = String(input).trim();
    if (!text) return;
    if (text.startsWith('[')) { try { append(JSON.parse(text)); return; } catch { /* 일반 문자열 */ } }
    urls.push(text);
  };
  append(value);
  const seen = new Set<string>(); const out: string[] = [];
  for (const u of urls.filter(Boolean)) { const k = dedupKey(u); if (seen.has(k)) continue; seen.add(k); out.push(u); }
  return out;
}

/** 업로드 이미지(image_urls/images/photos/image_url). */
export function productImages(p: EntityRecord): string[] {
  if (!p) return [];
  return collectImages([p.image_urls, p.images, p.photos, p.photo, p.image_url, p.doc_images]);
}

/** photo_link 중 바로 <img>에 박을 외부 URL(스크래핑 대상 제외). */
export function productExternalImages(p: EntityRecord): string[] {
  return String((p?.photo_link as string) || '').split(/\s*[\n,]\s*/).map((u) => u.trim())
    .filter((u) => /^(https?:|data:)/.test(u)).filter((u) => !NEEDS_SERVER_RE.test(u));
}

/** 갤러리용 전체 사진(프록시 적용). */
export function productPhotos(p: EntityRecord): string[] {
  return [...productImages(p), ...productExternalImages(p)].map(toProxiedImage);
}

/** 목록 썸네일용 첫 사진(프록시). */
export function firstProductImage(p: EntityRecord): string {
  const raw = productImages(p)[0] || productExternalImages(p)[0] || '';
  return raw ? toProxiedImage(raw) : '';
}

/** 서버해석 필요한 사진 소스(드라이브 폴더·스크래핑 대상) — photo_link 중 NEEDS_SERVER 인 것. */
export function scrapableSources(p: EntityRecord): string[] {
  return String((p?.photo_link as string) || '').split(/\s*[\n,]\s*/).map((u) => u.trim())
    .filter((u) => u && NEEDS_SERVER_RE.test(u));
}

// 폴더→이미지 해석 결과 캐시(카드 다수·재렌더 dedup). 세션 한정.
const _folderCache = new Map<string, Promise<string[]>>();
function fetchFolderImages(src: string, size: number): Promise<string[]> {
  const key = `${src}:${size}`;
  let pr = _folderCache.get(key);
  if (!pr) {
    pr = (async () => {
      try {
        const r = await fetch(`/api/extract-photos?url=${encodeURIComponent(src)}&size=${size}`);
        if (!r.ok) return [];
        const d = await r.json();
        return (d && d.ok && Array.isArray(d.urls) ? d.urls : []) as string[];
      } catch { return []; }
    })();
    _folderCache.set(key, pr);
    pr.then((u) => { if (!u.length) _folderCache.delete(key); }); // 실패는 캐시 안 함(재시도 가능)
  }
  return pr;
}

/** 드라이브 폴더 등을 /api/extract-photos 로 해석 → 프록시 이미지 URL(v3 동일 방식). */
export async function resolveServerPhotos(p: EntityRecord, size = 1280): Promise<string[]> {
  const srcs = scrapableSources(p);
  if (!srcs.length) return [];
  const lists = await Promise.all(srcs.map((s) => fetchFolderImages(s, size)));
  return lists.flat().map(toProxiedImage);
}
