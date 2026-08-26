'use client';
/**
 * **정산서 — 인쇄해서 내보내는 한 장.**
 *
 * ★사장님 2026-08-26 「관리자는 공급사별 영업채널별 정산서까지 만들어 낼수 있어야해」.
 *
 * ★이 화면은 **종이**다. ERP 의 다른 화면과 다르게 흰 바탕에 검은 글씨로 고정한다 —
 *   테마를 따라가면 다크 모드에서 인쇄했을 때 까맣게 나간다.
 * ★인쇄에서 빠질 것(버튼)은 `no-print` 로 뺀다. 종이에 버튼이 찍히면 그건 정산서가 아니다.
 * ★★**빈 칸이 있으면 대놓고 말한다.** 사업자번호가 비었는데 조용히 인쇄하면
 *   그 상태로 상대에게 나간다. 채워야 나갈 수 있는 것은 위에 붉게 세운다.
 */
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ledgerFetch } from '@/lib/firebase/ledger-client';
import type { Invoice } from '@/lib/domain/settlement-invoice';

type Payload = Invoice & {
  ok: boolean; reason?: string; receiverNote?: string;
  /** ① 대체키 stl_ · ② 사람이 읽는 문서번호. 발행 전이면 둘 다 빈다. */
  code?: string; invoiceNo?: string; issuedAt?: number; driftNote?: string;
};

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

/** 종이 색 — 테마를 안 따라간다. 다크 모드로 인쇄하면 까맣게 나간다. */
const INK = '#111';
const LINE = '#ccc';
const MUTE = '#666';

