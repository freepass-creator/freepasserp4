'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { C } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { WhitelabelFrame } from '@/components/WhitelabelFrame';
import { FREEPASS, hasBrand, type Whitelabel } from '@/lib/whitelabel';
import {
  SHOP, ShopCount, ShopEmpty, ShopMore, ShopPill,
  ShopSearch, ShopSort, ShopTextBtn, ShopTokens,
} from '@/components/shop/shop-ui';
import { ShopFilters } from '@/components/shop/ShopFilters';
import { ShopFilterSheet } from '@/components/shop/ShopFilterSheet';
import { ShopCard } from '@/components/shop/ShopCard';
import { guestShareUrl } from '@/lib/domain/product-share';
import { resolveAttr } from '@/lib/shop/attribution';
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
  // 차종·연료는 손님이 «말로 하는» 조건이다 — 「SUV 있어요?」 「전기차 돼요?」가 상담 첫 마디다.
  // 값은 실측으로 다 차 있다(승용 342 · SUV 273 · 승합 92 / 전기 · 하이브리드 존재).
  { axis: 'vc', key: 'SUV', label: 'SUV' },
  { axis: 'vc', key: '승합', label: '승합·카니발' },
  { axis: 'vc', key: '승용', label: '승용' },
  { axis: 'fuel', key: '전기', label: '전기차' },
  { axis: 'fuel', key: '하이브리드', label: '하이브리드' },
];

