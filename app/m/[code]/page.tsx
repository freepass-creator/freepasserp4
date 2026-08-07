'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getStore, peekCached } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { isOfferableProduct, vehicleName } from '@/lib/domain/product';
import { MessageCircle, Share2 } from 'lucide-react';
import { Btn, BottomNav, Loading, CenterNote, C, R, ICON } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { ProductDetail } from '@/components/ProductDetail';
import { ProductWorkBar } from '@/components/ProductWorkBar';
import { SimpleInquiry } from '@/components/SimpleInquiry';
import { ReportButton } from '@/components/ReportButton';
import { actor, getRole, ensureRoom } from '@/lib/domain/deal';
import { ContractPanel } from '@/components/ContractPanel';
import { ChatThread } from '@/components/ChatThread';
import { guestShareUrl } from '@/lib/domain/product-share';
import { touchRecent } from '@/lib/product-interest';
import { useAuthReady } from '@/lib/auth-context';
import { FINDER_RESET_LIMIT } from '@/lib/finder-session';
import { useAppBar } from '@/lib/appbar';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON } from '@/lib/tabbar';
import { copyText } from '@/lib/clipboard';
import { useIsMobile } from '@/lib/use-mobile';

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

  const detailName = p && isOfferableProduct(p)
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

  useEffect(() => { if (p && isOfferableProduct(p)) touchRecent(p); }, [p]);

  // ★훅은 early return 위에 있어야 한다 — 아래에 두면 p 가 undefined→정의 로 바뀔 때
  //   렌더마다 훅 개수가 달라져 「Rendered fewer hooks than expected」로 터진다.
  const mobile = useIsMobile();
  const [roomId, setRoomId] = useState<string>('');
  const role = getRole();
  const canDeal = role === 'agent' || role === 'admin';
  /** 영업자·관리자의 «일하는 화면» 3열 배열. 모바일은 세로로 쌓으므로 여기 해당 없음. */
  const workWeb = canDeal && !mobile;
  // 대화를 이 화면에서 편다 — 방은 영업자·관리자일 때만, 매물당 한 번 보장한다.
  useEffect(() => {
    if (!p || !isOfferableProduct(p) || !canDeal) return;
    let alive = true;
    void ensureRoom(p, actor(role))
      .then((key) => { if (alive) setRoomId(key); })
      .catch(() => { /* 방 보장 실패는 화면을 막지 않는다 — 하단 계약문의로 우회 가능 */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?._key, canDeal, role]);

  if (!authReady || p === undefined) return <Loading />;
  if (!p || !isOfferableProduct(p)) {
    return (
      <CenterNote>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div>{p ? '현재 판매 가능한 상품이 아닙니다.' : '매물을 찾을 수 없습니다.'}</div>
          <Btn variant="ghost" size="sm" onClick={() => router.push('/')}>매물 찾기로</Btn>
        </div>
      </CenterNote>
    );
  }

  const sendLink = () => {
    const a = actor(role);
    const url = guestShareUrl(p, a.code || a.uid);
    if (navigator.share) { navigator.share({ title: vehicleName(p), url }).catch(() => {}); return; }
    void copyText(url).then((copied) => copied ? toast('손님용 매물 링크 복사됨', 'ok') : prompt('링크', url));
  };
  // 계약문의 = 현재 사용자 방 보장(영업자=자기 딜방 / 관리자=관리자↔공급사방) 후 /chat. 간단문의와 같은 방으로 이어짐. 진행·계약요청은 거기서(ContractPanel 5단계).
  const inquire = async () => {
    try {
      const keyRoom = await ensureRoom(p, actor(role));
      router.push(`/chat?room=${encodeURIComponent(keyRoom)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '계약문의 실패', 'error');
    }
  };
  return (
    <>
      {/*
        ────────────────────────────────────────────────────────────────
        영업자 작업화면(2026-08-07 사장님과 합의) — 넷만 본다: ①상품확인 ②문의대화 ③파일첨부 ④계약진행상황.
        다섯 항목 전부 반영 완료:
          1 상단 요약바 고정(ProductWorkBar)      2 좌측을 가격→칩→스펙→사진(썸네일) 순으로
          3 계약은 «지금 단계»만(stepView=focus)  4 첨부 모아보기(ChatThread 📎 파일 줄)
          5 3열 1 : 1.4 : 0.9

        상세 배경은 docs/ROLE_NAVIGATION.md.
        ────────────────────────────────────────────────────────────────
      */}
      {/*
        영업자·관리자에게는 **일하는 화면**이다.
        이 상세는 원래 손님에게 보여줄 브로슈어(공개 견적 /q 와 같은 얼굴)인데 그걸 영업자에게도
        그대로 쓰게 해서, 좌우가 비고 대화·계약하러 다른 화면으로 나가야 했다(2026-08-07 결정).
        폭을 넓혀 두 칸으로 가르고 오른쪽에 «문의»와 «계약 진행상황»을 붙여 여기서 끝나게 한다.
        공급사·손님은 지금 그대로 한 칸 브로슈어다 — 그들에겐 그게 맞는 문법이다.
      */}
      <main style={{
        flex: 1, width: '100%', maxWidth: workWeb ? 'none' : 920, margin: '0 auto',
        padding: '14px 16px calc(76px + env(safe-area-inset-bottom))', boxSizing: 'border-box',
        ...(workWeb ? {
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100dvh - var(--topbar-h) - var(--fp-bar-h))',
          overflow: 'hidden',
        } : null),
      }}>
        {/* 요약바 = 스크롤해도 «어느 차인가»가 남는 유일한 줄. 3열 전체 위에 걸친다. */}
        {canDeal ? <ProductWorkBar p={p} /> : null}
        <div style={{
          minWidth: 0,
          ...(workWeb ? {
            display: 'grid',
            // 대화가 가장 오래 머무는 칸이라 제일 넓다. 계약은 «지금 단계» 하나만 보여 좁아도 산다.
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 0.9fr)',
            gridTemplateRows: '1fr', // 행이 내용 높이로 줄면 칸별 스크롤(height:100%)이 무너진다
            gap: 20,
            flex: 1,
            minHeight: 0,
          } : null),
        }}>
          {/* 상품상세는 길다 — 페이지를 통째로 굴리지 않고 이 칸만 상하로 스크롤한다. */}
          <div style={{ minWidth: 0, ...(workWeb ? { overflowY: 'auto', height: '100%', paddingRight: 6 } : null) }}>
            <ProductDetail p={p} layout={canDeal ? 'work' : 'brochure'} />
            {/* 검수요청 = 매물 정보 쪽 맨 아래. 정보에 대한 이의제기라 정보 칸에 붙는다. */}
            <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${C.line}`, width: '100%' }}>
              <ReportButton p={p} />
            </div>
          </div>
          {/* 가운데 = 대화. 첨부도 여기 있다. 방이 없으면 문의 입구를 대신 보여준다. */}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, ...(workWeb ? { height: '100%', overflow: 'hidden' } : null) }}>
            {canDeal && roomId ? (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', ...(mobile ? { height: '55dvh' } : { flex: 1, minHeight: 0 }), display: 'flex', flexDirection: 'column' }}>
                <ChatThread roomId={roomId} title={vehicleName(p) || String(p.car_number || '')} />
              </div>
            ) : <SimpleInquiry p={p} />}
          </div>
          {/* 오른쪽 = 계약 진행상황. 문의하러 나가지 않고 여기서 확인하고 진행한다.
              영업자는 «지금 단계»만(focus) — 관리자는 5단계 그대로 본다(감독 시야). */}
          {canDeal ? (
            <div style={{ minWidth: 0, ...(mobile ? null : { height: '100%', overflowY: 'auto', paddingRight: 6 }) }}>
              <ContractPanel product={p} roomId={roomId || undefined} stepView="focus" />
            </div>
          ) : null}
        </div>
      </main>
      {/* 하단독 = [이전] + 액션 — 전 화면 공통 규격. 액션 권한(canDeal)과 무관하게 항상 노출해야
          공급사도 이전 수단이 있다(예전엔 canDeal일 때만 렌더돼 공급사는 하단바 자체가 없었음).
          이전도 라벨 표기 — 다른 상세의 「목록」과 동일한 어포던스. */}
      <BottomNav maxWidth={canDeal ? 100000 : 920} padX={16} backShowLabel actions={canDeal ? <>
        <Btn title="공유" variant="ghost" size="sm" onClick={sendLink}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Share2 size={ICON.md} aria-hidden />
            공유
          </span>
        </Btn>
        <Btn title="계약문의" size="sm" onClick={inquire}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <MessageCircle size={ICON.md} aria-hidden />
            계약문의
          </span>
        </Btn>
      </> : undefined} />
    </>
  );
}
