'use client';
/**
 * **정산서 — 인쇄해서 내보내는 한 장.**
 *
 * ★사장님 2026-08-26
 *   「관리자는 공급사별 영업채널별 정산서까지 만들어 낼수 있어야해」
 *   「공급사는 받는거고 영업자는 지급이잖아 그거 양식 예쁘게 잘 만들어서 줘야하는데」
 *
 * ★이 화면은 **종이 미리보기**다. 본문은 A4 HTML(`settlement-invoice-html`)과 같다 —
 *   여기서 따로 표를 그리면 내려받은 문서와 미리보기가 갈린다.
 * ★인쇄에서 빠질 것(버튼·경고)은 `no-print` 로 뺀다.
 */
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Btn, C, Loading, CenterNote, Message } from '@/components/ui';
import { ledgerFetch } from '@/lib/firebase/ledger-client';
import type { Invoice } from '@/lib/domain/settlement-invoice';

type Payload = Invoice & {
  ok: boolean; reason?: string; receiverNote?: string;
  code?: string; invoiceNo?: string; issuedAt?: number; driftNote?: string;
  gate?: string[];
};

function InvoiceBody() {
  const q = useSearchParams();
  const month = q.get('month') || '';
  const axis = q.get('axis') || '공급사';
  const party = q.get('party') || '';
  const [data, setData] = useState<Payload | null>(null);
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const qs = `month=${encodeURIComponent(month)}&axis=${encodeURIComponent(axis)}&party=${encodeURIComponent(party)}`;

  const fit = () => {
    const d = frame.current?.contentDocument;
    if (d) frame.current!.style.height = `${d.documentElement.scrollHeight}px`;
  };

  const load = async () => {
    try {
      const res = await ledgerFetch(`/api/settlement/invoice?${qs}`);
      const body = await res.json() as Payload;
      setData(body);
      if (!body.ok) { setHtml(''); return; }
      const h = await ledgerFetch(`/api/settlement/invoice?${qs}&format=html&preview=1`);
      setHtml(h.ok ? await h.text() : '');
    } catch (e) {
      setData({ ok: false, reason: String((e as Error)?.message || e) } as Payload);
      setHtml('');
    }
  };

  /** **발행 — 번호를 붙인다.** 붙는 순간 그건 나간 문서다. 두 번 눌러도 번호는 하나다. */
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
      const body = await res.json() as { ok: boolean; reason?: string };
      if (!body.ok) { alert(body.reason || '발행하지 못했습니다'); return; }
      await load();
    } finally { setBusy(false); }
  };

  useEffect(() => { void load(); }, [month, axis, party]);

  if (!data) return <Loading />;
  if (!data.ok) return <CenterNote>{data.reason || '정산서를 만들지 못했습니다.'}</CenterNote>;

  const gated = (data.gate?.length ?? 0) > 0;

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: '100vh' }}>
      <style>{`@media print { .no-print { display: none !important } }`}</style>

      <div className="no-print" style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap' }}>
        <Btn onClick={() => frame.current?.contentWindow?.print()}>인쇄 / PDF 저장</Btn>
        {!data.invoiceNo && (
          <Btn variant="ghost" onClick={issue} disabled={busy || gated}>
            {busy ? '발행 중…' : gated ? '실적 확인 후 발행' : '번호 발행'}
          </Btn>
        )}
        <Btn variant="ghost" onClick={() => window.close()}>닫기</Btn>
      </div>

      {((data.gate?.length ?? 0) > 0 || data.missing?.length > 0 || data.receiverNote || data.driftNote) && (
        <div className="no-print">
          <Message variant="danger">
          {(data.gate?.length ?? 0) > 0 && (
            <div><b>실적 확인이 아직 안 끝났습니다</b> — {data.gate!.join(' / ')}</div>
          )}
          {data.missing?.length > 0 && <div>이 칸이 비어 있습니다 — <b>{data.missing.join(' · ')}</b></div>}
          {data.receiverNote && <div>{data.receiverNote}</div>}
          {data.driftNote && <div>{data.driftNote}</div>}
          </Message>
        </div>
      )}

      {html
        ? (
          <iframe
            ref={frame}
            title="정산서"
            srcDoc={html}
            onLoad={fit}
            style={{ display: 'block', width: '100%', border: 0, background: 'transparent' }}
          />
        )
        : <CenterNote minHeight={160}>문서를 그리지 못했습니다.</CenterNote>}
    </div>
  );
}

export default function SettlementInvoicePage() {
  return (
    <Suspense fallback={<Loading />}>
      <InvoiceBody />
    </Suspense>
  );
}
