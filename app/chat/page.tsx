'use client';
import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { roomsWithUnread, unreadFor, unreadRoomCount } from '@/lib/domain/messaging';
import { getProgress, isInquiryOnly } from '@/lib/domain/contract';
import { vehicleName } from '@/lib/domain/product';
import { PaneHead, Btn, C, Loading, CenterNote, PaneBody, FilterChips, SectionLabel, FW, FS } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { ChatThread } from '@/components/ChatThread';
import { ProductDetail } from '@/components/ProductDetail';
import { ContractPanel } from '@/components/ContractPanel';
import { ContractDocs } from '@/components/ContractDocs';
import { matchRoomQuery } from '@/lib/domain/search';
import { haptic } from '@/lib/haptics';
import { ChatRoomRow } from '@/components/list-rows';
import { NAV_LABEL } from '@/lib/tabbar';

type ChatSort = 'unread' | 'name';
type ChatFilter = '문의' | 'all' | '완료' | '취소';

const CHAT_SORTS: { value: ChatSort; label: string }[] = [
  { value: 'unread', label: '안읽음' },
  { value: 'name', label: '차명순' },
];
const CHAT_FILTERS: { key: ChatFilter; label: string }[] = [
  { key: '문의', label: '문의' },
  { key: 'all', label: '전체' },
  { key: '완료', label: '완료' },
  { key: '취소', label: '취소' },
];

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
  const [q, setQ] = useState('');
  const [swapKey, setSwapKey] = useState('chat');
  const [sort, setSort] = useState<ChatSort | ''>('');
  const [flt, setFlt] = useState<ChatFilter>('문의');

  const contractOf = (rm: EntityRecord) => contracts.find((c) => String(c.product_code) === String(rm.product_code) && String(c.agent_code) === String(rm.agent_code) && c.contract_status !== '계약취소');
  const productLookup = useMemo(() => {
    const byId = new Map<string, EntityRecord>();   // product_code·_key 둘 다 색인 (v3 방은 product_uid=_key로 연결)
    const byCar = new Map<string, EntityRecord>();
    for (const p of products) {
      const code = String(p.product_code || ''); const key = String(p._key || ''); const car = String(p.car_number || '');
      if (code) byId.set(code, p);
      if (key && !byId.has(key)) byId.set(key, p);
      if (car) byCar.set(car, p);
    }
    return { byId, byCar };
  }, [products]);
  const deletedLookup = useMemo(() => {
    const byId = new Map<string, EntityRecord>(); const byCar = new Map<string, EntityRecord>();
    for (const p of deletedProducts) {
      const code = String(p.product_code || ''); const key = String(p._key || ''); const car = String(p.car_number || '');
      if (code) byId.set(code, p); if (key && !byId.has(key)) byId.set(key, p); if (car) byCar.set(car, p);
    }
    return { byId, byCar };
  }, [deletedProducts]);
  /** 방 제목 = 실차명 해석. v3 방은 product_uid(=매물 _key)·car_number로 연결. 방값→매물→계약스냅샷→차번 순. (표시만, 데이터 미변경) */
  const roomTitle = (rm: EntityRecord): string => {
    const vn = String(rm.vehicle_name || '').trim();
    if (vn) return vn;
    const car = String(rm.car_number || '').trim();
    const p = productLookup.byId.get(String(rm.product_code))
      || productLookup.byId.get(String(rm.product_uid))
      || productLookup.byId.get(String(rm.product_id))
      || (car ? productLookup.byCar.get(car) : undefined);
    if (p) { const n = vehicleName(p); if (n) return n; }
    // 계약 스냅샷 — resolveProduct 와 동일 관대함: agent 무관, 취소 계약까지 최종 폴백. 차명 없으면 계약의 차번(car_number_snapshot)이라도.
    const pc = String(rm.product_code || '');
    const c = pc ? (contractOf(rm)
      || contracts.find((x) => String(x.product_code) === pc && String(x.contract_status || '') !== '계약취소')
      || contracts.find((x) => String(x.product_code) === pc)) : undefined;
    if (c) {
      const snap = [c.maker_snapshot, c.sub_model_snapshot].filter(Boolean).join(' ').trim();
      if (snap) return snap;
      const csnapCar = String(c.car_number_snapshot || '').trim();
      if (csnapCar) return csnapCar;
    }
    // 삭제된 매물(휴지통)에서라도 이름 복원
    const dp = deletedLookup.byId.get(String(rm.product_code))
      || deletedLookup.byId.get(String(rm.product_uid))
      || deletedLookup.byId.get(String(rm.product_id))
      || (car ? deletedLookup.byCar.get(car) : undefined);
    if (dp) { const n = vehicleName(dp); if (n) return car ? `${n} (삭제)` : n; }
    // 어디에도 정보 없음 — 매물이 삭제/제외돼 정보 유실. blank 대신 명시.
    return car ? `${car} (삭제된 차량)` : '삭제된 차량';
  };
  /** 채팅 참여자 = 코드 표기(영업코드 ↔ 공급사코드). 역할별 관점. */
  const roomCounter = (rm: EntityRecord): string => {
    const ag = String(rm.agent_code || '').trim();
    const pv = String(rm.provider_company_code || '').trim();
    return role === 'provider' ? ag : role === 'agent' ? pv : [ag, pv].filter(Boolean).join(' ↔ ');
  };
  const load = async (r: Role): Promise<EntityRecord[]> => {
    const [all, cts, prods, del] = await Promise.all([getStore().list('room', co), getStore().list('contract', co), getStore().list('product', co), getStore().listDeleted('product', co).catch(() => [])]);
    setContracts(cts); setProducts(prods); setDeletedProducts(del);
    const me = actor(r);
    const mine = r === 'admin' ? [...all] : r === 'provider' ? all.filter((x) => String(x.provider_company_code) === me.code) : all.filter((x) => String(x.agent_code) === me.code);
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
  const clearSel = () => { setSel(null); setSelRoom(null); setSelProduct(null); setSwapKey('chat'); };
  const firstInquiry = (list: EntityRecord[], cts: EntityRecord[]) => {
    const of = (rm: EntityRecord) => cts.find((c) => String(c.product_code) === String(rm.product_code) && String(c.agent_code) === String(rm.agent_code) && c.contract_status !== '계약취소');
    return list.find((rm) => isInquiryOnly(of(rm))) || list[0];
  };
  useEffect(() => { (async () => {
    await seedIfEmpty(co); const r = getRole(); setRoleS(r); const s = await load(r);
    const cts = await getStore().list('contract', co);
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('room') : null;
    const target = wanted ? s.find((x) => String(x._key) === wanted) : (!mobile ? firstInquiry(s, cts) : undefined);
    if (target) selectRoom(target);
  })(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const on = (e: Event) => { const r = (e as CustomEvent).detail as Role; setRoleS(r); (async () => { const s = await load(r); clearSel(); if (!mobile && s.length) { const cts = await getStore().list('contract', co); selectRoom(firstInquiry(s, cts)); } })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, [mobile]);

  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === '/chat') clearSel();
    };
    window.addEventListener('fp:work-list', on);
    return () => window.removeEventListener('fp:work-list', on);
  }, []);

  // 열람·전송 후 목록·뱃지 안읽음 갱신
  useEffect(() => {
    const on = () => { void load(getRole()); };
    window.addEventListener('fp:unread', on);
    return () => window.removeEventListener('fp:unread', on);
    /* eslint-disable-next-line */
  }, []);

  const shownRooms = (rooms || [])
    .filter((rm) => matchRoomQuery(rm, q))
    .filter((rm) => {
      if (flt === 'all') return true;
      const c = contractOf(rm);
      if (flt === '취소') return String(c?.contract_status || '') === '계약취소';
      if (flt === '완료') return String(c?.contract_status || '') === '계약완료';
      if (flt === '문의') return isInquiryOnly(c);
      return true;
    })
    .slice()
    .sort((a, b) => {
      if (!sort) return 0; // 기본 = load 최근순
      if (sort === 'unread') return unreadFor(b, role) - unreadFor(a, role) || Number(b.last_message_at || 0) - Number(a.last_message_at || 0);
      if (sort === 'name') return String(a.vehicle_name || '').localeCompare(String(b.vehicle_name || ''), 'ko');
      return 0;
    });
  const roomListEl = shownRooms.length === 0
    ? (
      <CenterNote>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <span>{q || flt !== '문의' ? '검색 결과 없음' : role === 'provider' ? '들어온 문의가 없습니다.' : role === 'admin' ? '채팅 중인 문의가 없습니다.' : '채팅 중인 문의가 없습니다.'}</span>
          {(q || flt !== '문의') ? (
            <Btn size="sm" variant="ghost" onClick={() => { setQ(''); setFlt('문의'); }}>조건 해제</Btn>
          ) : null}
        </div>
      </CenterNote>
    )
    : <div>{shownRooms.map((rm) => {
        const counter = roomCounter(rm);
        return (
          <ChatRoomRow
            key={String(rm._key)}
            room={rm}
            displayName={roomTitle(rm)}
            stageContract={contractOf(rm)}
            counter={counter}
            unread={unreadFor(rm, role)}
            selected={String(rm._key) === sel}
            onClick={() => selectRoom(rm)}
          />
        );
      })}</div>;

  const emptyPane = (t: string, msg: string) => <><PaneHead title={t} /><CenterNote>{msg}</CenterNote></>;
  const linked = selRoom?.linked_contract ? String(selRoom.linked_contract) : undefined;
  const selContract = selRoom ? contractOf(selRoom) : undefined;
  const inContract = !!selContract && getProgress(selContract).done >= 1;
  const docCode = selContract ? String(selContract.contract_code) : linked;
  const scroll = (n: ReactNode) => <PaneBody>{n}</PaneBody>;
  const reloadContracts = async () => setContracts(await getStore().list('contract', co));
  const contractBody = sel ? <ContractPanel product={selProduct} roomId={sel} linkedCode={linked} agentCode={selRoom ? String(selRoom.agent_code || '') : undefined} onChange={reloadContracts} /> : <div style={{ padding: 16, color: C.faint, fontSize: FS.sub }}>—</div>;
  const docsBody = docCode ? <ContractDocs contractCode={docCode} roomId={sel || undefined} /> : <div style={{ padding: 16, color: C.faint, fontSize: FS.sub }}>계약문의를 시작하면 서류를 첨부할 수 있습니다.</div>;
  const vehicleBlock = selProduct
    ? <>{selProduct._fromHistory ? <div style={{ fontSize: 11, color: C.faint, marginBottom: 8 }}>재고에서 내려간 매물 · 계약 이력 기준</div> : null}<ProductDetail p={selProduct} /></>
    : <CenterNote>이 매물의 이력이 없습니다.</CenterNote>;

  const goChat = () => { haptic.nav(); setSwapKey('chat'); };
  const goProgress = () => { haptic.nav(); setSwapKey('progress'); };

  const chatNode = sel
    ? <ChatThread roomId={sel} onContract={mobile ? () => goProgress() : undefined} />
    : emptyPane('채팅', '왼쪽에서 대화를 선택하세요.');

  // 모바일 계약진행 = 문의차량(또는 서류) + 계약패널을 한 스크롤에.
  const progressNode = (
    <>
      <PaneHead
        title="계약 진행"
        right={<Btn variant="ghost" size="sm" onClick={goChat}>채팅</Btn>}
      />
      <PaneBody pad>
        <div style={{ fontSize: 12, fontWeight: FW.label, color: C.faint, marginBottom: 8 }}>{inContract ? '첨부 서류' : '문의 차량'}</div>
        {inContract ? docsBody : vehicleBlock}
        <div style={{ fontSize: 12, fontWeight: FW.label, color: C.faint, margin: '18px 0 8px' }}>계약</div>
        {contractBody}
      </PaneBody>
    </>
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
    { key: 'contract', title: '계약', node: <><PaneHead title="계약 진행" />{scroll(contractBody)}</> },
  ];

  const mobilePanes: WorkPane[] = [
    { key: 'chat', title: '채팅', node: chatNode },
    { key: 'progress', title: '계약진행', node: progressNode },
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
      statusCount={inquiryUnreadN}
      listCount={shownRooms.length}
      list={rooms === null ? <Loading /> : roomListEl}
      panes={mobile ? mobilePanes : webPanes}
      selected={!!sel}
      onBack={clearSel}
      contextTitle={selRoom ? String(selRoom.vehicle_name || selRoom.car_number || '대화') : undefined}
      search={{ value: q, onChange: setQ, placeholder: '차번·상품·영업…' }}
      mobileLayout="swap"
      mobileSwapKey={swapKey}
      onMobileSwapKeyChange={setSwapKey}
      countSuffix="건"
      listTools={{
        search: { value: q, onChange: setQ, placeholder: '차번·상품·영업…' },
        sort: { value: sort, onChange: (v) => setSort(v as ChatSort | ''), options: CHAT_SORTS },
        filter: {
          count: flt === '문의' ? 0 : 1,
          title: '문의 필터',
          onClear: () => setFlt('문의'),
          body: (
            <>
              <SectionLabel mt={0}>분류</SectionLabel>
              <FilterChips value={flt} onChange={setFlt} options={CHAT_FILTERS} />
            </>
          ),
        },
        hints: [
          ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
          ...(sort ? [CHAT_SORTS.find((o) => o.value === sort)?.label || sort] : []),
          ...(flt !== '문의' ? [flt === 'all' ? '전체' : flt] : []),
        ],
        onClearHints: () => { setQ(''); setSort(''); setFlt('문의'); },
      }}
    />
    </>
  );
}
