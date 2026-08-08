'use client';

import { useCallback, useEffect, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import type { EntityRecord } from '@/lib/intake/entities';
import { actor, ensureRoom, type Role } from '@/lib/domain/deal';
import { contractStage, isContractCancelled } from '@/lib/domain/contract';
import { ChatThread } from '@/components/ChatThread';
import { ContractPanel } from '@/components/ContractPanel';
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

  useEffect(() => {
    if (narrow) return;
    let ok = true;
    void ensureRoom(product, actor(role))
      .then((key) => { if (ok) setRoomId(key); })
      .catch(() => {});
    return () => { ok = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, role, narrow]);

  useEffect(() => {
    if (narrow) return;
    reloadContract();
  }, [narrow, reloadContract]);

  if (narrow) return null;

  const stage = contractStage(contract);
  const stageBadge = contract ? <Badge tone={stage.tone}>{stage.label}</Badge> : null;

  const chromeGap = 14;
  const paneH = `calc(100dvh - var(--topbar-h) - var(--fp-tabbar-h, 0px) - var(--bottombar-h) - var(--fp-dock-safe, 0px) - ${chromeGap * 2}px)`;

  return (
    <aside
      aria-label="매물 보조 칼럼"
      style={{
        position: 'sticky',
        top: chromeGap,
        alignSelf: 'flex-start',
        height: paneH,
        maxHeight: paneH,
        flex: '0 0 380px', width: 380,
        display: 'flex', flexDirection: 'column',
        background: C.bg, border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden',
      }}
    >
      {/* 위 = 지금 누를 버튼만(내용 높이). 채팅이 아래를 채운다. */}
      <div style={{
        flex: '0 0 auto',
        maxHeight: '42%',
        minHeight: 0,
        overflowY: 'auto',
        borderBottom: `1px solid ${C.line2}`,
        display: 'flex',
        flexDirection: 'column',
      }}>
        <PaneHead title={CONTRACT_HEAD} right={stageBadge} />
        <ContractPanel
          product={product}
          roomId={roomId || undefined}
          stepView="focus"
          onChange={reloadContract}
        />
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <PaneHead title={NAV_LABEL.chat} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {roomId
            ? <ChatThread roomId={roomId} />
            : <div style={{ padding: 14, fontSize: FS.cap, color: C.faint }}>대화방 준비 중…</div>}
        </div>
      </div>
    </aside>
  );
}
