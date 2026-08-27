'use client';
/**
 * **정산관리 — 관리자가 «만드는» 곳.** 4열이다.
 *
 * ★사장님 2026-08-26 (화면 규격을 이렇게 잡았다)
 * ```
 * 접수목록   검색 + 접수상태만 거른다
 * 접수내용   입력 폼. **검색·필터 없다** — 한 건을 적는 자리다
 * 실적상태   목록. 검색 + 공급사별·영업자별·상태별
 * 청구현황   목록. 검색 + 월·공급사·영업채널·상태. 청구서는 여기서 뽑는다
 * ```
 *   「4개 패널을 용도에 맞게」 · 「접수내용 빼고는 검색창과 필터버튼이 각각 있어야겠네」
 *   · 「청구관련 필터버튼은 청구패널에 있으면 된다고」 · 「이 업무를 하기에 있어서 최소화 되는거만」
 *
 * ★★**규격은 이 페이지가 정하지 않는다**(사장님 「이 페이지만의 규격을 쓰지말고 통일된 규격 쓰라고」).
 *   목록은 전부 **`FeedListRow` 2줄 도메인 행**(`LedgerListRow`)이다 — 재고·계약·계약서관리와 같은 손.
 *   **엑셀형 표를 쓰지 않는다**(「엑셀형 없어도 돼」) — 표가 필요하면 엑셀로 내려받는다.
 * ★★**판마다 필터가 따로 논다.** 목록에서 「미완료」를 보면서 청구현황에서는 8월 전체를 볼 수 있어야 한다.
 * ★★**축이 둘이고 섞지 않는다.**
 * ```
 * 접수상태  당월접수 · 미완료 · 분납실적 · 완납실적 · 취소    계약이 어디까지 왔나
 * 청구상태  미청구 · 환수위험 · 청구예정 · 청구완료 · 환수    돈이 어디까지 갔나
 * ```
 *   완납실적인데 미청구인 건이 있다 — 합쳐 놓으면 그걸 못 찾는다. **거기가 돈이 새는 자리다.**
 *
 * ★**적는 곳은 시트 하나다.** 여기서 접수하면 시트 「접수」 탭에 줄이 더해진다.
 * ★**판정은 화면이 안 한다.** 자리·청구월·수수료는 `settlement-stage.ts`,
 *   청구 상태는 `settlement-billstate.ts` 가 정한다.
 * ⚠ **금액을 고치는 버튼은 두지 않는다.** 수수료는 요율표에서 나온다 —
 *   화면에서 손대기 시작하면 그날로 정본이 둘이 된다. 고칠 일은 시트에서 고친다.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ledgerFetch } from '@/lib/firebase/ledger-client';
import { BILL_STATES, BILL_TONE, BILL_WHY, type BillState } from '@/lib/domain/settlement-billstate';
import { providerBillGate, type Confirmation } from '@/lib/domain/settlement-confirm';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { WebListTools } from '@/components/WebListTools';
import { LedgerListRow, SettlementCreateRow } from '@/components/list-rows';
import {
  Badge, Btn, C, CenterNote, DetailTable, DtRow, FilterChips, FormGrid, FormReadList,
  FS, Input, KV_LABEL_W, ListRow, Loading, NUM, PageActions, PaneBody, PaneHead, Select, Switch, won,
} from '@/components/ui';
import { toast } from '@/components/Toaster';
import { Banknote, ClipboardList, ListChecks } from 'lucide-react';

type Money = { claim: number; claimVat: number; claimTotal: number; pay: number; payVat: number; payTotal: number; margin: number; net: number };
type Row = {
  plate: string; customer: string; supplier: string; agent: string; channel: string; product: string;
  /** 영업채널 코드 — 관문이 «이것으로» 붙는다(사장님 2026-08-27 「원장과 코드로 해야지」). 빈칸이면 이름으로. */
  channelCode: string;
  model: string; term: number; rent: number; price: number; deposit: number; payKind: string;
  receivedAt: string; deliveredAt: string; clawbackAt: string; clawbackAmount: number;
  paper: boolean; delivered: boolean; cancelled: boolean; clawback: boolean;
  stage: string; bucket: string; billingMonth: string | null; money: Money; nextRound: string;
  billState: BillState; phone: string;
};
type Payload = { ok: boolean; reason?: string; count: number; readAt: string; ledgerUrl: string; rows: Row[] };

/** 접수상태 — 계약이 어디까지 왔나. 「진행중」은 담당자가 매일 보는 두 칸을 합친 것이다. */
const STAGES = ['진행중', '당월접수', '미완료', '분납실적', '완납실적', '취소'] as const;
const inStage = (r: Row, t: string) =>
  (t === '전체' ? true : t === '진행중' ? r.bucket === '당월접수' || r.bucket === '미완료' : r.bucket === t);

const PRODUCT_OPTS = ['장기렌트', '선출고', '견적출고', '구독', '오플구독'];
const PAY_KIND_OPTS = ['일시납', '2회분납', '3회분납'];

