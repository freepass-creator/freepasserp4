'use client';
import { useMemo, useState } from 'react';
import { C } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { SHOP, ShopDockAction, ShopTextBtn } from '@/components/shop/shop-ui';
import { ShopFilters } from '@/components/shop/ShopFilters';
import {
  SHOP_AXES, emptySel, soloLabel,
  type ShopAxis, type ShopFacets, type ShopQuickChip,
} from '@/lib/shop/query';

/**
 * **빠른조건을 «고르는» 칸 — 웹 조건칸 맨 아래 구역 안에 선다. 누구나 연다.**
 *
 * ★★★사장님 2026-09-11 「화이트라벨에서 퀵필터 조정하는 거 **설정페이지 맨 하단 섹션 하나** 주고
 *   거기서 **펼쳐서 넣게** 해주자」.
 *   ⚠ 전에는 칩 줄 맨 앞 «설정 눈금» 단추 → 가운데 창(웹)·바닥 시트(폰)였다(2026-09-10).
 *
 * ★★★**조건칸과 «같은 체크 줄»이다**(사장님 2026-09-11 「엥 필터는 **저렇게 나오면 안 되는데**??」).
 *   ⚠ 처음엔 값을 전부 «알약»으로 늘어놨다(위=지금 줄 · 아래=옮겨올 것). 바로 위 조건칸은 체크 줄인데
 *     그 밑에서 같은 값이 딴 모양으로 쏟아져 나와, **필터가 한 기둥에 두 벌**로 보였다.
 *   ⇒ **조건칸 원자(`ShopFilters`)를 그대로 한 번 더 쓴다.** 축은 접혀 있고, 펴면 체크 줄이다.
 *     **체크 = 칩 줄에 올린다 · 풀면 뺀다.** 새 모양을 만들지 않았다 — 「있는 필터를 잠시 옮겨놓은 느낌」.
 *   ★숫자는 `base`(재고 전체)다 — 여기는 «가게의 첫 줄»을 짜는 자리라, 지금 걸어 둔 조건과 무관해야 한다.
 *   ★처음에 펴 두는 축 = **칩 줄에 뭔가 올라가 있는 축**만. 무엇이 올라가 있는지가 먼저 보인다.
 *
 * ★★★사장님 2026-09-10 「그냥 **누구나 할 수 있게 오픈**할 거야」 · 「**손님도 할 수 있게 다~**」.
 *   ⇒ 로그인도 역할도 안 본다. ⚠ 고친 것은 **그 채널 손님 전부**에게 보인다 — 그래서 칸이 먼저 말한다.
 *
 * ★저장은 **단추로** — 바뀐 것이 있을 때만 「되돌리기 · 이 줄로 저장」이 선다.
 *   누를 때마다 적으면 헛누름 한 번이 «모든 손님의 첫 줄»을 바꾼다.
 * ⚠ 부르는 쪽이 `key` 로 저장된 줄을 넘긴다 — 저장이 끝나면 초안이 새 줄로 다시 선다.
 *
 * ⚠⚠ **폰 상세 조건 시트에는 안 넣는다**(사장님 2026-09-11 「**모바일 필터는 기존 게 맞는 거야**」).
 */
