'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getStore, peekCached } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { isOfferableProduct, vehicleName } from '@/lib/domain/product';
import { MessageCircle, Share2 } from 'lucide-react';
import { Btn, BottomNav, Loading, CenterNote, C, ICON } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { ProductDetail } from '@/components/ProductDetail';
import { SimpleInquiry } from '@/components/SimpleInquiry';
import { ReportButton } from '@/components/ReportButton';
import { ProductAssistPanel, useAssistColumn } from '@/components/ProductAssistPanel';
import { actor, getRole, ensureRoom } from '@/lib/domain/deal';
import { guestShareUrl } from '@/lib/domain/product-share';
import { touchRecent } from '@/lib/product-interest';
import { useAuthReady } from '@/lib/auth-context';
import { FINDER_RESET_LIMIT } from '@/lib/finder-session';
import { useAppBar } from '@/lib/appbar';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON } from '@/lib/tabbar';
import { copyText } from '@/lib/clipboard';
import { useContentColumn } from '@/lib/content-column';

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
  const assistColumn = useAssistColumn();
  const colRef = useContentColumn<HTMLElement>();
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

  const role = getRole();
  const canDeal = role === 'agent' || role === 'admin';
  /** 보조 칼럼이 실제로 그려지는가 — 가격표 자리·하단독 위치가 여기 달렸다(역할 무관). */
  const assistShown = assistColumn;
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
  const dockActions = canDeal ? (
    <>
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
    </>
  ) : undefined;

  return (
    <>
      {/* 본문(브로슈어) + 보조 칼럼. 보조는 폭이 남을 때만 그려지고(ASSIST_BP) 본문 920 을 뺏지 않는다.
          좁으면 칼럼이 사라지고 하단독 「계약문의」 → /chat 동선 그대로다. */}
      {/* 상단 14 = 보조 sticky top 과 동일 — 본문·보조 윗선이 브라우저 높이와 같이 맞춰진다. */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 16, width: '100%', padding: '14px 16px 0', boxSizing: 'border-box' }}>
        {/* minWidth:0 — 없으면 본문이 안 줄어들어 보조 칼럼이 화면 밖으로 밀린다(flex 기본 min-content). */}
        {/* 본문 칼럼의 위치를 크롬에 알린다 — 상단 햄버거가 이 왼쪽 선을 따라온다. */}
        <main ref={colRef} style={{
          flex: '1 1 auto', minWidth: 0, width: '100%', maxWidth: 920, boxSizing: 'border-box',
          // 보조 칼럼이 서면 액션은 이 칼럼 안에서 따라다닌다 → 화면 고정독 자리를 비워 둘 필요가 없다.
          padding: assistShown ? 0 : '0 0 calc(76px + env(safe-area-inset-bottom))',
        }}>
          {/* 보조패널이 서면 가격표는 거기(맨 위)로 간다 — 본문은 차 설명만. */}
          <ProductDetail p={p} priceAside={assistShown} />
          <SimpleInquiry p={p} />
          {/* 검수요청 = 페이지 맨 하단. 본문과 같은 가로폭. */}
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${C.line}`, width: '100%' }}>
            <ReportButton p={p} />
          </div>
          {/* 이전·공유·계약문의는 **상세를 따라다닌다** — 화면 한가운데 고정독으로 두면
              옆에 보조 칼럼이 선 만큼 본문이 왼쪽으로 밀려 «상세 밑»이 아니게 된다(2026-08-08 지적).
              sticky bottom = 스크롤 중엔 화면 아래에 붙고, 상세 끝에 오면 거기서 멈춘다. */}
          {assistShown ? <BottomNav sticky maxWidth={920} padX={16} backShowLabel actions={dockActions} /> : null}
        </main>
        {/* 대여료 패널은 **역할과 무관하게** 뜬다 — 손님·공급사도 같은 자리에서 금액을 본다.
            그 밑의 계약·대화만 역할별로 붙는다(2026-08-08 결정). */}
        {assistColumn && <ProductAssistPanel product={p} role={role} />}
      </div>
      {/* 보조 칼럼이 없을 때(모바일·좁은 웹·손님·공급사)는 전 화면 공통 규격인 고정독 그대로.
          액션 권한(canDeal)과 무관하게 항상 노출해야 공급사도 이전 수단이 있다. */}
      {assistShown ? null : (
        <BottomNav maxWidth={920} padX={16} backShowLabel actions={dockActions} />
      )}
    </>
  );
}
