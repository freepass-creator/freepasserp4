'use client';
/**
 * 원가 설정 — 화면이 서버(회사 공용)와 주고받는 길.
 *
 * ★진실의 차례 — **회사 값 > 이 브라우저 캐시 > 엔진 기본값.**
 *   ㉠ 회사 값(`/api/estimate/cost`, Firestore) = 사장님이 정한 것. 있으면 이것이 이긴다.
 *   ㉡ 캐시(localStorage) = 마지막으로 받아 둔 회사 값. **첫 그림을 빠르게** 그리려고 둔다
 *      (견적을 열자마자 대여료가 서 있어야 한다). 네트워크가 죽어도 어제 값으로 굴러간다.
 *   ㉢ 기본값 = 엔진 `DEFAULT_CONFIG`. 아직 아무도 안 정했을 때.
 *   ⚠ 캐시는 «내가 정한 값»이 아니다. 예전에는 여기가 저장소였고, 그래서 사장님이 정한 원가를
 *     영업자가 못 봤다(2026-09-06 고침). 캐시에 쓰는 것은 «서버에서 받은 것»뿐이다.
 *
 * ★쓰기는 **관리자만**이다. 서버가 막고(403), 화면도 저장 버튼을 안 준다.
 *   원가는 회사가 정하는 값이지 영업자가 고르는 값이 아니다 — 각자 고치면 대여료가 사람마다 달라진다.
 */
import { getAuthClient } from '@/lib/firebase/client';
import { COST_DEFAULTS, type CostSettings } from './cost-settings';

const KEY = 'fp.estimate.cost.v1';

export type SharedCost = {
  cost: CostSettings;
  /** 회사 값이 실제로 있었나 — 없으면 기본값을 보여 주는 중이다. */
  fromServer: boolean;
  updatedAt?: string | null;
  canEdit?: boolean;
  /** 저장된 값 중 지금 규격을 벗어난 칸(있으면 화면이 알려야 한다). */
  stale?: string[];
};

/** 첫 그림용 — 브라우저 캐시를 «즉시» 읽는다. 없으면 엔진 기본값. */
export function cachedCost(): CostSettings {
  if (typeof window === 'undefined') return COST_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return COST_DEFAULTS;
    const saved = JSON.parse(raw) as Partial<CostSettings>;
    const out = { ...COST_DEFAULTS };
    // 저장된 뒤에 칸이 늘 수 있다 — 없는 칸은 기본값으로 채운다(빈 칸이 0 으로 굳지 않게).
    for (const k of Object.keys(COST_DEFAULTS) as (keyof CostSettings)[]) {
      const v = saved[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch { return COST_DEFAULTS; }
}

function cache(cost: CostSettings): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, JSON.stringify(cost)); } catch { /* 사생활 모드 등 — 캐시는 없어도 된다 */ }
}

async function bearer(): Promise<string | null> {
  const user = getAuthClient()?.currentUser;
  return user ? user.getIdToken() : null;
}

/**
 * 회사 값을 받아 온다. 못 받으면 **캐시로 굴러간다** — 원가를 못 읽었다고 견적을 못 내면 안 된다.
 * ⚠ 실패를 조용히 삼키지 않는다. `fromServer:false` 로 «회사 값이 아니다»를 화면에 알린다.
 */
export async function fetchSharedCost(): Promise<SharedCost> {
  const fallback: SharedCost = { cost: cachedCost(), fromServer: false };
  try {
    const token = await bearer();
    if (!token) return fallback;
    const r = await fetch('/api/estimate/cost', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!r.ok) return fallback;
    const j = await r.json() as { cost: CostSettings | null; updatedAt?: string | null; canEdit?: boolean; stale?: string[] };
    if (!j.cost) return { ...fallback, canEdit: j.canEdit };   // 아직 아무도 안 정했다
    cache(j.cost);
    return { cost: j.cost, fromServer: true, updatedAt: j.updatedAt ?? null, canEdit: j.canEdit, stale: j.stale };
  } catch { return fallback; }
}

export type SaveResult = { ok: true; updatedAt: string } | { ok: false; reason: 'forbidden' | 'range' | 'network'; fields?: string[] };

/** 회사 값으로 저장한다 — 관리자만 통과한다. */
export async function saveSharedCost(cost: CostSettings): Promise<SaveResult> {
  try {
    const token = await bearer();
    if (!token) return { ok: false, reason: 'forbidden' };
    const r = await fetch('/api/estimate/cost', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cost }),
      cache: 'no-store',
    });
    if (r.status === 403 || r.status === 401) return { ok: false, reason: 'forbidden' };
    if (r.status === 422) {
      const j = await r.json().catch(() => ({})) as { fields?: string[] };
      return { ok: false, reason: 'range', fields: j.fields };
    }
    if (!r.ok) return { ok: false, reason: 'network' };
    const j = await r.json() as { updatedAt: string };
    cache(cost);
    return { ok: true, updatedAt: j.updatedAt };
  } catch { return { ok: false, reason: 'network' }; }
}