const hay = (r: Row) => `${r.plate} ${r.model} ${r.customer} ${r.supplier} ${r.agent} ${r.channel}`.toLowerCase();
const hit = (r: Row, q: string) => !q.trim() || hay(r).includes(q.trim().toLowerCase());

const TABLE_INP: React.CSSProperties = {
  border: 'none', borderRadius: 0, background: 'transparent', padding: 0,
  height: 'auto', fontSize: FS.body, lineHeight: 1.5, width: '100%',
};

type AgentOpt = { code: string; name: string; channel: string; label: string };

/**
 * **접수 입력 칸 — 담당자의 «의식의 흐름» 그대로.**
 *
 * ★사장님 2026-08-26 「담당자가 취급하는 정보가
 *   **언제 · 어떤 차를 · 누가(영업자가) · 누구한테 · 어떤 조건으로 · 어떤 방식으로 · 어떤 상태인지**」.
 *   그 문장이 곧 화면의 차례다. 칸을 늘리거나 옮길 일이 생기면 **이 문장에 먼저 물어본다.**
 *
 * ```
 * 언제        접수일                                    ← 오늘로 채워 둔다
 * 어떤 차를    차량번호* · 공급사 · 모델명                  ← 차를 고르면 뒤 둘이 따라온다
 * 누가        영업채널 · 영업담당자 · 영업자 연락처          ← 채널을 고르면 담당자가 좁혀진다
 * 누구한테     고객명 · 고객연락처
 * 어떤 조건     상품구분 · 계약기간 · 렌탈료* · 보증금 · 차량가액
 * 어떤 방식     분납여부
 * 어떤 상태     계약서 · 인도완료 · 인도일
 * ```
 *
 * ★★**채널을 «먼저» 고른다.** 실측 2026-08-26 — 영업채널 20곳, 채널당 평균 2.9명.
 *   이름만 있는 56명짜리 목록을 뒤지는 대신 채널로 3명까지 좁힌다.
 *   동명이인(이승호 — 렌트야·카핑)도 그 자리에서 갈린다.
 *
 * ★★**상태값을 접수에서 받는다.** 실측 — 접수 42줄 중 계약서 95%·인도완료 76%가
 *   이미 켜져 있었다. 안 받으면 접수하자마자 상세로 다시 들어가 켜야 한다(두 번 일).
 *   ⚠ 인도완료를 켜면 **인도일이 같이** 가야 한다. 날짜가 없으면 청구월이 안 선다(서버가 막는다).
 */
const YN = ['예', '아니오'];

/** 언제 · 어떤 차를 */
const CAR_FIELDS: Field[] = [
  { key: 'receivedAt', label: '접수일', type: 'date', required: true, note: '오늘로 채워 뒀습니다 — 밀려 적을 때만 고치세요' },
  { key: 'plate', label: '차량번호', type: 'text', required: true },
  { key: 'supplier', label: '공급사', type: 'text', note: '차를 고르면 따라옵니다' },
  { key: 'model', label: '모델명', type: 'text', note: '차를 고르면 따라옵니다' },
];
/** 누가 — 영업자. ★채널이 먼저다. */
const SELLER_FIELDS: Field[] = [
  { key: 'channel', label: '영업채널', type: 'select', options: [] },
  { key: 'agentCode', label: '영업담당자', type: 'select', options: [], note: '채널을 고르면 그 채널 사람만 뜹니다' },
  { key: 'agent', label: '영업담당자(직접)', type: 'text', note: '명부에 없을 때만' },
  { key: 'agentPhone', label: '영업자 연락처', type: 'text', note: '안 적어도 됩니다 — 동명이인 가릴 때 씁니다' },
];
/** 누구한테 — 고객 */
const CUSTOMER_FIELDS: Field[] = [
  { key: 'customer', label: '고객명', type: 'text' },
  { key: 'phone', label: '고객연락처', type: 'text', note: '안 적어도 됩니다 — 동명이인 가릴 때 씁니다' },
];
/** 어떤 조건으로 · 어떤 방식으로 */
const TERMS_FIELDS: Field[] = [
  { key: 'product', label: '상품구분', type: 'select', options: PRODUCT_OPTS },
  { key: 'term', label: '계약기간(개월)', type: 'number' },
  { key: 'rent', label: '렌탈료', type: 'number', required: true },
  { key: 'deposit', label: '보증금', type: 'number' },
  // ★수수료 기준을 «상품구분»이 정한다 — 선출고·견적출고면 차량가액 × 요율이다(feeOf).
  //   비면 수수료가 «0원»이 된다. 실측 2026-08-26 — 95건이 이 기준이고 빈칸은 1건.
  { key: 'price', label: '차량가액', type: 'number', note: '선출고·견적출고면 반드시 — 비면 수수료가 0원이 됩니다' },
  { key: 'payKind', label: '분납여부', type: 'select', options: PAY_KIND_OPTS },
];
/** 어떤 상태인지 */
const STATE_FIELDS: Field[] = [
  { key: 'paper', label: '계약서', type: 'select', options: YN },
  { key: 'delivered', label: '인도완료', type: 'select', options: YN },
  { key: 'deliveredAt', label: '인도일', type: 'date', note: '인도완료가 「예」면 반드시 넣으세요' },
];

