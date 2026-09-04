'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { C, ICON } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { WhitelabelFrame } from '@/components/WhitelabelFrame';
import { FREEPASS, type Whitelabel } from '@/lib/whitelabel';
import {
  SHOP, ShopCount, ShopEmpty, ShopIconBtn, ShopMore, ShopPill, ShopPrimary,
  ShopSearch, ShopSort, ShopTextBtn, ShopTokens,
} from '@/components/shop/shop-ui';
import { ShopFilters } from '@/components/shop/ShopFilters';
import { ShopCard } from '@/components/shop/ShopCard';
import {
  AXIS_LABEL, SHOP_SORTS, activeTokens, clearAxis, emptyQuery, queryCount,
  readQuery, runShopQuery, toggleAxis, writeQuery,
  type ShopAxis, type ShopQuery, type ShopSort as ShopSortKey,
} from '@/lib/shop/query';

/**
 * 가게 — 손님이 차를 고르는 화면. **업무동 화면의 분기가 아니라 제 동(棟)이다.**
 *
 * 사장님 2026-09-04 「검색창이고 좌측 사이드바 필터하고 기존 거 활용하지 말고 새로이
 * 아까 우리 얘기된 거대로 좀 설계하고」.
 *
 * 왜 갈랐나. 9/4 까지 손님 화면은 ERP `/catalog` 안의 `if (브랜드)` 가지였다. 그래서
 *   ㉠ 무엇을 고치든 옆 가지(노브랜드 프리패스 화면)를 깨뜨릴까 봐 업무동 원자를 그대로 썼고,
 *   ㉡ 실제로 **모수를 영업자 잣대로 세다 조건 축 셋을 통째로 잃는** 사고가 났다.
 * 이제 가게는 제 조건 정본(`lib/shop/query`)·제 원자(`components/shop/*`)를 갖는다.
 *
 * 짜임 — 마켓이 공통으로 쓰는 순서 그대로다.
 *   머리띠(채널 이름·담당자) · 안내 블록(X 로 끔)
 *   ─ 밑줄 검색 한 줄
 *   ─ 빠른 조건(보증금 0원 · 금액대)
 *   ┌ 조건칸 260 ┬ 적용한 조건 토큰 ─────────────
 *   │ 전체차량 N │ N대 중 1–M            [정렬 ▾]
 *   │ 축 아홉    │ 카드 격자
 *
 * ★조건은 **주소에 실린다**(`lib/shop/query`). 영업자가 손님에게 보내는 것은 사이트 주소가
 *   아니라 「이 조건으로 골라 둔 목록」이라서다. 새로고침해도 조건이 안 날아간다.
 */

/** 한 번에 그리는 카드 수. 716대를 한꺼번에 그리면 폰에서 첫 화면이 늦는다. */
const PAGE = 60;

/**
 * 빠른 조건 — 검색 바로 밑. 손님이 제일 먼저 누르는 것만 셋넷.
 * ★값은 조건칸과 «같은 상태»를 만진다. 두 자리가 다른 값을 들면 그게 곧 「숨은 필터」다.
 * ★저신용·무심사 손님이 제일 먼저 재는 것은 월요금보다 **초기에 얼마 드는가**라 보증금 0원이 맨 앞이다.
 */
const QUICK: { axis: ShopAxis; key: string; label: string }[] = [
  { axis: 'dep', key: 'd0', label: '보증금 0원' },
  { axis: 'rent', key: 'r50', label: '월 50만원 이하' },
  { axis: 'rent', key: 'r60', label: '50~60만원' },
  { axis: 'rent', key: 'r70', label: '60~70만원' },
];

const FAV_KEY = 'fp4_shop_fav';

