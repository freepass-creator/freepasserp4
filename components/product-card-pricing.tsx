'use client';

import { createContext, useContext, useState, useRef, useEffect, type CSSProperties, type ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList, cheapest, priceAt } from '@/lib/domain/product';
import { man } from '@/lib/format';
import { C, R, NUM, FW, FS } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { CardPerkLine } from '@/components/product-card-perks';

// 가격 앵커 SSOT
//  · 상세 4줄 우측: Badges / PriceMonth / PriceRentDep / PeriodChips
//  · PriceAmounts = Month+RentDep 한 줄(간단카드)
//  · PricePeekRoot = peek 공유 + 그리드/플렉스 래퍼

type PricePeek = {
  p: EntityRecord;
  all: ReturnType<typeof priceList>;
  cheap: ReturnType<typeof cheapest>;
  focus: NonNullable<ReturnType<typeof cheapest>> | null;
  peekM: number | null;
  setPeekM: (m: number | null) => void;
  peeking: boolean;
  mobile: boolean;
};

const PricePeekCtx = createContext<PricePeek | null>(null);

function usePricePeek(): PricePeek {
  const ctx = useContext(PricePeekCtx);
  if (!ctx) throw new Error('PriceAmounts/PeriodChips는 PricePeekRoot 안에서 써야 합니다');
  return ctx;
}

/** 상세카드용 — Amounts·Chips가 떨어져 있어도 hover peek 공유.
 *  focusMonth = 필터에서 고른 운영개월(1개일 때). 없으면 최저가. */
export function PricePeekRoot({ p, focusMonth, children, style }: {
  p: EntityRecord; focusMonth?: number; children: ReactNode; style?: CSSProperties;
}) {
  const mobile = useIsMobile();
  const [peekM, setPeekM] = useState<number | null>(null);
  const all = priceList(p);
  const cheap = cheapest(p);
  const filtered = focusMonth && focusMonth > 0 ? priceAt(p, focusMonth) : null;
  const preview = !mobile && peekM != null ? priceAt(p, peekM) : null;
  const value: PricePeek = {
    p, all, cheap,
    focus: preview || filtered || cheap,
    peekM, setPeekM,
    peeking: preview != null,
    mobile,
  };
  // style.display가 있으면(그리드) flex 기본값 덮어씀
  const base: CSSProperties = style?.display
    ? { flex: 1, minWidth: 0 }
    : { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 };
  return (
    <PricePeekCtx.Provider value={value}>
      <div style={{ ...base, ...style }} onMouseLeave={() => setPeekM(null)}>
        {children}
      </div>
    </PricePeekCtx.Provider>
  );
}

/** 기간 라벨 (우측 2행). peek = 색만 은은히. */
export function PriceMonth({ align = 'end' }: { align?: 'start' | 'end' }) {
  const { focus, peeking } = usePricePeek();
  const end = align === 'end';
  if (!focus) return <span style={{ fontSize: FS.cap, color: C.faint }}>—</span>;
  return (
    <span style={{
      fontSize: FS.cap,
      fontWeight: FW.strong,
      color: peeking ? C.ink : C.mute,
      textAlign: end ? 'right' : undefined,
      whiteSpace: 'nowrap',
      transition: 'color 0.12s ease',
    }}>{focus.m}개월</span>
  );
}

/** 대여료·보증금 (우측 3행). peek = 색만 은은히 · 크기·굵기 고정. */
export function PriceRentDep({ align = 'end' }: { align?: 'start' | 'end' }) {
  const { focus, peeking } = usePricePeek();
  const end = align === 'end';
  if (!focus) {
    return <span style={{ fontSize: FS.cap, color: C.faint, fontWeight: FW.strong }}>가격문의</span>;
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
      justifyContent: end ? 'flex-end' : 'flex-start', minWidth: 0,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ fontSize: FS.micro, fontWeight: FW.body, color: peeking ? C.mute : C.faint, transition: 'color 0.12s ease' }}>월</span>
        <span style={{
          fontSize: FS.page, fontWeight: FW.head, fontFamily: NUM, letterSpacing: '-0.02em',
          color: peeking ? C.brand : C.ink, transition: 'color 0.12s ease',
        }}>{man(focus.rent)}</span>
      </span>
      <span style={{
        fontSize: FS.cap, fontWeight: FW.meta,
        color: peeking ? C.mute : C.faint, transition: 'color 0.12s ease',
      }}>
        {focus.deposit > 0 ? `보증 ${man(focus.deposit)}` : '무보증'}
      </span>
    </div>
  );
}

