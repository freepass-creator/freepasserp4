'use client';
import { useEffect, useMemo, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import {
  ADMIN_SETTLE_BLOCKS, computeAdminSettlement, importCompletedForMonth,
  monthTotals, saveAdminSettlement,
} from '@/lib/domain/admin-settlement';
import { Btn, C, CenterNote, FS, FW, Input, ListRow, Loading, R, Select, SectionLabel, won, NUM } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { useIsMobile } from '@/lib/use-mobile';

/** 월정산서(VAT·청구/지급) — /settlement 정산서 탭. */
export function AdminSettlementSheet({ month }: { month: string }) {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const all = await getStore().list('admin_settlement', co);
    setRows(all.filter((r) => String(r.settle_month) === month));
  };
  useEffect(() => { setSel(null); setForm({}); load(); /* eslint-disable-next-line */ }, [month, co]);

  const shown = rows || [];
  const tot = useMemo(() => monthTotals(shown), [shown]);

  const select = (r: EntityRecord) => {
    setSel(String(r._key || r.admin_settlement_code));
    setForm({ ...r, ...computeAdminSettlement(r) });
  };

  const setField = (k: string, v: string) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      return { ...next, ...computeAdminSettlement(next) };
    });
  };

  const save = async () => {
    if (!String(form.admin_settlement_code || '').trim()) return;
    setBusy(true);
    try {
      await saveAdminSettlement(form);
      await load();
      toast('정산서 저장됨', 'ok');
    } catch (e) { toast(String((e as Error).message || e), 'error'); }
    finally { setBusy(false); }
  };

  const importDone = async () => {
    setBusy(true);
    try {
      const r = await importCompletedForMonth(month);
      await load();
      toast(`불러오기: 신규 ${r.created} · 기존유지 ${r.skipped}`, 'ok');
    } catch (e) { toast(String((e as Error).message || e), 'error'); }
    finally { setBusy(false); }
  };

  if (rows === null) return <Loading />;

  return (
    <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 10, minHeight: mobile ? undefined : 420 }}>
      <div style={{ flex: mobile ? undefined : '0 0 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn size="sm" onClick={importDone} disabled={busy}>정산완료 불러오기</Btn>
        </div>
        <div style={{ fontSize: FS.cap, color: C.mute }}>
          청구 {won(tot.bill)} · 지급 {won(tot.pay)} · 수익 <b style={{ color: C.brand }}>{won(tot.profit)}</b> ({tot.n}건)
        </div>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, maxHeight: mobile ? 200 : 480, overflowY: 'auto' }}>
          {shown.length === 0
            ? <CenterNote>이 달 정산서 없음 — 정산완료 불러오기</CenterNote>
            : shown.map((r) => (
              <ListRow key={String(r._key)} selected={String(r._key) === sel} onClick={() => select(r)}
                main={String(r.customer_name || r.contract_code || '—')}
                sub={`${r.car_number || ''} · 청구 ${won(r.provider_bill)}`}
                right={<span style={{ fontSize: FS.cap, fontWeight: FW.head, color: C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(r.monthly_profit)}</span>}
              />
            ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: 12, overflowY: 'auto', maxHeight: mobile ? undefined : 520 }}>
        {!sel ? <CenterNote>왼쪽에서 정산서를 선택하세요</CenterNote> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: FS.body, fontWeight: FW.title }}>{String(form.admin_settlement_code)}</span>
              <span style={{ flex: 1 }} />
              <Btn size="sm" onClick={save} disabled={busy}>저장</Btn>
            </div>
            {ADMIN_SETTLE_BLOCKS.map((block) => (
              <div key={block.key}>
                <SectionLabel>{block.title}</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 8, marginTop: 6 }}>
                  {block.fields.map((f) => (
                    <div key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.strong }}>{f.label}{f.calc ? ' (자동)' : ''}</span>
                      {f.type === 'select' ? (
                        <Select value={String(form[f.k] ?? '')} onChange={(v) => setField(f.k, v)} options={(f.opts || []).map((o) => ({ value: o, label: o }))} size="sm" full />
                      ) : f.calc ? (
                        <div style={{ height: 32, display: 'flex', alignItems: 'center', padding: '0 8px', borderRadius: R, background: C.head, fontFamily: NUM, fontSize: FS.body, fontWeight: FW.head }}>{String(form[f.k] ?? '')}</div>
                      ) : (
                        <Input value={form[f.k] == null ? '' : String(form[f.k])} onChange={(v) => setField(f.k, v)}
                          size="sm" full inputMode={f.type === 'num' ? 'numeric' : undefined}
                          style={f.type === 'num' ? { fontFamily: NUM } : undefined} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ fontSize: FS.cap, color: C.faint, borderTop: `1px solid ${C.line2}`, paddingTop: 8 }}>
              부가세=합계×10% · 청구/지급=합계+부가세 · 당월수익=청구−지급. 청구·지급 칸을 직접 넣으면 그 값이 우선입니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
