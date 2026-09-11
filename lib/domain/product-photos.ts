/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 상품 이미지 수집 — freepasserp3 core/product-photos.js 이식.
 *   · v3 실데이터 사진 필드(image_urls/images/photos/image_url 배열·JSON문자열·중첩) 재귀 정규화 + 토큰무시 dedup.
 *   · photo_link(외부 URL) 분리, 스크래핑 대상(Drive 폴더·모던렌트카)은 제외.
 *   · 외부 호스트(Drive/lh3/Firebase Storage 등)는 /api/img 프록시로 감싸 CORS·referrer 우회.
 */
import { type EntityRecord } from '@/lib/intake/entities';

/**
 * 서버가 «풀어야» 사진이 되는 주소 — 폴더·상세페이지. 여기 없으면 `<img src=…>` 로 날것이 박힌다.
 *
 * ★`ironrentcar.com` 은 2026-09-01 에 넣었다. 사진칸에 상세페이지 주소가 들어와 있었는데
 *   여기 없어서 「그림 주소」로 취급됐고, 브라우저에서 **4대가 깨져 보였다**.
 *   (`/api/extract-photos` 가 그 페이지를 긁어 23장을 준다 — 같은 날 화이트리스트에 추가.)
 */
const NEEDS_SERVER_RE = /drive\.google\.com\/(drive\/folders\/|drive\/u\/\d+\/folders\/)|moderentcar\.co\.kr|autoplus\.co\.kr|ironrentcar\.com|tinyurl\.com|bit\.ly/;
/**
 * 프록시로 보낼 외부 이미지 호스트 — **서버 화이트리스트(lib/net/proxy-hosts.ts)와 같은 집합**이어야 한다.
 *
 * ⚠ 예전 패턴은 `moren-images\.s3[^.]*\.amazonaws\.com` 이었는데 `[^.]*` 가 점을 못 넘어
 *   실제 호스트 `moren-images.s3.ap-northeast-2.amazonaws.com` 에서 **매칭에 실패**했다.
 *   서버는 허용하는데 클라이언트가 프록시로 안 보내니, 모던렌트카(아이카·손오공·웰릭스) 사진이
 *   원본 주소로 직접 로드돼 안 떴다(실측 2026-08-07). 리전이 들어간 S3 주소를 그대로 받는다.
 */
/**
 * ★**티카(`lotterentacar.net`)** 를 2026-09-01 에 더했다 — 픽업(T카) 331대의 사진은 드라이브로
 *   옮기지 않고 **링크 그대로 ERP 에 띄운다**(사장님 「티카에 있는 사진만 연동해서 그냥 볼 수 있게끔」).
 *   서버 화이트리스트(`lib/net/proxy-hosts.ts`)와 **같이** 고쳐야 한다 — 한쪽만 고치면
 *   서버는 허용하는데 클라이언트가 프록시로 안 보내(또는 그 반대) 사진이 안 뜬다. 위 S3 사고가 그것이었다.
 */
const PROXY_HOSTS_RE = /(^|\.)(googleusercontent\.com|drive\.google\.com|autoplus\.co\.kr|moderentcar\.co\.kr|lotterentacar\.net)$|^moren-images\.s3[a-z0-9.-]*\.amazonaws\.com$/i;

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

/**
 * 토큰/쿼리 무시한 동일성 키 — Storage 토큰 다른 동일객체는 합치고, Drive id·lh3 path는 유지.
 *
 * ★★**밖에도 내준다**(2026-09-10). 사진을 «두 갈래»로 모으는 곳(`use-product-photos` 의
 *   저장사진 + 링크해석)이 이 자를 안 쓰고 **글자 그대로** 견줬다. 같은 드라이브 파일인데
 *   저장본은 `sz=w640`, 그 자리에서 푼 것은 `sz=w1280` 이라 **한 장이 두 장으로 세어졌다** —
 *   운영 실측(109호3438): 실제 51장인데 화면이 **「1 / 91」**. 손님은 같은 사진을 두 번 넘긴다.
 *   합치는 자가 하나여야 그런 일이 없다.
 */
export function photoDedupKey(url: string): string {
  /*
   * ★같은 주소는 «한 번만» 뜯는다(2026-09-11 사장님 「좀 빠릿빠릿하게」). 카드마다 사진 수십 장을
   *   합칠 때 이 자를 부르는데, 안에서 `new URL()` 을 한다 — 목록이 바뀔 때마다 같은 주소를 또 뜯었다.
   * ⚠ 주소는 끝없이 늘 수 있으니 상한을 둔다(넘으면 통째로 비우고 다시 쌓는다 — 틀린 값이 남지는 않는다).
   */
  const hit = dedupKeyCache.get(url);
  if (hit !== undefined) return hit;
  if (dedupKeyCache.size > 8000) dedupKeyCache.clear();
  const k = dedupKey(url);
  dedupKeyCache.set(url, k);
  return k;
}
const dedupKeyCache = new Map<string, string>();

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