/** 기간 → 대여료 → 보증금 한 줄(상세 우측 · 간단).
 *  peek = 색만 은은히 · 크기/굵기 고정. 웹·모바일 동일 치수.
 */
export function PriceAmounts({ align = 'start' }: {
  align?: 'start' | 'end' | 'center';
}) {
  const { focus, peeking } = usePricePeek();
  const end = align === 'end';
  const center = align === 'center';
  if (!focus) {
    return <span style={{ fontSize: FS.cap, color: C.faint, fontWeight: FW.strong }}>가격문의</span>;
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      flexWrap: 'nowrap', overflow: 'hidden', minWidth: 0, maxWidth: '100%',
      justifyContent: end ? 'flex-end' : center ? 'center' : 'flex-start',
    }}>
      <span style={{
        fontSize: FS.cap, fontWeight: FW.strong,
        color: peeking ? C.ink : C.mute, whiteSpace: 'nowrap',
        transition: 'color 0.12s ease',
      }}>{focus.m}개월</span>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, whiteSpace: 'nowrap' }}>
        <span style={{
          fontSize: FS.micro, fontWeight: FW.body,
          color: peeking ? C.mute : C.faint, transition: 'color 0.12s ease',
        }}>월</span>
        <span style={{
          fontSize: FS.title, fontWeight: FW.head, fontFamily: NUM, letterSpacing: '-0.02em',
          color: peeking ? C.brand : C.ink, transition: 'color 0.12s ease',
        }}>{man(focus.rent)}</span>
      </span>
      <span style={{
        fontSize: FS.cap, fontWeight: FW.meta,
        color: peeking ? C.mute : C.faint, whiteSpace: 'nowrap',
        transition: 'color 0.12s ease',
      }}>
        {focus.deposit > 0 ? `보증 ${man(focus.deposit)}` : '무보증'}
      </span>
    </div>
  );
}

/** 기간칩 공통 스타일 — 웹·모바일 동일(PeriodChips / PeriodRange). */
function periodChipStyle(on: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    height: 20, boxSizing: 'border-box',
    padding: '0 6px', borderRadius: R,
    fontSize: FS.micro, fontWeight: FW.strong, lineHeight: 1,
    letterSpacing: '-0.01em', whiteSpace: 'nowrap',
    color: on ? C.taupeBg : C.mute,
    background: on ? C.brand : C.head,
    flex: '0 0 auto',
  };
}

/** 모바일 — 최단~최장 기간칩 2개 + 물결. 칩 나열 금지. */
export function PeriodRange() {
  const { all } = usePricePeek();
  if (all.length < 2) return null;
  const months = all.map((x) => x.m);
  const lo = Math.min(...months);
  const hi = Math.max(...months);
  if (lo === hi) return null;
  const tip = (m: number) => {
    const pr = all.find((x) => x.m === m);
    if (!pr) return `${m}개월`;
    return `${pr.m}개월 · 월 ${man(pr.rent)} · ${pr.deposit > 0 ? `보증 ${man(pr.deposit)}` : '무보증'}`;
  };
  // 색·칩 없이 연한 텍스트 — 계약가능 기간범위(언제~언제)만 표시.
  const txt = { fontSize: FS.cap, fontWeight: FW.meta, color: C.faint, lineHeight: 1, flex: '0 0 auto' } as const;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      flex: '0 0 auto', whiteSpace: 'nowrap',
    }} aria-label={`${lo}~${hi}개월`}>
      <span title={tip(lo)} style={txt}>{lo}개월</span>
      <span style={txt}>~</span>
      <span title={tip(hi)} style={txt}>{hi}개월</span>
    </div>
  );
}

