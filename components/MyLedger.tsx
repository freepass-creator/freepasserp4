'use client';
/**
 * **내 계약 — 영업자·공급사가 «가지고 가는» 화면.**
 *
 * ★사장님 2026-08-26
 *   「관리자랑 영업자 공급사가 보는 페이지가 달랐으면 좋겟음 한페이지에 하면 오류가 많이 날거 같아」
 *   「관리자가 정보를 만들고 그걸 가지고 가는거로」
 *
 * 그래서 화면이 둘로 갈렸다 —
 * ```
 * 정산관리 /settlement/ledger   관리자가 «만드는» 곳. 접수·진행·금액·정산서
 * 계약·정산확인 /contract        영업자·공급사가 «가지고 가는» 곳 — 이 파일
 * ```
 * ★★**이 파일에는 관리자 분기가 없다.** 한 화면에 역할 분기를 쌓으면
 *   「관리자한테만 보여야 할 것」이 조건 하나 어긋나서 새어 나간다. 아예 안 두는 게 안전하다.
 * ★★금액은 서버가 애초에 안 보낸다(`/api/settlement/mine`). 여기서 가리는 게 아니다 —
 *   가리기만 하면 개발자도구 한 번에 다 보인다. 보이는 돈은 대여료·보증금뿐이고 둘 다 계약 조건이다.
 */
import { useEffect, useMemo, useState } from 'react';
import { ledgerFetch } from '@/lib/firebase/ledger-client';
import type { PublicRow } from '@/lib/domain/settlement-view';
import { canBill, confirmLabel, confirmTone, type Confirmation } from '@/lib/domain/settlement-confirm';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import {
  Badge, Btn, C, CenterNote, DetailRow, FilterChips, FilterGroup, FS, FW, Input,
  ListGroup, ListRow, Loading, Message, NUM, PaneBody, PaneHead, R, R_CARD, won,
} from '@/components/ui';
import { toast } from '@/components/Toaster';
import { CheckCircle2, ListChecks } from 'lucide-react';

type Payload = {
  ok: boolean;
  whoami?: string;
  count?: number;
  counts?: { label: string; n: number }[];
  rows?: PublicRow[];
  note?: string;
  reason?: string;
};

/** 진행중이 먼저다 — 끝난 건은 «세는» 대상이지 «보는» 대상이 아니다. */
const TABS = ['진행중', '인도완료', '분납중', '취소', '전체'] as const;
type Tab = (typeof TABS)[number];

const inTab = (r: PublicRow, t: Tab) => {
  if (t === '전체') return true;
  if (t === '취소') return r.cancelled;
  if (r.cancelled) return false;
  if (t === '진행중') return !r.delivered;
  if (t === '분납중') return r.bucket === '분납실적';
  return r.delivered;
};

const toneOf = (r: PublicRow): 'gray' | 'blue' | 'green' | 'red' =>
  r.cancelled ? 'red' : !r.delivered ? 'gray' : r.bucket === '분납실적' ? 'blue' : 'green';

/** 실적을 세는 달 — 인도된 달. 인도 전이면 접수한 달로 잡아 둔다. */
const monthOf = (r: PublicRow) => (r.deliveredAt || r.receivedAt || '').slice(0, 7);

