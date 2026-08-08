'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ChatRoomRow } from '@/components/list-rows';
import { vehicleName } from '@/lib/domain/product';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import type { EntityRecord } from '@/lib/intake/entities';
import { actor, ensureRoom, type Role } from '@/lib/domain/deal';
import { contractStage, isContractCancelled } from '@/lib/domain/contract';
import { ChatThread } from '@/components/ChatThread';
import { ContractPanel } from '@/components/ContractPanel';
import { ProductPriceTable } from '@/components/ProductPriceTable';
import { Badge, Btn, C, FS, FW, NUM, PaneHead, R } from '@/components/ui';
import { NAV_LABEL } from '@/lib/tabbar';
import { useIsMobile } from '@/lib/use-mobile';
import { getSession } from '@/lib/auth-session';
import { canAccessOwnedRecord } from '@/lib/domain/authorization';
import { unreadFor } from '@/lib/domain/messaging';
import { msgClock } from '@/lib/format';

/**
 * 매물 상세 옆 **보조 칼럼** — 위=대여료·계약 / 아래=채팅.
 *
 * ★넓은 화면 = `position:fixed` 뷰포트 고정. 본문(매물정보)이 스크롤돼도 보조패널은 안 움직인다.
 *   플로우에는 폭만 잡는 spacer 를 두어 본문이 밑으로 파고들지 않게 한다.
 * ★계약 버튼은 `ContractPanel` focus 만 — 엔진 이중 구현 금지.
 */

export const ASSIST_BP = 1200;
/** 보조 칼럼 폭·본문과의 간격 — 하단독을 본문 아래로 맞추려면 페이지가 이 치수를 알아야 한다. */
export const ASSIST_W = 380;
export const ASSIST_GAP = 16;

/**
 * 지금 보조 칼럼이 실제로 그려지는가.
 *
 * 페이지는 이걸 알아야 **하단독(이전·공유·계약문의)을 본문 칼럼 아래로 맞출 수 있다.**
 * 모르면 독은 화면 한가운데에 서고, 본문은 보조 칼럼에 밀려 왼쪽에 있으므로
 * 버튼이 «상세가 아니라 보조 칼럼 밑»에 붙은 것처럼 어긋난다(2026-08-08 지적).
 */
export function useAssistColumn(): boolean {
  return !useIsMobile(ASSIST_BP);
}

const CONTRACT_HEAD = '계약진행';
const CHROME_GAP = 14;