/** 기간 칩 — 상세 우측 · 간단 가격 아래.
 *  clamp = 부모 폭 100%. 넘치면 줄바꿈(칩 중간 잘림 금지).
 *  after = 같은 wrap에 끼움(조건 등) → 줄바꿈된 칩 옆으로 붙음.
 */
export function PeriodChips({ align = 'start', clamp, after }: {
  align?: 'start' | 'end'; clamp?: boolean; after?: ReactNode;
}) {
  const { all, cheap, peekM, setPeekM, peeking, mobile } = usePricePeek();
  const end = align === 'end';
  const h = 20;
  if (!all.length && !after) return <div style={{ minHeight: h }} aria-hidden />;
  return (
    <div style={{
      display: 'flex', gap: 3, flexWrap: 'wrap',
      justifyContent: end ? 'flex-end' : 'flex-start',
      alignItems: 'center',
      minHeight: h,
      maxWidth: clamp ? '100%' : undefined,
      width: clamp ? '100%' : undefined,
    }}>
      {all.map((pr) => {
        const on = peeking ? pr.m === peekM : pr.m === cheap!.m;
        return (
          <span
            key={pr.m}
            data-period-chip
            onMouseEnter={() => { if (!mobile) setPeekM(pr.m); }}
            title={`${pr.m}개월 · 월 ${man(pr.rent)} · ${pr.deposit > 0 ? `보증 ${man(pr.deposit)}` : '무보증'}`}
            style={{ ...periodChipStyle(on), cursor: mobile ? undefined : 'pointer' }}
          >{pr.m}개월</span>
        );
      })}
      {after != null && (
        <div style={{ flex: '0 0 auto', marginLeft: 6, minWidth: 0 }}>
          {after}
        </div>
      )}
    </div>
  );
}

/**
 * 간단카드 — 기간 + 조건.
 *  · 웹: 조건 = 맨 마지막 줄(기간 아래). 기간 2줄이면 조건이 그 줄에 한 칸 양보.
 *  · 모바일: 기간칩 나열 금지 → 조건만.
 */
export function PeriodPerkBand({ p, dense, gap = 6 }: {
  p: EntityRecord; dense?: boolean; gap?: number;
}) {
  const { all, mobile } = usePricePeek();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [yieldSlot, setYieldSlot] = useState(false);

  useEffect(() => {
    if (mobile) return;
    const el = wrapRef.current;
    if (!el) return;
    const check = () => {
      const chips = el.querySelectorAll<HTMLElement>('[data-period-chip]');
      if (chips.length < 2) {
        setYieldSlot(false);
        return;
      }
      const top = chips[0].offsetTop;
      let wrapped = false;
      for (let i = 1; i < chips.length; i++) {
        if (chips[i].offsetTop > top + 2) { wrapped = true; break; }
      }
      setYieldSlot(wrapped);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [all.map((x) => x.m).join(','), mobile]);

  const perk = <CardPerkLine p={p} dense={dense} inline={!mobile && yieldSlot} />;

  // 모바일 = 앵커 가격(PriceAmounts)만 위에 두고, 여기선 조건만
  if (mobile) {
    return (
      <div style={{ flex: '0 0 auto', minWidth: 0, width: '100%' }}>
        {perk}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: yieldSlot ? 0 : gap,
      minWidth: 0, width: '100%', flex: '0 0 auto',
    }}>
      <div ref={wrapRef} style={{ minWidth: 0, width: '100%' }}>
        <PeriodChips
          align="start"
          clamp
          after={yieldSlot ? perk : undefined}
        />
      </div>
      {!yieldSlot && (
        <div style={{ flex: '0 0 auto', minWidth: 0, width: '100%' }}>
          {perk}
        </div>
      )}
    </div>
  );
}

/** 간단카드용 — Amounts만(기간칩은 PeriodPerkBand/웹 전용). */
export function PriceHero({ p, align = 'start', focusMonth }: {
  p: EntityRecord; align?: 'start' | 'end'; focusMonth?: number;
}) {
  const end = align === 'end';
  return (
    <PricePeekRoot p={p} focusMonth={focusMonth} style={{
      gap: 5,
      alignItems: end ? 'flex-end' : 'stretch',
      flex: '0 0 auto',
    }}>
      <PriceAmounts align={align} />
    </PricePeekRoot>
  );
}
