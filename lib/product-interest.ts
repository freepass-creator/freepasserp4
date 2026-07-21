/**
 * 매물 관심함 — 최근 본 · 찜. 세션 로컬(localStorage). 서버 동기화 없음.
 * 엔카식 탐색: 다시 꺼내기·비교 전 단계. 홈 위젯·카드 하트가 소비.
 */
'use client';

import { vehicleName, cheapest } from '@/lib/domain/product';
import type { EntityRecord } from '@/lib/intake/entities';

export type InterestSnap = {
  code: string;
  name: string;
  plate: string;
  rent: number; // 0=없음. 원가
  deposit: number; // 0=무보증/없음
  month: number; // 0=기간 없음. 최저(또는 당시) 개월
  at: number;
};

const RECENT_KEY = 'fp4_recent_products';
const FAV_KEY = 'fp4_fav_products';
const MAX_RECENT = 16;
const MAX_FAV = 40;
const EVT = 'fp:interest';
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch { /* noop */ }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

function read(key: string): InterestSnap[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) as InterestSnap[] : [];
    return Array.isArray(arr) ? arr.filter((x) => x && x.code).map(normalizeSnap) : [];
  } catch { return []; }
}

/** 구버전 스냅(rent만) 호환. */
function normalizeSnap(x: InterestSnap): InterestSnap {
  return {
    code: String(x.code || ''),
    name: String(x.name || ''),
    plate: String(x.plate || ''),
    rent: Number(x.rent) || 0,
    deposit: Number(x.deposit) || 0,
    month: Number(x.month) || 0,
    at: Number(x.at) || Date.now(),
  };
}

function write(key: string, list: InterestSnap[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(list));
  notify();
}

export function snapOf(p: EntityRecord): InterestSnap {
  const focus = cheapest(p);
  return {
    code: String(p.product_code || p._key || ''),
    name: vehicleName(p),
    plate: String(p.car_number || ''),
    rent: focus ? focus.rent : 0,
    deposit: focus ? focus.deposit : 0,
    month: focus ? focus.m : 0,
    at: Date.now(),
  };
}

export function listRecent(): InterestSnap[] { return read(RECENT_KEY); }
export function listFavs(): InterestSnap[] { return read(FAV_KEY); }
export function isFav(code: string): boolean { return !!code && read(FAV_KEY).some((x) => x.code === code); }

/** 상세 진입 시 — 최근 본 맨 앞. 중복 제거. */
export function touchRecent(p: EntityRecord | InterestSnap) {
  const snap = 'product_code' in p || '_key' in p ? snapOf(p as EntityRecord) : { ...normalizeSnap(p as InterestSnap), at: Date.now() };
  if (!snap.code) return;
  const next = [snap, ...read(RECENT_KEY).filter((x) => x.code !== snap.code)].slice(0, MAX_RECENT);
  write(RECENT_KEY, next);
}

/** 찜 토글. 반환 = 찜 여부(true=찜됨). */
export function toggleFav(p: EntityRecord | InterestSnap): boolean {
  const snap = 'product_code' in p || '_key' in p ? snapOf(p as EntityRecord) : { ...normalizeSnap(p as InterestSnap), at: Date.now() };
  if (!snap.code) return false;
  const cur = read(FAV_KEY);
  const on = cur.some((x) => x.code === snap.code);
  if (on) write(FAV_KEY, cur.filter((x) => x.code !== snap.code));
  else write(FAV_KEY, [snap, ...cur].slice(0, MAX_FAV));
  return !on;
}

export function removeFav(code: string) {
  write(FAV_KEY, read(FAV_KEY).filter((x) => x.code !== code));
}

export function removeRecent(code: string) {
  write(RECENT_KEY, read(RECENT_KEY).filter((x) => x.code !== code));
}

export function clearRecent() { write(RECENT_KEY, []); }
export function clearFavs() { write(FAV_KEY, []); }

/** 관심함 변경 구독 — 위젯·하트·칩 숫자 동기화. */
export function subscribeInterest(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window === 'undefined') return () => { listeners.delete(cb); };
  const onStorage = (e: StorageEvent) => {
    if (e.key === RECENT_KEY || e.key === FAV_KEY || e.key === null) cb();
  };
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', onStorage);
  };
}
