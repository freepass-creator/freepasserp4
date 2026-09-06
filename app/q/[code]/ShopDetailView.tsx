'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { EntityRecord } from '@/lib/intake/entities';
import { CenterNote, Loading } from '@/components/ui';
import { WhitelabelFrame } from '@/components/WhitelabelFrame';
import { FavShare, ShopDetail, ShopDetailLead } from '@/components/shop/ShopDetail';
import type { Whitelabel } from '@/lib/whitelabel';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { resolveAttr } from '@/lib/shop/attribution';

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
  /** 담당 귀속 — 「목록으로」에도 물려 보낸다. 돌아갔을 때 담당자가 바뀌면 그게 곧 퍼널이 끊기는 것이다. */
  const [attr, setAttr] = useState('');
  /** 채널 미리보기 꼬리표 — 도메인이 붙기 전까지만 쓴다(목록으로 돌아갈 때 물려 보낸다). */
  const [wlPreview, setWlPreview] = useState('');

  useEffect(() => { (async () => {
    // 누구 손님인가 — 주소 ?a= → 기억해 둔 값 → 로그인한 나. 목록과 «같은» 규칙을 쓴다.
    const params = new URLSearchParams(window.location.search);
    const a = resolveAttr(params);
    setAttr(a);
    setWlPreview(params.get('wl') || '');
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

  const agentName = String(agent?.name || '').trim();
  /*
   * ★★전화번호는 **담당자 → 대표번호** 순으로 떨어진다(2026-09-05 실측 사고).
   *
   *   `?a=` 없이 들어온 손님 — 채널 첫 화면(uniautofreepass.com/) → 목록 → 카드 — 은 담당자가 없다.
   *   그때 담당자 번호만 보고 있었더니 **폰 화면 전체에 전화 링크가 0개**가 됐다.
   *   번호는 푸터 맨 밑에 «누를 수 없는 글자»로만 남아 있었다.
   *   사장님이 「그냥 그 주소로 들어가면 상품부터 다 보인다」고 하신 바로 그 경로가,
   *   정확히 «전화를 걸 수 없는» 경로였다. 상담 전환이 매출인 장사에서 이건 화면이 아니라 매출의 구멍이다.
   *
   * ★껍데기(`WhitelabelFrame`)는 원래부터 이 폴백을 갖고 있었는데 상세만 못 받고 있었다 —
   *   상세가 제 하단독을 가지느라 프레임 독을 껐기(`dock={false}`) 때문이다.
   */
  const phone = String(agent?.phone || agent?.mobile || agent?.tel || agent?.contact || '').replace(/\s/g, '')
    || String(wl.tel || '').replace(/\s/g, '');
  /** 목록으로 돌아가는 주소 — 담당 귀속을 물고 간다. 못 찾은 화면에서도 같은 문을 쓴다. */
  /*
   * ⚠ 채널 미리보기(`?wl=`)로 들어온 손님은 목록도 «그 채널»로 돌아가야 한다. 안 물고 가면
   *   「목록으로」를 누른 순간 노브랜드 프리패스 목록이 뜬다 — 눌렀더니 남의 사이트다(2026-09-05).
   *   도메인이 붙으면 호스트가 브랜드를 정하므로 이 꼬리표는 저절로 사라진다.
   */
  const listHref = (() => {
    const q = new URLSearchParams();
    if (attr) q.set('a', attr);
    if (wlPreview) q.set('wl', wlPreview);
    const s = q.toString();
    return `/shop${s ? `?${s}` : ''}`;
  })();
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
    /*
     * ⚠ 「담당자에게 문의해 주세요」라고 써 놓고 **번호도 목록도 없었다**(2026-09-05 검토).
     *   문장이 시키는 일을 손님이 할 수가 없으면 그건 안내가 아니라 막다른 길이다.
     *   ⇒ 프레임 독을 **켠다**(여기는 상세가 아니라 제 하단독이 없다 — 겹칠 일이 없다).
     *     담당자가 없으면 껍데기가 대표번호로 떨어뜨린다. 목록으로 가는 문도 같이 준다.
     */
    return (
      <WhitelabelFrame wl={wl} agentName={agentName} agentPhone={phone} notice={false}>
        <div style={{ padding: '72px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)', marginBottom: 8 }}>
            이미 출고되었거나 안내가 끝난 차량입니다
          </div>
          <div style={{ fontSize: 14.5, color: 'var(--text-sub)', lineHeight: 1.7, marginBottom: 22 }}>
            같은 조건의 다른 차량을 보시거나, 담당자에게 문의해 주세요.
          </div>
          <a href={listHref} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 52, padding: '0 26px', borderRadius: 999,
            background: 'var(--brand)', color: '#fff', textDecoration: 'none',
            fontSize: 14.5, fontWeight: 700,
          }}>다른 차량 보기</a>
        </div>
      </WhitelabelFrame>
    );
  }


  /*
   * ★폰의 관심·공유는 **머리띠 오른쪽**이다(사장님 2026-09-05). 상세 안에 두면 갈 데가 없다 —
   *   사진 위는 금지, 하단독은 두 칸 확정, 차번 줄은 정보 줄이다. 머리띠 오른쪽만 비어 있었고
   *   폰에서는 고정이라 **어디를 보고 있든** 보낼 수 있다(공유 = 퍼널).
   *   웹은 상세 제 실행줄(「목록으로 ↔ ♡ 공유」)이 받는다 — 껍데기는 폰에서만 그린다.
   */
  return (
    <WhitelabelFrame wl={wl} agentName={agentName} agentPhone={phone} notice={false} dock={false}
      headerLead={<ShopDetailLead />}
      headerActions={<FavShare title={vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', fallback: 'plate' })} />}>
      <ShopDetail p={p} agentName={agentName} agentPhone={phone}
        listHref={listHref} />
    </WhitelabelFrame>
  );
}