export function MyLedger() {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<Tab>('진행중');
  const [sel, setSel] = useState('');
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ mine?: Confirmation | null; note?: string } | null>(null);
  const [disputeOn, setDisputeOn] = useState(false);
  const [disputeNote, setDisputeNote] = useState('');

  const load = async () => {
    try {
      const res = await ledgerFetch('/api/settlement/mine');
      setData(await res.json() as Payload);
    } catch (e) {
      setData({ ok: false, reason: String((e as Error)?.message || e) });
    }
  };
  useEffect(() => { load(); }, []);

  const all = useMemo(() => data?.rows || [], [data]);

  /** 들어오면 이번 달이 잡혀 있어야 한다 — 물어보는 것은 늘 «이번 달 내 실적»이다. */
  useEffect(() => {
    if (month || !all.length) return;
    const now = new Date();
    setMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  }, [all, month]);

  const loadConfirm = async (m: string) => {
    if (!m) { setConfirm(null); return; }
    try {
      const res = await ledgerFetch(`/api/settlement/confirm?month=${encodeURIComponent(m)}`);
      setConfirm(await res.json());
    } catch { setConfirm(null); }
  };
  useEffect(() => { loadConfirm(month); }, [month]);

  const rows = useMemo(() => all.filter((r) => inTab(r, tab)), [all, tab]);
  const picked = useMemo(() => all.find((r) => r.plate + r.receivedAt === sel) || null, [all, sel]);
  /** 이 달 내 실적 — 확인은 이 건수에 대고 하는 것이다. */
  const ofMonth = useMemo(
    () => all.filter((r) => !r.cancelled && r.delivered && monthOf(r) === month),
    [all, month],
  );

  /** ★확인은 본인만 한다. 관리자가 대신 눌러 줄 수 없다(서버가 막는다). */
  const sendConfirm = async (state: '확인' | '이의') => {
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month, state, note: state === '이의' ? disputeNote : '' }),
      });
      const body = await res.json() as { ok: boolean; reason?: string };
      if (!body.ok) { toast(body.reason || '보내지 못했습니다'); return; }
      toast(state === '확인' ? '실적을 확인했습니다' : '이의를 접수했습니다');
      setDisputeOn(false); setDisputeNote('');
      await loadConfirm(month);
    } finally { setBusy(false); }
  };

  if (!data) return <Loading />;
  if (!data.ok) return <CenterNote>{data.reason || '원장을 읽지 못했습니다.'}</CenterNote>;

  const card: React.CSSProperties = { border: '1px solid ' + C.line, borderRadius: R_CARD, padding: 10 };
  const done = canBill(confirm?.mine || null, ofMonth.length).ok;

  const list = (
    <>
      {/* 실적 건수 — 정산확인이 묻는 것은 «몇 건인가»다. 금액이 아니다. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(84px,1fr))', gap: 5, marginBottom: 8 }}>
        {(data.counts || []).map((c) => (
          <div key={c.label} style={{ border: '1px solid ' + C.line, borderRadius: R_CARD, padding: '6px 8px' }}>
            <div style={{ fontSize: FS.micro, color: C.mute, fontWeight: FW.label }}>{c.label}</div>
            <div style={{ fontSize: FS.title, fontWeight: FW.head, color: C.ink, fontVariantNumeric: NUM }}>
              {c.n}<span style={{ fontSize: FS.micro, color: C.mute, fontWeight: FW.body }}> 건</span>
            </div>
          </div>
        ))}
      </div>

      {/* ★실적 확인 — 청구 앞에 놓인 문. 묻는 것은 «건»이지 «금액»이 아니다. */}
      {month && (
        <div style={{ ...card, display: 'grid', gap: 7, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: FS.body, fontWeight: FW.head }}>{month} 실적 확인</span>
            <Badge tone={confirmTone(confirm?.mine || null, ofMonth.length)}>
              {confirmLabel(confirm?.mine || null, ofMonth.length)}
            </Badge>
            <span style={{ fontSize: FS.cap, color: C.mute }}>{ofMonth.length}건</span>
          </div>
          {confirm?.note && <div style={{ fontSize: FS.cap, color: C.danger }}>{confirm.note}</div>}
          {!done && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Btn disabled={busy} onClick={() => sendConfirm('확인')}>이 {ofMonth.length}건이 맞습니다</Btn>
              <Btn variant="ghost" disabled={busy} onClick={() => setDisputeOn((v) => !v)}>다른 게 있습니다</Btn>
            </div>
          )}
          {disputeOn && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Input value={disputeNote} onChange={setDisputeNote} placeholder="무엇이 다른지 적어 주세요 (차량번호 등)" />
              <Btn variant="danger" disabled={busy || !disputeNote.trim()} onClick={() => sendConfirm('이의')}>이의 보내기</Btn>
            </div>
          )}
          <div style={{ fontSize: FS.micro, color: C.mute, lineHeight: 1.5 }}>
            확인하시면 공급사에 청구가 나갑니다. 수수료 금액은 이 화면에서 다루지 않습니다.
          </div>
        </div>
      )}

      <FilterGroup title="보기">
        <FilterChips
          options={TABS.map((t) => ({ key: t, label: t, count: all.filter((r) => inTab(r, t)).length }))}
          value={tab}
          onChange={(v) => setTab(v)}
        />
      </FilterGroup>

      {rows.length === 0
        ? <CenterNote>{data.note || '해당하는 계약이 없습니다.'}</CenterNote>
        : (
          <ListGroup>
            {rows.map((r) => (
              <ListRow
                key={r.plate + r.receivedAt}
                selected={sel === r.plate + r.receivedAt}
                onClick={() => setSel(r.plate + r.receivedAt)}
                main={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {r.plate || '차번 미정'}
                    <span style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.body }}>{r.model}</span>
                  </span>
                }
                sub={[r.customer, r.supplier, r.product, r.term ? r.term + '개월' : '', r.rent ? '대여료 ' + won(r.rent) : '']
                  .filter(Boolean).join(' · ')}
                right={<Badge tone={toneOf(r)}>{r.status}</Badge>}
              />
            ))}
          </ListGroup>
        )}
    </>
  );

  const kv = (k: string, v: string) => <DetailRow key={k} label={k} value={v} valueColor={C.ink} />;

  const detail = picked ? (
    <>
      {/* 계약 조건 — 사장님이 «확인하라»고 한 대여료·기간·보증금이 여기다 */}
      <div style={{ ...card, padding: '2px 10px', marginBottom: 10 }}>
        {kv('차량번호', picked.plate)}
        {kv('모델명', picked.model)}
        {kv('고객명', picked.customer)}
        {kv('공급사', picked.supplier)}
        {kv('상품구분', picked.product)}
        {kv('계약기간', picked.term ? picked.term + '개월' : '')}
        {kv('대여료', picked.rent ? won(picked.rent) : '')}
        {kv('보증금', picked.deposit ? won(picked.deposit) : '')}
        {kv('분납여부', picked.payKind)}
      </div>

      {/* 진행 — 계약서 → 인도. 인도가 실적의 관문이다 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
        {[
          { on: !!picked.receivedAt, label: '접수', at: picked.receivedAt },
          { on: picked.paper, label: '계약서 작성', at: '' },
          { on: picked.delivered, label: '인도완료', at: picked.deliveredAt },
        ].map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: FS.body }}>
            <CheckCircle2 size={15} color={s.on ? C.ink : C.line} />
            <span style={{ color: s.on ? C.ink : C.mute, fontWeight: s.on ? FW.strong : FW.body }}>{s.label}</span>
            <span style={{ marginLeft: 'auto', fontSize: FS.cap, color: C.mute }}>{s.at}</span>
          </div>
        ))}
        {picked.cancelled && <div><Badge tone="red">계약취소</Badge></div>}
      </div>

      <Message variant="info">수수료·정산 금액은 이 화면에서 다루지 않습니다. 정산 내역은 담당자에게 확인하세요.</Message>
    </>
  ) : <CenterNote>목록에서 계약을 고르세요.</CenterNote>;

  const panes: WorkPane[] = [
    { key: 'one', title: '계약', icon: ListChecks, node: <><PaneHead title="계약 진행" /><PaneBody>{detail}</PaneBody></> },
  ];

  return (
    <WorkPage
      title="계약·정산확인"
      statusLabel={data.whoami || ''}
      statusCount={data.count ?? 0}
      listCount={rows.length}
      list={list}
      panes={panes}
      selected={!!picked}
      onBack={() => setSel('')}
    />
  );
}
