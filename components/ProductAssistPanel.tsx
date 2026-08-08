'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import type { EntityRecord } from '@/lib/intake/entities';
import { actor, ensureRoom, type Role } from '@/lib/domain/deal';
import { contractStage, isContractCancelled } from '@/lib/domain/contract';
import { ChatThread } from '@/components/ChatThread';
import { ContractPanel } from '@/components/ContractPanel';
import { ProductPriceTable } from '@/components/ProductPriceTable';
import { Badge, C, FS, PaneHead, R } from '@/components/ui';
import { NAV_LABEL } from '@/lib/tabbar';
import { useIsMobile } from '@/lib/use-mobile';

/**
 * 매물 상세 옆 **보조 칼럼** — 위=지금 할 계약 액션(작게) / 아래=계약문의 채팅(나머지).
 *
 * ★문서 흐름 안의 칼럼(`sticky`). 계약 버튼은 `ContractPanel` focus 만 — 엔진 이중 구현 금지.
 * ★위칸은 내용 높이만. 안쪽에 ListGroup 카드(또 박스)를 얹지 않는다 — aside 테두리 하나면 충분.
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

export function ProductAssistPanel({ product, role }: { product: EntityRecord; role: Role }) {
  const narrow = useIsMobile(ASSIST_BP);
  const co = getCompanyId();
  const [roomId, setRoomId] = useState('');
  const [contract, setContract] = useState<EntityRecord | null | undefined>(undefined);

  const code = String(product.product_code || '');

  const reloadContract = useCallback(() => {
    void getStore().list('contract', co)
      .then((all) => {
        setContract(all.find((x) => String(x.product_code) === code && !isContractCancelled(x)) || null);
      })
      .catch(() => setContract(null));
  }, [co, code]);

  // 대여료 위에 계약·대화가 붙는 건 딜을 진행하는 역할뿐이다. 손님·공급사에게 방을 만들면
  //  쓰지도 않는 방이 목록에 쌓이고, 손님 화면에서 서버 쓰기가 일어난다.
  const canDeal = role === 'agent' || role === 'admin';

  useEffect(() => {
    if (narrow || !canDeal) return;
    let ok = true;
    void ensureRoom(product, actor(role))
      .then((key) => { if (ok) setRoomId(key); })
      .catch(() => {});
    return () => { ok = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, role, narrow, canDeal]);

  useEffect(() => {
    if (narrow || !canDeal) return;
    reloadContract();
  }, [narrow, canDeal, reloadContract]);

  if (narrow) return null;

  const stage = contractStage(contract);
  const stageBadge = contract ? <Badge tone={stage.tone}>{stage.label}</Badge> : null;

  const chromeGap = 14;
  // 본문 머리(차명·칩)만큼 내려온다 → 대여료 카드 윗선 = 사진 윗선(2026-08-08 사장님).
  const headOffset = 'var(--fp-detail-head-h, 0px)';
  // 계약·대화가 붙는 역할만 높이를 다 쓴다. **아래는 브라우저 끝까지** 간다 —
  //  하단독이 본문 안으로 들어가 화면 아래를 막지 않으므로 자리를 비워 둘 이유가 없다.
  //  가격만 있는 역할(공급사·둘러보기)은 내용 높이로 선다. 안 그러면 표 밑이 빈 상자가 된다.
  const paneH = canDeal
    ? `calc(100dvh - var(--topbar-h) - var(--fp-tabbar-h, 0px) - var(--fp-dock-safe, 0px) - ${chromeGap}px - ${headOffset})`
    : undefined;

  return (
    <aside
      aria-label="매물 보조 칼럼"
      style={{
        position: 'sticky',
        top: chromeGap,
        alignSelf: 'flex-start',
        marginTop: headOffset,
        height: paneH,
        maxHeight: paneH,
        flex: '0 0 380px', width: 380,
        display: 'flex', flexDirection: 'column', gap: 10,
        minHeight: 0,
      }}
    >
      {/* 맨 위 = 돈. 헤이딜러처럼 본문은 차 설명, 우측은 «얼마에 · 어떻게 진행»이다.
          영업자가 손님과 통화하며 스크롤해도 금액은 여기 그대로 있다. */}
      <AsideCard title="대여료 / 보증금">
        <ProductPriceTable p={product} bare />
      </AsideCard>

      {/* 대여료까지는 손님·영업·공급·관리자가 **다 같다**. 그 밑에 붙는 것만 역할별이다
          (2026-08-08 결정). 딜을 진행하지 않는 역할에는 아래를 그리지 않는다. */}
      {!canDeal ? null : (
        <>
          <AsideCard title={CONTRACT_HEAD} right={stageBadge} cap="42%">
            <ContractPanel
              product={product}
              roomId={roomId || undefined}
              stepView="focus"
              onChange={reloadContract}
            />
          </AsideCard>
          <AsideCard title={NAV_LABEL.chat} grow>
            {roomId
              ? <ChatThread roomId={roomId} />
              : <div style={{ padding: 14, fontSize: FS.cap, color: C.faint }}>대화방 준비 중…</div>}
          </AsideCard>
        </>
      )}
    </aside>
  );
}

/**
 * 보조 칼럼의 카드 하나.
 *
 * 한 상자에 칸막이로 나누지 않고 **카드를 따로 세운다** — 역할마다 붙는 카드가 다르기 때문이다
 * (2026-08-08 사장님). 손님에게는 대여료 하나만 서는데, 그때 칸막이 상자면 아래가 빈 채로 남는다.
 */
function AsideCard({ title, right, children, grow, cap }: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  /** 남는 높이를 다 쓴다(대화). */
  grow?: boolean;
  /** 내용 높이로 서되 이만큼까지만(계약). */
  cap?: string;
}) {
  return (
    <section style={{
      border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', minHeight: 0,
      ...(grow ? { flex: '1 1 auto' } : { flex: '0 0 auto', maxHeight: cap }),
    }}>
      <PaneHead title={title} right={right} />
      {/* 대화는 스스로 스크롤한다(입력창 고정) — 여기서 또 굴리면 스크롤이 둘이 된다. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: grow ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </section>
  );
}
