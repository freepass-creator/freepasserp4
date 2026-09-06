'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName } from '@/lib/domain/product';
import { ProductDetail } from '@/components/ProductDetail';
import { C, Loading, CenterNote, Btn, Message, FW, FS, ICON, SH } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { Phone } from 'lucide-react';
import { GUEST_W } from '@/lib/guest-layout';
import { WhitelabelFrame } from '@/components/WhitelabelFrame';
import { FREEPASS, type Whitelabel } from '@/lib/whitelabel';

/**
 * 손님 대면 **상품 안내**(화이트라벨).
 * ★이름(사장님 2026-08-20): 「견적」이 아니라 「상품 안내」다 — 이 화면은 12~60개월 요율표를 통째로
 *   보여 주고 손님이 고르는 안내지, 손님 조건을 확정해 «당신은 월 얼마»를 적는 견적서가 아니다.
 *   경로(`/q`)와 API 이름은 그대로 둔다 — 이미 손님에게 나간 링크가 깨진다.
 * Phase2: 사진·요금·조건 손롤 삭제 → ProductDetail(audience=customer).
 * 이 페이지는 귀속(?a=)·상담 CTA·화이트라벨 크롬만 담당.
 *
 * ★데이터는 **서버 API**(`/api/catalog/quote`)에서 받는다. 예전엔 브라우저가 RTDB 를 직접
 *   읽었는데, 규칙이 인증을 요구해서 **비로그인 손님에게는 401 → 항상 빈 화면**이었다
 *   (2026-07-30 QA 「영업 공유 퍼널 전면 불능」 · 2026-08-08 재확인).
 *   규칙을 열면 원가·수수료·회원까지 새므로, 서버가 서비스계정으로 읽고 화이트리스트만 준다.
 */

export function QuoteView({ wl = FREEPASS }: { wl?: Whitelabel }) {
  const { code } = useParams<{ code: string }>();
  const key = decodeURIComponent(String(code));
  const [p, setP] = useState<EntityRecord | null | undefined>(undefined);
  const [agent, setAgent] = useState<EntityRecord | null>(null);

  useEffect(() => { (async () => {
    const a = typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('a') || localStorage.getItem('fp4_attr'))
      : null;
    if (a && typeof window !== 'undefined') localStorage.setItem('fp4_attr', a);
    try {
      const q = new URLSearchParams({ code: key });
      if (a) q.set('a', a);
      const res = await fetch(`/api/catalog/quote?${q}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({})) as { product?: EntityRecord; agent?: EntityRecord | null };
      setP(res.ok && body.product ? body.product : null);
      setAgent(body.agent || null);
    } catch {
      setP(null);
    }
  })(); /* eslint-disable-next-line */ }, [key]);

  useEffect(() => { if (p) document.title = `${vehicleName(p)} · 상품 안내`; }, [p]);

  if (p === undefined) return <Loading />;
  // 판매 가능 여부는 서버가 이미 판정했다(만료·출고불가면 404). 여기서 다시 걸지 않는다.
  if (!p) return <CenterNote>현재 안내 가능한 상품이 아닙니다.</CenterNote>;

  const agentName = agent ? String(agent.name || '') : '';
  const phone = agent
    ? String(agent.phone || agent.mobile || agent.tel || agent.contact || '').replace(/\s/g, '')
    : '';
  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : '';

  /**
   * ★안내 블록과 폰 하단독은 **끈다.**
   *   안내는 목록에서 이미 봤고(같은 말을 두 번 하지 않는다), 하단독은 이 화면이 제 것을 가졌다
   *   — 켜 두면 독이 둘로 겹친다.
   */
  return (
    <WhitelabelFrame wl={wl} agentName={agentName} agentPhone={phone} notice={false} dock={false}>
    <div style={{
      display: 'flex', justifyContent: 'center',
      // 하단바가 마지막 줄을 덮지 않게 바 높이만큼 비운다(바가 없으면 평소 여백).
      padding: telHref ? '18px 18px calc(var(--fp-bar-h) + var(--fp-dock-safe, env(safe-area-inset-bottom)) + 18px)' : '18px 18px 28px',
    }}>
    <main style={{ flex: '1 1 auto', minWidth: 0, maxWidth: GUEST_W }}>
      <div style={{ fontSize: FS.sub, color: C.mute, letterSpacing: '0.04em', marginBottom: 10 }}>상품 안내</div>
      <ProductDetail p={p} audience="customer" />
      {/* 담당자·전화는 하단바가 늘 들고 있다 — 본문에 같은 말을 또 적지 않는다. */}
          {!telHref ? (
          <Message variant="info">
            <div style={{ fontWeight: FW.title }}>상담 문의</div>
            <div>
              {agentName ? `담당 영업자 ${agentName}에게 연락 주세요.` : '담당 영업자에게 연락 주세요.'}
            </div>
          </Message>
          ) : null}
      <Message variant="info">본 안내는 참고용이며 심사·재고에 따라 변동될 수 있습니다.</Message>
    </main>
    </div>

    {/*
      손님 하단바 — **담당자에게 바로 전화**(사장님 2026-08-20).
      ERP 하단독과 **같은 규격**을 쓴다: 높이 `--fp-bar-h` · 세로 패딩 `--fp-bar-pad-y` · 같은 껍데기(윗선·그림자·안전영역).
      숫자를 손으로 찍으면 ERP 바가 바뀔 때 이 바만 어긋난다.
      안쪽은 본문 칼럼(GUEST_W)과 같은 폭·같은 좌우 여백이라 **담당자 이름이 본문 왼쪽 선에 맞는다**.
    */}
    {telHref ? (
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
        background: C.taupeBg, borderTop: `1px solid ${C.line}`, boxShadow: SH.dock,
        paddingBottom: 'var(--fp-dock-safe, env(safe-area-inset-bottom))',
      }}>
        <div style={{
          maxWidth: GUEST_W, margin: '0 auto', boxSizing: 'border-box',
          height: 'var(--fp-bar-h)', padding: '0 18px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.2 }}>담당 영업자</div>
            <div style={{
              fontSize: FS.body, fontWeight: FW.title, lineHeight: 1.3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {agentName || '상담 담당자'}{phone ? ` · ${phone}` : ''}
            </div>
          </div>
          <Btn href={telHref} onClick={() => haptic.nav()} title="담당 영업자에게 전화합니다">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Phone size={ICON.md} aria-hidden />전화 상담
            </span>
          </Btn>
        </div>
      </div>
    ) : null}
    </WhitelabelFrame>
  );
}
