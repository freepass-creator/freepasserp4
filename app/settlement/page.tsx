'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole } from '@/lib/domain/deal';
import { parseSettlementHistory } from '@/lib/domain/settlement-import';
import { downloadSettlementReport } from '@/lib/excel-export';
import { Page, Btn, Badge, FilterChips, IconBtn, PillTabs, SearchInput, won, C, R, NUM, FW, FS, Loading, CenterNote, SETTLEMENT_STATUS_TONE, th, thR, td, tdR } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { AdminSettlementSheet } from '@/components/AdminSettlementSheet';
import { matchSettlementQuery } from '@/lib/domain/search';
import { NAV_LABEL } from '@/lib/tabbar';

// 관리자 월별정산 — ① 집계(건별 R1/R2) ② 정산서(VAT·청구/지급 admin_settlement).
const monthOf = (s: EntityRecord) => String(s.contract_date || '').slice(0, 7);
const tdL: typeof td = { ...td, textAlign: 'left' as const };

export default function MonthlySettlement() {
  const co = getCompanyId();
  const router = useRouter();
  const mobile = useIsMobile();
  const [ok, setOk] = useState<boolean | null>(null);
  const [rows, setRows] = useState<EntityRecord[]>([]);
  const [month, setMonth] = useState('');
  const [group, setGroup] = useState<'none' | 'provider' | 'channel'>('none');
  const [mode, setMode] = useState<'agg' | 'sheet'>('agg');
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { (async () => {
    await seedIfEmpty(co);
    if (getRole() !== 'admin') { router.replace('/contract'); return; }
    const all = await getStore().list('settlement', co);
    setRows(all); setOk(true);
    const ms = [...new Set(all.map(monthOf).filter(Boolean))].sort();
    setMonth(ms.length ? ms[ms.length - 1] : new Date().toISOString().slice(0, 7));
  })(); /* eslint-disable-next-line */ }, []);

  // 계약현황 xlsx → 정산 이력 임포트(관리자). 재사용: 다음 파일도 같은 버튼.
  const importXlsx = async (files: FileList | null) => {
    if (!files || !files.length) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await files[0].arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheets = wb.SheetNames.map((name) => ({ name, aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) as unknown[][] }));
      const { records } = parseSettlementHistory(sheets);
      if (!records.length) { toast('정산 데이터를 찾지 못했습니다 (계약현황 형식 확인)', 'error'); return; }
      const res = await getStore().save('settlement', co, records);
      const all = await getStore().list('settlement', co); setRows(all);
      const ms = [...new Set(all.map(monthOf).filter(Boolean))].sort();
      if (ms.length) setMonth(ms[ms.length - 1]);
      toast(`정산 이력 ${res.saved}건 반영${res.duplicates ? ` · 기존 ${res.duplicates} 유지` : ''}`, 'ok');
    } catch (e) { toast('가져오기 실패: ' + String(e), 'error'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const months = useMemo(() => { const s = new Set(rows.map(monthOf).filter(Boolean)); s.add(new Date().toISOString().slice(0, 7)); return [...s].sort(); }, [rows]);
  const monthRowsAll = useMemo(() => rows.filter((s) => monthOf(s) === month).sort((a, b) => String(a.settlement_code).localeCompare(String(b.settlement_code))), [rows, month]);
  const monthRows = useMemo(() => monthRowsAll.filter((s) => matchSettlementQuery(s, q)), [monthRowsAll, q]);
  const tot = (f: (s: EntityRecord) => unknown) => monthRows.reduce((n, s) => n + (Number(f(s)) || 0), 0);
  const idx = months.indexOf(month);
  const step = (d: number) => { const i = idx + d; if (i >= 0 && i < months.length) setMonth(months[i]); };

  // 공급사별·영업채널별 소계(정산서). 환수는 net에서 이미 fee_amount 기준이라 별도 표기.
  const grouped = useMemo(() => {
    if (group === 'none') return [] as { name: string; n: number; r1: number; r2: number; net: number; cb: number }[];
    const key = group === 'provider' ? 'provider_company_code' : 'agent_channel_code';
    const m = new Map<string, EntityRecord[]>();
    for (const s of monthRows) { const k = String(s[key] || '(미지정)'); const a = m.get(k); if (a) a.push(s); else m.set(k, [s]); }
    return [...m.entries()].map(([name, list]) => {
      const r1 = list.reduce((n, s) => n + (Number(s.fee_amount) || 0), 0);
      const r2 = list.reduce((n, s) => n + (Number(s.agent_payout) || 0), 0);
      const cb = list.reduce((n, s) => n + (Number(s.clawback_amount) || 0), 0);
      return { name, n: list.length, r1, r2, net: r1 - r2, cb };
    }).sort((a, b) => b.net - a.net);
  }, [monthRows, group]);

  if (ok === null) return <Loading />;

  const cards: [string, number, string][] = [
    ['공급사 청구 (R1)', tot((s) => s.fee_amount), C.ink],
    ['영업자 지급 (R2)', tot((s) => s.agent_payout), C.ink],
    ['순수익', tot((s) => s.net_amount), C.brand],
    ['환수', tot((s) => s.clawback_amount), C.danger],
  ];
  return (
    <Page title={NAV_LABEL.settlement} meta={`${monthRows.length}건`}
      listTools={mode === 'agg' ? {
        search: { value: q, onChange: setQ, placeholder: '정산·계약·차번·계약자·공급·영업…' },
        hints: q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : undefined,
        onClearHints: () => setQ(''),
      } : undefined}
      bottomActions={mode === 'agg' ? (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <Btn variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>가져오기</Btn>
          {monthRows.length > 0 && <Btn variant="ghost" size="sm" onClick={() => downloadSettlementReport(monthRows, month)}>정산서</Btn>}
        </span>
      ) : undefined}
      right={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconBtn onClick={() => step(-1)} disabled={idx <= 0} title="이전 달">‹</IconBtn>
        <span style={{ fontSize: FS.title, fontWeight: FW.head, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', minWidth: 74, textAlign: 'center' }}>{month || '—'}</span>
        <IconBtn onClick={() => step(1)} disabled={idx >= months.length - 1} title="다음 달">›</IconBtn>
        {!mobile && mode === 'agg' && <>
          <Btn variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>가져오기</Btn>
          {monthRows.length > 0 && <Btn variant="ghost" size="sm" onClick={() => downloadSettlementReport(monthRows, month)}>정산서</Btn>}
        </>}
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={(e) => importXlsx(e.target.files)} style={{ display: 'none' }} />
      </div>}>

      <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <PillTabs tabs={[{ key: 'agg', label: '월별 집계' }, { key: 'sheet', label: 'VAT 정산서' }]} value={mode} onChange={setMode} size="sm" />
        {mode === 'agg' && !mobile && (
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="정산·계약·차번·계약자·공급·영업…"
            style={{ flex: '1 1 220px', minWidth: 180, maxWidth: 360 }}
          />
        )}
      </div>

      {mode === 'sheet' ? <AdminSettlementSheet month={month} /> : (<>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, margin: '14px 0' }}>
        {cards.map(([label, val, color]) => (
          <div key={label} style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: '11px 14px' }}>
            <div style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.strong }}>{label}</div>
            <div style={{ fontSize: 17, fontWeight: FW.head, color, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{won(val)}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 10 }}>
        <FilterChips value={group} onChange={setGroup} options={[{ key: 'none', label: '전체' }, { key: 'provider', label: '공급사별' }, { key: 'channel', label: '영업채널별' }]} />
      </div>

      {monthRows.length === 0 ? <CenterNote>{q ? '검색 결과 없음' : '이 달 정산 내역이 없습니다.'}</CenterNote>
        : group !== 'none' ? (
          mobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {grouped.map((g) => (
                <div key={g.name} style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}><span style={{ fontSize: FS.body, fontWeight: FW.title, color: C.ink }}>{g.name}</span><span style={{ fontSize: FS.cap, color: C.faint }}>{g.n}건</span></div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px', fontSize: FS.sub }}>
                    <div style={{ color: C.mute }}>공급사청구 <b style={{ float: 'right', color: C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(g.r1)}</b></div>
                    <div style={{ color: C.mute }}>영업지급 <b style={{ float: 'right', color: C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(g.r2)}</b></div>
                    <div style={{ color: C.mute }}>순수익 <b style={{ float: 'right', color: C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(g.net)}</b></div>
                    {g.cb > 0 && <div style={{ color: C.mute }}>환수 <b style={{ float: 'right', color: C.danger, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(g.cb)}</b></div>}
                  </div>
                </div>
              ))}
              <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.head, padding: '10px 12px', fontSize: FS.sub }}><b>합계 {monthRows.length}건</b> · 순수익 <b style={{ color: C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(tot((s) => s.net_amount))}</b> · 환수 <b style={{ color: C.danger, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(tot((s) => s.clawback_amount))}</b></div>
            </div>
          ) : (
            <div className="fp-sheet">
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620 }}>
                <thead><tr><th style={th}>{group === 'provider' ? '공급사' : '영업채널'}</th><th style={thR}>건수</th><th style={thR}>공급사청구</th><th style={thR}>영업지급</th><th style={thR}>순수익</th><th style={thR}>환수</th></tr></thead>
                <tbody>
                  {grouped.map((g) => (
                    <tr key={g.name} style={{ borderTop: `1px solid ${C.line2}` }}>
                      <td style={tdL}>{g.name}</td><td style={tdR}>{g.n}</td><td style={tdR}>{won(g.r1)}</td><td style={tdR}>{won(g.r2)}</td><td style={{ ...tdR, color: C.brand, fontWeight: FW.strong }}>{won(g.net)}</td><td style={{ ...tdR, color: g.cb ? C.danger : C.faint }}>{g.cb ? won(g.cb) : '—'}</td>
                    </tr>
                  ))}
                  <tr style={{ background: C.head, borderTop: `1px solid ${C.line2}` }}>
                    <td style={{ ...tdL, fontWeight: FW.head }} colSpan={2}>합계 {monthRows.length}건</td>
                    <td style={{ ...tdR, fontWeight: FW.head }}>{won(tot((s) => s.fee_amount))}</td>
                    <td style={{ ...tdR, fontWeight: FW.head }}>{won(tot((s) => s.agent_payout))}</td>
                    <td style={{ ...tdR, fontWeight: FW.head, color: C.brand }}>{won(tot((s) => s.net_amount))}</td>
                    <td style={{ ...tdR, fontWeight: FW.head, color: C.danger }}>{won(tot((s) => s.clawback_amount))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        )
        : mobile ? (
          /* 모바일 = 카드(가로 표 회피) */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {monthRows.map((s) => {
              const cb = Number(s.clawback_amount) || 0;
              return (
                <div key={String(s.settlement_code)} style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                    <span style={{ fontSize: FS.body, fontWeight: FW.title, color: C.ink }}>{String(s.customer_name || '—')}</span>
                    <span style={{ fontSize: FS.cap, color: C.faint, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{String(s.car_number || '')}</span>
                    <span style={{ flex: 1 }} />
                    <Badge tone={SETTLEMENT_STATUS_TONE[String(s.settlement_status)] || 'gray'}>{String(s.settlement_status || '')}</Badge>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px', fontSize: FS.sub }}>
                    <div style={{ color: C.mute }}>월대여료 <b style={{ color: C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', float: 'right' }}>{won(s.rent_amount)}</b></div>
                    <div style={{ color: C.mute }}>공급사청구 <b style={{ color: C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', float: 'right' }}>{won(s.fee_amount)}</b></div>
                    <div style={{ color: C.mute }}>영업지급 <b style={{ color: C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', float: 'right' }}>{won(s.agent_payout)}</b></div>
                    <div style={{ color: C.mute }}>순수익 <b style={{ color: C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', float: 'right' }}>{won(s.net_amount)}</b></div>
                    {cb > 0 && <div style={{ color: C.mute, gridColumn: '1 / -1' }}>환수 <b style={{ color: C.danger, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', float: 'right' }}>{won(cb)}</b></div>}
                  </div>
                </div>
              );
            })}
            <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.head, padding: '10px 12px', fontSize: FS.sub }}>
              <b>합계 {monthRows.length}건</b> · 청구 <b style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(tot((s) => s.fee_amount))}</b> · 지급 <b style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(tot((s) => s.agent_payout))}</b> · 순수익 <b style={{ color: C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(tot((s) => s.net_amount))}</b>
            </div>
          </div>
        ) : (
          /* 웹 = 엑셀형 표 (.fp-sheet + sticky th SSOT) */
          <div className="fp-sheet">
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
              <thead><tr>
                <th style={th}>계약자</th><th style={th}>차량</th><th style={th}>공급사</th><th style={th}>영업자</th>
                <th style={thR}>월대여료</th><th style={thR}>공급사청구</th><th style={thR}>영업지급</th><th style={thR}>순수익</th><th style={thR}>환수</th><th style={th}>상태</th>
              </tr></thead>
              <tbody>
                {monthRows.map((s) => (
                  <tr key={String(s.settlement_code)} style={{ borderTop: `1px solid ${C.line2}` }}>
                    <td style={tdL}>{String(s.customer_name || '—')}</td>
                    <td style={tdL}>{[s.car_number, s.sub_model_snapshot].filter(Boolean).join(' ') || '—'}</td>
                    <td style={tdL}>{String(s.provider_company_code || '—')}</td>
                    <td style={tdL}>{String(s.agent_code || '—')}</td>
                    <td style={tdR}>{won(s.rent_amount)}</td>
                    <td style={tdR}>{won(s.fee_amount)}</td>
                    <td style={tdR}>{won(s.agent_payout)}</td>
                    <td style={{ ...tdR, color: C.brand, fontWeight: FW.strong }}>{won(s.net_amount)}</td>
                    <td style={{ ...tdR, color: Number(s.clawback_amount) ? C.danger : C.faint }}>{Number(s.clawback_amount) ? won(s.clawback_amount) : '—'}</td>
                    <td style={tdL}>{String(s.settlement_status || '')}</td>
                  </tr>
                ))}
                <tr style={{ background: C.head, borderTop: `1px solid ${C.line2}` }}>
                  <td style={{ ...tdL, fontWeight: FW.head }} colSpan={4}>합계 {monthRows.length}건</td>
                  <td style={{ ...tdR, fontWeight: FW.head }}>{won(tot((s) => s.rent_amount))}</td>
                  <td style={{ ...tdR, fontWeight: FW.head }}>{won(tot((s) => s.fee_amount))}</td>
                  <td style={{ ...tdR, fontWeight: FW.head }}>{won(tot((s) => s.agent_payout))}</td>
                  <td style={{ ...tdR, fontWeight: FW.head, color: C.brand }}>{won(tot((s) => s.net_amount))}</td>
                  <td style={{ ...tdR, fontWeight: FW.head, color: C.danger }}>{won(tot((s) => s.clawback_amount))}</td>
                  <td style={tdL} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      <div style={{ marginTop: 12, fontSize: FS.cap, color: C.faint, lineHeight: 1.6 }}>공급사청구(R1)=월대여료×공급사율 · 영업지급(R2)=월대여료×영업지급율 · 순수익=R1−R2. 율은 계약 시점 동결(기본 10%/4%, 신차=공급사 0%).</div>
      </>)}
    </Page>
  );
}
