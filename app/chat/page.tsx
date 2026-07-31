'use client';
import { useCallback, useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile, isMobileViewport } from '@/lib/use-mobile';
import { useKeyboardOpen } from '@/lib/use-keyboard';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { roomsWithUnread, unreadFor, unreadRoomCount } from '@/lib/domain/messaging';
import { getProgress, isInquiryOnly } from '@/lib/domain/contract';
import { withProviderNames } from '@/lib/domain/identity';
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
import { canAccessOwnedRecord } from '@/lib/domain/authorization';
import { initAuth } from '@/lib/firebase/auth';
import {
  buildContractIndex,
  buildProductLookup,
  chatCodeOf,
  contractForRoom,
  providerForRoom,
  roomPlate,
  roomModel as resolveRoomModel,
  roomTitle as resolveRoomTitle,
} from '@/features/chat/room-display';
import {
  CHAT_FILTER_DEFAULT,
  CHAT_FILTERS,
  CHAT_SORTS,
  chatRoomPreviewCount,
  filterChatRooms,
  isWorkspaceChatRoom,
  type ChatFilter,
  type ChatSort,
} from '@/features/chat/room-filter';
import { ListChecks, MessageCircle, ClipboardList } from 'lucide-react';
import { ChatRoomList } from '@/features/chat/ChatRoomList';

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
  const [sel, setSel] = useState<string | null>(null);
  const [selRoom, setSelRoom] = useState<EntityRecord | null>(null);
  const [selProduct, setSelProduct] = useState<EntityRecord | null>(null);
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

  // 계약 인덱스 — `product_code|agent_code` → 계약. 현행 contracts.find 순서를 정확 재현:
  //  · '계약취소'는 후보에서 제외(find의 `c.contract_status !== '계약취소'`).
  //  · 같은 키에 비취소 계약이 여럿이면 배열에서 먼저 나온 것 우선(find가 먼저 만나는 원소).
  const contractIndex = useMemo(() => buildContractIndex(contracts, false), [contracts]);
  // 취소 필터 전용 — 취소된 계약만(동일 키 first-wins). contractIndex와 분리(취소 제외 인덱스는 항상 빈결과였음).
  const cancelledIndex = useMemo(() => buildContractIndex(contracts, true), [contracts]);
  const contractOf = (rm: EntityRecord) => contractForRoom(contractIndex, rm);
  const cancelledOf = (rm: EntityRecord) => contractForRoom(cancelledIndex, rm);
  const productLookup = useMemo(() => buildProductLookup(products), [products]);
  const deletedLookup = useMemo(() => buildProductLookup(deletedProducts), [deletedProducts]);
  /** 방 제목 = 실차명 해석. v3 방은 product_uid(=매물 _key)·car_number로 연결. 방값→매물→계약스냅샷→차번 순. (표시만, 데이터 미변경) */
  const roomTitle = (rm: EntityRecord): string => resolveRoomTitle(rm, productLookup, deletedLookup, contracts, contractOf(rm));
  const roomChatCode = (rm: EntityRecord): string =>
    chatCodeOf(rm, roomPlate(rm, productLookup, deletedLookup, contracts, contractOf(rm)));
  /** 매물 공급사 표기 — 관리자 응대용(이름 우선, 없으면 코드). */
  const providerOf = (rm: EntityRecord) => providerForRoom(rm, productLookup);
  /** 목록 규격 — ①줄=차량명 ②줄=차번. 헤더(contextTitle)는 합본 roomTitle을 그대로 쓴다. */
  const roomHead = (rm: EntityRecord): string => resolveRoomModel(rm, productLookup, deletedLookup, contracts, contractOf(rm));
  const roomPlateOf = (rm: EntityRecord): string => roomPlate(rm, productLookup, deletedLookup, contracts, contractOf(rm));
  const roomCounter = (rm: EntityRecord): string => {
    const ag = String(rm.agent_code || '').trim();
    const pv = providerOf(rm);
    if (role === 'provider') return ag;
    if (role === 'admin') return ag;
    return pv.name || pv.code;
  };
  const sortByRecent = (arr: EntityRecord[]) => arr.slice().sort((a, b) => Number(b.last_message_at || 0) - Number(a.last_message_at || 0));
  // 점진 로딩 — 1차: 방 목록만 즉시 페인트(저장된 안읽음 카운터·차명은 코드 폴백).
  //  2차(백그라운드): 상품카탈로그·계약·전체 메시지 안읽음 보강 → 차명·필터·안읽음 채움.
  //  전량 선반입을 첫 페인트 뒤로 미뤄 계약진행만큼 빠르게 목록이 뜸.
  const load = async (r: Role): Promise<EntityRecord[]> => {
    const store = getStore();
    // 카탈로그를 방 목록과 "동시에" 출발 — 방을 받은 뒤 시작하면 네트워크 왕복이 한 번 더 붙어
    // 목록이 뜬 다음 차량번호·차명이 뒤늦게 따라붙는 게 눈에 보인다.
    // 차명 조인은 원본(listRaw) 기준 — 판매용 목록은 중복정리·제외로 예전 문의 차를 놓친다.
    const catalogP = Promise.all([
      store.list('contract', co),
      typeof store.listRaw === 'function' ? store.listRaw('product', co) : store.list('product', co),
      store.listDeleted('product', co).catch(() => []),
      store.list('partner', co).catch(() => []),
    ]);
    const all = await store.list('room', co);
    const mine = all.filter((x) => canAccessOwnedRecord(getSession(), x) && isWorkspaceChatRoom(x, r));
    setRooms(sortByRecent(mine)); // ← 즉시 페인트
    void (async () => {
      try {
        const [cts, prods, del, partners] = await catalogP;
        setContracts(cts);
        setProducts(withProviderNames(prods, partners));
        setDeletedProducts(del);
        const withUnread = await roomsWithUnread(mine, r);
        setRooms(sortByRecent(withUnread));
      } catch (e) {
        // 무음 실패 금지 — 여기서 죽으면 방의 차명이 전부 코드/번호 폴백으로 남아 "차량 조회불가"처럼 보인다.
        console.error('[chat] 카탈로그 보강 실패(상품·계약·파트너 로드):', e);
      }
    })();
    return sortByRecent(mine);
  };
  // 방목록·안읽음(+계약)만 부분 갱신 — products/deletedProducts 카탈로그는 재조회하지 않음(fp:unread 경량 경로).
  //  메시지 열람/전송으로 카탈로그는 변하지 않으므로 최초 load에서 받은 products·deletedProducts(삭제매물 이름복원)를 재사용.
  const refreshRooms = async (r: Role): Promise<EntityRecord[]> => {
    const [all, cts] = await Promise.all([getStore().list('room', co), getStore().list('contract', co)]);
    setContracts(cts);
    const mine = all.filter((x) => canAccessOwnedRecord(getSession(), x) && isWorkspaceChatRoom(x, r));
    const withUnread = await roomsWithUnread(mine, r);
    const sorted = withUnread.sort((a, b) => Number(b.last_message_at || 0) - Number(a.last_message_at || 0));
    setRooms(sorted);
    return sorted;
  };
  const resolveProduct = async (rm: EntityRecord): Promise<EntityRecord | null> => {
    const live = await getStore().get('product', co, String(rm.product_code));
    if (live) return live;
    const cts = await getStore().list('contract', co);
    const c = cts.find((x) => String(x.product_code) === String(rm.product_code) && String(x.agent_code) === String(rm.agent_code) && x.contract_status !== '계약취소')
      || cts.find((x) => String(x.product_code) === String(rm.product_code));
    if (!c && !rm.vehicle_name) return null;
    return {
      product_code: rm.product_code,
      car_number: rm.car_number || c?.car_number_snapshot || '',
      maker: c?.maker_snapshot || '', sub_model: c?.sub_model_snapshot || '', vehicle_name: rm.vehicle_name || '',
      ...(c && Number(c.rent_month_snapshot) ? { price: { [String(c.rent_month_snapshot)]: { rent: Number(c.rent_amount_snapshot) || 0, deposit: Number(c.deposit_amount_snapshot) || 0 } } } : {}),
      _fromHistory: true,
    } as EntityRecord;
  };
  const selectRoom = async (rm: EntityRecord) => {
    setSel(String(rm._key));
    setSelRoom(rm);
    setSelProduct(await resolveProduct(rm));
    setSwapKey('chat');
  };
  const clearSel = () => {
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
  // 방행 클릭 = 최신 selectRoom을 안정 참조로 호출. handleRoomClick 참조가 렌더마다 바뀌지 않아
  //  ChatRoomRow(React.memo)가 검색 타이핑·선택 변경 등 리렌더에 전량 재렌더되지 않는다.
  const selectRoomRef = useRef(selectRoom);
  selectRoomRef.current = selectRoom;
  const handleRoomClick = useCallback((rm: EntityRecord) => selectRoomRef.current(rm), []);
  const firstInquiry = (list: EntityRecord[], cts: EntityRecord[]) => {
    const of = (rm: EntityRecord) => cts.find((c) => String(c.product_code) === String(rm.product_code) && String(c.agent_code) === String(rm.agent_code) && c.contract_status !== '계약취소');
    return list.find((rm) => isInquiryOnly(of(rm))) || list[0];
  };
  useEffect(() => { (async () => {
    await initAuth();
    await seedIfEmpty(co); const r = getRole(); setRoleS(r); const s = await load(r);
    const cts = await getStore().list('contract', co);
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('room') : null;
    // 모바일은 '목록 먼저' — 첫 방 자동선택은 웹만. mobile(첫 렌더 SSR힌트)이 데스크톱으로 어긋나
    //  모바일서도 방이 열리던 버그 → 마운트 시점 신뢰되는 isMobileViewport()로 직접 판정.
    const target = wanted ? s.find((x) => String(x._key) === wanted) : (!isMobileViewport() ? firstInquiry(s, cts) : undefined);
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

  useEffect(() => { const on = (e: Event) => { const r = (e as CustomEvent).detail as Role; setRoleS(r); (async () => { const s = await load(r); clearSel(); if (!mobile && s.length) { const cts = await getStore().list('contract', co); selectRoom(firstInquiry(s, cts)); } })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, [mobile]);

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
  }), [rooms, q, flt, sort, role, contractIndex, cancelledIndex]);
  const draftPreviewCount = useMemo(() => chatRoomPreviewCount({
    rooms: rooms || [], query: q, filter: draftFlt, role, contractIndex, cancelledIndex,
  }), [rooms, q, draftFlt, role, contractIndex, cancelledIndex]);
  const roomListEl = <ChatRoomList
    rooms={shownRooms}
    role={role}
    selected={sel}
    query={qInput}
    filterActive={flt !== CHAT_FILTER_DEFAULT}
    displayName={roomHead}
    plate={roomPlateOf}
    providerName={(room) => {
      if (role !== 'admin') return undefined;
      const provider = providerOf(room);
      return provider.name || provider.code || undefined;
    }}
    contract={contractOf}
    counter={roomCounter}
    onSelect={handleRoomClick}
    onReset={() => { setQInput(''); setQ(''); setFlt(CHAT_FILTER_DEFAULT); }}
  />;

  // CenterNote는 PaneBody 안에 둔다 — 헤더의 형제로 두면 헤더 높이까지 먹어
  //  문구 중심이 헤더 절반(16px)만큼 내려가 옆 패널과 눈높이가 안 맞았다.
  const emptyPane = (t: string, msg: string) => <><PaneHead title={t} /><PaneBody><CenterNote>{msg}</CenterNote></PaneBody></>;
  const linked = selRoom?.linked_contract ? String(selRoom.linked_contract) : undefined;
  const selContract = selRoom ? contractOf(selRoom) : undefined;
  const inContract = !!selContract && getProgress(selContract).done >= 1;
  const docCode = selContract ? String(selContract.contract_code) : linked;
  const scroll = (n: ReactNode) => <PaneBody>{n}</PaneBody>;
  const reloadContracts = async () => setContracts(await getStore().list('contract', co));
  // 빈 상태는 CenterNote 완결문 한 종류로 — '—' 한 글자만 놓으면 데이터가 깨진 것처럼 읽힌다.
  const contractBody = sel ? <ContractPanel product={selProduct} roomId={sel} linkedCode={linked} agentCode={selRoom ? String(selRoom.agent_code || '') : undefined} onChange={reloadContracts} /> : <CenterNote>대화를 선택하세요.</CenterNote>;
  const docsBody = docCode ? <ContractDocs contractCode={docCode} roomId={sel || undefined} /> : <CenterNote>계약문의를 시작하면 서류를 첨부할 수 있습니다.</CenterNote>;
  const vehicleBlock = selProduct
    ? <>{selProduct._fromHistory ? <div style={{ fontSize: FS.cap, color: C.faint, marginBottom: 8 }}>재고에서 내려간 매물 · 계약 이력 기준</div> : null}<ProductDetail p={selProduct} /></>
    : <CenterNote>이 매물의 이력이 없습니다.</CenterNote>;

  // 계약진행 이동 = 하단 swap + 상단 우측(erp3 headerRight 클립보드).
  const chatHead = selRoom ? roomTitle(selRoom) : '';
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
    (rooms || []).filter((rm) => isInquiryOnly(contractOf(rm))),
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
            const head = roomTitle(selRoom);
            const code = roomChatCode(selRoom);
            const pv = role === 'admin' ? providerOf(selRoom) : null;
            const suf = pv ? (pv.name || pv.code) : '';
            return (
              <span style={{ display: 'inline-flex', alignItems: 'baseline', minWidth: 0, maxWidth: '100%' }}>
                <span style={{
                  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {head}
                  {suf ? <span style={{ color: C.mute, fontWeight: FW.strong }}> · {suf}</span> : null}
                </span>
                {code ? (
                  <span style={{
                    flex: '0 0 auto', marginLeft: 8, color: C.faint, fontWeight: FW.label,
                    fontSize: FS.sub, fontFamily: NUM, fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
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