/*
 * ★★**관심(하트)은 없다**(사장님 2026-09-05 「손님들이 여기에 **로그인을 안 할 거라서 관심을
 *   못 찍을 거야** … 손님 로그인 하는 게 **없거든**. 영업사원은 로그인을 할 수 있지만
 *   **영업사원 전용 로그인**이야」). 여기 있던 `FAV_KEY`(브라우저 저장)는 걷었다 —
 *   담아 둔 것을 다시 꺼내 볼 «내 목록»이 없는데 담는 단추만 있었다. 공유는 남는다(§1-2).
 */

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
  /*
   * 미리보기 꼬리표(`?wl=`) — **도메인이 붙기 전까지만** 쓰는 것이다.
   * 목록에서 상세로 넘어갈 때 이걸 안 물고 가면 상세가 노브랜드로 떨어져 「눌렀더니 남의 사이트」가 된다.
   * 운영에서는 호스트가 브랜드를 정하므로 이 값이 없고, 그때는 빈 문자열이라 주소가 그대로 짧다.
   */
  const [wlQuery, setWlQuery] = useState('');
  /** 검색줄이 «지금 붙어 있나» — 붙었을 때만 밑에 가는 선이 뜬다(안 붙었는데 선이 있으면 그냥 줄이 하나 더 그어진 것이다). */
  const stickRef = useRef<HTMLDivElement>(null);

  /* 첫 진입 — 주소에서 조건을 복원하고, 담당자·매물을 받아 온다. */
  useEffect(() => { (async () => {
    const params = new URLSearchParams(window.location.search);
    const restored = readQuery(params);
    setQuery(restored);
    setTyped(restored.q);

    // 누구 손님인가 — 주소 ?a= → 기억해 둔 값 → 로그인한 나. 규칙은 `lib/shop/attribution` 한 곳이다.
    const a = resolveAttr(params);
    setAttr(a);
    /*
     * ★★**채널을 상세까지 물고 간다.** 주소에 `?wl=` 이 있으면 그걸 쓰고, 없어도 **지금 채널 화면인데
     *   호스트가 그 채널 도메인이 아니면**(= `/uniauto` 같은 전용 경로) 채널 키를 붙인다.
     * ⚠ 이걸 안 하면 목록은 유니오토인데 카드를 누른 순간 **노브랜드 옛 「상품 안내」 화면**이 뜬다
     *   (2026-09-05 실측 — `/uniauto` 에서 카드를 눌러 확인했다). 손님에겐 「눌렀더니 남의 사이트」다.
     * ★도메인이 붙으면 호스트가 곧 브랜드라 이 값은 저절로 빈 문자열이 된다 — 주소가 짧아진다.
     */
    const wlParam = params.get('wl');
    const hostIsChannel = wl.hosts.some((h) => h.toLowerCase() === window.location.hostname.toLowerCase());
    const wlKey = wlParam || (hasBrand(wl) && !hostIsChannel ? wl.key : '');
    setWlQuery(wlKey ? `?wl=${encodeURIComponent(wlKey)}` : '');
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

  /*
   * 붙었는지 재는 것 — **요소 자신**을 본다. 위쪽 경계를 1px 깎아 두면(`rootMargin -1px`),
   * 붙어 있는 동안에만 그 1px 이 밖으로 나가 「다 안 보이는 상태(ratio<1)」가 된다.
   * ⚠ 예전에는 앞에 1px 짜리 보초 div 를 꽂았는데, React 가 관리하는 부모에 손으로 넣은 노드라
   *   다시 그릴 때 사라져 표시가 영영 안 켜졌다(2026-09-04 실측 — 붙었는데 클래스가 없었다).
   * ⚠ 스크롤 이벤트로 매 프레임 재지 않는다 — 폰에서 목록이 버벅인다.
   */
  useEffect(() => {
    const el = stickRef.current;
    if (!el || !mobile) return;
    const io = new IntersectionObserver(
      ([e]) => el.classList.toggle('is-stuck', e.intersectionRatio < 1),
      { root: el.closest('.fp-main-pad'), rootMargin: '-1px 0px 0px 0px', threshold: [1] },
    );
    io.observe(el);
    return () => { io.disconnect(); el.classList.remove('is-stuck'); };
  }, [mobile]);

  /* 조건이 바뀌면 첫 장으로 — 3장까지 펼쳐 본 뒤 조건을 좁혔는데 여전히 3장이면 뭐가 준 건지 모른다. */
  useEffect(() => { setLimit(PAGE); }, [query]);

  const { list, total, facets } = useMemo(() => runShopQuery(rows, query), [rows, query]);
  const tokens = useMemo(
    () => activeTokens(query, facets).map((t) => ({ ...t, axisLabel: AXIS_LABEL[t.axis] })),
    [query, facets],
  );
  const shown = list.slice(0, limit);
  /** 재고 전체 — 웹 왼쪽 기둥의 「전체차량」. 조건과 무관한 값이라 안 변하는 게 «맞다». */
  const countText = rows === null ? '—' : String(total);
  /** 지금 조건으로 남은 수 — 폰 머리가 드는 값. 조건을 넷 걸어 3대면 3이라고 말해야 한다. */
  const shownText = rows === null ? '—' : String(list.length);
  /** 검색어든 축이든 하나라도 걸렸나 — 걸렸으면 「전체차량」이 아니라 「조건에 맞는 차량」이다. */
  const narrowed = queryCount(query) > 0 || !!query.q.trim();

  const onToggle = useCallback((axis: ShopAxis, key: string) => setQuery((q) => toggleAxis(q, axis, key)), []);
  const onClearAxis = useCallback((axis: ShopAxis) => setQuery((q) => clearAxis(q, axis)), []);
  const onClearAll = useCallback(() => { setQuery((q) => ({ ...emptyQuery(), q: q.q })); }, []);

  /*
   * 상세로 가는 주소 — **짧은 토큰**(`guestShareUrl` SSOT).
   *
   * ⚠⚠ 전에는 `/q/{상품코드}?a=…` 를 그대로 썼는데, 실제 상품코드가 `RP012_122두8108` 꼴이라
   *   **손님 주소창에 공급사 코드가 그대로 나갔다**(2026-09-05 실측). 손님이 그 주소를 공유하면
   *   우리가 어느 회사 차를 파는지가 같이 나간다 — 화이트라벨에서 제일 나쁜 종류의 누출이다.
   *   한글 차번이 `%ED%95%98`(9자)로 부풀어 링크가 길어지는 것은 덤이었다.
   *   토큰은 순수 ASCII 10자라 짧고 되돌릴 수 없다(`lib/domain/product-share` 머리말).
   * ★옛 주소(`/q/{상품코드}?a=`)도 그대로 열린다 — 서버가 통째로 먼저 찾는다. 이미 나간 링크는 안 죽는다.
   */
  const href = (p: EntityRecord) => `${guestShareUrl(p, attr, '')}${wlQuery}`;

  const filters = (
    <ShopFilters facets={facets} sel={query.sel} onToggle={onToggle} onClearAxis={onClearAxis} onClearAll={onClearAll} />
  );

  return (
    <WhitelabelFrame wl={wl} agentName={agent?.name} agentPhone={agent?.phone}>
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: mobile ? '18px 16px 28px' : '26px 24px 40px' }}>
        {/* 검색 — 목록 열과 같은 폭에 걸친다. 페이지 한가운데 띄우면 조건칸과 축이 안 맞는다. */}
        {/*
          검색줄 + 알약 줄 — **폰에서는 위에 붙어 따라온다**(`.fp-shop-stick`).
          목록을 한참 내려가다 다시 찾고 싶을 때 맨 위로 되돌아가지 않아도 된다. 요즘 커머스가 다 그렇다.
          ⚠ 구르는 것은 `.fp-main-pad` 다(html/body 는 overflow hidden) — sticky 는 그 안에서 잡힌다.
          ★문구는 «손님이 실제로 칠 말»이라야 한다(사장님 2026-09-04 「이 검색창에서 손님이 어떻게
            차량번호 검색을 하겠니? 차종 조건 뭐 이런 걸로 검색을 해야 되고」).
            차번은 영업자·우리가 쓰는 열쇠지 손님의 말이 아니다 — 검색은 여전히 차번도 받지만
            **안내를 차번으로 하면** 손님은 「내가 아는 게 없네」 하고 조건칸으로도 안 간다.
        */}
        <div ref={stickRef} className={mobile ? 'fp-shop-stick' : undefined}>
          <ShopSearch value={typed} onChange={setTyped}
            placeholder="차종·차명으로 찾아보세요 (예: 카니발, 쏘렌토, 그랜저)"
            onFilter={mobile ? () => setSheet(true) : undefined}
            filterCount={queryCount(query)} />

          {/*
            빠른 조건 — **한 줄로 스르륵 미는 알약**(사장님 2026-09-04 「좌우로 스크롤하는 그 알약처럼
            생긴 그 필터, 그게 스르륵 이렇게 왔다 가야 되고, 그 밑에는 바로 품목이 나오는 거야」).
            접어서 두 줄로 쌓으면 조건이 늘 때마다 목록이 아래로 밀린다 — 폰 첫 화면에 상품이 안 보이면
            그 화면은 진 것이다. 「많이 찾는 조건」 라벨도 뺐다(자리만 먹고 아무도 안 읽는다).
            ★축 아홉으로 가는 문(「조건」)은 여기 두지 않는다 — **검색줄 오른쪽 끝**이 그 자리다.
          */}
          {/* ⚠ `padding` 단축속성을 쓰지 않는다 — CSS 의 `padding-inline: 16` 을 0 으로 덮어써
              첫 칩이 화면 끝에 붙는다(2026-09-04 실측 x=0). 세로 여백만 만진다. */}
          <div className="fp-shop-rail" style={{ paddingBlock: 13 }}>
            {QUICK.map((k) => (
              <ShopPill key={`${k.axis}:${k.key}`} on={query.sel[k.axis].includes(k.key)}
                onClick={() => onToggle(k.axis, k.key)}>{k.label}</ShopPill>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: SHOP.gap.pane, alignItems: 'flex-start', marginTop: mobile ? 18 : 26 }}>
          {/*
            웹 조건칸도 «따라온다». 716대를 내려가다 조건을 바꾸려면 매번 맨 위로 올라가야 했다.
            ★`maxHeight`+`overflowY` 를 같이 줘야 축이 화면보다 길 때 기둥 «안에서» 굴러간다 —
              안 주면 아래쪽 축(혜택 등)에 영영 손이 안 닿는다.
            ★`top: 20` — 0 으로 붙이면 화면 맨 위 선에 딱 붙어 답답하다.
            ⚠ 주석을 삼항의 «값 자리»에 넣지 않는다 — 자식이 둘이 되어 JSX 가 깨진다(방금 깨뜨렸다).
          */}
          {!mobile ? (
            /*
             * ⚠ 여기 `maxHeight + overflowY:auto` 가 있었다 — 조건칸 «안»에 스크롤바가 또 생겨서,
             *   목록을 내리는 손이 기둥 위에 있으면 목록이 아니라 조건칸이 굴렀다(2026-09-05 실측).
             *   엔카·케이카 둘 다 왼쪽 기둥은 **페이지와 같이 흐른다.**
             * ⇒ 붙박이(sticky)는 두되 **높이를 자르지 않는다.** 기둥이 화면보다 길면 그냥 같이 흐르고,
             *   짧으면 제자리에 붙어 있는다 — 스크롤 막대가 화면에 하나뿐이라야 손이 헷갈리지 않는다.
             */
            <aside style={{
              width: 260, flexShrink: 0,
              position: 'sticky', top: 20, alignSelf: 'flex-start',
            }}>
              <div style={{ paddingBottom: 18 }}><ShopCount value={countText} /></div>
              {/*
                ⚠ 여기 있던 「필터」 제목과 「초기화」를 뺐다(2026-09-05 검토).
                  · 제목 — 바로 밑에 「차종·제조사·월 대여료…」 아홉이 굵게 서 있다. 아무도 안 읽는 라벨이
                    굵은 검정 밑줄까지 끌고 있었다.
                  · 초기화 — 오른쪽 토큰 줄의 「조건 모두 지우기」와 **같은 함수·같은 화면**이다.
                    조건을 다 푸는 문이 한 화면에 둘일 이유가 없다.
              */}
              {/*
                ⚠ 여기 있던 굵은 검정 가로선을 뺐다(사장님 2026-09-05 「저런 쓸데없는 라인들,
                  없어도 되는 구분선 이런 거는 좀 최소화해야 된다」).
                  「전체차량 716대」와 축 목록은 «글자 크기»가 이미 다르다 — 선이 없어도 갈린다.
                  나누는 일은 선이 아니라 **여백**이 한다.
              */}
              <div style={{ paddingTop: 26 }}>{filters}</div>
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
              {mobile ? <ShopCount value={shownText} filtered={narrowed} /> : (
                <span style={{ fontSize: SHOP.fs.sub, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>
                  {rows === null ? '불러오는 중' : `${list.length}대 중 1–${shown.length}`}
                </span>
              )}
              <div style={{ flex: 1 }} />
              <ShopSort value={query.sort} options={SHOP_SORTS}
                onChange={(v) => setQuery((q) => ({ ...q, sort: v as ShopSortKey }))} />
            </div>

            {rows === null ? (
              <Grid mobile={mobile}>
                {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} />)}
              </Grid>
            ) : list.length === 0 ? (
              // 검색어까지 지운다 — 축만 풀면 검색어로 비운 손님은 여전히 0건이다.
              <ShopEmpty onClear={() => { setTyped(''); setQuery(emptyQuery()); }} />
            ) : (
              <>
                <Grid mobile={mobile}>
                  {shown.map((p) => (
                    <ShopCard key={String(p.product_code)} p={p} href={href(p)}
 />
                  ))}
                </Grid>
                <ShopMore shown={shown.length} total={list.length} onMore={() => setLimit((n) => n + PAGE)} />
              </>
            )}
          </div>
        </div>
      </main>

      {mobile && sheet ? (
        <ShopFilterSheet facets={facets} sel={query.sel}
          onToggle={onToggle} onClearAxis={onClearAxis} onClearAll={onClearAll}
          resultCount={list.length} onClose={() => setSheet(false)} />
      ) : null}
    </WhitelabelFrame>
  );
}

/**
 * 목록 — 웹 3열 격자 · **폰은 한 줄에 한 대(세로 큰 카드)**.
 *
 * 사장님 2026-09-04 「세로 타입으로 크게 사진 그리고 차량 스펙 대여료 뭐 우대사항 이런 하자.
 * 가로로 할 필요가 없을 것 같다. **어차피 검색해서 찾을 놈은 거고 우리가 뭐 몇 만 몇 만 개
 * 있는 것도 아니고**」 — 그 말이 맞다. 가로형(당근 형태)이 이기는 판은 매물이 수만 개라
 * «훑어야 하는» 곳이다. 우리는 716대고 손님은 조건으로 좁혀서 온다.
 * 좁혀 놓고 보는 화면이면 한 대를 **제대로** 보여 주는 편이 낫다.
 */
function Grid({ mobile, children }: { mobile: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      /*
       * ⚠ 폰 한 열도 반드시 `minmax(0, 1fr)` 이다. 맨 `1fr` 은 `minmax(auto, 1fr)` 이라
       *   칸의 최소폭이 «내용의 min-content»가 되는데, 카드 안에 안 줄어드는 것(옵션 칩·
       *   nowrap 금액)이 있으면 칸이 그만큼 벌어진다. 실측으로 main 이 375 화면에서 864px 이 됐고,
       *   카드는 멀쩡해 보이는데 **하트가 화면 밖(x=822)** 에 나가 있었다. 눈으로는 안 보이는 고장이다.
       */
      gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))',
      /*
       * 테두리를 걷었으니 카드를 나누는 것은 **여백**뿐이다 — 좁으면 두 카드가 한 덩어리로 붙어 보인다.
       * 세로가 가로보다 넓다(글자 줄이 카드 아래쪽에 몰려 있어 그만큼 더 떼야 갈린다).
       */
      gap: mobile ? '28px 12px' : '34px 22px',
    }}>{children}</div>
  );
}

/** 불러오는 동안의 자리 — 카드와 «같은 짜임»이라야 목록이 도착할 때 화면이 안 튄다. */
function Skeleton() {
  const bar = (w: string, h: number) => (
    <div className="fp-shop-skel" style={{ height: h, width: w, borderRadius: 5 }} />
  );
  return (
    <div>
      <div className="fp-shop-skel" style={{ aspectRatio: '4 / 3', borderRadius: SHOP.r.card }} />
      <div style={{ padding: '12px 2px 2px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {bar('78%', 16)}{bar('52%', 12)}{bar('46%', 26)}{bar('60%', 12)}
      </div>
    </div>
  );
}
