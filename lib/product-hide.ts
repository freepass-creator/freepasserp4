/**
 * 매물 숨기기 — 목록에서 안 보이게. 세션 로컬(localStorage). 설정에서 해제.
 */
'use client';

const HIDDEN_KEY = 'fp4_hidden_products';
const EVT = 'fp:hidden';
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
    const raw = localStorage.getItem(HIDDEN_KEY);
    const arr = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
  } catch { return []; }
}

function write(codes: string[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(codes));
  notify();
}

export type HiddenSnap = { code: string; name: string; plate: string; at: number };

function readSnaps(): HiddenSnap[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HIDDEN_KEY + '_meta');
    const arr = raw ? JSON.parse(raw) as HiddenSnap[] : [];
    return Array.isArray(arr) ? arr.filter((x) => x && x.code) : [];
  } catch { return []; }
}

function writeSnaps(snaps: HiddenSnap[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(HIDDEN_KEY + '_meta', JSON.stringify(snaps));
}

export function listHiddenCodes(): string[] { return read(); }
export function listHidden(): HiddenSnap[] {
  const codes = new Set(read());
  return readSnaps().filter((s) => codes.has(s.code));
}
export function isHidden(code: string): boolean { return !!code && read().includes(code); }

export function hideProduct(p: { code: string; name?: string; plate?: string }) {
  if (!p.code) return;
  const codes = read();
  if (codes.includes(p.code)) return;
  write([p.code, ...codes]);
  const snaps = readSnaps().filter((s) => s.code !== p.code);
  writeSnaps([{ code: p.code, name: p.name || '', plate: p.plate || '', at: Date.now() }, ...snaps].slice(0, 200));
  notify();
}

export function unhideProduct(code: string) {
  write(read().filter((c) => c !== code));
  writeSnaps(readSnaps().filter((s) => s.code !== code));
  notify();
}

export function clearHidden() {
  write([]);
  writeSnaps([]);
  notify();
}

export function subscribeHidden(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window === 'undefined') return () => { listeners.delete(cb); };
  const onStorage = (e: StorageEvent) => {
    if (e.key === HIDDEN_KEY || e.key === HIDDEN_KEY + '_meta' || e.key === null) cb();
  };
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', onStorage);
  };
}
