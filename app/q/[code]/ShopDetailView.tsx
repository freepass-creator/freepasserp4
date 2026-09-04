'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { EntityRecord } from '@/lib/intake/entities';
import { CenterNote, Loading } from '@/components/ui';
import { WhitelabelFrame } from '@/components/WhitelabelFrame';
import { ShopDetail } from '@/components/shop/ShopDetail';
import type { Whitelabel } from '@/lib/whitelabel';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';

/**
 * 가게 상세의 «데이터 껍데기» — 화면은 `ShopDetail` 이 그린다.
 *
 * ★주소가 `/q/[code]` 그대로인 이유 — **이미 손님에게 나간 링크가 깨진다.** 카톡·문자로 보낸
 *   공유링크는 회수할 수 없다. 그래서 동을 가르면서도 이 주소는 건드리지 않았고, 서버 껍데기
 *   (`page.tsx`)가 «호스트에 브랜드가 있으면 가게 상세, 없으면 예전 상품안내»로 갈라 준다.
 *   화면 «안»의 분기가 아니라 라우팅 단계의 갈림이라 두 화면이 서로를 안 건드린다.
 *
 * ★데이터는 서버 API(`/api/catalog/quote`)에서 받는다. 예전엔 브라우저가 RTDB 를 직접 읽었는데,
 *   규칙이 인증을 요구해 **비로그인 손님에게는 401 → 항상 빈 화면**이었다(2026-07-30 QA).
 *   규칙을 열면 원가·수수료·회원까지 새므로 서버가 서비스계정으로 읽고 화이트리스트만 준다.
 *
 * ★안내 블록과 폰 하단독은 껍데기에서 **끈다.** 안내는 목록에서 이미 봤고(같은 말을 두 번 하지
 *   않는다), 하단독은 이 화면이 제 것을 가졌다 — 켜 두면 독이 둘로 겹친다.
 */
export function ShopDetailView({ wl }: { wl: Whitelabel }) {
  const { code } = useParams<{ code: string }>();
  const key = decodeURIComponent(String(code));
  const [p, setP] = useState<EntityRecord | null | undefined>(undefined);
  const [agent, setAgent] = useState<EntityRecord | null>(null);

  useEffect(() => { (async () => {
    // 담당 귀속(?a=)은 목록에서 기억해 둔 것을 이어 쓴다 — 손님이 목록·상세를 오가도 담당자가 안 바뀐다.
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
    } catch { setP(null); }
  })(); }, [key]);

  useEffect(() => {
    if (!p) return;
    // 서버가 내려준 og 제목이 정본이고, 이건 «브라우저 탭»만 맞춰 주는 것이다.
    document.title = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', fallback: 'plate' }) || wl.name;
  }, [p, wl.name]);

  /*
   * ⚠ 불러오는 중·못 찾은 경우에도 **껍데기 안**에 둔다(2026-09-04 실측 사고).
   *   맨 화면으로 내보냈더니 손님이 팔린 차 링크를 눌렀을 때 브랜드가 통째로 사라지고
   *   업무동 회색 바탕에 글자 한 줄만 남았다 — 「이 회사 사이트가 죽었나」로 보인다.
   *   못 찾은 것은 «흔한 일»이다(선점·출고로 목록에서 빠진다). 흔한 일에 화면이 무너지면 안 된다.
   */
  if (p === undefined) {
    return <WhitelabelFrame wl={wl} notice={false} dock={false}><Loading /></WhitelabelFrame>;
  }
  // 판매 가능 여부는 서버가 이미 판정했다(만료·출고불가면 못 찾는다). 여기서 다시 걸지 않는다.
  if (!p) {
    return (
      <WhitelabelFrame wl={wl} notice={false} dock={false}>
        <CenterNote>
          이미 출고되었거나 안내가 끝난 차량입니다.
          <br />다른 차량은 담당자에게 문의해 주세요.
        </CenterNote>
      </WhitelabelFrame>
    );
  }

  const agentName = String(agent?.name || '').trim();
  const phone = String(agent?.phone || agent?.mobile || agent?.tel || agent?.contact || '').replace(/\s/g, '');

  return (
    <WhitelabelFrame wl={wl} agentName={agentName} agentPhone={phone} notice={false} dock={false}>
      <ShopDetail p={p} agentName={agentName} agentPhone={phone} />
    </WhitelabelFrame>
  );
}
