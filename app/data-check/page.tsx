'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName } from '@/lib/domain/product';
import { checkInventory } from '@/lib/domain/data-check';
import { setReportStatus } from '@/lib/domain/report';
import { toast } from '@/components/Toaster';
import { C, Loading, Btn } from '@/components/ui';

// 데이터 점검 — 매물 자동 이상감지(상시). 사진없음·중복·모순·노후·폐차급 전수 스캔 → 클릭해 매물로 이동.
export default function DataCheck() {
  const co = getCompanyId();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [reports, setReports] = useState<EntityRecord[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const loadReports = async () => { try { setReports(await getStore().list('report', co)); } catch { setReports([]); } };
  useEffect(() => { (async () => { await seedIfEmpty(co); setRows(await getStore().list('product', co)); await loadReports(); })(); /* eslint-disable-next-line */ }, []);
  const resolve = async (code: string) => { try { await setReportStatus(co, code, '처리완료'); toast('처리완료 표시됨', 'ok'); loadReports(); } catch (e) { toast('실패(규칙 배포 필요): ' + String(e), 'error'); } };
  const openReports = reports.filter((r) => String(r.status) !== '처리완료').sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  const byCode = useMemo(() => new Map((rows || []).map((p) => [String(p.product_code ?? p._key), p])), [rows]);
  const groups = useMemo(() => (rows ? checkInventory(rows) : []), [rows]);
  if (rows === null) return <Loading />;

  const sev: Record<string, { c: string; t: string }> = { high: { c: '#c0453a', t: '높음' }, mid: { c: '#b7791f', t: '중간' }, low: { c: '#5b6472', t: '낮음' } };
  const totalHits = groups.reduce((a, g) => a + g.hits.length, 0);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '18px 16px 44px' }}>
      <div style={{ fontSize: 12, color: C.mute, letterSpacing: '0.04em' }}>매물 관리</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '4px 0 4px' }}>데이터 점검</h1>
      <div style={{ fontSize: 13, color: C.mute, marginBottom: 16 }}>{rows.length}매물 자동 스캔 · 이상 {groups.length}종 · 표시 {totalHits}건{openReports.length ? ` · 영업자 확인요청 ${openReports.length}` : ''}</div>

      {openReports.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#9a3412', marginBottom: 6 }}>⚑ 영업자 확인 요청 {openReports.length}건</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {openReports.map((r) => {
              const p = byCode.get(String(r.product_code));
              return (
                <div key={String(r.report_code)} style={{ border: `1px solid #f59e0b55`, borderRadius: 6, background: '#fff7ed', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Link href={`/m/${encodeURIComponent(String(r.product_code))}`} style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, textDecoration: 'none', fontFamily: 'var(--font-mono)' }}>{String(r.car_number || r.product_code)}</Link>
                  <span style={{ fontSize: 12, color: '#9a3412', fontWeight: 700 }}>{String(r.reason)}</span>
                  {p && <span style={{ fontSize: 11.5, color: C.mute }}>{vehicleName(p)}</span>}
                  {r.memo ? <span style={{ fontSize: 11.5, color: C.faint, flex: 1, minWidth: 0 }}>“{String(r.memo)}”</span> : <span style={{ flex: 1 }} />}
                  <span style={{ fontSize: 11, color: C.faint }}>{String(r.reporter_name || '')} · {String(r.provider_company_code || '')}</span>
                  <Btn size="sm" variant="ghost" onClick={() => resolve(String(r.report_code))}>처리완료</Btn>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.faint, fontSize: 14 }}>이상 없음 — 데이터가 깨끗합니다 ✓</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map((g) => (
            <div key={g.key} style={{ border: `1px solid ${C.line}`, borderRadius: 6, background: '#fff', overflow: 'hidden' }}>
              <button onClick={() => toggle(g.key)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ width: 8, height: 8, borderRadius: 8, background: sev[g.severity].c, flex: '0 0 auto' }} />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{g.label}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: sev[g.severity].c, fontFamily: 'var(--font-mono)' }}>{g.hits.length}건</span>
                <span style={{ fontSize: 11.5, color: C.faint, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.hint}</span>
                <span style={{ fontSize: 11, color: C.mute }}>{open.has(g.key) ? '▲' : '▼'}</span>
              </button>
              {open.has(g.key) && (
                <div style={{ borderTop: `1px solid ${C.line2}`, padding: '6px 10px 10px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {g.hits.slice(0, 200).map((h, i) => {
                    const p = byCode.get(h.code);
                    return (
                      <Link key={i} href={`/m/${encodeURIComponent(h.code)}`} title={p ? vehicleName(p) : ''} style={{ fontSize: 11.5, color: C.ink, background: '#f1f3f7', border: `1px solid ${C.line}`, borderRadius: 4, padding: '3px 8px', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}>
                        {h.car}{h.note ? <span style={{ color: C.faint }}> · {h.note}</span> : ''}
                      </Link>
                    );
                  })}
                  {g.hits.length > 200 && <span style={{ fontSize: 11, color: C.faint, alignSelf: 'center' }}>외 {g.hits.length - 200}건…</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 18, fontSize: 11, color: C.faint }}>* 읽기전용 자동 점검 — 각 항목 클릭 시 해당 매물로 이동. 시트 취합할 때마다 자동 재점검됩니다.</div>
    </main>
  );
}
