'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, type Role } from '@/lib/domain/deal';
import { roomsWithUnread, unreadFor } from '@/lib/domain/messaging';
import { initAuth } from '@/lib/firebase/auth';
import { getSession } from '@/lib/auth-session';
import { canAccessOwnedRecord } from '@/lib/domain/authorization';
import { isOfferableProduct } from '@/lib/domain/product';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { ChatThread } from '@/components/ChatThread';
import { ContractPanel } from '@/components/ContractPanel';
import { RoomFiles } from '@/components/RoomFiles';
import { ProductDetail } from '@/components/ProductDetail';
import { ChatRoomRow } from '@/components/list-rows';
import { PaneHead, PaneBody, C, FS, FW, CenterNote, FeedRowSkeleton, ToggleChips } from '@/components/ui';
import {
  buildContractIndex,
  buildProductLookup,
  contractForRoom,
  productForRoom,
  roomModel as resolveRoomModel,
  roomPlate,
} from '@/features/chat/room-display';
import { isWorkspaceChatRoom } from '@/features/chat/room-filter';
import { deskItemOf, sortDeskQueue, type DeskItem } from '@/features/desk/queue';
import { msgClock } from '@/lib/format';
import { MessageCircle, ListChecks, Car } from 'lucide-react';

/**
 * 관리자 응대 — 들어온 문의를 «처리할 일»로 세워 놓고, 한 화면에서 다 끝낸다.
 *
 * `/chat`(계약문의)과 같은 방을 다루지만 문법이 다르다. 저기는 «내 대화»고 여기는 «대기함»이다.
 *   · 정렬이 최신순이 아니라 **오래 기다린 순**이다. 최신순이면 오래된 건이 영원히 밑에 깔린다.
 *   · 다 본 상태가 «읽었다»가 아니라 «큐가 비었다»이다.
 * 공급사가 앱에 안 들어오므로(시트로 관리) 계약의 공급 몫은 운영자가 처리한다 — 그 대기열이 이 화면이다.
 *
 * 새로 만든 것은 큐 판정(features/desk/queue.ts)뿐이다. 대화·계약·파일·매물은 기존 부품 그대로 —
 * 두 벌로 갈라지면 곧 어긋난다. 설계: docs/ADMIN_DESK.md
 */
type Seg = 'mine' | 'unread' | 'all';
const SEGS: { key: Seg; label: string }[] = [
  { key: 'mine', label: '내 차례' },
  { key: 'unread', label: '미확인' },
  { key: 'all', label: '전체' },
];

