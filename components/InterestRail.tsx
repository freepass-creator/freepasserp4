'use client';
import Link from 'next/link';
import { useEffect, useState, type MouseEvent } from 'react';
import { Star, History, X } from 'lucide-react';
import { C, R, Btn, IconBtn, NUM, ctrlH, ctrlFs, FW, FS } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { vehicleName, cheapest } from '@/lib/domain/product';
import {
  listRecent, listFavs, clearRecent, clearFavs, removeRecent, removeFav, subscribeInterest,
  type InterestSnap,
} from '@/lib/product-interest';
import { man } from '@/lib/format';
import type { EntityRecord } from '@/lib/intake/entities';
import { haptic } from '@/lib/haptics';

export type InterestTab = 'recent' | 'fav';

const TAB_KEY = 'fp4_interest_tab';

/** 관심함 펼침 탭 — 상세 다녀와도 유지(sessionStorage). */
export function useInterestTab(): [InterestTab | null, (t: InterestTab | null) => void] {
  const [tab, setTabState] = useState<InterestTab | null>(null);
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(TAB_KEY);
      if (v === 'recent' || v === 'fav') setTabState(v);
    } catch { /* noop */ }
  }, []);
  const setTab = (t: InterestTab | null) => {
    setTabState(t);
    try {
      if (t) sessionStorage.setItem(TAB_KEY, t);
      else sessionStorage.removeItem(TAB_KEY);
    } catch { /* noop */ }
  };
  return [tab, setTab];
}

/** 최근·찜 목록 구독 */
export function useInterestLists() {
  const [recent, setRecent] = useState<InterestSnap[]>([]);
  const [favs, setFavs] = useState<InterestSnap[]>([]);
  useEffect(() => {
    const refresh = () => { setRecent(listRecent()); setFavs(listFavs()); };
    refresh();
    return subscribeInterest(refresh);
  }, []);
  return { recent, favs };
}

/** 활성 탭이 비면 자동 닫기(칩 0개면 패널도 끔). */
export function useInterestTabGuard(
  tab: InterestTab | null,
  setTab: (t: InterestTab | null) => void,
  recentN: number,
  favN: number,
) {
  useEffect(() => {
    if (tab === 'recent' && recentN === 0) setTab(null);
    else if (tab === 'fav' && favN === 0) setTab(null);
  }, [tab, recentN, favN, setTab]);
}

/** 검색창 옆 숫자 칩 — 최근 N / 찜 N. 0이면 칩만 숨김(슬롯 높이는 유지 → 툴바 상하 간격 고정). */
export function InterestTriggers({
  recentN, favN, tab, onTab,
}: {
  recentN: number; favN: number; tab: InterestTab | null;
  onTab: (t: InterestTab | null) => void;
}) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile);

  const chip = (k: InterestTab, n: number, Icon: typeof History, label: string) => {
    if (!n) return null;
    const on = tab === k;
    const accent = C.brand;
    const accentBg = C.selected;
    return (
      <Btn
        key={k}
        variant="ghost"
        title={label}
        aria-label={`${label} ${n}`}
        aria-pressed={on}
        onClick={() => { haptic.select(); onTab(on ? null : k); }}
        style={{
          flex: '0 0 auto', minWidth: h,
          padding: mobile ? '0 10px' : '0 8px',
          border: `1px solid ${on ? accent : C.line}`,
          background: on ? accentBg : C.taupeBg,
          color: on ? accent : C.mute, fontWeight: FW.label, fontSize: ctrlFs(mobile),
          fontFamily: NUM, boxShadow: 'none', gap: 4,
        }}
      >
        <Icon size={14} strokeWidth={on ? 2.4 : 2} />
        {n}
      </Btn>
    );
  };

  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        flex: '0 0 auto', height: h, minHeight: h,
      }}
      aria-hidden={!recentN && !favN}
    >
      {chip('recent', recentN, History, '최근 본')}
      {chip('fav', favN, Star, '관심')}
    </div>
  );
}