const VIEW_CONTRACT: Field[] = [
  { key: 'plate', label: '차량번호', type: 'text' },
  { key: 'supplier', label: '공급사', type: 'text' },
  { key: 'model', label: '모델명', type: 'text' },
  { key: 'customer', label: '고객명', type: 'text' },
  { key: 'phone', label: '연락처', type: 'text' },
  { key: 'agent', label: '영업담당자', type: 'text' },
  { key: 'channel', label: '영업채널', type: 'text' },
];

/**
 * 접수 «뒤에» 고칠 수 있는 칸 — 값 = 원장 칸 이름.
 *
 * ★따라온 값이 틀렸거나, 직접 적은 건이라 비어 있을 때 여기서 고친다.
 *   서버(`lib/server/settlement-store.ts` `EDITABLE_FIELDS`)가 허용한 칸만 넣는다.
 *   여기 없는 칸을 넣어도 서버가 400 으로 막는다 — 화면은 편의일 뿐이다.
 * ⚠ **공급사를 고치면 그 줄의 청구가 다른 회사로 옮겨 간다.** 청구서가 서는 축이라서다.
 *   이미 발행된 청구서가 있으면 그 문서와 어긋난다. 그래서 경고를 달아 둔다.
 */
const EDIT_COLUMN: Record<string, string> = {
  supplier: '공급사', model: '모델명', customer: '고객명', phone: '고객연락처',
  agent: '영업담당자', channel: '영업채널',
};
const VIEW_TERMS: Field[] = [
  { key: 'product', label: '상품구분', type: 'text' },
  { key: 'term', label: '계약기간', type: 'text' },
  { key: 'rent', label: '렌탈료', type: 'text' },
  { key: 'deposit', label: '보증금', type: 'text' },
  { key: 'price', label: '차량가액', type: 'text' },
  { key: 'payKind', label: '분납여부', type: 'text' },
];

/** 접수 입력은 페이지와 상태를 나눈다 — 한 글자마다 목록·실적·청구를 다시 그리지 않게. */
function LedgerCreateForm({
  agentList, busy, onSubmit, onCancel,
}: {
  agentList: AgentOpt[];
  busy: boolean;
  onSubmit: (form: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [form, setForm] = useState<Record<string, string>>({
    receivedAt: iso, product: '장기렌트', payKind: '일시납', paper: '아니오', delivered: '아니오',
  });

  const onChange = (k: string, v: string) => {
    // ★채널을 바꾸면 담당자를 «비운다». 안 비우면 다른 채널 사람이 그대로 붙어 있는다.
    if (k === 'channel') {
      setForm((f) => ({ ...f, channel: v, agentCode: '', agent: '' }));
      return;
    }
    // 담당자를 고르면 이름이 따라온다. 채널이 비어 있었으면 그것도 채운다.
    if (k === 'agentCode') {
      const a = agentList.find((x) => x.code === v);
      setForm((f) => ({ ...f, agentCode: v, agent: a?.name || f.agent || '', channel: f.channel || a?.channel || '' }));
      return;
    }
    setForm((f) => ({ ...f, [k]: v }));
  };

  /** 채널 목록 — 명부에서 뽑아 이름순. */
  const channels = useMemo(
    () => [...new Set(agentList.map((a) => a.channel).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'ko')),
    [agentList],
  );
  /** ★고른 채널의 사람만. 채널이 비어 있으면 전부 — 처음 열었을 때 아무도 없으면 막힌 것처럼 보인다. */
  const forChannel = useMemo(
    () => (form.channel ? agentList.filter((a) => a.channel === form.channel) : agentList),
    [agentList, form.channel],
  );
  const selectOptions = {
    channel: [{ value: '', label: channels.length ? '고르기' : '명부를 못 받았습니다' },
      ...channels.map((c) => ({ value: c, label: c }))],
    agentCode: [{ value: '', label: forChannel.length ? '고르기' : '이 채널에 등록된 사람이 없습니다' },
      ...forChannel.map((a) => ({ value: a.code, label: form.channel ? a.name : a.label }))],
  };

  /**
   * ★**연락처 칸은 «늘» 세운다.** 사장님 2026-08-26 「손님연락처 영업자연락처는 필수는 아닌데
   *   동명이인때문에 / 일단 칸은 두자고 연락처 기입을 안하더라도 약간 메모성으로」.
   *   ⚠ 한때 「직접 적은 사람만」 보이게 접었는데, 그러면 명부에서 고른 사람의 번호를
   *     «확인»할 자리가 없어진다. 동명이인을 가리려고 두는 칸이니 늘 보여야 한다.
   *   실측 2026-08-26 — 고객연락처는 431줄 «전부» 빈칸이고, 영업자는 56명 중 25명이 없다.
   *     그래서 필수가 아니라 메모다. 비어도 접수는 된다.
   */
  const sellerFields = SELLER_FIELDS;
  /** 인도완료가 「예」일 때만 인도일을 세운다 — 안 그러면 늘 비어 있는 칸이 하나 는다. */
  const delivering = form.delivered === '예';
  const stateFields = STATE_FIELDS
    .filter((f) => f.key !== 'deliveredAt' || delivering)
    .map((f) => (f.key === 'deliveredAt' ? { ...f, required: true } : f));

  return (
    <>
      <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.6 }}>
        계약금이 들어온 계약을 적습니다.
        {' '}<b style={{ color: C.ink }}>언제 · 어떤 차를 · 누가 · 누구한테 · 어떤 조건으로 · 어떤 상태인지</b> 순서입니다.
        {' '}청구월·수수료는 기계가 채웁니다.
      </div>
      <FormGrid title="언제 · 어떤 차를" accent="main" fields={CAR_FIELDS}
        form={form as unknown as EntityRecord} onChange={onChange} showNotes />
      <FormGrid title="누가 팔았나" accent="sub" fields={sellerFields}
        form={form as unknown as EntityRecord} onChange={onChange} selectOptions={selectOptions} showNotes />
      <FormGrid title="누구한테" accent="sub" fields={CUSTOMER_FIELDS}
        form={form as unknown as EntityRecord} onChange={onChange} showNotes />
      <FormGrid title="어떤 조건으로 · 어떤 방식으로" accent="sub" fields={TERMS_FIELDS}
        form={form as unknown as EntityRecord} onChange={onChange} showNotes />
      <FormGrid title="어떤 상태인지" accent="sub" fields={stateFields}
        form={form as unknown as EntityRecord} onChange={onChange} showNotes />
      <PageActions
        cancel={{ onClick: onCancel, disabled: busy }}
        save={{ onClick: () => onSubmit(form), disabled: busy, label: busy ? '접수 중…' : '접수하기' }}
      />
    </>
  );
}