export function ProductAssistPanel({ product, role }: { product: EntityRecord; role: Role }) {
  const narrow = useIsMobile(ASSIST_BP);
  const router = useRouter();
  const co = getCompanyId();
  const [roomId, setRoomId] = useState('');
  const [contract, setContract] = useState<EntityRecord | null | undefined>(undefined);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [fixedBox, setFixedBox] = useState<{ left: number; width: number } | null>(null);

  const code = String(product.product_code || '');

  const reloadContract = useCallback(() => {
    void getStore().list('contract', co)
      .then((all) => {
        setContract(all.find((x) => String(x.product_code) === code && !isContractCancelled(x)) || null);
      })
      .catch(() => setContract(null));
  }, [co, code]);

  /**
   * 이 매물에 **문의를 여는 쪽**은 영업자다 — 방은 «매물 × 영업자»로 만들어진다.
   * 공급사·관리자는 방을 만들지 않고 **들어온 문의를 골라 본다**(2026-08-08 사장님).
   * 그래서 같은 자리에 영업자는 «내 대화», 공급사·관리자는 «문의 목록»이 선다.
   */
  const asksRoom = role === 'agent';
  const readsInbox = role === 'provider' || role === 'admin';
  const canDeal = asksRoom || readsInbox;
  const [inbox, setInbox] = useState<EntityRecord[] | null>(null);
  const [picked, setPicked] = useState('');
  /** 지금 보고 있는 방 — 영업자는 자기 방, 공급사·관리자는 목록에서 고른 방. */
  const activeRoom = asksRoom ? roomId : picked;

  // 모바일도 상세 아래에 계약·대화를 쌓으므로 좁다고 건너뛰지 않는다(2026-08-08).
  useEffect(() => {
    if (!asksRoom) return;
    let ok = true;
    void ensureRoom(product, actor(role))
      .then((key) => { if (ok) setRoomId(key); })
      .catch(() => {});
    return () => { ok = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, role, asksRoom]);

  // 공급사·관리자 = 이 매물에 들어온 문의만 모아 본다. 방을 새로 만들지 않는다(읽기 전용 조회).
  const loadInbox = useCallback(() => {
    if (!readsInbox) return;
    void getStore().list('room', co)
      .then((all) => {
        const mine = all.filter((r) => String(r.product_code || r.product_uid || '') === code
          && canAccessOwnedRecord(getSession(), r));
        mine.sort((a, b) => Number(b.last_message_at || 0) - Number(a.last_message_at || 0));
        setInbox(mine);
        setPicked((cur) => cur || String(mine[0]?._key || ''));
      })
      .catch(() => setInbox([]));
  }, [co, code, readsInbox]);

  useEffect(() => {
    if (!readsInbox) return;
    loadInbox();
    const on = () => loadInbox();
    window.addEventListener('fp:unread', on);
    return () => window.removeEventListener('fp:unread', on);
  }, [readsInbox, loadInbox]);

  useEffect(() => {
    if (!canDeal) return;
    reloadContract();
  }, [canDeal, reloadContract]);

  // spacer 의 left → fixed 패널이 같은 세로선에 선다(창 리사이즈·스크롤바 대응).
  useEffect(() => {
    if (narrow) {
      setFixedBox(null);
      return;
    }
    const slot = slotRef.current;
    if (!slot) return;
    const measure = () => {
      const r = slot.getBoundingClientRect();
      setFixedBox({ left: Math.round(r.left), width: Math.round(r.width) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(slot);
    ro.observe(document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [narrow, code]);

  // 좁은 화면 = 본문 아래로 **쌓는다**. 딜을 진행하지 않는 역할에는 쌓을 것이 없다.
  if (narrow && !canDeal) return null;

  const stage = contractStage(contract);
  const stageBadge = contract ? <Badge tone={stage.tone}>{stage.label}</Badge> : null;

  // 본문 머리(차명·칩)만큼 — 대여료 카드 윗선 = 사진 윗선(2026-08-08 사장님).
  const headOffset = 'var(--fp-detail-head-h, 0px)';
  // fixed 는 뷰포트 기준 — 상단바 아래 + 머리 정렬.
  // 바닥은 sticky 하단독(이전·공유·계약문의) **윗선에 딱** — 여백 없이 맞닿게.
  const fixedTop = `calc(var(--topbar-h) + ${CHROME_GAP}px + ${headOffset})`;
  const fixedBottom = `calc(var(--fp-bar-h) + var(--fp-dock-safe, 0px))`;

  /**
   * 관리자·공급사 상세 = **몇 건 왔는지**만. 대화는 여기서 하지 않는다(2026-08-08 사장님).
   *
   * 응대는 계약문의 페이지 하나에서만 한다 — 같은 문의를 두 화면에서 받으면 어디서 답했는지
   * 흩어지고, 상세를 열 때마다 대화가 열려 «읽음»이 의도 없이 찍힌다.
   * 채팅창은 영업자에게만 준다(그들에겐 매물이 출발점이라 상세에서 끝나야 한다).
   */
  const unreadN = (inbox || []).reduce((sum, r) => sum + (unreadFor(r, role) > 0 ? 1 : 0), 0);
  /** 응대는 계약문의 페이지에서만 — 행을 누르면 그 방으로 넘긴다. */
  const openRoom = (r: EntityRecord) => router.push(`/chat?room=${encodeURIComponent(String(r._key))}`);
  /**
   * **배열은 그대로, 채팅창 자리만 문의 목록**(2026-08-08 사장님).
   * 영업자에게 대화가 있던 그 자리에 관리자·공급사는 «누가 문의했는지»를 본다.
   * 여기서 답하지는 않는다 — 누르면 계약문의 페이지의 그 방으로 간다(응대는 한 곳에서만).
   */
  const inboxCard = (
    <AsideCard
      title="문의"
      right={inbox?.length ? <Badge tone={unreadN ? 'red' : 'gray'}>{inbox.length}</Badge> : null}
      grow={!narrow}
      fixedH={narrow ? '40dvh' : undefined}
    >
      {inbox === null ? (
        <div style={{ padding: 12, fontSize: FS.cap, color: C.faint }}>불러오는 중…</div>
      ) : inbox.length === 0 ? (
        <div style={{ padding: 12, fontSize: FS.cap, color: C.faint, lineHeight: 1.5 }}>
          아직 이 차에 들어온 문의가 없습니다.
        </div>
      ) : (
        // 계약문의 페이지가 쓰는 **그 행 원자 그대로**(ChatRoomRow) — 같은 문의가 두 화면에서
        //  다르게 생기면 «같은 것»으로 안 읽힌다. 상태 아이콘·안읽음·시각 규칙도 따라온다.
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {inbox.map((r) => (
            <ChatRoomRow
              key={String(r._key)}
              room={r}
              stageContract={contract && String(contract.contract_code) === String(r.linked_contract || '') ? contract : null}
              counter={String(r.agent_name || r.agent_code || '')}
              unread={unreadFor(r, role)}
              onClick={openRoom}
              displayName={vehicleName(product)}
              plate={String(product.car_number || '')}
            />
          ))}
        </div>
      )}
    </AsideCard>
  );

  const body = (
    <>
      <AsideCard title="대여료 / 보증금">
        <ProductPriceTable p={product} bare />
      </AsideCard>
      {/* 배열은 역할과 무관하게 같다: 대여료 → 계약진행 → (대화 | 문의 목록).
          계약진행 카드는 하나지만 보는 사람마다 «내가 할 일»이 다르다(ContractPanel focus). */}
      {!canDeal ? null : (
        <>
          <AsideCard title={CONTRACT_HEAD} right={stageBadge} cap="42%">
            <ContractPanel
              product={product}
              // 관리자·공급사에는 방을 넘기지 않는다 — 방은 영업자별이라 남의 딜을 잡는다.
              roomId={asksRoom ? (roomId || undefined) : undefined}
              stepView="focus"
              onChange={reloadContract}
            />
          </AsideCard>
          {asksRoom ? (
            <AsideCard title={NAV_LABEL.chat} grow>
              {roomId
                ? <ChatThread roomId={roomId} />
                : <div style={{ padding: 14, fontSize: FS.cap, color: C.faint }}>대화방 준비 중…</div>}
            </AsideCard>
          ) : inboxCard}
        </>
      )}
    </>
  );

  // 좁은 화면 = 상세 끝나는 자리에 **계약진행 → 채팅** 순으로 쌓는다.
  if (narrow) {
    return (
      <aside
        aria-label="계약·대화"
        style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14, width: '100%', minWidth: 0 }}
      >
        {!canDeal ? null : (
          <>
            {/* 좁은 화면도 같은 배열 — 계약진행 → (대화 | 문의 목록). */}
            <AsideCard title={CONTRACT_HEAD} right={stageBadge}>
              <ContractPanel
                product={product}
                roomId={asksRoom ? (roomId || undefined) : undefined}
                stepView="focus"
                onChange={reloadContract}
              />
            </AsideCard>
            {asksRoom ? (
              <AsideCard title={NAV_LABEL.chat} fixedH="60dvh">
                {roomId
                  ? <ChatThread roomId={roomId} />
                  : <div style={{ padding: 14, fontSize: FS.cap, color: C.faint }}>대화방 준비 중…</div>}
              </AsideCard>
            ) : inboxCard}
          </>
        )}
      </aside>
    );
  }

  return (
    <>
      {/* 플로우 자리만 예약 — 본문이 보조 폭을 침범하지 않게. 실패널은 fixed. */}
      <div
        ref={slotRef}
        aria-hidden
        style={{
          flex: `0 0 ${ASSIST_W}px`,
          width: ASSIST_W,
          alignSelf: 'stretch',
          pointerEvents: 'none',
        }}
      />
      <aside
        aria-label="매물 보조 칼럼"
        style={{
          position: 'fixed',
          top: fixedTop,
          bottom: canDeal ? fixedBottom : undefined,
          left: fixedBox ? fixedBox.left : undefined,
          width: fixedBox ? fixedBox.width : ASSIST_W,
          // 측정 전엔 화면 밖으로 — 한 프레임 점프 방지
          visibility: fixedBox ? 'visible' : 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 0,
          maxHeight: canDeal ? undefined : 'none',
          zIndex: 40,
          boxSizing: 'border-box',
          pointerEvents: 'auto',
        }}
      >
        {body}
      </aside>
    </>
  );
}

/**
 * 보조 칼럼의 카드 하나.
 *
 * 한 상자에 칸막이로 나누지 않고 **카드를 따로 세운다** — 역할마다 붙는 카드가 다르기 때문이다
 * (2026-08-08 사장님). 손님에게는 대여료 하나만 서는데, 그때 칸막이 상자면 아래가 빈 채로 남는다.
 */
export function AsideCard({ title, right, children, grow, cap, fixedH }: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  /** 남는 높이를 다 쓴다(대화). */
  grow?: boolean;
  /** 내용 높이로 서되 이만큼까지만(계약). */
  cap?: string;
  /** 세로로 쌓을 때의 고정 높이(모바일 대화) — 안 정하면 대화가 페이지를 끝없이 늘린다. */
  fixedH?: string;
}) {
  return (
    <section style={{
      border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', minHeight: 0,
      ...(grow ? { flex: '1 1 auto' } : { flex: '0 0 auto', maxHeight: cap }),
      ...(fixedH ? { height: fixedH } : null),
    }}>
      <PaneHead title={title} right={right} />
      {/* 대화는 스스로 스크롤한다(입력창 고정) — 여기서 또 굴리면 스크롤이 둘이 된다. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: grow || fixedH ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </section>
  );
}
