'use client';
import Link from 'next/link';
import { useEffect, useState, type MouseEvent } from 'react';
import { Star, History, StarOff, Trash2, X, MessageCircle } from 'lucide-react';
import { C, R, Btn, ButtonLabel, IconBtn, NUM, ctrlH, ctrlFs, FW, FS, ICON } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { vehicleName, cheapest, isStockedProduct } from '@/lib/domain/product';
import {
  listRecent, listFavs, clearRecent, clearFavs, removeRecent, removeFav, subscribeInterest,
  type InterestSnap,
} from '@/lib/product-interest';
import { man } from '@/lib/format';
import type { EntityRecord } from '@/lib/intake/entities';
import { haptic } from '@/lib/haptics';

/**
 * 관심함 탭 — 최근 · 관심 · 문의.
 *
 * 셋 다 **매물 목록**이다. 문의도 대화창이 아니라 매물 카드로 보여 주고 누르면 상세로 간다
 * (2026-08-08 사장님) — 최근·관심과 같은 문법이라야 «어디서 이어서 하나»가 흔들리지 않는다.
 * 다른 점은 출처뿐: 최근·관심은 이 기기(localStorage), 문의는 **방 데이터**(영업자=내가 남긴 문의 /
 * 공급사·관리자=들어온 문의)라 기기를 바꿔도 따라온다.
 */
export type InterestTab = 'recent' | 'fav' | 'inq';

const TAB_KEY = 'fp4_interest_tab';

/** 관심함 펼침 탭 — 상세 다녀와도 유지(sessionStorage). */
export function useInterestTab(): [InterestTab | null, (t: InterestTab | null) => void] {
  const [tab, setTabState] = useState<InterestTab | null>(null);
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(TAB_KEY);
      if (v === 'recent' || v === 'fav' || v === 'inq') setTabState(v);
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

/** 활성 탭이 비면 자동 닫기(칩 0개면 패널도 끔). enabled=false면 스킵(모바일 목록모드=빈 최근/관심도 선택 유지). */
export function useInterestTabGuard(
  tab: InterestTab | null,
  setTab: (t: InterestTab | null) => void,
  recentN: number,
  favN: number,
  enabled = true,
  inqN = 0,
) {
  useEffect(() => {
    if (!enabled) return;
    if (tab === 'recent' && recentN === 0) setTab(null);
    else if (tab === 'fav' && favN === 0) setTab(null);
    else if (tab === 'inq' && inqN === 0) setTab(null);
  }, [tab, recentN, favN, inqN, setTab, enabled]);
}

/** 검색창 옆 숫자 칩 — 최근 N / 찜 N. 0이면 칩만 숨김(슬롯 높이는 유지 → 툴바 상하 간격 고정). */
export function InterestTriggers({
  recentN, favN, inqN = 0, tab, onTab,
}: {
  recentN: number; favN: number; inqN?: number; tab: InterestTab | null;
  onTab: (t: InterestTab | null) => void;
}) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile);

  const chip = (k: InterestTab, n: number, Icon: typeof History, label: string) => {
    if (!n) return null;
    const on = tab === k;
    /**
     * 켜짐 = **1단 반전**(네이비 면 + 흰 글자). 연한 면(2단)으로 뒀다가 올렸다 —
     * 이 칩은 «패널을 여는 스위치»라 지금 열려 있는지가 한눈에 보여야 한다(사장님 2026-08-20
     * 「눌리면 버튼 색깔이 반전되면서 메인컬러가 가야 하는 거 아니냐」).
     * 2단(연한 면)은 «선택된 줄»이 쓰는 세기다 — 사다리에서 같은 단을 두 뜻으로 쓰지 않는다.
     */
    return (
      <Btn
        key={k}
        variant="ghost"
        title={label}
        aria-label={`${label} ${n}`}
        aria-pressed={on}
        onClick={() => { onTab(on ? null : k); }}
        haptic="select"
        style={{
          flex: '0 0 auto', minWidth: h,
          padding: mobile ? '0 10px' : '0 8px',
          border: `1px solid ${on ? C.brand : C.line}`,
          background: on ? C.brand : C.taupeBg,
          color: on ? C.inverse : C.mute, fontWeight: on ? FW.title : FW.label, fontSize: ctrlFs(mobile),
          fontFamily: NUM, fontVariantNumeric: 'tabular-nums', boxShadow: 'none', gap: 4,
        }}
      >
        <Icon size={ICON.sm} strokeWidth={2.2} />
        <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
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
      {chip('recent', recentN, History, '최근')}
      {chip('fav', favN, Star, '관심')}
      {chip('inq', inqN, MessageCircle, '문의')}
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
          {plate ? <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.head }}>{plate}</span> : null}
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
              <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.head, color: C.brand }}>{man(focus.rent)}</span>
              {' · '}
              {focus.deposit > 0 ? (
                <span style={{ color: C.mute }}>
                  보증 <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong }}>{man(focus.deposit)}</span>
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

      {/* 문의는 방에서 파생된 목록이라 «제거»가 없다 — 지울 수 있는 건 이 기기에 쌓인 최근·관심뿐이다. */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 2, flex: '0 0 auto',
      }}>
        {tab === 'inq' ? null : (
        <IconBtn
          title={removeLabel}
          onClick={onRemove}
          style={{
            border: 'none', background: mobile ? 'transparent' : C.head, color: C.faint,
            width: mobile ? 40 : 26, height: mobile ? 40 : 26,
          }}
        >
          <X size={mobile ? 16 : 13} />
        </IconBtn>
        )}
      </div>
    </Link>
  );
}

