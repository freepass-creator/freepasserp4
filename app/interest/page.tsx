'use client';
import { useEffect, useMemo, useState } from 'react';
import { StarOff, Trash2 } from 'lucide-react';
import { Page, Btn, ButtonLabel, C, FilterChips, FS, ICON } from '@/components/ui';
import { InterestSummaryCard, useInterestLists } from '@/components/InterestRail';
import { useAuthReady } from '@/lib/auth-context';
import { useIsMobile } from '@/lib/use-mobile';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { isStockedProduct } from '@/lib/domain/product';
import { clearRecent, clearFavs } from '@/lib/product-interest';
import type { EntityRecord } from '@/lib/intake/entities';

/**
 * **내가본상품** — 이 기기의 최근 본 · 관심(찜) 상품 모음(하단탭 3번 칸, 사장님 2026-08-22
 * 「재고관리/내가본상품을 여기에 모아두면 좋을 거 같아, 관심/최근 상품을」).
 *
 * ★웹은 상품찾기 검색줄 옆 최근·관심 칩이 같은 목록을 연다 — 모바일 검색줄엔 그 칩이 없어서
 *   (검색창+필터만, 2026-08-22 정리) 이 페이지가 모바일의 유일한 입구다. 웹에서 열어도 같은 화면.
 * ★데이터는 product-interest(localStorage) 그대로 — 서버 동기화 없음, 기기별이다.
 *   목록 걸러내기는 InterestPanel 과 같은 규칙: 라이브 데이터가 있는데 판매조건을 잃은 차는 숨기고,
 *   라이브가 아예 없는(삭제된) 스냅은 남겨 사용자가 X 로 지울 수 있게 한다.
 */
type PageTab = 'recent' | 'fav';
const TAB_KEY = 'fp4_interest_page_tab';

export default function InterestPage() {
  const authReady = useAuthReady();
  const mobile = useIsMobile();
  const { recent, favs } = useInterestLists();
  const [tab, setTab] = useState<PageTab>('recent');
  const [rows, setRows] = useState<EntityRecord[] | null>(null);

  useEffect(() => {
    try { const t = sessionStorage.getItem(TAB_KEY); if (t === 'fav' || t === 'recent') setTab(t); } catch { /* noop */ }
  }, []);
  const switchTab = (t: PageTab) => {
    setTab(t);
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* noop */ }
  };

  useEffect(() => {
    if (!authReady) return;
    let alive = true;
    getStore().list('product', getCompanyId())
      .then((all) => { if (alive) setRows(all); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [authReady]);

  const allByCode = useMemo(
    () => new Map((rows || []).map((p) => [String(p.product_code || p._key), p])),
    [rows],
  );
  const dropUnstocked = (snap: { code: string }) => {
    const live = allByCode.get(snap.code);
    return !live || isStockedProduct(live);
  };
  const recentList = recent.filter(dropUnstocked);
  const favList = favs.filter(dropUnstocked);
  const stockedByCode = useMemo(
    () => new Map((rows || []).filter(isStockedProduct).map((p) => [String(p.product_code || p._key), p])),
    [rows],
  );

  const items = tab === 'recent' ? recentList : favList;

  return (
    <Page title="내가본상품" meta={items.length} countSuffix="대">
      {/* 상단 12 = 모바일 섹션 리듬 공통규격(사장님 2026-08-22). */}
      <div style={{ maxWidth: 560, width: '100%', margin: '0 auto', boxSizing: 'border-box', padding: '12px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <FilterChips
            value={tab}
            onChange={(k) => switchTab(k as PageTab)}
            options={[
              { key: 'recent', label: `최근 본 ${recentList.length}` },
              { key: 'fav', label: `관심 ${favList.length}` },
            ]}
          />
          <span style={{ flex: 1 }} />
          {tab === 'recent' && recentList.length > 0 ? (
            <Btn title="최근 본 상품 비우기" size="sm" variant="ghost" haptic="impact" onClick={clearRecent}>
              <ButtonLabel icon={<Trash2 size={ICON.md} aria-hidden />}>비우기</ButtonLabel>
            </Btn>
          ) : null}
          {tab === 'fav' && favList.length > 0 ? (
            <Btn title="관심 상품 비우기" size="sm" variant="ghost" haptic="impact" onClick={clearFavs}>
              <ButtonLabel icon={<StarOff size={ICON.md} aria-hidden />}>비우기</ButtonLabel>
            </Btn>
          ) : null}
        </div>
        {items.length === 0 ? (
          <div style={{ fontSize: FS.sub, color: C.faint, padding: '18px 0', textAlign: 'center', lineHeight: 1.6 }}>
            {tab === 'recent' ? '아직 본 상품이 없습니다.' : '관심 상품이 없습니다.'}
            <br />
            {tab === 'recent' ? '상품찾기에서 상세를 열면 여기에 쌓입니다.' : '상품 상세의 별표(☆)로 담을 수 있습니다.'}
          </div>
        ) : (
          /* 모바일 = 라인 목록(카드가 스스로 hairline) · 웹 = 카드 사이만 벌린다. */
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: mobile ? 0 : 8 }}>
            {items.map((s) => (
              <InterestSummaryCard key={s.code} live={stockedByCode.get(s.code)} snap={s} tab={tab} />
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
