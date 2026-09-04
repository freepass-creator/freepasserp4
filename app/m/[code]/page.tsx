'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { getStore, peekCached } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { isOfferableProduct, isStockedProduct, vehicleName } from '@/lib/domain/product';
import { Btn, BottomNav, Loading, CenterNote, Message } from '@/components/ui';
import { ProductDetail } from '@/components/ProductDetail';
import { SimpleInquiry } from '@/components/SimpleInquiry';
import { ReportButton } from '@/components/ReportButton';
import { useAgentColumn, AGENT_COL_GAP } from '@/components/product-agent-layout';
import { getRole } from '@/lib/domain/deal';
import { touchRecent } from '@/lib/product-interest';
import { useAuthReady } from '@/lib/auth-context';
import { useIsMobile } from '@/lib/use-mobile';
import { FINDER_RESET_LIMIT } from '@/lib/finder-session';
import { useAppBar } from '@/lib/appbar';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON } from '@/lib/tabbar';
import { useContentColumn } from '@/lib/content-column';
import { fetchSheetLiveStatuses, SHEET_LIVE_STATUS_POLL_MS } from '@/lib/firebase/sheet-live-status-client';

// 가격/전달/사진 보조 패널은 상품 본문보다 늦게 떠도 된다. 상세 첫 페인트에서는
// 가벼운 layout hook만 쓰고, 실제 영업 보조 UI는 역할·폭이 필요한 시점에 불러온다.
const ProductAgentPanel = dynamic(() => import('@/components/ProductAgentPanel').then((m) => m.ProductAgentPanel), {
  ssr: false,
  loading: () => <Loading label="영업 도구를 여는 중…" />,
});
const ProductAgentShareActions = dynamic(() => import('@/components/ProductAgentPanel').then((m) => m.ProductAgentShareActions), { ssr: false });
const ProductAgentColumn = dynamic(() => import('@/components/ProductAgentPanel').then((m) => m.ProductAgentColumn), {
  ssr: false,
  loading: () => <Loading label="영업 도구를 여는 중…" />,
});

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
  const wideAgentColumn = useAgentColumn();
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
          /* 모바일 상단바엔 차명 안 붙인다 — 바로 밑 상세 머리·모델명 칸에 다 있다(사장님 2026-08-22 「상단바에는 상품모델명 빼도 돼」). */
          secondaryLabel={!mobile ? detailName || undefined : undefined}
        />
      ),
    },
    [detailName, mobile],
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
  const assistShown = wideAgentColumn && canUseAssist;
  /**
   * 하단독 = 이전 + **링크 공유 하나**(좁은 화면) / 이전 + 검수 요청(넓은 화면 — 공유는 칼럼이 든다)
   *   — 사장님 2026-08-22
   * 「텍스트복사 빼자, 링크 공유하기 버튼만 · 바로 공유할 수 있게끔 · 웹도 링크 공유로」.
   * 누르면 바로 OS 공유시트(카톡·문자), 없으면 링크 복사(ProductAgentShareActions).
   */
  /**
   * ★감싸개는 `display:contents` — 자기는 상자를 만들지 않고 자식을 독의 «직계»로 내보낸다.
   *   독의 폭 규칙(`.fp-action-dock__actions > .fp-press[...]`)은 «직계»에만 걸리는데,
   *   전에는 이 span 이 사이에 끼어 있어 공유 버튼이 그 규칙을 못 받고 제 글자폭만 차지했다.
   *   그래서 「꽉 채우기」가 안 먹었다(2026-08-30).
   */
  const dockActions = canUseAssist ? (
    <span style={{ display: 'contents' }}>
      {/* ★공유는 «한 화면에 하나»다(사장님 2026-09-04 「링크 공유하기는 중복이잖아」).
          넓은 화면에서는 우측 칼럼 **바닥 고정줄**이 그걸 든다(ProductAgentColumn) —
          거기 있는 이유는 「스크롤과 상관없이 늘 손에 닿아야」이고(2026-08-20), 하단독이 또 들면
          같은 버튼이 나란히 둘로 선다. 좁은 화면은 칼럼이 없으니 독이 든다. */}
      {!assistShown ? <ProductAgentShareActions p={p} /> : null}
      {/* 검수 요청은 넓은 화면 독에만 — 모바일은 뺀다(사장님 2026-08-22 「요청보내기 버튼 없애 주고」). */}
      {canDeal && assistShown ? <ReportButton p={p} /> : null}
    </span>
  ) : undefined;

  return (
    <>
      {/* 본문(브로슈어) + 보조 spacer. 보조 실패널은 fixed(뷰포트 고정) — 매물정보가 스크롤돼도 안 움직임.
          좁으면 칼럼이 사라지고 하단독 「계약문의」 → /chat 동선 그대로다. */}
      {/* 여백 공통규격(사장님 2026-08-22 「상하좌우 여백 다 맞춰야 하고 섹션칸끼리 공통규격」):
          모바일 좌우 12 = 상단바·검색줄·목록·하단독 한 선 · 상단 12 = 섹션 사이 간격(12)과 같은 리듬. 웹은 16/14 유지. */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: AGENT_COL_GAP, width: '100%', padding: mobile ? '12px 12px 0' : '14px 16px 0', boxSizing: 'border-box' }}>
        {/* minWidth:0 — 없으면 본문이 안 줄어들어 보조 칼럼이 화면 밖으로 밀린다(flex 기본 min-content). */}
        {/* 본문 칼럼의 위치를 크롬에 알린다 — 상단 햄버거가 이 왼쪽 선을 따라온다. */}
        <main ref={colRef} style={{
          flex: '1 1 auto', minWidth: 0, width: '100%', maxWidth: 920, boxSizing: 'border-box',
          /**
           * 하단 여백 — **하단탭바까지 세서** 비운다(사장님 2026-08-20 「하단탭바 있으니까」).
           *  예전 값 `76px + env(safe-area)` 는 ①탭바 높이를 아예 안 셌고 ②탭바가 뜨면 AppTabBar 가
           *  `--fp-dock-safe:0` 으로 바꾸는데도 safe-area 를 한 번 더 더해 이중으로 셌다.
           *  높이는 전부 CSS 변수가 알고 있다 — 숫자를 손으로 찍지 않는다.
           *    고정독 = `--fp-bar-h` · 탭바 = `--fp-tabbar-h`(없으면 0) · 안전영역 = `--fp-dock-safe`
           *
           * ⚠ 보조 칼럼이 설 때는 **0**이어야 한다(사장님 「하단탭바는 딱 붙어 있어야지」).
           *   그때 독은 본문 안 `sticky bottom:0` 이라 **이 패딩만큼 그대로 위로 뜬다** —
           *   숨 쉬라고 20px 을 줬더니 바가 브라우저 바닥에서 20px 떠버렸다. 여백은 독 «위»의 문제이지
           *   독 «아래»에 만들 것이 아니다.
           */
          padding: assistShown
            ? 0
            : '0 0 calc(var(--fp-bar-h) + var(--fp-tabbar-h, 0px) + var(--fp-dock-safe, env(safe-area-inset-bottom)) + 20px)',
        }}>
          {!offerable ? (
            <Message variant="warning">
              대여료 미입력 상품입니다. 재고·차량 정보는 확인할 수 있지만 손님 안내·계약은 요금 입력 후 가능합니다.
            </Message>
          ) : null}
          <ProductDetail p={p} />
          {/* 간단문의는 **딜을 진행하지 않는 사람**(손님·공급사)에게만. 영업자·관리자에게는
              아래에 진짜 계약진행·대화가 붙으므로 간이 입구가 남으면 문의가 두 곳으로 갈린다. */}
          {canUseAssist ? null : <SimpleInquiry p={p} />}
          {/* 이전·공유·계약문의는 **상세를 따라다닌다** — 화면 한가운데 고정독으로 두면
              옆에 보조 칼럼이 선 만큼 본문이 왼쪽으로 밀려 «상세 밑»이 아니게 된다(2026-08-08 지적).
              sticky bottom = 스크롤 중엔 화면 아래에 붙고, 상세 끝에 오면 거기서 멈춘다. */}
          {/* 좁은 화면: 상세 끝나는 자리에 계약진행 → 대화 순으로 쌓는다. */}
          {/* 좁은 화면 = 칼럼이 없으니 상세 끝에 그대로 쌓는다. 항목은 웹과 같다(폭만 다르다). */}
          {/* 모바일 패널: 대여료표 없이(본문 대여료 표와 중복) 경계 바+섹션표, 공유는 하단독이 갖는다(pinnedShare — 중복 금지).
              marginTop 12 = 섹션 사이 공통 간격(사장님 2026-08-22 「섹션칸끼리 공통규격」). */}
          {!assistShown && canUseAssist ? <div style={{ marginTop: 12 }}><ProductAgentPanel p={p} pinnedShare /></div> : null}
          {assistShown ? <BottomNav sticky gapTop={14} maxWidth={920} padX={16} backShowLabel actions={dockActions} /> : null}
        </main>
        {/* 우측은 **영업자가 보는 것만**(대여료 목록·영업 정보·전달·사진). 계약·대화는 여기 없다 —
            상담 문의는 아직 운영하지 않는다(사장님 2026-08-20). */}
        {assistShown && <ProductAgentColumn p={p} />}
      </div>
      {/* 보조 칼럼이 없을 때(모바일·좁은 웹·손님·공급사)는 전 화면 공통 규격인 고정독 그대로.
          액션 권한(canDeal)과 무관하게 항상 노출해야 공급사도 이전 수단이 있다. */}
      {assistShown ? null : (
        <BottomNav maxWidth={920} padX={16} backShowLabel actions={dockActions} />
      )}
    </>
  );
}
