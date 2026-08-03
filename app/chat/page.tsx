'use client';
import { useCallback, useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { getStore, type StoreAdapter } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { useKeyboardOpen } from '@/lib/use-keyboard';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { roomsWithUnread, unreadFor, unreadRoomCount } from '@/lib/domain/messaging';
import { contractStage, isInquiryOnly, isContractCancelled } from '@/lib/domain/contract';
import { providerNameMap, withProviderNames } from '@/lib/domain/identity';
import { PaneHead, Btn, IconBtn, C, Loading, CenterNote, PaneBody, FilterChips, FilterGroup, FS, FW, NUM, FeedRowSkeleton } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { ChatThread } from '@/components/ChatThread';
import { ProductDetail } from '@/components/ProductDetail';
import { ContractPanel } from '@/components/ContractPanel';
import { ContractDocs } from '@/components/ContractDocs';
import { haptic } from '@/lib/haptics';
import { ChatRoomRow } from '@/components/list-rows';
import { NAV_LABEL } from '@/lib/tabbar';
import { getSession } from '@/lib/auth-session';
import { canAccessOwnedRecord, organizationRole } from '@/lib/domain/authorization';
import { initAuth } from '@/lib/firebase/auth';
import {
  buildContractIndex,
  buildProductLookup,
  chatCodeOf,
  contractForRoom,
  productForRoom,
  providerForRoom,
  roomPlate,
  roomProductDetail,
  roomModel as resolveRoomModel,
} from '@/features/chat/room-display';
import { roomVehicleDetailLabel } from '@/lib/domain/vehicle-label';
import {
  CHAT_FILTER_DEFAULT,
  CHAT_FILTERS,
  CHAT_SORTS,
  chatRowContract,
  chatRoomPreviewCount,
  filterChatRooms,
  isWorkspaceChatRoom,
  requestedChatRoom,
  type ChatFilter,
  type ChatSort,
} from '@/features/chat/room-filter';
import { joinMetaText, retainVisibleSelection, workPartyParts } from '@/features/work-list-display';
import { ListChecks, MessageCircle, ClipboardList } from 'lucide-react';
import { ChatRoomList } from '@/features/chat/ChatRoomList';
import {
  collapseDuplicateEmptyRooms,
  duplicateEmptyRoomFamilies,
  verifyDuplicateRoomMessages,
  type EmptyRoomDedupeEvidence,
} from '@/features/chat/room-dedupe';

async function emptyRoomDedupeEvidence(
  rooms: EntityRecord[],
  contracts: EntityRecord[],
  store: StoreAdapter,
  companyId: string,
): Promise<EmptyRoomDedupeEvidence> {
  const active = buildContractIndex(contracts, false);
  const cancelled = buildContractIndex(contracts, true);
  const contractOf = (room: EntityRecord) => (
    contractForRoom(active, room) || contractForRoom(cancelled, room)
  );
  const families = duplicateEmptyRoomFamilies(rooms, { contractOf });
  const messageState = await verifyDuplicateRoomMessages(families, {
    listForRoom: typeof store.listMessagesForRoom === 'function'
      ? (roomId) => store.listMessagesForRoom!(companyId, roomId)
      : undefined,
    listAll: () => store.list('message', companyId),
  });
  return { messageState, contractOf };
}

// 문의 = 단순 채팅 목록 | 채팅 | 상품상세 | 계약(진행 전환).
//   계약진행으로 넘어간 방은 /contract. 웹=4열 / 모바일=채팅↔계약진행.
export default function Chat() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [role, setRoleS] = useState<Role>('agent');
  const [rooms, setRooms] = useState<EntityRecord[] | null>(null);
  const [contracts, setContracts] = useState<EntityRecord[]>([]);
  const [products, setProducts] = useState<EntityRecord[]>([]);
  const [deletedProducts, setDeletedProducts] = useState<EntityRecord[]>([]);
  const [providerAliases, setProviderAliases] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [selRoom, setSelRoom] = useState<EntityRecord | null>(null);
  const [selProduct, setSelProduct] = useState<EntityRecord | null>(null);
  const selectionEpoch = useRef(0);
  const [qInput, setQInput] = useState(''); // 검색창 즉시 반영
  const [q, setQ] = useState(''); // 디바운스된 검색
  const [swapKey, setSwapKey] = useState('chat');
  // 메시지 작성 중 = 하단독 숨김(키보드 위 공간 확보). 입력 취소·전송하면 다시 나와 목록으로 갈 수 있다.
  const [composing, setComposing] = useState(false);
  const kb = useKeyboardOpen();
  const [sort, setSort] = useState<ChatSort | ''>('');
  const [flt, setFlt] = useState<ChatFilter>(CHAT_FILTER_DEFAULT);
  const [draftFlt, setDraftFlt] = useState<ChatFilter>(CHAT_FILTER_DEFAULT);

  // 검색 디바운스 — 타이핑마다 방목록 filter 전량 재계산 방지
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 180);
    return () => clearTimeout(t);
  }, [qInput]);

  // 계약 인덱스 — linked_contract 우선, 레거시 product_uid·차번·agent_uid까지 같은 resolver로 연결.
  // 같은 fallback 키는 진행 중 계약 우선, 그다음 최신 계약으로 결정적으로 고른다.
  const contractIndex = useMemo(() => buildContractIndex(contracts, false), [contracts]);
  // 취소 이력 fallback — 활성 계약이 없을 때만 같은 최신성 규칙으로 사용한다.
  const cancelledIndex = useMemo(() => buildContractIndex(contracts, true), [contracts]);
  const contractOf = (rm: EntityRecord) => contractForRoom(contractIndex, rm);
  const cancelledOf = (rm: EntityRecord) => contractForRoom(cancelledIndex, rm);
  const productLookup = useMemo(() => buildProductLookup(products), [products]);
  const deletedLookup = useMemo(() => buildProductLookup(deletedProducts), [deletedProducts]);
  /** v3 방도 product_uid·차번으로 연결하되 표시는 방 snapshot → 계약 snapshot → 매물 순으로 복원한다. */
  const roomContract = (rm: EntityRecord) => contractOf(rm) || cancelledOf(rm);
  const roomChatCode = (rm: EntityRecord): string =>
    chatCodeOf(rm, roomPlate(rm, productLookup, deletedLookup, contracts, roomContract(rm)));
  /** 매물 공급사 표기 — 관리자 응대용(이름 우선, 없으면 코드). */
  const providerOf = (rm: EntityRecord) => providerForRoom(rm, productLookup, deletedLookup, providerAliases);
  /** 목록 규격 — ①줄=차량명 ②줄=차번. 헤더(contextTitle)는 합본 roomTitle을 그대로 쓴다. */
  const roomHead = (rm: EntityRecord): string => resolveRoomModel(rm, productLookup, deletedLookup, contracts, roomContract(rm));
  const roomPlateOf = (rm: EntityRecord): string => roomPlate(rm, productLookup, deletedLookup, contracts, roomContract(rm));
  const roomCounter = (rm: EntityRecord): string => {
    const pv = providerOf(rm);
    return joinMetaText(workPartyParts(organizationRole(getSession()) || role, rm, {
      agentFallback: contractOf(rm) || cancelledOf(rm),
      providerName: pv.name || pv.code,
    }));
  };
  const sortByRecent = (arr: EntityRecord[]) => arr.slice().sort((a, b) => Number(b.last_message_at || 0) - Number(a.last_message_at || 0));
  // 방과 계약·상품·파트너를 원자적으로 준비한다. 방만 먼저 그리면 계약 인덱스가 빈 첫 프레임에서
  // 진행/완료/취소 방이 잠깐 '문의'로 보이므로, 의미 보강이 끝날 때까지 목록 skeleton을 유지한다.
  const load = async (r: Role): Promise<EntityRecord[]> => {
    setRooms(null);
    const store = getStore();
    // 방과 카탈로그는 동시에 출발하고, 계약 lifecycle까지 모두 준비된 뒤에만 목록을 연다.
    // 차명 조인은 원본 기준 — 판매용 목록은 중복정리·제외로 예전 문의 차를 놓친다.
    const catalogP = Promise.all([
      store.list('contract', co),
      typeof store.listRaw === 'function' ? store.listRaw('product', co) : store.list('product', co),
      store.listDeleted('product', co).catch(() => []),
      store.list('partner', co).catch(() => []),
    ]).catch((e) => {
      // 의미 보강 실패를 빈 계약/상품으로 오인 렌더하지 않는다. skeleton을 유지하고 원인을 남긴다.
      console.error('[chat] 카탈로그 보강 실패(상품·계약·파트너 로드):', e);
      throw e;
    });
    const all = await store.list('room', co);
    const mine = all.filter((x) => canAccessOwnedRecord(getSession(), x) && isWorkspaceChatRoom(x, r));
    const [cts, prods, del, partners] = await catalogP;
    const [withUnread, dedupeEvidence] = await Promise.all([
      roomsWithUnread(mine, r, store).catch((e) => {
        // 안읽음 보강 실패는 lifecycle·차량명 의미를 바꾸지 않으므로 방의 저장 카운터로 안전하게 표시한다.
        console.error('[chat] 안읽음 보강 실패:', e);
        return mine;
      }),
      emptyRoomDedupeEvidence(mine, cts, store, co),
    ]);
    const sorted = sortByRecent(collapseDuplicateEmptyRooms(withUnread, dedupeEvidence));
    // React 18 자동 batching: 의미를 구성하는 상태를 같은 tick에 반영하고 rooms를 마지막에 연다.
    setContracts(cts);
    setProducts(withProviderNames(prods, partners));
    setDeletedProducts(del);
    setProviderAliases(providerNameMap(partners));
    setRooms(sorted);
    return sorted;
  };
  // 방목록·안읽음(+계약)만 부분 갱신 — products/deletedProducts 카탈로그는 재조회하지 않음(fp:unread 경량 경로).
  //  메시지 열람/전송으로 카탈로그는 변하지 않으므로 최초 load에서 받은 products·deletedProducts(삭제매물 이름복원)를 재사용.
  const refreshRooms = async (r: Role): Promise<EntityRecord[]> => {
    const store = getStore();
    const [all, cts] = await Promise.all([
      store.list('room', co),
      store.list('contract', co),
    ]);
    setContracts(cts);
    const mine = all.filter((x) => canAccessOwnedRecord(getSession(), x) && isWorkspaceChatRoom(x, r));
    const [withUnread, dedupeEvidence] = await Promise.all([
      roomsWithUnread(mine, r, store),
      emptyRoomDedupeEvidence(mine, cts, store, co),
    ]);
    const sorted = sortByRecent(collapseDuplicateEmptyRooms(withUnread, dedupeEvidence));
    setRooms(sorted);
    return sorted;
  };
  const resolveProduct = async (rm: EntityRecord): Promise<EntityRecord | null> => {
    const store = getStore();
    // 목록에서 이미 복원한 레거시 product_uid를 canonical product_code로 바꿔 상세도 같은 차를 연다.
    // get(product_uid)는 RTDB 정규화 후 _key=product_code라 miss할 수 있으므로 raw uid를 곧장 쓰지 않는다.
    let indexed = productForRoom(productLookup, rm) || productForRoom(deletedLookup, rm);
    let productId = String(indexed?.product_code || indexed?._key || rm.product_code || rm.product_uid || rm.product_id || '').trim();
    let live = productId ? await store.get('product', co, productId) : null;

    // 방이 먼저 페인트되고 카탈로그가 아직 도착하지 않은 클릭도, 이미 진행 중인 listRaw를 기다려 같은 조인으로 복구한다.
    if (!indexed) {
      const catalog = typeof store.listRaw === 'function'
        ? await store.listRaw('product', co)
        : await store.list('product', co);
      indexed = productForRoom(buildProductLookup(catalog), rm);
      const restoredId = String(indexed?.product_code || indexed?._key || '').trim();
      if (restoredId && restoredId !== productId) {
        productId = restoredId;
        live = await store.get('product', co, productId);
      }
    }

    let c = roomContract(rm);
    if (!c) {
      const cts = await store.list('contract', co);
      c = contractForRoom(buildContractIndex(cts, false), rm)
        || contractForRoom(buildContractIndex(cts, true), rm);
    }
    return roomProductDetail(rm, live || indexed, c);
  };
  const selectRoom = async (rm: EntityRecord) => {
    const epoch = ++selectionEpoch.current;
    setSel(String(rm._key));
    setSelRoom(rm);
    setSelProduct(null);
    setSwapKey('chat');
    const product = await resolveProduct(rm);
    if (epoch === selectionEpoch.current) setSelProduct(product);
  };
  const clearSel = () => {
    selectionEpoch.current += 1;
    setSel(null); setSelRoom(null); setSelProduct(null); setSwapKey('chat');
    // 목록 복귀 후 새로고침이 ?room=으로 다시 열리지 않게
    if (typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      if (u.searchParams.has('room')) {
        u.searchParams.delete('room');
        const q = u.searchParams.toString();
        window.history.replaceState({}, '', u.pathname + (q ? `?${q}` : '') + u.hash);
      }
    }
  };

  // 계약 생성·링크 변경 뒤 방 목록이 갱신되면 선택 중인 방 스냅샷도 최신값으로 교체한다.
  // 별도 selRoom이 예전 linked_contract를 계속 들고 있으면 새 계약을 다시 못 찾는다.
  useEffect(() => {
    if (!rooms || !sel) return;
    const fresh = rooms.find((room) => String(room._key) === sel);
    if (!fresh) return;
    setSelRoom((previous) => previous === fresh ? previous : fresh);
  }, [rooms, sel]);
  // 방행 클릭 = 최신 selectRoom을 안정 참조로 호출. handleRoomClick 참조가 렌더마다 바뀌지 않아
  //  ChatRoomRow(React.memo)가 검색 타이핑·선택 변경 등 리렌더에 전량 재렌더되지 않는다.
  const selectRoomRef = useRef(selectRoom);
  selectRoomRef.current = selectRoom;
  const handleRoomClick = useCallback((rm: EntityRecord) => selectRoomRef.current(rm), []);
  useEffect(() => { (async () => {
    await initAuth();
    await seedIfEmpty(co); const r = getRole(); setRoleS(r); const s = await load(r);
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('room') : null;
    // 일반 진입은 데스크톱도 목록만 연다. 첫 방 자동선택은 ChatThread의 markRead를 호출해
    // 사용자가 보지 않은 실데이터를 읽음 처리하므로, 명시적인 ?room= 딥링크만 선택한다.
    const target = requestedChatRoom(s, wanted);
    if (target) selectRoom(target);
  })(); /* eslint-disable-next-line */ }, []);

  // ?room= 방이 첫 load에 없으면(권한·타이밍) 목록이 갱신될 때 한 번 더 연다. 이미 다른 방 선택 중이면 건드리지 않음.
  useEffect(() => {
    if (!rooms || sel) return;
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('room') : null;
    if (!wanted) return;
    const target = rooms.find((x) => String(x._key) === wanted);
    if (target) void selectRoomRef.current(target);
  }, [rooms, sel]);

  useEffect(() => { const on = (e: Event) => { const r = (e as CustomEvent).detail as Role; setRoleS(r); (async () => { await load(r); clearSel(); })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === '/chat') clearSel();
    };
    window.addEventListener('fp:work-list', on);
    return () => window.removeEventListener('fp:work-list', on);
  }, []);

  // 열람·전송 후 목록·뱃지 안읽음 갱신 — 방목록·안읽음(+계약)만 부분 갱신(전체 매물 카탈로그 재조회 안 함).
  useEffect(() => {
    const on = () => { void refreshRooms(getRole()); };
    window.addEventListener('fp:unread', on);
    return () => window.removeEventListener('fp:unread', on);
    /* eslint-disable-next-line */
  }, []);

  // 상대가 보낸 새 문의·새 메시지는 이쪽에 알릴 계기가 없다 — 화면이 보이는 동안만 주기적으로,
  //  그리고 앱·탭 복귀 즉시 다시 읽는다. store 의 LIVE TTL(10초)이 실조회를 열어주므로 실제로 새 값이 온다(QA SYNC-1).
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void refreshRooms(getRole()); };
    const id = window.setInterval(tick, 20_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
    /* eslint-disable-next-line */
  }, []);

  // 방목록 필터·정렬 — 실제 사용값(rooms·q·flt·sort·role·계약인덱스)이 바뀔 때만 재계산.
  //  contractOf는 contractIndex를 읽으므로 deps에 contractIndex 포함(값 의미는 원본 find와 동일).
  const shownRooms = useMemo(() => filterChatRooms({
    rooms: rooms || [], query: q, filter: flt, sort, role, contractIndex, cancelledIndex,
    searchText: (room) => joinMetaText([
      roomHead(room), roomPlateOf(room),
      contractStage(chatRowContract(room, flt, contractIndex, cancelledIndex)).label,
      roomCounter(room),
    ]),
    nameOf: roomHead,
  }), [rooms, q, flt, sort, role, contractIndex, cancelledIndex, productLookup, deletedLookup, providerAliases]);
  const draftPreviewCount = useMemo(() => chatRoomPreviewCount({
    rooms: rooms || [], query: q, filter: draftFlt, role, contractIndex, cancelledIndex,
    searchText: (room) => joinMetaText([
      roomHead(room), roomPlateOf(room),
      contractStage(chatRowContract(room, draftFlt, contractIndex, cancelledIndex)).label,
      roomCounter(room),
    ]),
    nameOf: roomHead,
  }), [rooms, q, draftFlt, role, contractIndex, cancelledIndex, productLookup, deletedLookup, providerAliases]);
  const rowContract = (room: EntityRecord) => chatRowContract(room, flt, contractIndex, cancelledIndex);

  // 필터·검색에서 선택행이 사라지면 상세도 함께 비운다. 숨은 이전 행을 계속 보여주지 않는다.
  useEffect(() => {
    if (!rooms || !sel) return;
    const visible = shownRooms.map((room) => String(room._key));
    if (retainVisibleSelection(sel, visible) === sel) return;
    clearSel();
    // clearSel은 최신 선택 epoch와 URL room 파라미터를 함께 정리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, shownRooms, sel]);

  const roomListEl = <ChatRoomList
    rooms={shownRooms}
    role={role}
    selected={sel}
    query={qInput}
    filterActive={flt !== CHAT_FILTER_DEFAULT}
    displayName={roomHead}
    plate={roomPlateOf}
    contract={rowContract}
    counter={roomCounter}
    onSelect={handleRoomClick}
    onReset={() => { setQInput(''); setQ(''); setFlt(CHAT_FILTER_DEFAULT); }}
  />;

  // CenterNote는 PaneBody 안에 둔다 — 헤더의 형제로 두면 헤더 높이까지 먹어
  //  문구 중심이 헤더 절반(16px)만큼 내려가 옆 패널과 눈높이가 안 맞았다.
  const emptyPane = (t: string, msg: string) => <><PaneHead title={t} /><PaneBody><CenterNote>{msg}</CenterNote></PaneBody></>;
  const selContract = selRoom ? rowContract(selRoom) : undefined;
  const inContract = !!selContract;
  // 원본 명시 링크가 있으면 resolver가 현재 인덱스에서 못 찾더라도 버리지 않는다.
  // ContractPanel도 이 링크가 존재할 때 다른 차량·담당자 계약으로 재추정하지 않는다.
  const rawLinked = String(selRoom?.linked_contract || '').trim();
  const linked = rawLinked || (selContract ? String(selContract.contract_code) : undefined);
  const docCode = linked;
  const scroll = (n: ReactNode) => <PaneBody>{n}</PaneBody>;
  const reloadContracts = async () => setContracts(await getStore().list('contract', co));
  // 빈 상태는 CenterNote 완결문 한 종류로 — '—' 한 글자만 놓으면 데이터가 깨진 것처럼 읽힌다.
  const contractBody = !sel
    ? <CenterNote>대화를 선택하세요.</CenterNote>
    : isContractCancelled(selContract)
      ? <CenterNote>{joinMetaText([selContract?.contract_code, '취소된 계약입니다.'])}</CenterNote>
      : <ContractPanel key={String(sel)} product={selProduct} roomId={sel || undefined} linkedCode={linked} agentCode={selRoom ? String(selRoom.agent_code || '') : undefined} onChange={reloadContracts} />;
  const docsBody = docCode
    ? <ContractDocs key={`${String(sel)}:${docCode}`} contractCode={docCode} roomId={sel || undefined} readOnly={isContractCancelled(selContract)} />
    : <CenterNote>계약문의를 시작하면 서류를 첨부할 수 있습니다.</CenterNote>;
  const vehicleBlock = selProduct
    ? <>{selProduct._fromHistory ? <div style={{ fontSize: FS.cap, color: C.faint, marginBottom: 8 }}>재고에서 내려간 매물 · 계약 이력 기준</div> : null}<ProductDetail p={selProduct} /></>
    : <CenterNote>이 매물의 이력이 없습니다.</CenterNote>;

  // 계약진행 이동 = 하단 swap + 상단 우측(erp3 headerRight 클립보드).
  const selectedVehicleName = selRoom
    ? roomVehicleDetailLabel(selRoom, selProduct, selContract) || roomHead(selRoom)
    : '';
  const chatHead = selRoom
    ? [roomPlateOf(selRoom), selectedVehicleName].filter(Boolean).join(' ')
    : '';
  const chatCode = selRoom ? roomChatCode(selRoom) : '';
  const chatNode = sel
    ? <ChatThread roomId={sel} title={chatHead} chatCode={chatCode} onComposeFocus={setComposing} />
    : emptyPane('채팅', '왼쪽에서 대화를 선택하세요.');

  const headerActions = sel && mobile ? (
    <IconBtn
      title={swapKey === 'chat' ? '계약진행' : '채팅'}
      haptic="nav"
      onClick={() => setSwapKey(swapKey === 'chat' ? 'progress' : 'chat')}
    >
      {swapKey === 'chat'
        ? <ClipboardList size={18} strokeWidth={2.25} aria-hidden />
        : <MessageCircle size={18} strokeWidth={2.25} aria-hidden />}
    </IconBtn>
  ) : undefined;

  // 모바일 계약진행 = /contract 모바일 스택과 동일(진행 → 서류). 상품상세·정산은 각 페이지 규격.
  const progressNode = (
    <div style={{ height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <section
        aria-label="진행"
        style={{ borderBottom: `1px solid ${C.line}`, background: 'var(--bg-card)', boxSizing: 'border-box' }}
      >
        <PaneHead title="계약 진행상황" />
        <PaneBody>{contractBody}</PaneBody>
      </section>
      <section
        aria-label="서류"
        style={{ background: 'var(--bg-card)', boxSizing: 'border-box' }}
      >
        <PaneHead title="첨부 서류" />
        <PaneBody>{docsBody}</PaneBody>
      </section>
    </div>
  );

  const webPanes: WorkPane[] = [
    { key: 'chat', title: '채팅', node: chatNode },
    {
      key: 'detail',
      title: inContract ? '서류' : '상품',
      node: inContract
        ? <><PaneHead title="첨부 서류" />{scroll(docsBody)}</>
        : <><PaneHead title="문의 차량" /><PaneBody pad>{vehicleBlock}</PaneBody></>,
    },
    { key: 'contract', title: '계약', node: <><PaneHead title="계약 진행상황" />{scroll(contractBody)}</> },
  ];

  const mobilePanes: WorkPane[] = [
    { key: 'chat', title: '채팅', icon: MessageCircle, node: chatNode },
    { key: 'progress', title: '계약진행', icon: ListChecks, node: progressNode },
  ];

  const inquiryUnreadN = unreadRoomCount(
    (rooms || []).filter((rm) => {
      const contract = roomContract(rm);
      return !isContractCancelled(contract) && isInquiryOnly(contract);
    }),
    role,
  );

  return (
    <>
    <WorkPage
      title={NAV_LABEL.chat}
      statusLabel="문의 미확인"
      statusCount={rooms === null ? null : inquiryUnreadN}
      listCount={rooms === null ? null : shownRooms.length}
      list={rooms === null ? <FeedRowSkeleton /> : roomListEl}
      panes={mobile ? mobilePanes : webPanes}
      selected={!!sel}
      onBack={clearSel}
      contextTitle={selRoom
        ? (() => {
            // 목록과 같은 snapshot을 쓰되 상세 헤더는 T2 전체 사양. 차번은 우측 대화코드와 중복하지 않는다.
            const head = selectedVehicleName;
            const code = roomChatCode(selRoom);
            return (
              <span style={{ display: 'inline-flex', alignItems: 'baseline', minWidth: 0, maxWidth: '100%' }}>
                <span style={{
                  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {head}
                </span>
                {code ? (
                  <span style={{
                    flex: '0 0 auto', marginLeft: 8, color: C.faint, fontWeight: FW.label,
                    fontSize: FS.sub, fontFamily: NUM, fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{code}</span>
                ) : null}
              </span>
            );
          })()
        : undefined}
      search={{ value: qInput, onChange: setQInput, placeholder: '차번·상품·영업…' }}
      mobileLayout="swap"
      headerActions={headerActions}
      // 하단독은 **키보드가 실제로 올라와 있을 때만** 숨긴다(채팅 탭 한정).
      //  포커스 기준으로 두면 뒤로가기로 키보드만 내렸을 때 입력칸은 계속 포커스라
      //  하단독이 영영 안 돌아와 목록으로 나갈 수가 없다. visualViewport 미지원 환경만 포커스로 폴백.
      hideDock={(kb.supported ? kb.open : composing) && swapKey === 'chat'}
      mobileSwapKey={swapKey}
      onMobileSwapKeyChange={setSwapKey}
      countSuffix="건"
      listTools={{
        search: { value: qInput, onChange: setQInput, placeholder: '차번·상품·영업…' },
        sort: { value: sort, onChange: (v) => setSort(v as ChatSort | ''), options: CHAT_SORTS },
        filter: {
          count: flt === CHAT_FILTER_DEFAULT ? 0 : 1,
          title: '조건 검색',
          previewCount: draftPreviewCount,
          previewUnit: '건',
          dirty: draftFlt !== flt,
          capture: () => setDraftFlt(flt),
          restore: () => setDraftFlt(flt),
          commit: () => setFlt(draftFlt),
          onClear: () => mobile ? setDraftFlt(CHAT_FILTER_DEFAULT) : setFlt(CHAT_FILTER_DEFAULT),
            body: (
              <FilterGroup
                title="분류"
                count={(mobile ? draftFlt : flt) === CHAT_FILTER_DEFAULT ? 0 : 1}
                defaultOpen
                first={!mobile}
                onClear={() => mobile ? setDraftFlt(CHAT_FILTER_DEFAULT) : setFlt(CHAT_FILTER_DEFAULT)}
              >
                <FilterChips
                  value={mobile ? draftFlt : flt}
                  onChange={mobile ? setDraftFlt : setFlt}
                  options={CHAT_FILTERS.map((o) => (
                    o.key === '미확인' && inquiryUnreadN > 0
                      ? { ...o, label: `미확인 ${inquiryUnreadN}` }
                      : o
                  ))}
                />
              </FilterGroup>
            ),
        },
        hints: [
          ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
          ...(sort ? [CHAT_SORTS.find((o) => o.value === sort)?.label || sort] : []),
          ...(flt !== CHAT_FILTER_DEFAULT ? [CHAT_FILTERS.find((o) => o.key === flt)?.label || flt] : []),
        ],
        onClearHints: () => { setQInput(''); setQ(''); setSort(''); setFlt(CHAT_FILTER_DEFAULT); },
      }}
    />
    </>
  );
}
