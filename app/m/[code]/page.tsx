'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getStore, peekCached } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName } from '@/lib/domain/product';
import { Btn, BottomNav, Loading, CenterNote, C } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { ProductDetail } from '@/components/ProductDetail';
import { SimpleInquiry } from '@/components/SimpleInquiry';
import { ReportButton } from '@/components/ReportButton';
import { actor, getRole, ensureRoom } from '@/lib/domain/deal';
import { touchRecent } from '@/lib/product-interest';
import { useAuthReady } from '@/lib/auth-context';
import { FINDER_RESET_LIMIT } from '@/lib/finder-session';
import { useAppBar } from '@/lib/appbar';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON } from '@/lib/tabbar';

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

  const detailName = p
    ? (vehicleName(p) || String(p.car_number || p.product_code || '매물'))
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

  useEffect(() => { if (p) touchRecent(p); }, [p]);

  if (!authReady || p === undefined) return <Loading />;
  if (!p) {
    return (
      <CenterNote>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div>매물을 찾을 수 없습니다.</div>
          <Btn variant="ghost" size="sm" onClick={() => router.push('/')}>매물 찾기로</Btn>
        </div>
      </CenterNote>
    );
  }

  const sendLink = () => {
    const url = `${location.origin}/q/${encodeURIComponent(String(p.product_code))}?a=${encodeURIComponent(actor(getRole()).code)}`;
    if (navigator.share) { navigator.share({ title: vehicleName(p), url }).catch(() => {}); return; }
    navigator.clipboard?.writeText(url).then(() => toast('손님용 매물 링크 복사됨', 'ok'), () => prompt('링크', url));
  };
  // 계약문의 = 현재 사용자 방 보장(영업자=자기 딜방 / 관리자=관리자↔공급사방) 후 /chat. 간단문의와 같은 방으로 이어짐. 진행·계약요청은 거기서(ContractPanel 5단계).
  const inquire = async () => { const keyRoom = await ensureRoom(p, actor(getRole())); router.push(`/chat?room=${encodeURIComponent(keyRoom)}`); };
  return (
    <>
      <main style={{ flex: 1, width: '100%', maxWidth: 920, margin: '0 auto', padding: '14px 16px calc(76px + env(safe-area-inset-bottom))', boxSizing: 'border-box' }}>
        <ProductDetail p={p} />
        <SimpleInquiry p={p} />
        {/* 검수요청 = 페이지 맨 하단. 본문과 같은 가로폭. */}
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${C.line}`, width: '100%' }}>
          <ReportButton p={p} />
        </div>
      </main>
      <BottomNav maxWidth={920} padX={16} actions={<>
        <Btn variant="ghost" size="sm" onClick={sendLink}>손님공유</Btn>
        <Btn size="sm" onClick={inquire}>계약문의</Btn>
      </>} />
    </>
  );
}