export function ShopQuickEditor({ facets, value, onSave, saving }: {
  facets: ShopFacets;
  value: ShopQuickChip[];
  onSave: (next: ShopQuickChip[]) => void;
  saving?: boolean;
}) {
  const [picked, setPicked] = useState<ShopQuickChip[]>(value);
  const mobile = useIsMobile();

  const id = (c: { axis: ShopAxis; key: string }) => `${c.axis}:${c.key}`;
  const dirty = picked.map(id).join('|') !== value.map(id).join('|');

  /** 체크 상태 = 칩 줄에 올라가 있는 것(축별). */
  const sel = useMemo(() => {
    const s = emptySel();
    for (const c of picked) s[c.axis].push(c.key);
    return s;
  }, [picked]);

  /**
   * 고르는 목록 = 조건칸과 같은 집계에서 **재고에 있는 값만**, 숫자는 `base`.
   * ★이미 올라가 있는데 재고가 빠진 값은 **0 으로 남긴다** — 안 보이면 뺄 길이 없다
   *   (손님 화면에는 원래 안 뜨므로, 여기서 «0» 이 곧 「지금 없음」이다).
   */
  const pickFacets = useMemo(() => {
    const out = {} as ShopFacets;
    for (const axis of SHOP_AXES) {
      const have = facets[axis].filter((o) => o.base > 0).map((o) => ({ ...o, count: o.base }));
      const gone = picked
        .filter((c) => c.axis === axis && !have.some((o) => o.key === c.key))
        .map((c) => ({ key: c.key, label: c.label || soloLabel(c.key) || c.key, count: 0, base: 0 }));
      out[axis] = [...have, ...gone];
    }
    return out;
  }, [facets, picked]);

  /*
   * 체크 = 줄 «끝»에 붙인다 · 풀면 뺀다. 줄의 차례는 올린 차례다.
   * ★풀었다 다시 체크하면 **원래 이름을 되살린다**(「전기차」가 「전기」로 바뀌지 않게) — 저장된 줄에서 찾는다.
   */
  const onToggle = (axis: ShopAxis, key: string) => setPicked((p) => {
    if (p.some((c) => c.axis === axis && c.key === key)) return p.filter((c) => !(c.axis === axis && c.key === key));
    const prior = value.find((c) => c.axis === axis && c.key === key);
    return [...p, prior ?? { axis, key }];
  });
  const onClearAxis = (axis: ShopAxis) => setPicked((p) => p.filter((c) => c.axis !== axis));

  /* 처음 펴 둘 축 — 열 때 한 번만 정한다(고르다가 축이 저절로 접히면 손이 자리를 잃는다). */
  const [openAxes] = useState(() => new Set(value.map((c) => c.axis)));

  return (
    <div>
      {/*
        ★**«같이 보는 줄»이라고 먼저 말한다.** 누구나 고칠 수 있게 열어 둔 자리라,
          고치는 사람이 「내 화면만 바뀐다」고 오해하면 남의 가게 첫 줄을 무심코 바꾼다.
      */}
      <div style={{ fontSize: SHOP.fs.cap, color: C.mute, lineHeight: 1.7, marginBottom: SHOP.sp.snug }}>
        체크한 조건이 목록 위 칩 줄에 섭니다 · 지금 {picked.length}개.
        고친 줄은 <strong style={{ color: C.ink }}>이 가게를 보는 모든 분</strong>에게 같이 보입니다.
      </div>

      <ShopFilters facets={pickFacets} sel={sel} onToggle={onToggle} onClearAxis={onClearAxis}
        mobile={mobile} openInit={(a) => openAxes.has(a)} />

      {dirty ? (
        <div style={{
          position: 'sticky', bottom: 0, background: C.bg,
          display: 'flex', alignItems: 'center', gap: SHOP.sp.cozy,
          marginTop: SHOP.sp.snug, paddingBlock: SHOP.sp.snug, borderTop: `1px solid ${C.line2}`,
        }}>
          <ShopTextBtn onClick={() => setPicked(value)}>되돌리기</ShopTextBtn>
          {/* 높이 = 라벨 없는 단추 사다리(웹 36 · 폰 40) — 기둥 안 한 줄이라 독 높이(44/48)는 무겁다. */}
          <div style={{ flex: 1, height: mobile ? SHOP.icon.mobile : SHOP.icon.web }}>
            <ShopDockAction onClick={() => { if (!saving) onSave(picked); }}>
              {saving ? '저장하는 중' : '이 줄로 저장'}
            </ShopDockAction>
          </div>
        </div>
      ) : null}
    </div>
  );
}
