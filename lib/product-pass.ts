/**
 * 관심없음 — 목록에서 안 지우고 맨 뒤로 보냄. 숨기기(완전 제외)와 다름.
 * 세션 로컬(localStorage). 설정에서 해제 가능.
 */
'use client';

const PASS_KEY = 'fp4_pass_products';
const META_KEY = 'fp4_pass_products_meta';
const EVT = 'fp:pass';
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch { /* noop */ }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PASS_KEY);
    const arr = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch { return []; }
}

function write(codes: string[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PASS_KEY, JSON.stringify(codes));
  notify();
}

export type PassSnap = { code: string; name: string; plate: string; at: number };

function readSnaps(): PassSnap[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(META_KEY);
    const arr = raw ? JSON.parse(raw) as PassSnap[] : [];
    return Array.isArray(arr) ? arr.filter((x) => x && x.code) : [];
  } catch { return []; }
}

function writeSnaps(snaps: PassSnap[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(META_KEY, JSON.stringify(snaps));
}

export function listPassedCodes(): string[] { return read(); }
export function listPassed(): PassSnap[] {
  const codes = new Set(read());
  return readSnaps().filter((s) => codes.has(s.code));
}
export function isPassed(code: string): boolean { return !!code && read().includes(code); }

/** 관심없음 — 맨 뒤로. 관심(찜)에 있으면 함께 해제. */
export function passProduct(p: { code: string; name?: string; plate?: string }) {
  if (!p.code) return;
  const codes = read().filter((c) => c !== p.code);
  write([...codes, p.code]); // 최근 관심없음이 더 뒤
  const snaps = readSnaps().filter((s) => s.code !== p.code);
  writeSnaps([{ code: p.code, name: p.name || '', plate: p.plate || '', at: Date.now() }, ...snaps].slice(0, 200));
  notify();
}

export function unpassProduct(code: string) {
  write(read().filter((c) => c !== code));
  writeSnaps(readSnaps().filter((s) => s.code !== code));
  notify();
}

export function clearPassed() {
  write([]);
  writeSnaps([]);
  notify();
}

export function subscribePassed(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window === 'undefined') return () => { listeners.delete(cb); };
  const onStorage = (e: StorageEvent) => {
    if (e.key === PASS_KEY || e.key === META_KEY || e.key === null) cb();
  };
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', onStorage);
  };
}