export default function SettlementLedgerPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  /** 상세에서 손댄 칸 — 저장 전까지만 여기 있다. 줄을 바꾸면 비운다. */
  const [edit, setEdit] = useState<Record<string, string>>({});

  // ① 접수목록 — 검색 + 접수상태만
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<string>('진행중');
  const [sel, setSel] = useState('');
  const [creating, setCreating] = useState(false);
  const [agentList, setAgentList] = useState<AgentOpt[]>([]);
  /** 인도일 — 체크만 켜면 청구월이 안 서니 날짜를 같이 받는다. */
  const [deliverOn, setDeliverOn] = useState('');

  // ③ 실적상태 — 자기 검색·필터
  const [pQ, setPQ] = useState('');
  const [pSup, setPSup] = useState('');
  const [pAgent, setPAgent] = useState('');
  const [pStage, setPStage] = useState('전체');

  // ④ 청구현황 — 자기 검색·필터
  const [bQ, setBQ] = useState('');
  const [bSup, setBSup] = useState('');
  const [bChannel, setBChannel] = useState('');
  const [bill, setBill] = useState('전체');
  const [month, setMonth] = useState('');
  const [confirms, setConfirms] = useState<Confirmation[]>([]);
  /** 지금 «대신 적는» 영업채널 하나 · 그 근거. 한 번에 한 곳만 연다. */
  const [memoFor, setMemoFor] = useState('');
  const [memoNote, setMemoNote] = useState('');

  const load = async () => {
    try {
      const res = await ledgerFetch('/api/settlement/ledger');
      const body = await res.json() as Payload;
      if (!body.ok) { setErr(body.reason || '읽지 못했습니다'); return; }
      setErr(''); setData(body);
    } catch (e) { setErr(String((e as Error)?.message || e)); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await ledgerFetch('/api/settlement/agents');
        const body = await res.json() as { ok: boolean; list?: { code: string; name: string; channel: string; label: string }[] };
        if (body.ok && body.list) setAgentList(body.list);
      } catch { /* 명부를 못 받아도 접수는 막지 않는다 */ }
    })();
  }, []);

  const rows = useMemo(() => data?.rows || [], [data]);
  const months = useMemo(
    () => [...new Set(rows.map((r) => r.billingMonth || '').filter(Boolean))].sort().reverse(),
    [rows],
  );
  const suppliers = useMemo(() => [...new Set(rows.map((r) => r.supplier).filter(Boolean))].sort(), [rows]);
  const agents = useMemo(() => [...new Set(rows.map((r) => r.agent).filter(Boolean))].sort(), [rows]);
  const channels = useMemo(() => [...new Set(rows.map((r) => r.channel).filter(Boolean))].sort(), [rows]);

  /** 들어오면 이번 달이 잡혀 있어야 한다 — 급한 건 늘 «이번 달 말일까지»다. */
  useEffect(() => {
    if (month || !rows.length) return;
    const now = new Date();
    setMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  }, [rows, month]);

  const loadConfirms = useCallback(async (m: string) => {
    if (!m) { setConfirms([]); return; }
    try {
      const res = await ledgerFetch(`/api/settlement/confirm?month=${encodeURIComponent(m)}`);
      const body = await res.json() as { ok: boolean; list?: Confirmation[] };
      setConfirms(body.ok ? (body.list || []) : []);
    } catch { setConfirms([]); }
  }, []);
  useEffect(() => { loadConfirms(month); }, [month, loadConfirms]);

  /**
   * **우리가 대신 적는다.** 사장님 2026-08-27
   *   「erp화면에서 일단 계정없어도 그냥 우리가 메모하는거로 쓸거라니까」.
   * ★근거를 «먼저» 받는다 — 서버도 막지만, 여기서 막아야 헛걸음을 안 한다.
   * ★적고 나면 다시 읽는다. 화면이 옛 상태로 남으면 두 번 적게 된다.
   */
  const writeMemo = async (channel: string) => {
    const why = memoNote.trim();
    if (!why) { toast('어떻게 확인받았는지 적어 주세요 — 전화·카톡 등'); return; }
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month, who: channel, state: '확인', note: why, proxy: true }),
      });
      const body = await res.json() as { ok: boolean; reason?: string; lines?: number };
      if (!body.ok) { toast(body.reason || '적지 못했습니다'); return; }
      toast(`${channel} ${body.lines}건 — 확인으로 적었습니다`);
      setMemoFor(''); setMemoNote('');
      await loadConfirms(month);
    } finally { setBusy(false); }
  };

  // 판마다 따로 거른다
  const shown = useMemo(() => rows.filter((r) => hit(r, q) && inStage(r, stage)), [rows, q, stage]);
  const perf = useMemo(() => rows.filter((r) => hit(r, pQ)
    && (!pSup || r.supplier === pSup) && (!pAgent || r.agent === pAgent) && inStage(r, pStage)),
  [rows, pQ, pSup, pAgent, pStage]);
  const billRows = useMemo(() => rows.filter((r) => hit(r, bQ)
    && (!bSup || r.supplier === bSup) && (!bChannel || r.channel === bChannel)
    && (bill === '전체' || r.billState === bill)),
  [rows, bQ, bSup, bChannel, bill]);

  const picked = useMemo(() => rows.find((r) => `${r.plate}|${r.receivedAt}` === sel) || null, [rows, sel]);
  /**
   * ★줄을 바꾸면 손댄 값을 «버린다».
   *   안 버리면 A 줄에서 고치다 만 모델명이 B 줄 칸에 그대로 떠 있고,
   *   그 상태로 저장하면 **B 줄에 A 의 값이 박힌다.**
   */
  useEffect(() => { setEdit({}); }, [sel]);
  const pick = (r: Row) => { setSel(`${r.plate}|${r.receivedAt}`); setCreating(false); };
  const keyOf = (r: Row) => `${r.plate}|${r.receivedAt}`;

  /** 그 달 청구 — 청구현황 판의 필터를 그대로 탄다. */
  const billable = useMemo(
    () => billRows.filter((r) => !r.cancelled && (!month || r.billingMonth === month)),
    [billRows, month],
  );
  const byParty = useMemo(() => {
    const m = new Map<string, { n: number; claim: number; pay: number }>();
    for (const r of billable) {
      const k = r.supplier || '(공급사 미기재)';
      const c = m.get(k) || { n: 0, claim: 0, pay: 0 };
      c.n += 1; c.claim += r.money.claim; c.pay += r.money.pay;
      m.set(k, c);
    }
    return [...m].sort((a, b) => (b[1].claim - b[1].pay) - (a[1].claim - a[1].pay));
  }, [billable]);
  const tot = billable.reduce(
    (a, r) => ({ n: a.n + 1, claim: a.claim + r.money.claim, pay: a.pay + r.money.pay }),
    { n: 0, claim: 0, pay: 0 },
  );

  /** 우리가 «대신 적어 둔» 확인 — 본인이 누른 것과 섞어 보이지 않는다. */
  const proxied = useMemo(
    () => confirms.filter((c) => c.month === month && c.proxy).sort((a, b) => a.who.localeCompare(b.who, 'ko')),
    [confirms, month],
  );

  /** 이 달 청구를 막고 있는 영업채널 — 서버 발행 관문과 같은 축이다. */
  const gate = useMemo(() => {
    if (!month) return [];
    return providerBillGate(billable, confirms).sort((left, right) => right.lines - left.lines);
  }, [month, billable, confirms]);

  const submit = async (form: Record<string, string>) => {
    if (!form.plate?.trim()) { toast('차량번호를 적어 주세요'); return; }
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/ledger', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
      });
      const body = await res.json() as { ok: boolean; reason?: string; plate?: string };
      if (!body.ok) { toast(body.reason || '접수하지 못했습니다'); return; }
      toast(`${body.plate} 접수했습니다`);
      setCreating(false);
      await load();
    } finally { setBusy(false); }
  };

  /** 진행만 고친다. 금액·요율은 서버가 흰 목록으로 막는다. */
  const patchRow = async (r: Row, patch: Record<string, string>) => {
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/ledger', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plate: r.plate, receivedAt: r.receivedAt, patch }),
      });
      const body = await res.json() as { ok: boolean; reason?: string };
      if (!body.ok) { toast(body.reason || '고치지 못했습니다'); return; }
      await load();
    } finally { setBusy(false); }
  };

  /**
   * 목록에서 바로 인도완료 — **인도일은 오늘**이다.
   * ★날짜 없이 체크만 켜면 청구월이 안 서고 「인도는 됐는데 청구가 없는」 줄이 조용히 생긴다.
   *   다른 날짜가 필요하면 시트에서 고친다.
   */
  const markDelivered = async (r: Row) => {
    const t = new Date();
    const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (!window.confirm(`${r.plate} — 인도일 ${day} 로 인도완료 처리할까요?`)) return;
    await patchRow(r, { 인도완료: 'TRUE', 인도일: day });
  };

  if (err) return <CenterNote>정산원장을 못 읽었습니다 — {err}</CenterNote>;
  if (!data) return <Loading />;


  // ─────────────────────────────── ① 접수목록
  const list = (
    <>
      <SettlementCreateRow onClick={() => { setCreating(true); setSel(''); }} />
      {shown.length === 0
        ? <CenterNote>그 조건에 해당하는 계약이 없습니다.</CenterNote>
        : shown.map((r) => (
          <LedgerListRow key={keyOf(r)} row={{ ...r, claim: r.money.claim }}
            selected={sel === keyOf(r)} onClick={() => pick(r)} />
        ))}
    </>
  );

  const createForm = (
    <LedgerCreateForm
      agentList={agentList}
      busy={busy}
      onSubmit={submit}
      onCancel={() => setCreating(false)}
    />
  );

  /**
   * ─────────────────── ② 접수내용
   * 보기·접수가 같은 DetailTable(FormGrid/FormReadList). 상태 스위치만 값 칸에 둔다.
   */
  const intake = picked ? (
    <>
      <FormGrid
        title="계약"
        accent="main"
        fields={VIEW_CONTRACT.map((f) => (EDIT_COLUMN[f.key]
          ? { ...f, note: f.key === 'supplier' ? '바꾸면 청구 상대가 바뀝니다' : f.note }
          : { ...f, readOnly: true }))}
        form={{
          plate: picked.plate,
          supplier: edit.supplier ?? picked.supplier,
          model: edit.model ?? picked.model,
          customer: edit.customer ?? picked.customer,
          phone: edit.phone ?? picked.phone,
          agent: edit.agent ?? picked.agent,
          channel: edit.channel ?? picked.channel,
        }}
        onChange={(k, v) => { if (EDIT_COLUMN[k]) setEdit((e) => ({ ...e, [k]: v })); }}
      />
      {Object.keys(edit).length > 0 && (
        <PageActions
          cancel={{ onClick: () => setEdit({}), disabled: busy, label: '되돌리기' }}
          save={{
            disabled: busy,
            label: busy ? '저장 중…' : '저장',
            onClick: () => {
              // ★바뀐 칸만 보낸다. 안 바뀐 칸까지 쓰면 이력이 «고치지 않은 것»으로 더러워진다.
              const patch: Record<string, string> = {};
              const cur = picked as unknown as Record<string, unknown>;
              for (const [k, v] of Object.entries(edit)) {
                const col = EDIT_COLUMN[k];
                if (col && String(v ?? '') !== String(cur[k] ?? '')) patch[col] = String(v ?? '');
              }
              if (!Object.keys(patch).length) { setEdit({}); return; }
              void patchRow(picked, patch).then(() => setEdit({}));
            },
          }}
        />
      )}

      <FormReadList
        title="조건"
        accent="sub"
        fields={VIEW_TERMS}
        form={{
          product: picked.product,
          term: picked.term ? `${picked.term}개월` : '',
          rent: picked.rent ? won(picked.rent) : '',
          deposit: picked.deposit ? won(picked.deposit) : '',
          price: picked.price ? won(picked.price) : '',
          payKind: picked.payKind,
        }}
      />
      <DetailTable
        title="상태"
        hint="원장의 체크 넷입니다. 여기서 바꾸면 시트에 그대로 갑니다."
        accent="sub"
        span={2}
        widths={[KV_LABEL_W, undefined]}
      >
        <DtRow i={0} label="접수일">{picked.receivedAt}</DtRow>
        <DtRow i={1} label="계약서">
          <Switch checked={picked.paper} disabled={busy}
            onChange={(next) => patchRow(picked, { 계약서: next ? 'TRUE' : 'FALSE' })} />
        </DtRow>
        <DtRow i={2} label="인도완료">
          {picked.delivered ? (
            <Switch checked disabled={busy}
              onChange={() => patchRow(picked, { 인도완료: 'FALSE', 인도일: '' })} />
          ) : (
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Input value={deliverOn} onChange={setDeliverOn} placeholder="—" style={TABLE_INP} />
              <Btn size="sm" disabled={busy || !deliverOn.trim()}
                onClick={() => patchRow(picked, { 인도완료: 'TRUE', 인도일: deliverOn.trim() })}>켜기</Btn>
            </span>
          )}
        </DtRow>
        <DtRow i={3} label="인도일">{picked.deliveredAt}</DtRow>
        <DtRow i={4} label="계약취소">
          <Switch checked={picked.cancelled} disabled={busy}
            onChange={(next) => patchRow(picked, { 계약취소: next ? 'TRUE' : 'FALSE' })} />
        </DtRow>
        <DtRow i={5} label="환수">
          <Switch checked={picked.clawback} disabled={busy}
            onChange={(next) => patchRow(picked, { 환수: next ? 'TRUE' : 'FALSE' })} />
        </DtRow>
      </DetailTable>
    </>
  ) : <CenterNote>목록에서 계약을 고르거나, 맨 위 「계약접수」를 누르세요.</CenterNote>;

  // ─────────────────────────────── ③ 실적상태 — 같은 2줄 행. 인도는 여기서 켠다
  const progress = (
    <>
      <div style={{ padding: '8px 12px', fontSize: FS.cap, color: C.mute }}>
        {perf.length}건 · 인도완료 {perf.filter((r) => r.delivered).length} · 인도 전 {perf.filter((r) => !r.delivered && !r.cancelled).length}
      </div>
      {perf.length === 0
        ? <CenterNote>그 조건에 해당하는 계약이 없습니다.</CenterNote>
        : perf.map((r) => (
          <LedgerListRow key={keyOf(r)} row={{ ...r, claim: r.money.claim }}
            selected={sel === keyOf(r)} onClick={() => pick(r)}
            right={r.delivered || r.cancelled ? undefined : (
              <Btn variant="bare" disabled={busy} onClick={() => markDelivered(r)}>인도완료</Btn>
            )}
          />
        ))}
    </>
  );

  // ─────────────────────────────── ④ 청구현황 — 같은 2줄 행. 청구서는 여기서 뽑는다
  const billing = (
    <>
      <div style={{ padding: '8px 12px', fontSize: FS.cap, color: C.mute, fontVariantNumeric: NUM }}>
        {tot.n}건 · 청구 <b style={{ color: C.ink }}>{won(tot.claim)}</b> · 수익 <b style={{ color: C.ink }}>{won(tot.claim - tot.pay)}</b>
      </div>

      {/*
        **영업채널 실적 확인 — 막는 곳을 «누를 수 있게» 둔다.**

        ★사장님 2026-08-27 「erp화면에서 일단 계정없어도 그냥 우리가 메모하는거로 쓸거라니까」
          「영업채널 파트너사로만 만들어두면 돼」.
          영업채널 사람들이 계정을 안 만들었는데 그동안 청구가 멈춰 있었다.
          ⇒ 전화·카톡으로 받아서 **여기서 우리가 적는다.**
        ⚠ 적는 순간 청구서가 나갈 수 있게 된다. 그래서 **근거를 받고** 「대신 적음」으로 남긴다.
        ⚠ 이름을 손으로 치게 하지 않는다 — 원장에 뜬 채널만 누른다. 오타는 아무 문도 안 연다.
      */}
      {month && (
        <div style={{ padding: '0 12px 8px', fontSize: FS.cap, lineHeight: 1.6 }}>
          <b>영업채널 실적 확인</b>{' '}
          {gate.length === 0
            ? <span style={{ color: C.ok }}>막는 곳 없음 — 청구해도 됩니다</span>
            : <span style={{ color: C.danger }}>{gate.length}곳이 아직입니다</span>}
          {proxied.length > 0 && (
            <span style={{ color: C.mute }}>{'  ·  '}우리가 적은 것 {proxied.length}곳</span>
          )}

          {gate.map((g) => (
            <div key={g.code || g.channel} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ minWidth: 128, color: C.ink }}>{g.channel} <span style={{ color: C.mute }}>{g.lines}건</span></span>
              {memoFor === g.channel ? (
                <>
                  <Input value={memoNote} autoFocus size="sm" style={{ flex: 1, minWidth: 0 }}
                    placeholder="어떻게 확인받았나 — 전화·카톡 등"
                    onChange={setMemoNote}
                    onEnter={() => writeMemo(g.channel)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setMemoFor(''); setMemoNote(''); } }} />
                  <Btn size="sm" disabled={busy} onClick={() => writeMemo(g.channel)}>적기</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => { setMemoFor(''); setMemoNote(''); }}>취소</Btn>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, minWidth: 0, color: C.mute }}>{g.why}</span>
                  <Btn size="sm" variant="bare" disabled={busy}
                    onClick={() => { setMemoFor(g.channel); setMemoNote(''); }}>대신 적기</Btn>
                </>
              )}
            </div>
          ))}

          {proxied.map((c) => (
            <div key={c.key} style={{ marginTop: 3, color: C.mute }}>
              <span style={{ display: 'inline-block', minWidth: 128, color: C.ink }}>{c.who}</span>
              대신 적음 · {c.proxyBy || '관리자'} · {c.note}
            </div>
          ))}
        </div>
      )}

      {byParty.length === 0
        ? <CenterNote>그 조건에 청구할 것이 없습니다.</CenterNote>
        : byParty.map(([sup, v]) => (
          <ListRow
            key={sup}
            main={sup}
            sub={`${v.n}건 · 청구 ${won(v.claim)} · 수익 ${won(v.claim - v.pay)}`}
            right={(
              <Btn variant="bare" disabled={!month}
                onClick={() => window.open(
                  `/settlement/invoice?month=${encodeURIComponent(month)}&axis=${encodeURIComponent('공급사')}&party=${encodeURIComponent(sup)}`,
                  '_blank',
                )}>청구서</Btn>
            )}
          />
        ))}

      {picked && (
        <DetailTable
          title={`고른 계약 — ${picked.plate}`}
          hint={BILL_WHY[picked.billState]}
          accent="sub"
          span={2}
          widths={[KV_LABEL_W, undefined]}
        >
          <DtRow i={0} label="청구상태"><Badge tone={BILL_TONE[picked.billState]}>{picked.billState}</Badge></DtRow>
          <DtRow i={1} label="청구월">{picked.billingMonth || '인도 전'}</DtRow>
          <DtRow i={2} label="청구액" valueStyle={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{picked.money.claim ? won(picked.money.claim) : ''}</DtRow>
          <DtRow i={3} label="지급액" valueStyle={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{picked.money.pay ? won(picked.money.pay) : ''}</DtRow>
          <DtRow i={4} label="우리몫" valueStyle={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{picked.money.margin ? won(picked.money.margin) : ''}</DtRow>
        </DetailTable>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '8px 12px' }}>
        <Btn variant="ghost" onClick={load}>다시 읽기</Btn>
        <Btn variant="ghost" onClick={() => window.open(data.ledgerUrl, '_blank')}>시트 열기</Btn>
      </div>
    </>
  );

  const panes: WorkPane[] = [
    {
      key: 'intake', title: creating ? '계약접수' : '접수내용', icon: ClipboardList,
      node: <><PaneHead title={creating ? '계약접수' : '접수내용'} /><PaneBody pad>{creating ? createForm : intake}</PaneBody></>,
    },
    {
      key: 'progress', title: '실적상태', icon: ListChecks, node: (
        <>
          <PaneHead title="실적상태" />
          <WebListTools tools={{
            search: { value: pQ, onChange: setPQ, placeholder: '차번·고객·공급사·영업자…' },
            filter: {
              count: (pSup ? 1 : 0) + (pAgent ? 1 : 0) + (pStage !== '전체' ? 1 : 0),
              body: (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Select value={pSup} onChange={setPSup}
                      options={[{ value: '', label: '공급사 전체' }, ...suppliers.map((v) => ({ value: v, label: v }))]} />
                    <Select value={pAgent} onChange={setPAgent}
                      options={[{ value: '', label: '영업자 전체' }, ...agents.map((v) => ({ value: v, label: v }))]} />
                  </div>
                  <FilterChips
                    options={['전체', ...STAGES].map((t) => ({ key: t, label: t, count: rows.filter((r) => inStage(r, t)).length }))}
                    value={pStage}
                    onChange={(v) => setPStage(v)}
                  />
                </div>
              ),
            },
          }} />
          <PaneBody>{progress}</PaneBody>
        </>
      ),
    },
    {
      key: 'billing', title: '청구현황', icon: Banknote, node: (
        <>
          <PaneHead title="청구현황" />
          <WebListTools tools={{
            search: { value: bQ, onChange: setBQ, placeholder: '차번·고객·공급사·영업자…' },
            filter: {
              count: (bSup ? 1 : 0) + (bChannel ? 1 : 0) + (bill !== '전체' ? 1 : 0),
              body: (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Select value={month} onChange={setMonth}
                      options={[{ value: '', label: '전체 달' }, ...months.map((m) => ({ value: m, label: m }))]} />
                    <Select value={bSup} onChange={setBSup}
                      options={[{ value: '', label: '공급사 전체' }, ...suppliers.map((v) => ({ value: v, label: v }))]} />
                    <Select value={bChannel} onChange={setBChannel}
                      options={[{ value: '', label: '영업채널 전체' }, ...channels.map((v) => ({ value: v, label: v }))]} />
                  </div>
                  <FilterChips
                    options={[
                      { key: '전체', label: '전체', count: rows.length },
                      ...BILL_STATES.map((b) => ({
                        key: b as string, label: b as string, count: rows.filter((r) => r.billState === b).length,
                      })),
                    ]}
                    value={bill}
                    onChange={(v) => setBill(v)}
                  />
                </div>
              ),
            },
          }} />
          <PaneBody>{billing}</PaneBody>
        </>
      ),
    },
  ];

  return (
    <WorkPage
      title="접수목록"
      statusCount={rows.length}
      listCount={shown.length}
      list={list}
      panes={panes}
      selected={!!picked || creating}
      onBack={() => { setSel(''); setCreating(false); }}
      backKind={creating ? 'cancel' : 'list'}
      contextTitle={creating ? '계약접수' : picked?.plate}
      listTools={{
        search: { value: q, onChange: setQ, placeholder: '차번·고객·공급사·영업자…' },
        filter: {
          count: stage === '진행중' ? 0 : 1,
          body: (
            <FilterChips
              options={STAGES.map((t) => ({ key: t, label: t, count: rows.filter((r) => hit(r, q) && inStage(r, t)).length }))}
              value={stage}
              onChange={(v) => setStage(v)}
            />
          ),
        },
      }}
    />
  );
}
