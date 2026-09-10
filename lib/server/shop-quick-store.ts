import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import type { ShopQuickChip } from '@/lib/shop/query';
import { SHOP_AXES } from '@/lib/shop/query';

/**
 * **채널의 빠른조건 — 화면에서 고친 것**(원장 보관).
 *
 * ★★사장님 2026-09-10 「퀵필터가 **진짜로 있는 필터**가 들어가야 하는데」 ·
 *   「**있는 필터를 잠시 옮겨놓은 느낌**이어야 하잖아」 · 「그래서 퀵필터를 **수정할 수 있게**
 *   해주면 좋겠어」 · 「**있는 필터만** 갖다 놓겠음」.
 *
 * ★★**왜 원장인가 — 채널 표(`lib/whitelabel.ts`)는 «코드»라 배포를 해야 바뀐다.**
 *   담당자가 화면에서 칩 하나를 옮기려고 배포를 기다릴 수는 없다.
 *   ⇒ 코드의 `wl.quick` 은 **그 채널의 기본판**으로 두고, 화면에서 고친 것은 여기 얹는다.
 *   적은 적 없는 채널은 예전 그대로다 — **아무것도 안 바뀐다.**
 *
 * ★★**「있는 필터만」은 여기서 못 지킨다 — 화면이 지킨다.**
 *   재고에 그 값이 몇 대인지는 «지금 목록»을 세어야 아는 값(교차 집계)이라 서버가 미리 못 정한다.
 *   ⇒ 고르는 화면이 «지금 있는 값»만 내놓고(`facets`), 그리는 쪽도 건수 0 이면 안 그린다
 *     (`ShopView` 의 `quick` — 두 겹으로 막는다). 여기는 «무엇을 골랐나»만 적어 둔다.
 *   ⚠ 그래서 오래 지난 뒤 재고가 빠지면 저장된 칩이 조용히 사라진다 — **그게 맞는 동작이다.**
 *     0대짜리 칩을 세워 두는 것보다 낫고, 재고가 돌아오면 저절로 다시 뜬다.
 *
 * ⚠ 저장은 `getStore()` 다(집 규칙 ②) — 화면이나 라우트가 제 저장소를 따로 파지 않는다.
 */

/** 원장 노드 이름 — 채널 하나가 줄 하나다(`_key` = 채널 key). */
const ENTITY = 'shop_quick';

export type ShopQuickRecord = {
  _key: string;
  /** 고른 칩 — **적은 순서가 곧 화면 순서**다(채널 표의 `quick` 과 같은 규칙). */
  quick: ShopQuickChip[];
  /** 누가 언제 고쳤나 — 「누가 바꿨지」를 화면 밖에서 물을 때 답할 수 있어야 한다. */
  updated_by?: string;
  updated_at?: number;
};

/** 축 이름이 우리 축인지 — 원장에 아무 글자나 들어와도 화면이 안 깨지게 여기서 거른다. */
const isAxis = (v: unknown): v is ShopQuickChip['axis'] =>
  (SHOP_AXES as readonly string[]).includes(String(v ?? ''));

/**
 * 원장 값 → 화면이 쓰는 꼴. **믿지 않고 걸러서** 준다.
 * ★라벨은 «있으면» 쓴다(「승합·카니발」처럼 구간 이름을 손님 말로 바꾼 것). 없으면 화면이 축에서 만든다.
 */
export function sanitizeQuick(raw: unknown): ShopQuickChip[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ShopQuickChip[] = [];
  for (const item of raw) {
    const o = (item || {}) as Record<string, unknown>;
    const axis = o.axis;
    const key = String(o.key ?? '').trim();
    if (!isAxis(axis) || !key) continue;
    const id = `${axis}:${key}`;
    if (seen.has(id)) continue;          // 같은 조건을 두 번 세우지 않는다
    seen.add(id);
    const label = String(o.label ?? '').trim();
    out.push(label ? { axis, key, label } : { axis, key });
  }
  return out.slice(0, 20);               // 줄 하나에 스물이면 이미 «빠른» 조건이 아니다
}

/** 그 채널이 화면에서 고쳐 둔 칩 — 고친 적 없으면 `null`(그때는 채널 표의 기본판을 쓴다). */
export async function readShopQuick(wlKey: string): Promise<ShopQuickChip[] | null> {
  const key = String(wlKey || '').trim();
  if (!key) return null;
  try {
    const rows = await getStore().list(ENTITY, getCompanyId());
    const hit = rows.find((r) => String(r._key ?? '') === key);
    if (!hit) return null;
    const quick = sanitizeQuick((hit as unknown as ShopQuickRecord).quick);
    /*
     * ⚠ **빈 배열도 «고친 것»이다.** 담당자가 칩을 다 뺀 채널은 칩 줄이 없어야 하는데,
     *   여기서 `null` 로 답하면 기본판이 되살아나 「지웠는데 또 생긴다」가 된다.
     */
    return quick;
  } catch {
    /* 원장이 잠깐 안 열려도 화면은 떠야 한다 — 그때는 채널 표의 기본판으로 간다. */
    return null;
  }
}

/** 화면에서 고친 칩을 적어 둔다. */
export async function writeShopQuick(
  wlKey: string, quick: ShopQuickChip[], who: string,
): Promise<ShopQuickChip[]> {
  const key = String(wlKey || '').trim();
  if (!key) throw new Error('채널이 없습니다');
  const clean = sanitizeQuick(quick);
  await getStore().save(ENTITY, getCompanyId(), [{
    _key: key,
    quick: clean,
    updated_by: who,
    updated_at: Date.now(),
  } as unknown as Parameters<ReturnType<typeof getStore>['save']>[2][number]]);
  return clean;
}
