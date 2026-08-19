'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getStore, peekCached } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { isOfferableProduct, isStockedProduct, vehicleName } from '@/lib/domain/product';
import { Copy, Share2 } from 'lucide-react';
import { Btn, BottomNav, Loading, CenterNote, C, FS, ICON, R } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { ProductDetail, ProductPhotoDownloadButton } from '@/components/ProductDetail';
import { SimpleInquiry } from '@/components/SimpleInquiry';
import { ReportButton } from '@/components/ReportButton';
import { ProductAssistPanel, useAssistColumn, ASSIST_GAP } from '@/components/ProductAssistPanel';
import { CustomerPreviewButton } from '@/components/CustomerPreviewModal';
import { actor, getRole } from '@/lib/domain/deal';
import { formatProductForCopy, guestShareUrl } from '@/lib/domain/product-share';
import { touchRecent } from '@/lib/product-interest';
import { useAuthReady } from '@/lib/auth-context';
import { useIsMobile } from '@/lib/use-mobile';
import { FINDER_RESET_LIMIT } from '@/lib/finder-session';
import { useAppBar } from '@/lib/appbar';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON } from '@/lib/tabbar';
import { copyText } from '@/lib/clipboard';
import { useContentColumn } from '@/lib/content-column';
import { fetchSheetLiveStatuses, SHEET_LIVE_STATUS_POLL_MS } from '@/lib/firebase/sheet-live-status-client';