/** 북마크 2줄 — 차량번호·차종 / 기간·대여료·보증금. 우측 X만(관심추가는 상세만). */
export function InterestSummaryCard({ live, snap, tab }: {
  live?: EntityRecord; snap: InterestSnap; tab: InterestTab;
}) {
  const mobile = useIsMobile();
  const plate = live ? String(live.car_number || '') : snap.plate;
  const name = live ? vehicleName(live) : (snap.name || '차량');
  const focus = live
    ? cheapest(live)
    : (snap.month > 0 && snap.rent > 0
      ? { m: snap.month, rent: snap.rent, deposit: snap.deposit || 0 }
      : null);
  const href = `/m/${encodeURIComponent(live ? String(live.product_code) : snap.code)}`;
  const removeLabel = tab === 'recent' ? '최근에서 제거' : '관심 해제';
  const onRemove = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    haptic.tap();
    if (tab === 'recent') removeRecent(snap.code);
    else removeFav(snap.code);
  };

  return (
    <Link
      href={href}
      className="fp-card fp-card-bookmark"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
        padding: mobile ? '10px 6px' : '5px 8px',
        // 모바일 = 리스트형(테두리·배경 제거, 얇은 구분선). 웹 = 격자 카드 유지.
        borderRadius: mobile ? 0 : R,
        background: mobile ? 'transparent' : C.taupeBg,
        border: mobile ? 'none' : `1px solid ${C.line}`,
        borderBottom: mobile ? `1px solid ${C.line2}` : `1px solid ${C.line}`,
        textDecoration: 'none', color: 'inherit', boxSizing: 'border-box',
      }}
    >
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{
          fontSize: mobile ? FS.body : FS.sub, lineHeight: 1.25, color: C.ink,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {plate ? <span style={{ fontFamily: NUM, fontWeight: FW.head }}>{plate}</span> : null}
          {plate ? <span style={{ color: C.faint }}> · </span> : null}
          <span style={{ fontWeight: FW.strong }}>{name}</span>
        </div>
        <div style={{
          fontSize: mobile ? FS.sub : FS.cap, lineHeight: 1.25,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {focus && focus.rent > 0 ? (
            <>
              <span style={{ color: C.faint }}>{focus.m}개월</span>
              {' · '}
              <span style={{ fontFamily: NUM, fontWeight: FW.head, color: C.brand }}>{man(focus.rent)}</span>
              {' · '}
              {focus.deposit > 0 ? (
                <span style={{ color: C.mute }}>
                  보증 <span style={{ fontFamily: NUM, fontWeight: FW.strong }}>{man(focus.deposit)}</span>
                </span>
              ) : (
                <span style={{ color: C.faint }}>무보증</span>
              )}
            </>
          ) : (
            <span style={{ color: C.faint }}>{live ? '가격문의' : '재고없음'}</span>
          )}
        </div>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 2, flex: '0 0 auto',
      }}>
        <IconBtn
          title={removeLabel}
          onClick={onRemove}
          style={{
            border: 'none', background: mobile ? 'transparent' : C.head, color: C.faint,
            width: mobile ? 34 : 26, height: mobile ? 34 : 26,
          }}
        >
          <X size={13} />
        </IconBtn>
      </div>
    </Link>
  );
}

/** 검색 옆 칩 → 목록 위 틀고정 띠. 얇은 요약카드. */
export function InterestPanel({
  rows, tab, recent, favs, onClose,
}: {
  rows: EntityRecord[];
  tab: InterestTab | null;
  recent: InterestSnap[];
  favs: InterestSnap[];
  onClose: () => void;
  view?: string;
}) {
  const mobile = useIsMobile();
  if (!tab) return null;

  const items = tab === 'recent' ? recent : favs;
  const byCode = new Map(rows.map((p) => [String(p.product_code || p._key), p]));

  return (
    <div className="fp-finder-interest" style={{ width: '100%', marginBottom: mobile ? 10 : 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.brand }}>
          {tab === 'recent' ? `최근 ${recent.length}` : `관심 ${favs.length}`}
        </span>
        <span style={{ flex: 1 }} />
        {tab === 'recent' && recent.length > 0 && (
          <Btn size="sm" variant="ghost" onClick={clearRecent}>비우기</Btn>
        )}
        {tab === 'fav' && favs.length > 0 && (
          <Btn size="sm" variant="ghost" onClick={clearFavs}>비우기</Btn>
        )}
        <Btn size="sm" variant="ghost" onClick={onClose}>닫기</Btn>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: FS.sub, color: C.faint, padding: '4px 0' }}>
          {tab === 'recent' ? '아직 본 상품이 없습니다' : '관심 상품이 없습니다'}
        </div>
      ) : (
        <div style={{
          display: 'grid', width: '100%',
          gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: mobile ? 0 : 14,
        }}>
          {items.map((s) => (
            <InterestSummaryCard key={s.code} live={byCode.get(s.code)} snap={s} tab={tab} />
          ))}
        </div>
      )}
    </div>
  );
}