/** 기다린 시간 — 「2시간」처럼 한 덩어리로. 초 단위는 응대 판단에 쓸모가 없다. */
function waitedText(since: number): string {
  if (!since) return '';
  const min = Math.floor((Date.now() - since) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간`;
  return `${Math.floor(hr / 24)}일`;
}

export default function Desk() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [role, setRoleS] = useState<Role>('agent');
  const [ready, setReady] = useState(false);
  const [rooms, setRooms] = useState<EntityRecord[] | null>(null);
  const [contracts, setContracts] = useState<EntityRecord[]>([]);
  const [products, setProducts] = useState<EntityRecord[]>([]);
  const [deleted, setDeleted] = useState<EntityRecord[]>([]);
  const [seg, setSeg] = useState<Seg>('mine');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string>('');
  const [swapKey, setSwapKey] = useState('chat');

  const load = useCallback(async (r: Role) => {
    const store = getStore();
    const [all, cts, prods, del] = await Promise.all([
      store.list('room', co),
      store.list('contract', co),
      typeof store.listRaw === 'function' ? store.listRaw('product', co) : store.list('product', co),
      store.listDeleted('product', co).catch(() => [] as EntityRecord[]),
    ]);
    const mine = all.filter((x) => canAccessOwnedRecord(getSession(), x) && isWorkspaceChatRoom(x, r));
    // 안읽음 보강 실패가 큐 자체를 막지 않게 — 큐 판정은 계약이 하고, 안읽음은 보조 축이다.
    const withUnread = await roomsWithUnread(mine, r, store).catch(() => mine);
    setContracts(cts);
    setProducts(prods);
    setDeleted(del);
    setRooms(withUnread);
  }, [co]);

  useEffect(() => {
    (async () => {
      await initAuth();
      await seedIfEmpty(co);
      const r = getRole();
      setRoleS(r);
      setReady(true);
      if (r === 'admin') await load(r);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 새 말·읽음·계약 변화 → 큐 재계산. 채팅과 같은 신호를 쓴다(폴링 추가 없음).
  useEffect(() => {
    if (role !== 'admin') return;
    const on = () => { void load(role).catch(() => {}); };
    window.addEventListener('fp:unread', on);
    window.addEventListener('focus', on);
    return () => {
      window.removeEventListener('fp:unread', on);
      window.removeEventListener('focus', on);
    };
  }, [role, load]);

  const contractIndex = useMemo(() => buildContractIndex(contracts, false), [contracts]);
  const cancelledIndex = useMemo(() => buildContractIndex(contracts, true), [contracts]);
  const productLookup = useMemo(() => buildProductLookup(products), [products]);
  const deletedLookup = useMemo(() => buildProductLookup(deleted), [deleted]);

  const items = useMemo<DeskItem[]>(() => {
    if (!rooms) return [];
    return sortDeskQueue(rooms.map((rm) => {
      const contract = contractForRoom(contractIndex, rm) || contractForRoom(cancelledIndex, rm) || null;
      return deskItemOf(rm, contract);
    }));
  }, [rooms, contractIndex, cancelledIndex]);

  const mineN = items.filter((x) => x.bucket === 'mine').length;
  const unreadN = items.filter((x) => unreadFor(x.room, role) > 0).length;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((x) => {
      if (seg === 'mine' && x.bucket !== 'mine') return false;
      if (seg === 'unread' && unreadFor(x.room, role) <= 0) return false;
      // 전체에서도 끝난 건은 큐 아래로 내리지 않고 아예 뺀다 — 대기함이지 이력함이 아니다.
      if (seg === 'all' && x.bucket === 'done') return false;
      if (!needle) return true;
      const hay = [
        resolveRoomModel(x.room, productLookup, deletedLookup, contracts, x.contract || undefined),
        roomPlate(x.room, productLookup, deletedLookup, contracts, x.contract || undefined),
        x.room.agent_name, x.room.agent_code, x.contract?.contract_code, x.nextLabel,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [items, seg, q, role, productLookup, deletedLookup, contracts]);

  const selItem = items.find((x) => String(x.room._key) === sel) || null;
  const selRoom = selItem?.room || null;
  const selProduct = selRoom ? (productForRoom(productLookup, selRoom) || productForRoom(deletedLookup, selRoom) || null) : null;

  const handleClick = useCallback((rm: EntityRecord) => {
    setSel(String(rm._key));
    setSwapKey('chat');
  }, []);

  if (!ready) return <FeedRowSkeleton />;
  if (role !== 'admin') {
    return <CenterNote>관리자 전용 화면입니다.</CenterNote>;
  }

  const listEl = (
    <>
      {shown.map((x) => (
        <ChatRoomRow
          key={String(x.room._key)}
          room={x.room}
          stageContract={x.contract}
          // 관리자의 1순위 축은 «누가»(영업자)다. 그다음이 «내가 뭘 해야 하나».
          counter={[String(x.room.agent_name || x.room.agent_code || ''), x.nextLabel, waitedText(x.sinceAt)].filter(Boolean).join(' · ')}
          unread={unreadFor(x.room, role)}
          selected={String(x.room._key) === sel}
          onClick={handleClick}
          displayName={resolveRoomModel(x.room, productLookup, deletedLookup, contracts, x.contract || undefined)}
          plate={roomPlate(x.room, productLookup, deletedLookup, contracts, x.contract || undefined)}
        />
      ))}
      {shown.length === 0 ? (
        <CenterNote>
          {seg === 'mine' ? '내 차례인 문의가 없습니다.' : seg === 'unread' ? '미확인 문의가 없습니다.' : '진행 중인 문의가 없습니다.'}
        </CenterNote>
      ) : null}
    </>
  );

  const chatNode = selRoom ? (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <ChatThread
        roomId={String(selRoom._key)}
        title={resolveRoomModel(selRoom, productLookup, deletedLookup, contracts, selItem?.contract || undefined)}
      />
    </div>
  ) : <CenterNote>왼쪽에서 문의를 고르세요.</CenterNote>;

  // 「채팅 안내하면서 모든 걸 관장」 — 계약·파일이 대화 옆에 같이 선다. 다른 화면으로 나가지 않는다.
  const workNode = selRoom ? (
    <div style={{ height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <PaneHead title="계약 진행" />
      <PaneBody>
        <ContractPanel
          product={selProduct && isOfferableProduct(selProduct) ? selProduct : null}
          roomId={String(selRoom._key)}
          linkedCode={selItem?.contract ? String(selItem.contract.contract_code) : undefined}
          agentCode={selRoom.agent_code ? String(selRoom.agent_code) : undefined}
          onChange={() => { void load(role); }}
        />
      </PaneBody>
      <PaneHead title="파일" />
      <PaneBody>
        <RoomFiles roomId={String(selRoom._key)} />
      </PaneBody>
    </div>
  ) : <CenterNote>문의를 고르면 계약·파일이 여기 열립니다.</CenterNote>;

  const vehicleNode = selProduct ? (
    <div style={{ height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <PaneHead title="문의 차량" />
      <PaneBody pad>
        <ProductDetail p={selProduct} layout="work" />
      </PaneBody>
    </div>
  ) : (
    <CenterNote>{selRoom ? '연결된 매물을 찾을 수 없습니다(삭제·이관).' : '문의를 고르면 차량이 열립니다.'}</CenterNote>
  );

  const webPanes: WorkPane[] = [
    { key: 'chat', title: '대화', node: chatNode },
    { key: 'work', title: '계약·파일', node: workNode },
    { key: 'vehicle', title: '차량', node: vehicleNode },
  ];
  const mobilePanes: WorkPane[] = [
    { key: 'chat', title: '대화', icon: MessageCircle, node: chatNode },
    { key: 'work', title: '계약', icon: ListChecks, node: workNode },
    { key: 'vehicle', title: '차량', icon: Car, node: vehicleNode },
  ];

  return (
    <WorkPage
      title="응대"
      statusLabel="내 차례"
      statusCount={rooms === null ? null : mineN}
      attentionLabel="미확인"
      attentionCount={rooms === null ? null : unreadN}
      listCount={rooms === null ? null : shown.length}
      list={rooms === null ? <FeedRowSkeleton /> : listEl}
      listHeader={(
        <div style={{ padding: '6px 10px', borderBottom: `1px solid ${C.line}` }}>
          <ToggleChips
            size="sm"
            selected={new Set([seg])}
            options={SEGS.map((s) => ({
              key: s.key,
              label: s.key === 'mine' && mineN ? `${s.label} ${mineN}`
                : s.key === 'unread' && unreadN ? `${s.label} ${unreadN}`
                : s.label,
            }))}
            onToggle={(k) => setSeg(k as Seg)}
          />
        </div>
      )}
      panes={mobile ? mobilePanes : webPanes}
      selected={!!selRoom}
      onBack={() => setSel('')}
      contextTitle={selRoom ? (
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {resolveRoomModel(selRoom, productLookup, deletedLookup, contracts, selItem?.contract || undefined)}
          </span>
          <span style={{ flex: '0 0 auto', fontSize: FS.cap, fontWeight: FW.label, color: C.mute }}>
            {[String(selRoom.agent_name || selRoom.agent_code || ''), selItem?.nextLabel].filter(Boolean).join(' · ')}
          </span>
          {selItem?.sinceAt ? (
            <span style={{ flex: '0 0 auto', fontSize: FS.cap, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>
              {msgClock(selItem.sinceAt)}
            </span>
          ) : null}
        </span>
      ) : undefined}
      search={{ value: q, onChange: setQ, placeholder: '영업자·차번·차명…' }}
      mobileLayout="swap"
      mobileSwapKey={swapKey}
      onMobileSwapKeyChange={setSwapKey}
      countSuffix="건"
    />
  );
}