function PartyBlock({ title, p, bank }: { title: string; p: Invoice['issuer']; bank?: boolean }) {
  const row = (k: string, v: string) => (
    <div style={{ display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.7 }}>
      <span style={{ width: 62, flex: 'none', color: MUTE }}>{k}</span>
      <span style={{ color: v ? INK : '#c00' }}>{v || '— 비어 있음'}</span>
    </div>
  );
  return (
    <div style={{ flex: 1, minWidth: 220, border: `1px solid ${LINE}`, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: MUTE, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{p.name || '— 비어 있음'}</div>
      {row('사업자번호', p.bizNo)}
      {row('대표자', p.ceo)}
      {row('주소', p.address)}
      {bank && row('입금계좌', [p.bank, p.account, p.holder].filter(Boolean).join(' '))}
    </div>
  );
}

function InvoiceBody() {
  const q = useSearchParams();
  const month = q.get('month') || '';
  const axis = q.get('axis') || '공급사';
  const party = q.get('party') || '';
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * **발행 — 번호를 붙인다.** 붙는 순간 그건 나간 문서다.
   * ★두 번 눌러도 번호는 하나다(서버가 이미 있으면 그것을 돌려준다).
   */
  const issue = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/invoice', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          month: data.month, axis: data.axis, party: data.party,
          supply: data.supply, vat: data.vat, total: data.total, lines: data.lines.length,
        }),
      });
      const body = await res.json() as { ok: boolean; reason?: string; code?: string; invoiceNo?: string; issuedAt?: number };
      if (!body.ok) { alert(body.reason || '발행하지 못했습니다'); return; }
      setData({ ...data, code: body.code, invoiceNo: body.invoiceNo, issuedAt: body.issuedAt, driftNote: '' });
    } finally { setBusy(false); }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await ledgerFetch(`/api/settlement/invoice?month=${encodeURIComponent(month)}&axis=${encodeURIComponent(axis)}&party=${encodeURIComponent(party)}`);
        setData(await res.json() as Payload);
      } catch (e) {
        setData({ ok: false, reason: String((e as Error)?.message || e) } as Payload);
      }
    })();
  }, [month, axis, party]);

  if (!data) return <div style={{ padding: 40, color: MUTE }}>읽는 중…</div>;
  if (!data.ok) return <div style={{ padding: 40, color: '#c00' }}>{data.reason || '정산서를 만들지 못했습니다.'}</div>;

  const th: React.CSSProperties = { padding: '5px 6px', fontSize: 11, color: MUTE, fontWeight: 600, borderBottom: `1px solid ${INK}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '5px 6px', fontSize: 12, borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' };
  const num: React.CSSProperties = { ...td, textAlign: 'right' };

  return (
    <div style={{ background: '#fff', color: INK, minHeight: '100vh', padding: 24 }}>
      <style>{`@media print { .no-print { display: none !important } body { background: #fff } }`}</style>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button type="button" onClick={() => window.print()}
          style={{ padding: '7px 14px', fontSize: 13, border: `1px solid ${INK}`, background: INK, color: '#fff', cursor: 'pointer' }}>
          인쇄 / PDF 저장
        </button>
        {!data.invoiceNo && (
          <button type="button" onClick={issue} disabled={busy}
            style={{ padding: '7px 14px', fontSize: 13, border: `1px solid ${INK}`, background: '#fff', color: INK, cursor: 'pointer' }}>
            {busy ? '발행 중…' : '번호 발행'}
          </button>
        )}
        <button type="button" onClick={() => window.close()}
          style={{ padding: '7px 14px', fontSize: 13, border: `1px solid ${LINE}`, background: '#fff', color: INK, cursor: 'pointer' }}>
          닫기
        </button>
      </div>

      {/* ★채워야 나갈 수 있는 것 — 조용히 인쇄하면 그 상태로 상대에게 간다 */}
      {(data.missing?.length > 0 || data.receiverNote || data.driftNote) && (
        <div style={{ border: '1px solid #c00', color: '#c00', padding: '8px 10px', marginBottom: 14, fontSize: 12, lineHeight: 1.6 }}>
          {data.missing?.length > 0 && <div>이 칸이 비어 있습니다 — <b>{data.missing.join(' · ')}</b>. 채우고 보내세요.</div>}
          {data.receiverNote && <div>{data.receiverNote}</div>}
          {data.driftNote && <div>{data.driftNote} 다시 발행하지 말고 어느 쪽이 맞는지 먼저 보세요.</div>}
        </div>
      )}

      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 6 }}>{data.kind}</div>
        <div style={{ fontSize: 13, color: MUTE, marginTop: 4 }}>{data.month} · {data.party}</div>
        {/* ★문서번호 — 붙으면 안 바뀐다. 없으면 «발행 전»이라고 말한다. 종이에 번호가 없으면 대사를 못 한다. */}
        <div style={{ fontSize: 12, color: data.invoiceNo ? INK : '#c00', marginTop: 2 }}>
          {data.invoiceNo ? `문서번호 ${data.invoiceNo}` : '발행 전 — 번호를 발행하고 보내세요'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {/* 청구서면 «받는 곳»이 공급사, 지급명세면 «주는 곳»이 우리다 — 뜻이 뒤집힌다 */}
        <PartyBlock title={data.kind === '청구서' ? '받는 곳 (공급사)' : '받는 곳 (영업채널)'} p={data.receiver} />
        <PartyBlock title={data.kind === '청구서' ? '보내는 곳 (프리패스)' : '지급하는 곳 (프리패스)'} p={data.issuer} bank={data.kind === '청구서'} />
      </div>

      <div style={{ border: `2px solid ${INK}`, padding: '10px 12px', marginBottom: 14, display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: MUTE }}>{data.kind === '청구서' ? '청구 합계' : '지급 합계'}</span>
        <span style={{ fontSize: 26, fontWeight: 800 }}>{won(data.total)}<span style={{ fontSize: 14, fontWeight: 400 }}> 원</span></span>
        <span style={{ fontSize: 12, color: MUTE }}>
          공급가 {won(data.supply)} · 부가세 {won(data.vat)}
          {data.clawback ? ` · 환수 −${won(data.clawback)} 반영됨` : ''}
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>차량번호</th>
            <th style={{ ...th, textAlign: 'left' }}>모델명</th>
            <th style={{ ...th, textAlign: 'left' }}>고객</th>
            <th style={{ ...th, textAlign: 'left' }}>상품</th>
            <th style={{ ...th, textAlign: 'left' }}>산정 기준</th>
            <th style={{ ...th, textAlign: 'right' }}>공급가</th>
            <th style={{ ...th, textAlign: 'right' }}>부가세</th>
            <th style={{ ...th, textAlign: 'right' }}>합계</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l, i) => (
            <tr key={l.plate + i} style={l.minus ? { color: '#c00' } : undefined}>
              <td style={td}>{l.plate}</td>
              <td style={td}>{l.model}</td>
              <td style={td}>{l.customer}</td>
              <td style={td}>{l.product}{l.term ? ` ${l.term}개월` : ''}</td>
              <td style={{ ...td, color: l.minus ? '#c00' : MUTE }}>{l.base}{l.reason ? ` · ${l.reason}` : ''}</td>
              <td style={num}>{won(l.amount)}</td>
              <td style={num}>{won(l.vat)}</td>
              <td style={{ ...num, fontWeight: 700 }}>{won(l.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} style={{ ...td, borderTop: `2px solid ${INK}`, borderBottom: 'none', fontWeight: 700 }}>
              합계 {data.lines.length}건
            </td>
            <td style={{ ...num, borderTop: `2px solid ${INK}`, borderBottom: 'none', fontWeight: 700 }}>{won(data.supply)}</td>
            <td style={{ ...num, borderTop: `2px solid ${INK}`, borderBottom: 'none', fontWeight: 700 }}>{won(data.vat)}</td>
            <td style={{ ...num, borderTop: `2px solid ${INK}`, borderBottom: 'none', fontWeight: 800 }}>{won(data.total)}</td>
          </tr>
        </tfoot>
      </table>

      <div style={{ marginTop: 16, fontSize: 11, color: MUTE, lineHeight: 1.7 }}>
        · 환수 줄은 이미 끊은 계산서를 되돌린 것이 아니라, 이 달에 마이너스로 새로 선 줄입니다.<br />
        · 금액은 정산원장에 확정된 값입니다. 다른 값이 필요하면 원장을 먼저 고쳐 주세요.
      </div>
    </div>
  );
}

export default function SettlementInvoicePage() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>읽는 중…</div>}>
      <InvoiceBody />
    </Suspense>
  );
}