export function ShopView({ wl = FREEPASS }: { wl?: Whitelabel }) {
  const mobile = useIsMobile();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [agent, setAgent] = useState<{ name?: string; phone?: string } | null>(null);
  const [attr, setAttr] = useState('');
  const [query, setQuery] = useState<ShopQuery>(emptyQuery);
  /** 검색칸의 «지금 글자» — 목록에는 디바운스를 거쳐 들어간다(타이핑마다 716대를 훑지 않는다). */
  const [typed, setTyped] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [sheet, setSheet] = useState(false);
  const [fav, setFav] = useState<Set<string>>(new Set());

  /* 첫 진입 — 주소에서 조건을 복원하고, 담당자·매물을 받아 온다. */
  useEffect(() => { (async () => {
    const params = new URLSearchParams(window.location.search);
    const restored = readQuery(params);
    setQuery(restored);
    setTyped(restored.q);
    try { setFav(new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as string[])); } catch { /* 저장 못 읽어도 화면은 돈다 */ }

    // 담당 귀속(?a=)은 한 번 들어오면 기억한다 — 손님이 목록·상세를 오가도 담당자가 안 바뀐다.
    const a = params.get('a') || localStorage.getItem('fp4_attr') || '';
    if (a) localStorage.setItem('fp4_attr', a);
    setAttr(a);
    try {
      const p = new URLSearchParams();
      if (params.get('p')) p.set('p', String(params.get('p')));
      if (a) p.set('a', a);
      const res = await fetch(`/api/catalog/feed?${p}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({})) as {
        products?: EntityRecord[]; agent?: { name?: string; phone?: string } | null;
      };
      setRows(res.ok && body.products ? body.products : []);
      setAgent(body.agent || null);
    } catch { setRows([]); }
  })(); }, []);

  /* 검색 디바운스 — 180ms. 파인더와 같은 값으로 둔다(같은 손이 두 화면을 만진다). */
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q === typed ? q : { ...q, q: typed })), 180);
    return () => clearTimeout(t);
  }, [typed]);

  /*
   * 조건이 바뀌면 주소를 고쳐 쓴다.
   * ★`replaceState` 다 — `push` 로 쌓으면 손님이 뒤로가기를 열 번 눌러야 들어온 곳으로 나간다.
   * ★조건이 아닌 파라미터(a·p·wl)는 그대로 지킨다.
   */
  useEffect(() => {
    if (rows === null) return; // 복원 전에는 주소를 건드리지 않는다(빈 조건으로 덮어쓰게 된다)
    const keep = new URLSearchParams(window.location.search);
    const next = `${window.location.pathname}${writeQuery(query, keep)}`;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next);
    }
  }, [query, rows]);

  /* 조건이 바뀌면 첫 장으로 — 3장까지 펼쳐 본 뒤 조건을 좁혔는데 여전히 3장이면 뭐가 준 건지 모른다. */
  useEffect(() => { setLimit(PAGE); }, [query]);

  const { list, total, facets } = useMemo(() => runShopQuery(rows, query), [rows, query]);
  const tokens = useMemo(
    () => activeTokens(query, facets).map((t) => ({ ...t, axisLabel: AXIS_LABEL[t.axis] })),
    [query, facets],
  );
  const shown = list.slice(0, limit);
  const countText = rows === null ? '—' : String(total);

  const onToggle = useCallback((axis: ShopAxis, key: string) => setQuery((q) => toggleAxis(q, axis, key)), []);
  const onClearAxis = useCallback((axis: ShopAxis) => setQuery((q) => clearAxis(q, axis)), []);
  const onClearAll = useCallback(() => { setQuery((q) => ({ ...emptyQuery(), q: q.q })); }, []);
  const onFav = useCallback((code: string) => {
    setFav((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])); } catch { /* 저장 실패는 화면을 막지 않는다 */ }
      return next;
    });
  }, []);

  const href = (p: EntityRecord) =>
    `/q/${encodeURIComponent(String(p.product_code))}${attr ? `?a=${encodeURIComponent(attr)}` : ''}`;

  const filters = (
    <ShopFilters facets={facets} sel={query.sel} onToggle={onToggle} onClearAxis={onClearAxis} />
  );

  return (
    <WhitelabelFrame wl={wl} agentName={agent?.name} agentPhone={agent?.phone}>
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: mobile ? '18px 16px 28px' : '26px 24px 40px' }}>
        {/* 검색 — 목록 열과 같은 폭에 걸친다. 페이지 한가운데 띄우면 조건칸과 축이 안 맞는다. */}
        <ShopSearch value={typed} onChange={setTyped} placeholder="차종, 차량번호로 검색해 보세요" />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
          <span style={{ fontSize: SHOP.fs.cap, color: C.faint, marginRight: 2 }}>많이 찾는 조건</span>
          {QUICK.map((k) => (
            <ShopPill key={`${k.axis}:${k.key}`} on={query.sel[k.axis].includes(k.key)}
              onClick={() => onToggle(k.axis, k.key)}>{k.label}</ShopPill>
          ))}
        </div>

        <div style={{ display: 'flex', gap: SHOP.gap.pane, alignItems: 'flex-start', marginTop: mobile ? 18 : 26 }}>
          {!mobile ? (
            <aside style={{ width: 260, flexShrink: 0 }}>
              <div style={{ paddingBottom: 18 }}><ShopCount value={countText} /></div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                paddingBottom: 12, borderBottom: `1px solid ${C.ink}`,
              }}>
                <span style={{ fontSize: SHOP.fs.h2, fontWeight: 700, color: C.ink }}>필터</span>
                {queryCount(query) ? <ShopTextBtn onClick={onClearAll}>초기화</ShopTextBtn> : null}
              </div>
              <div style={{ paddingTop: 18 }}>{filters}</div>
            </aside>
          ) : null}

          <div style={{ flex: 1, minWidth: 0 }}>
            <ShopTokens tokens={tokens}
              onRemove={(axis, key) => onToggle(axis as ShopAxis, key)} onClear={onClearAll} />

            {/* 목록 머리 = 격자의 어깨. 왼 기둥이 «전체»를 세므로 여기는 «지금 보이는 만큼»을 말한다. */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              margin: mobile ? '14px 0 12px' : '18px 0 16px',
            }}>
              {mobile ? <ShopCount value={countText} /> : (
                <span style={{ fontSize: SHOP.fs.sub, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>
                  {rows === null ? '불러오는 중' : `${list.length}대 중 1–${shown.length}`}
                </span>
              )}
              <div style={{ flex: 1 }} />
              {mobile ? (
                <ShopPill on={queryCount(query) > 0} onClick={() => setSheet(true)}>
                  <SlidersHorizontal size={ICON.md} aria-hidden style={{ marginRight: 6 }} />
                  조건{queryCount(query) ? ` ${queryCount(query)}` : ''}
                </ShopPill>
              ) : null}
              <ShopSort value={query.sort} options={SHOP_SORTS}
                onChange={(v) => setQuery((q) => ({ ...q, sort: v as ShopSortKey }))} />
            </div>

            {rows === null ? (
              <Grid mobile={mobile}>
                {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} />)}
              </Grid>
            ) : list.length === 0 ? (
              <ShopEmpty onClear={onClearAll} />
            ) : (
              <>
                <Grid mobile={mobile}>
                  {shown.map((p) => (
                    <ShopCard key={String(p.product_code)} p={p} href={href(p)}
                      faved={fav.has(String(p.product_code))} onFav={onFav} />
                  ))}
                </Grid>
                <ShopMore shown={shown.length} total={list.length} onMore={() => setLimit((n) => n + PAGE)} />
              </>
            )}
          </div>
        </div>
      </main>

      {/*
        폰 조건 시트 — 조건칸을 아래에서 끌어올린다.
        ★자동 포커스를 걸 검색칸이 여기 없다(검색은 위에 상시 있다) — 시트는 «조건만» 든다.
          조건 보러 온 사람 앞에 키보드가 올라오면 매번 내리고 시작해야 한다.
      */}
      {mobile && sheet ? (
        <div role="dialog" aria-label="조건" style={{
          position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.42)',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        }} onClick={() => setSheet(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18,
            maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '16px 16px 12px', borderBottom: `1px solid ${C.line2}`,
            }}>
              <span style={{ fontSize: SHOP.fs.h2, fontWeight: 700 }}>조건</span>
              <div style={{ flex: 1 }} />
              {queryCount(query) ? <ShopTextBtn onClick={onClearAll}>초기화</ShopTextBtn> : null}
              <ShopIconBtn onClick={() => setSheet(false)} label="닫기">
                <X size={ICON.lg} aria-hidden />
              </ShopIconBtn>
            </div>
            <div style={{ overflowY: 'auto', padding: '16px 16px 8px', flex: 1 }}>{filters}</div>
            <div style={{ padding: '10px 16px 18px', borderTop: `1px solid ${C.line2}` }}>
              <ShopPrimary onClick={() => setSheet(false)}>{list.length}대 보기</ShopPrimary>
            </div>
          </div>
        </div>
      ) : null}
    </WhitelabelFrame>
  );
}

/** 격자 — 웹 3열 · 폰 2열. 폰 1열은 카드가 커서 한 화면에 한 대밖에 안 들어온다(고르는 맛이 없다). */
function Grid({ mobile, children }: { mobile: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${mobile ? 2 : 3}, minmax(0, 1fr))`,
      gap: mobile ? 12 : 18,
    }}>{children}</div>
  );
}

/** 불러오는 동안의 자리 — 카드와 «같은 비율»이라야 목록이 도착할 때 화면이 안 튄다. */
function Skeleton() {
  return (
    <div style={{ borderRadius: SHOP.r.card, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
      <div style={{ aspectRatio: '4 / 3', background: C.placeholder }} />
      <div style={{ padding: 15, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ height: 15, width: '78%', borderRadius: 4, background: C.placeholder }} />
        <div style={{ height: 11, width: '52%', borderRadius: 4, background: C.placeholder }} />
        <div style={{ height: 24, width: '46%', borderRadius: 4, background: C.placeholder }} />
      </div>
    </div>
  );
}