/** 검색 옆 칩 → 목록 위 틀고정 띠. 얇은 요약카드. */
export function InterestPanel({
  rows, tab, recent, favs, inquiries = [], onClose,
}: {
  rows: EntityRecord[];
  tab: InterestTab | null;
  recent: InterestSnap[];
  favs: InterestSnap[];
  /** 문의가 오간 매물 — 방에서 파생(비우기 없음). */
  inquiries?: InterestSnap[];
  onClose: () => void;
  view?: string;
}) {
  const mobile = useIsMobile();
  if (!tab) return null;

  const storedItems = tab === 'recent' ? recent : tab === 'fav' ? favs : inquiries;
  const allByCode = new Map(rows.map((p) => [String(p.product_code || p._key), p]));
  // 현재 데이터에 존재하지만 판매조건을 잃은 상품은 최근·관심 우회 링크로 다시 노출하지 않는다.
  // 이미 삭제되어 live 데이터가 없는 스냅은 사용자가 직접 제거할 수 있게 기존대로 남긴다.
  const items = storedItems.filter((snapshot) => {
    const live = allByCode.get(snapshot.code);
    return !live || isStockedProduct(live);
  });
  const byCode = new Map(rows.filter(isStockedProduct).map((p) => [String(p.product_code || p._key), p]));

  return (
    <div className="fp-finder-interest" style={{ width: '100%', marginBottom: mobile ? 10 : 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.brand }}>
          {tab === 'recent' ? `최근 ${items.length}` : tab === 'fav' ? `관심 ${items.length}` : `문의 ${items.length}`}
        </span>
        <span style={{ flex: 1 }} />
        {tab === 'recent' && recent.length > 0 && (
          <Btn title="최근 비우기" size="sm" variant="ghost" haptic="impact" onClick={clearRecent}>
            <ButtonLabel icon={<Trash2 size={ICON.md} aria-hidden />}>비우기</ButtonLabel>
          </Btn>
        )}
        {tab === 'fav' && favs.length > 0 && (
          <Btn title="관심 상품 비우기" size="sm" variant="ghost" haptic="impact" onClick={clearFavs}>
            <ButtonLabel icon={<StarOff size={ICON.md} aria-hidden />}>비우기</ButtonLabel>
          </Btn>
        )}
        <Btn mobileIcon={<X size={ICON.lg} />} title="관심함 닫기" size="sm" variant="ghost" haptic="back" onClick={onClose}>닫기</Btn>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: FS.sub, color: C.faint, padding: '4px 0' }}>
          {tab === 'recent' ? '아직 본 상품이 없습니다' : tab === 'fav' ? '관심 상품이 없습니다' : '문의한 상품이 없습니다'}
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