/**
 * ★★**한 차의 사진 목록은 «한 번만» 푼다**(사장님 2026-09-11 「좀 빠릿빠릿하게 움직일 수 있게 해야 함
 *   뭔가 느린 거 같은데」).
 *
 * ⚠ 실측 2026-09-11 운영 · 폰 성능(CPU 4배 느리게) — 손님 목록에서 칩 하나 누를 때 **CPU 의 첫째가
 *   이 파일**이었다. 목록을 줄 세우는 잣대 「사진 있는 차 먼저」가 **680대 전부**의 사진을 매번 다시 풀고,
 *   푸는 김에 **사진 한 장마다 `new URL()`** 로 중복 열쇠를 만든다. 티카 차는 사진이 수십 장이라
 *   누를 때마다 URL 을 **수만 번** 새로 뜯었다(`dedupKey` 337ms + `URL` 145ms · 한 번 누름에).
 * ⇒ 차(객체)마다 결과를 들고 있다가, **사진 칸이 그대로면** 그대로 돌려준다.
 * ★「그대로」는 **칸의 참조**로 본다 — 사진 칸을 새 값으로 갈아 끼우면(편집 화면이 하는 방식) 다시 푼다.
 *   ⚠ 배열을 «제자리에서» 고치면(push) 못 알아챈다 — 이 저장소의 편집은 새 배열로 갈아 끼운다.
 * ★`WeakMap` 이라 차가 목록에서 빠지면 캐시도 같이 사라진다(메모리를 붙잡지 않는다).
 */
type PhotoMemo = { src: unknown[]; images: string[]; first?: string; photos?: string[] };
const photoMemo = new WeakMap<object, PhotoMemo>();
const photoSrc = (p: EntityRecord): unknown[] =>
  [p.image_urls, p.images, p.photos, p.photo, p.image_url, p.doc_images, p.photo_link];
function memoFor(p: EntityRecord): PhotoMemo {
  const src = photoSrc(p);
  const hit = photoMemo.get(p);
  if (hit && hit.src.length === src.length && hit.src.every((v, i) => v === src[i])) return hit;
  const images = collectImages(src.slice(0, 6)).filter((u) => !NEEDS_SERVER_RE.test(u));
  const next: PhotoMemo = { src, images };
  photoMemo.set(p, next);
  return next;
}

/** 업로드 이미지(image_urls/images/photos/image_url). 스크래핑 대상 URL은 제외(extract-photos 전용). */
export function productImages(p: EntityRecord): string[] {
  if (!p) return [];
  /* 돌려주는 배열을 부르는 쪽이 고쳐도 캐시가 안 더러워지게 «사본»을 준다(얕은 복사는 싸다). */
  return memoFor(p).images.slice();
}

/** photo_link 중 바로 <img>에 박을 외부 URL(스크래핑 대상 제외). */
export function productExternalImages(p: EntityRecord): string[] {
  return String((p?.photo_link as string) || '').split(/\s*[\n,]\s*/).map((u) => u.trim())
    .filter((u) => /^(https?:|data:)/.test(u)).filter((u) => !NEEDS_SERVER_RE.test(u));
}

/** 갤러리용 전체 사진(프록시 적용). */
export function productPhotos(p: EntityRecord): string[] {
  return productPhotosShared(p).slice();
}

/**
 * `productPhotos` 의 **캐시 원본** — 고치지 말고 읽기만 하는 쪽(`use-product-photos`)이 쓴다.
 * ★같은 차면 **같은 배열**을 준다 — 카드가 「사진이 바뀌었나」를 참조로 알아채 헛그리기를 안 한다.
 * ⚠ 2026-09-11 실측 — 목록이 바뀔 때마다 새로 뜬 카드가 제 사진 «전부»를 프록시 주소로 다시 만들었다
 *   (한 장마다 `new URL()`). 첫 장 하나 보이려고 수십 장을 뜯은 셈이다.
 */
export function productPhotosShared(p: EntityRecord): readonly string[] {
  if (!p) return EMPTY;
  const m = memoFor(p);
  if (!m.photos) m.photos = [...m.images, ...productExternalImages(p)].map(toProxiedImage);
  return m.photos;
}
const EMPTY: readonly string[] = Object.freeze([]);

/** 목록 썸네일용 첫 사진(프록시). */
export function firstProductImage(p: EntityRecord): string {
  if (!p) return '';
  const m = memoFor(p);
  if (m.first === undefined) {
    const raw = m.images[0] || productExternalImages(p)[0] || '';
    m.first = raw ? toProxiedImage(raw) : '';
  }
  return m.first;
}

/** 서버해석 필요한 사진 소스(드라이브 폴더·스크래핑 대상) — photo_link 중 NEEDS_SERVER 인 것. */
export function scrapableSources(p: EntityRecord): string[] {
  return String((p?.photo_link as string) || '').split(/\s*[\n,]\s*/).map((u) => u.trim())
    .filter((u) => u && NEEDS_SERVER_RE.test(u));
}

// 폴더→이미지 해석 결과 캐시(카드 다수·재렌더 dedup). 세션 한정.
const _folderCache = new Map<string, Promise<string[]>>();
// 동시성 상한 큐(v3 MAX_CONCURRENT 이식) — 그리드 N개 카드가 마운트 시 /api/extract-photos를 무제한 병렬 발사하면
// 서버가 구글드라이브를 동시다발 스크래핑 → 429로 전체 썸네일 붕괴. 캐시 hit은 큐 우회.
const MAX_CONCURRENT = 6;
let _active = 0;
const _queue: (() => void)[] = [];
function _run<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const task = () => { _active++; fn().then(resolve, reject).finally(() => { _active--; const n = _queue.shift(); if (n) n(); }); };
    if (_active < MAX_CONCURRENT) task(); else _queue.push(task);
  });
}
function fetchFolderImages(src: string, size: number): Promise<string[]> {
  const key = `${src}:${size}`;
  let pr = _folderCache.get(key);
  if (!pr) {
    pr = _run(async () => {
      try {
        const r = await fetch(`/api/extract-photos?url=${encodeURIComponent(src)}&size=${size}`);
        if (!r.ok) return [];
        const d = await r.json();
        return (d && d.ok && Array.isArray(d.urls) ? d.urls : []) as string[];
      } catch { return []; }
    });
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
