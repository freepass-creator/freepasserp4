'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { roomsWithUnread, unreadFor, unreadRoomCount } from '@/lib/domain/messaging';
import { getProgress, isInquiryOnly } from '@/lib/domain/contract';
import { PaneHead, Btn, C, Loading, CenterNote, PaneBody, FilterChips, SectionLabel } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { ChatThread } from '@/components/ChatThread';
import { ProductDetail } from '@/components/ProductDetail';
import { ContractPanel } from '@/components/ContractPanel';
import { ContractDocs } from '@/components/ContractDocs';
import { matchRoomQuery } from '@/lib/domain/search';
import { haptic } from '@/lib/haptics';
import { ChatRoomRow } from '@/components/list-rows';

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
  const [sel, setSel] = useState<string | null>(null);
  const [selRoom, setSelRoom] = useState<EntityRecord | null>(null);
  const [selProduct, setSelProduct] = useState<EntityRecord | null>(null);
  const [q, setQ] = useState('');
  const [swapKey, setSwapKey] = useState('chat');
  const [sort, setSort] = useState<ChatSort | ''>('');
  const [flt, setFlt] = useState<ChatFilter>('문의');

  const contractOf = (rm: EntityRecord) => contracts.find((c) => String(c.product_code) === String(rm.product_code) && String(c.agent_code) === String(rm.agent_code) && c.contract_status !== '계약취소');
  const load = async (r: Role): Promise<EntityRecord[]> => {
    const [all, cts] = await Promise.all([getStore().list('room', co), getStore().list('contract', co)]);
    setContracts(cts);
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
    ? <div style={{ padding: 24, textAlign: 'center', color: C.faint, fontSize: 12.5 }}>{q || flt !== '문의' ? '검색 결과 없음' : role === 'provider' ? '들어온 문의가 없습니다.' : role === 'admin' ? '채팅 중인 문의가 없습니다.' : '채팅 중인 문의가 없습니다.'}</div>
    : <div>{shownRooms.map((rm) => {
        const counter = role === 'provider' ? String(rm.agent_code || '') : role === 'agent' ? String(rm.provider_company_code || '') : `${rm.agent_code || ''} ↔ ${rm.provider_company_code || ''}`;
        return (
          <ChatRoomRow
            key={String(rm._key)}
            room={rm}
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
  const contractBody = sel ? <ContractPanel product={selProduct} roomId={sel} linkedCode={linked} agentCode={selRoom ? String(selRoom.agent_code || '') : undefined} onChange={reloadContracts} /> : <div style={{ padding: 16, color: C.faint, fontSize: 12.5 }}>—</div>;
  const docsBody = docCode ? <ContractDocs contractCode={docCode} roomId={sel || undefined} /> : <div style={{ padding: 16, color: C.faint, fontSize: 12.5 }}>계약문의를 시작하면 서류를 첨부할 수 있습니다.</div>;
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
        <div style={{ fontSize: 12, fontWeight: 800, color: C.faint, marginBottom: 8 }}>{inContract ? '첨부 서류' : '문의 차량'}</div>
        {inContract ? docsBody : vehicleBlock}
        <div style={{ fontSize: 12, fontWeight: 800, color: C.faint, margin: '18px 0 8px' }}>계약</div>
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
      title="문의"
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
