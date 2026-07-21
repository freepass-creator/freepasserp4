'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { vehicleName } from '@/lib/domain/product';
import { checkInventory } from '@/lib/domain/data-check';
import { auditMasterFit, type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { loadVehicleMaster } from '@/lib/domain/vehicle-master-load';
import { setReportStatus } from '@/lib/domain/report';
import { toast } from '@/components/Toaster';
import { Page, C, R, NUM, Loading, Btn, CenterNote, FormCard, SectionLabel, Badge, toneText } from '@/components/ui';
import { MasterFitSummary } from '@/components/MasterFitSummary';
import { NAV_LABEL } from '@/lib/tabbar';
import { haptic } from '@/lib/haptics';

// 데이터 점검 — 매물 자동 이상감지(상시) + 차종마스터 규격 전수 검수.
export default function DataCheck() {
  const co = getCompanyId();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [master, setMaster] = useState<MasterEntry[] | null>(null);
  const [reports, setReports] = useState<EntityRecord[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const loadReports = async () => { try { setReports(await getStore().list('report', co)); } catch { setReports([]); } };
  useEffect(() => {
    (async () => {
      await seedIfEmpty(co);
      setRows(await getStore().list('product', co));
      await loadReports();
    })();
    loadVehicleMaster()
      .then((entries) => setMaster(entries))
      .catch(() => setMaster([]));
    /* eslint-disable-next-line */
  }, []);
  const resolve = async (code: string) => {
    try {
      await setReportStatus(co, code, '처리완료');
      toast('처리완료 표시됨', 'ok');
      loadReports();
    } catch (e) {
      toast('실패(규칙 배포 필요): ' + String(e), 'error');
    }
  };
  const openReports = reports.filter((r) => String(r.status) !== '처리완료').sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  const byCode = useMemo(() => new Map((rows || []).map((p) => [String(p.product_code ?? p._key), p])), [rows]);
  const groups = useMemo(() => (rows ? checkInventory(rows) : []), [rows]);
  const masterFit = useMemo(() => (rows && master && master.length ? auditMasterFit(rows, master) : null), [rows, master]);
  if (rows === null) return <Loading />;

  const sevTone = (p: string) => (p === 'high' ? 'red' : p === 'mid' ? 'amber' : 'gray') as 'red' | 'amber' | 'gray';
  const sevLabel = (p: string) => (p === 'high' ? '높음' : p === 'mid' ? '중간' : '낮음');
  const totalHits = groups.reduce((a, g) => a + g.hits.length, 0);
  const toggle = (k: string) => {
    haptic.select();
    setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };

  const meta = `${rows.length.toLocaleString()}매물 · 이상 ${groups.length}종 · ${totalHits}건`
    + (openReports.length ? ` · 검수 ${openReports.length}` : '');

  return (
    <Page title={NAV_LABEL.dataCheck} meta={meta} countSuffix="">
      <FormCard title="차종마스터 규격" hint="제조사·모델·세부모델이 마스터 실경로인지">
        {master === null ? (
          <CenterNote minHeight={48}>마스터 불러오는 중…</CenterNote>
        ) : !master.length ? (
          <div style={{ fontSize: 12.5, color: toneText('red') }}>마스터 로드 실패 — `/data/vehicle-master.json` 확인</div>
        ) : !masterFit ? (
          <CenterNote minHeight={48}>집계 중…</CenterNote>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: C.mute, marginBottom: 10, lineHeight: 1.5 }}>
              마스터 {master.length.toLocaleString()}세대 기준. 자동변환= high+중 · 검수= 검토+미매칭+신호없음.
            </div>
            <MasterFitSummary
              fit={masterFit}
              showSamples
              footer={
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10 }}>
                  일괄 변환은 <Link href="/dev" style={{ color: C.accent }}>개발도구</Link>에서 · 단건은 재고에서 매칭.
                </div>
              }
            />
          </>
        )}
      </FormCard>

      {openReports.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <SectionLabel mt={0}>영업자 검수 요청 · {openReports.length}건</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {openReports.map((r) => {
              const p = byCode.get(String(r.product_code));
              return (
                <div
                  key={String(r.report_code)}
                  style={{
                    border: `1px solid ${C.warn}`, borderRadius: R, background: C.warnBg,
                    padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  }}
                >
                  <Link
                    href={`/m/${encodeURIComponent(String(r.product_code))}`}
                    style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, textDecoration: 'none', fontFamily: NUM }}
                  >
                    {String(r.car_number || r.product_code)}
                  </Link>
                  <Badge tone="amber">{String(r.reason)}</Badge>
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

      <div style={{ marginTop: 18 }}>
        <SectionLabel mt={0}>자동 이상 감지</SectionLabel>
        {groups.length === 0 ? (
          <CenterNote minHeight={120}>이상 없음 — 데이터가 깨끗합니다</CenterNote>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groups.map((g) => {
              const on = open.has(g.key);
              const tone = sevTone(g.severity);
              return (
                <FormCard
                  key={g.key}
                  title={(
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%' }}>
                      <span>{g.label}</span>
                      <Badge tone={tone}>{sevLabel(g.severity)}</Badge>
                      <span style={{ fontFamily: NUM, fontWeight: 800, color: toneText(tone) }}>{g.hits.length}건</span>
                      <span style={{ marginLeft: 'auto' }}>
                        <Btn size="sm" variant="ghost" onClick={() => toggle(g.key)}>
                          {on ? '접기' : '펼치기'}
                        </Btn>
                      </span>
                    </span>
                  )}
                  hint={g.hint}
                >
                  {on ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {g.hits.slice(0, 200).map((h, i) => {
                        const p = byCode.get(h.code);
                        return (
                          <Link
                            key={i}
                            href={`/m/${encodeURIComponent(h.code)}`}
                            title={p ? vehicleName(p) : ''}
                            style={{
                              fontSize: 11.5, color: C.ink, background: C.head,
                              border: `1px solid ${C.line}`, borderRadius: R,
                              padding: '3px 8px', textDecoration: 'none', fontFamily: NUM,
                            }}
                          >
                            {h.car}{h.note ? <span style={{ color: C.faint }}> · {h.note}</span> : ''}
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: C.faint }}>펼치면 해당 매물 링크를 봅니다.</div>
                  )}
                </FormCard>
              );
            })}
          </div>
        )}
      </div>
    </Page>
  );
}