// 매물 상세(전체화면) = ProductDetail 원자 + 하단 액션바(이전·소통·손님공유·계약).
export default function Detail() {
  const { code } = useParams<{ code: string }>();
  const co = getCompanyId();
  const router = useRouter();
  const authReady = useAuthReady();
  const key = decodeURIComponent(String(code));
  // 홈 list 캐시 있으면 Loading 없이 즉시 페인팅(백그라운드 get으로 재확인).
  const [p, setP] = useState<EntityRecord | null | undefined>(() => peekCached('product', co, key) ?? undefined);

  // 홈 복귀 시 더보기/전체보기만 리셋하라고 표시(필터는 session 유지)
  useEffect(() => {
    try { sessionStorage.setItem(FINDER_RESET_LIMIT, '1'); } catch { /* */ }
  }, []);

  // 상세 진입 = 맨 위(간단문의 scrollIntoView 잔상·이전 스크롤 방어)
  useEffect(() => {
    const el = document.querySelector('.fp-main-pad') as HTMLElement | null;
    if (el) el.scrollTop = 0;
  }, [key]);

  // ★훅은 early return 위에 — 아래에 두면 p 가 undefined→정의 로 바뀔 때 훅 개수가 달라져 터진다.
  const wideAssistColumn = useAssistColumn();
  const mobile = useIsMobile();
  const colRef = useContentColumn<HTMLElement>();
  const detailName = p && isStockedProduct(p)
    ? (vehicleName(p) || String(p.car_number || '상품'))
    : null;
  useAppBar(
    {
      title: (
        <PageStatus
          icon={NAV_ICON.product}
          label="상품상세"
          secondaryLabel={detailName || undefined}
        />
      ),
    },
    [detailName],
  );

  useEffect(() => {
    // 인증 부팅 전 getStore()가 Local로 떨어지면 RTDB 매물키가 없어서 null → "찾을 수 없음" 깜빡임.
    if (!authReady) return;
    let alive = true;
    (async () => {
      await seedIfEmpty(co);
      const store = getStore();
      let found = await store.get('product', co, key);
      if (!found) {
        // 키 인코딩·idFrom 어긋남 대비 — list에서 product_code/_key로 재탐색.
        const all = await store.list('product', co);
        found = all.find((r) => String(r._key) === key || String(r.product_code) === key) || null;
      }
      if (!alive) return;
      // get 실패해도 캐시(peek)가 있으면 유지 — 일시 권한/네트워크로 빈 화면 덮지 않음.
      setP((prev) => found ?? prev ?? null);
    })();
    return () => { alive = false; };
  }, [key, co, authReady]);

  // 상세를 오래 열어 둬도 상품마스터의 상태를 놓치지 않는다. 제원·가격은 현재
  // 상세 스냅샷을 유지하고 vehicle_status 한 원자만 교체한다.
  useEffect(() => {
    if (!authReady) return;
    let alive = true;
    let refreshing = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (!alive || refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        const statuses = await fetchSheetLiveStatuses(controller.signal);
        if (!alive || !statuses) return;
        setP((current) => {
          if (!current) return current;
          const statusKey = String(current._key || current.product_code || key);
          if (!Object.prototype.hasOwnProperty.call(statuses, statusKey)) return current;
          const status = String(statuses[statusKey] || '').trim();
          return String(current.vehicle_status || '').trim() !== status
            ? { ...current, vehicle_status: status }
            : current;
        });
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          console.warn('[detail] 차량상태 실시간 갱신 실패(기존 상태 유지):', (error as Error).message);
        }
      } finally {
        refreshing = false;
      }
    };
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, SHEET_LIVE_STATUS_POLL_MS);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authReady, key]);

  useEffect(() => { if (p && isStockedProduct(p)) touchRecent(p); }, [p]);

  if (!authReady || p === undefined) return <Loading />;
  if (!p || !isStockedProduct(p)) {
    return (
      <CenterNote>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div>{p ? '현재 판매 가능한 상품이 아닙니다.' : '매물을 찾을 수 없습니다.'}</div>
          <Btn variant="ghost" size="sm" onClick={() => router.push('/')}>매물 찾기로</Btn>
        </div>
      </CenterNote>
    );
  }

  const role = getRole();
  const offerable = isOfferableProduct(p);
  const canDeal = role === 'agent' || role === 'admin';
  /** 내부 역할의 계약·문의 보조 칼럼. 가격은 역할·폭과 무관하게 본문에만 둔다. */
  const canUseAssist = role === 'agent' || role === 'admin' || role === 'provider';
  const assistShown = wideAssistColumn && canUseAssist;
  const sendLink = () => {
    const a = actor(role);
    const url = guestShareUrl(p, a.code || a.uid);
    if (navigator.share) { navigator.share({ title: vehicleName(p), url }).catch(() => {}); return; }
    void copyText(url).then((copied) => copied ? toast('손님용 매물 링크 복사됨', 'ok') : prompt('링크', url));
  };
  const copyProductText = () => {
    void copyText(formatProductForCopy(p)).then((copied) => {
      toast(copied ? '상품 텍스트가 복사되었습니다' : '상품 텍스트를 복사하지 못했습니다', copied ? 'ok' : 'error');
    });
  };
  const dockActions = canDeal ? (
    <>
      <ReportButton p={p} />
      <ProductPhotoDownloadButton p={p} />
      {offerable ? (
        <>
          <Btn title="손님 전달" variant="ghost" size="sm" mobileIcon={<Share2 size={ICON.lg} aria-hidden />} onClick={sendLink}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Share2 size={ICON.md} aria-hidden />
              손님 전달
            </span>
          </Btn>
          <Btn title="텍스트 복사" variant="ghost" size="sm" mobileIcon={<Copy size={ICON.lg} aria-hidden />} onClick={copyProductText}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Copy size={ICON.md} aria-hidden />
              텍스트 복사
            </span>
          </Btn>
          {/* 손님 화면 미리보기(웹) — 손님이 링크를 열면 보게 될 /q 를 폰 프레임으로(샘플 반영 2026-08-18) */}
          {!mobile && <CustomerPreviewButton p={p} />}
        </>
      ) : null}
    </>
  ) : undefined;

  return (
    <>
      {/* 본문(브로슈어) + 보조 spacer. 보조 실패널은 fixed(뷰포트 고정) — 매물정보가 스크롤돼도 안 움직임.
          좁으면 칼럼이 사라지고 하단독 「계약문의」 → /chat 동선 그대로다. */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: ASSIST_GAP, width: '100%', padding: '14px 16px 0', boxSizing: 'border-box' }}>
        {/* minWidth:0 — 없으면 본문이 안 줄어들어 보조 칼럼이 화면 밖으로 밀린다(flex 기본 min-content). */}
        {/* 본문 칼럼의 위치를 크롬에 알린다 — 상단 햄버거가 이 왼쪽 선을 따라온다. */}
        <main ref={colRef} style={{
          flex: '1 1 auto', minWidth: 0, width: '100%', maxWidth: 920, boxSizing: 'border-box',
          // 보조 칼럼이 서면 액션은 이 칼럼 안에서 따라다닌다 → 화면 고정독 자리를 비워 둘 필요가 없다.
          padding: assistShown ? 0 : '0 0 calc(76px + env(safe-area-inset-bottom))',
        }}>
          {!offerable ? (
            <div role="status" style={{ marginBottom: 12, padding: '11px 14px', border: `1px solid ${C.warn}`, borderRadius: R, color: C.warn, background: C.warnBg, fontSize: FS.sub }}>
              대여료 미입력 상품입니다. 재고·차량 정보는 확인할 수 있지만 공유·견적·계약은 요금 입력 후 가능합니다.
            </div>
          ) : null}
          <ProductDetail p={p} />
          {/* 간단문의는 **딜을 진행하지 않는 사람**(손님·공급사)에게만. 영업자·관리자에게는
              아래에 진짜 계약진행·대화가 붙으므로 간이 입구가 남으면 문의가 두 곳으로 갈린다. */}
          {canUseAssist ? null : <SimpleInquiry p={p} />}
          {/* 이전·공유·계약문의는 **상세를 따라다닌다** — 화면 한가운데 고정독으로 두면
              옆에 보조 칼럼이 선 만큼 본문이 왼쪽으로 밀려 «상세 밑»이 아니게 된다(2026-08-08 지적).
              sticky bottom = 스크롤 중엔 화면 아래에 붙고, 상세 끝에 오면 거기서 멈춘다. */}
          {/* 좁은 화면: 상세 끝나는 자리에 계약진행 → 대화 순으로 쌓는다. */}
          {!assistShown && canUseAssist ? <ProductAssistPanel product={p} role={role} /> : null}
          {assistShown ? <BottomNav sticky maxWidth={920} padX={16} backShowLabel actions={dockActions} /> : null}
        </main>
        {/* 우측은 계약·대화 동선만 담당한다. 상품 정보와 가격은 본문에 세로로 이어진다. */}
        {assistShown && <ProductAssistPanel product={p} role={role} />}
      </div>
      {/* 보조 칼럼이 없을 때(모바일·좁은 웹·손님·공급사)는 전 화면 공통 규격인 고정독 그대로.
          액션 권한(canDeal)과 무관하게 항상 노출해야 공급사도 이전 수단이 있다. */}
      {assistShown ? null : (
        <BottomNav maxWidth={920} padX={16} backShowLabel actions={dockActions} />
      )}
    </>
  );
}
