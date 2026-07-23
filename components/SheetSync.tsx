'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStore } from '@/lib/store';
import { getRole, actor } from '@/lib/domain/deal';
import { toast } from '@/components/Toaster';
import { Btn, C, FS, FW, Input, PillTabs, R, Select, SectionLabel, Textarea } from '@/components/ui';
import { type EntityRecord } from '@/lib/intake/entities';
import { type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { fetchSheetTable, parseDelimited, autoMapHeaders, IMPORT_FIELDS, type MappingProfile } from '@/lib/domain/sheet-import';
import { commitSupplierProducts, previewSupplierTable } from '@/lib/domain/master-ingress';
import { loadVehicleMaster, peekVehicleMaster } from '@/lib/domain/vehicle-master-load';
import { ADAPTER_OPTIONS, resolveAdapter, type SheetAdapterId } from '@/lib/domain/sheet-adapters';
import { listSheetPartners, syncAllPartnerSheets, type PartnerSheetRow } from '@/lib/domain/sheet-sync-all';

/**
 * 공급사 매물 취합 — 공급사마다 고유 시트 + 매핑 학습.
 * 관리자: 시트 URL 등록된 공급사 일괄 가져오기+저장. 단일/엑셀도 동일 엔진.
 */
export function SheetSync({ co, onImported }: { co: string; onImported: () => void }) {
  const role = getRole();
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState<'sheet' | 'excel'>('sheet');
  const [url, setUrl] = useState('');
  const [gid, setGid] = useState('');
  const [headerRow, setHeaderRow] = useState('8');
  const [adapterId, setAdapterId] = useState<SheetAdapterId>('autoplus');
  const [prov, setProv] = useState(isAdmin ? '' : (actor('provider').code || ''));
  const [paste, setPaste] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<MappingProfile>({});
  const [busy, setBusy] = useState(false);
  const [master, setMaster] = useState<MasterEntry[] | null>(() => peekVehicleMaster());
  const [roster, setRoster] = useState<PartnerSheetRow[]>([]);
  const [bulkLog, setBulkLog] = useState<string>('');
  const [partnerHint, setPartnerHint] = useState('');

  const refreshRoster = useCallback(async () => {
    if (!isAdmin) return;
    try { setRoster(await listSheetPartners(co)); } catch { setRoster([]); }
  }, [co, isAdmin]);

  /** 공급사: partner에 저장된 시트 URL·어댑터·헤더·매핑 자동 채움. */
  const hydrateFromPartner = useCallback(async (code: string) => {
    if (!code.trim()) return;
    try {
      const p = await getStore().get('partner', co, code.trim());
      if (!p) {
        setPartnerHint(`파트너 ${code} 없음 — URL을 직접 넣고「매핑·URL 저장」하면 다음에 자동 채움`);
        return;
      }
      const savedUrl = String(p.sheet_url || '').trim();
      const savedGid = String(p.sheet_tab || '').trim();
      const savedHeader = p.header_row != null && p.header_row !== '' ? String(p.header_row) : '';
      const savedAdapter = (String(p.adapter_id || '') as SheetAdapterId) || 'autoplus';
      if (savedUrl && !/^https:\/\/docs\.google\.com\/…/.test(savedUrl)) {
        setUrl(savedUrl);
        setPartnerHint(`${String(p.name || code)} 시트 불러옴`);
      } else {
        const cached = typeof window !== 'undefined' ? localStorage.getItem('fp4_sheet_' + role) : '';
        if (cached) setUrl(cached);
        setPartnerHint(savedUrl
          ? '시드 placeholder URL — 실제 구글시트 주소를 넣고「매핑·URL 저장」하세요'
          : '등록된 시트 없음 — URL 입력 후「매핑·URL 저장」하면 다음에 자동');
      }
      if (savedGid) setGid(savedGid);
      if (savedHeader) setHeaderRow(savedHeader);
      if (savedAdapter === 'generic' || savedAdapter === 'autoplus') setAdapterId(savedAdapter);
      else setAdapterId('autoplus');
    } catch {
      setPartnerHint('파트너 시트 정보를 읽지 못했습니다');
    }
  }, [co, role]);

  useEffect(() => {
    loadVehicleMaster()
      .then((entries) => setMaster(entries))
      .catch(() => {
        setMaster([]);
        toast('차종마스터 로드 실패 — 변환·입고 불가', 'error');
      });
  }, []);
  useEffect(() => { refreshRoster(); }, [refreshRoster]);
  useEffect(() => {
    if (!isAdmin && prov) void hydrateFromPartner(prov);
  }, [isAdmin, prov, hydrateFromPartner]);

  const clear = () => { setTable(null); setMapping({}); setBulkLog(''); };
  const prepared = (raw: string[][]) => resolveAdapter(adapterId).prepareTable(raw, { headerRow: Math.max(0, Number(headerRow) || 0) });
  const masterReady = !!(master && master.length);

  const loadSheet = async () => {
    if (!url.trim()) { toast('구글시트 URL을 입력하세요', 'error'); return; }
    setBusy(true); setBulkLog('');
    try {
      const raw = await fetchSheetTable(url.trim(), gid.trim() || undefined);
      const t = prepared(raw);
      if (t.length < 2) { toast('헤더 + 데이터 행이 필요합니다(헤더 행 번호 확인)', 'error'); return; }
      setTable(t);
      setMapping(await loadProfile(prov) || autoMapHeaders(t[0]));
      if (typeof window !== 'undefined') localStorage.setItem('fp4_sheet_' + role, url.trim());
    } catch (e) { toast('시트 불러오기 실패: ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };
  const loadExcel = async () => {
    if (!paste.trim()) { toast('엑셀 내용을 붙여넣으세요', 'error'); return; }
    const t = prepared(parseDelimited(paste, '\t'));
    if (t.length < 2) { toast('헤더 + 데이터 행이 필요합니다', 'error'); return; }
    setBulkLog(''); setTable(t); setMapping(await loadProfile(prov) || autoMapHeaders(t[0]));
  };
  const loadProfile = async (code: string): Promise<MappingProfile | null> => {
    if (!code.trim()) return null;
    try { const p = await getStore().get('partner', co, code.trim()); return p?.mapping_profile ? (safeProfile(p.mapping_profile) ?? null) : null; } catch { return null; }
  };

  const preview = useMemo(() => (
    table && masterReady
      ? previewSupplierTable(table, {
          providerCode: prov.trim() || 'preview',
          master: master!,
          profile: Object.keys(mapping).length ? mapping : undefined,
        })
      : null
  ), [table, mapping, master, masterReady, prov]);

  const fieldForCol = (i: number) => Object.keys(mapping).find((f) => mapping[f] === i) || '';
  const setColField = (i: number, field: string) => {
    const next: MappingProfile = { ...mapping };
    for (const f of Object.keys(next)) if (next[f] === i) delete next[f];
    if (field) next[field] = i;
    setMapping(next);
  };

  const saveMapping = async () => {
    if (!prov.trim()) { toast('공급사 코드를 지정해야 매핑을 저장합니다', 'error'); return; }
    setBusy(true);
    try {
      await getStore().update('partner', co, prov.trim(), {
        mapping_profile: JSON.stringify(mapping),
        sheet_url: url.trim() || undefined,
        sheet_tab: gid.trim() || undefined,
        header_row: Number(headerRow) || 0,
        adapter_id: adapterId,
      } as EntityRecord);
      toast(`매핑 저장됨 — ${prov.trim()}`, 'ok');
      await refreshRoster();
    } catch (e) { toast('매핑 저장 실패: ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };

  /** 차종마스터 틀로 변환 후 저장 — master-ingress SSOT. */
  const convertAndSave = async () => {
    if (!masterReady) { toast('차종마스터가 없습니다 — 변환 불가', 'error'); return; }
    if (!preview?.products.length) return;
    if (!('car_number' in mapping)) { toast('차량번호 컬럼을 지정하세요', 'error'); return; }
    setBusy(true);
    try {
      const r = await commitSupplierProducts(co, preview.products, master!);
      toast(
        `변환 저장: 확정 ${r.confirmed} · 검수 ${r.review} · 신규 ${r.created} · 갱신 ${r.updated}`,
        r.review ? 'info' : 'ok',
      );
      if (prov.trim()) {
        try { await getStore().update('partner', co, prov.trim(), { last_synced_at: Date.now() } as EntityRecord); } catch { /* best-effort */ }
      }
      clear(); await refreshRoster(); onImported();
    } catch (e) { toast('저장 실패: ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };

  /** 관리자: URL 있는 공급사 전부 당겨서 마스터 변환+soft-merge 저장. */
  const syncAllAndSave = async () => {
    if (busy) return;
    if (!masterReady) { toast('차종마스터 로드 실패 — 일괄 변환 불가', 'error'); return; }
    if (!roster.length) { toast('시트 URL이 등록된 공급사가 없습니다 — 회원/파트너에서 주소를 먼저 넣으세요', 'info'); return; }
    setBusy(true); setBulkLog('');
    try {
      const r = await syncAllPartnerSheets(co, master!);
      setBulkLog(r.lines.map((l) => l.message).join('\n'));
      if (!r.commit) {
        toast(r.failCount ? `연동 실패 ${r.failCount}곳 · 매물 0건` : '가져올 매물 없음', 'error');
      } else {
        toast(
          `전체 변환 저장 — 공급사 ${r.okCount}/${r.partnerCount} · 신규 ${r.commit.created} · 갱신 ${r.commit.updated}`
          + (r.ingress ? ` · 확정 ${r.ingress.confirmed}·검수 ${r.ingress.review}` : ''),
          r.failCount || (r.ingress && r.ingress.review > 0) ? 'info' : 'ok',
        );
        onImported();
      }
      await refreshRoster();
    } catch (e) { toast('전체 연동 실패: ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };

  const fmtSync = (t: number | null) => {
    if (!t) return '미연동';
    try { return new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {isAdmin && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.selected, padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: FW.title, color: C.brand, marginBottom: 3 }}>공급사 시트 일괄 변환</div>
          <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5, marginBottom: 8 }}>
            공급사 기본정보 → 차종마스터 틀로 변환 후 저장. high·중 확정, 검토·미매칭은 검수 표시.
          </div>
          {roster.length === 0 ? (
            <div style={{ fontSize: FS.cap, color: C.mute, marginBottom: 8 }}>등록된 시트 없음 → `/members` 파트너에 구글시트 URL 입력</div>
          ) : (
            <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {roster.map((p) => (
                <div key={p.code} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: FS.cap, minWidth: 0 }}>
                  <span style={{ fontWeight: FW.strong, color: C.ink, flex: '0 0 auto' }}>{p.name}</span>
                  <span style={{ color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }} title={p.url}>{p.url}</span>
                  <span style={{ color: C.mute, flex: '0 0 auto', fontFamily: 'var(--font-mono)', fontSize: FS.micro }}>{fmtSync(p.lastSyncedAt)}</span>
                </div>
              ))}
            </div>
          )}
          <Btn onClick={syncAllAndSave} disabled={busy || !masterReady || !roster.length}>
            {busy ? '변환 중…' : `전체 변환 후 저장 (${roster.length})`}
          </Btn>
          {bulkLog && (
            <pre style={{ margin: '8px 0 0', fontSize: 11, color: C.mute, whiteSpace: 'pre-wrap', maxHeight: 130, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>{bulkLog}</pre>
          )}
        </div>
      )}

      <PillTabs tabs={[{ key: 'sheet', label: '단일 시트' }, { key: 'excel', label: '엑셀 업로드' }]} value={tab} onChange={(k) => { setTab(k); clear(); }} size="sm" />
      {!isAdmin && (
        <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.45, padding: '6px 8px', background: C.head, borderRadius: R }}>
          <b style={{ color: C.ink }}>연습</b> — 어댑터 <b>오토플러스식</b> · 구글시트 URL → 불러오기 → 차량번호 매핑 → 차종 변환 후 저장.
          {partnerHint ? <span style={{ display: 'block', marginTop: 4, color: C.faint }}>{partnerHint}</span> : null}
        </div>
      )}
      {isAdmin && <Input value={prov} onChange={(v) => setProv(v)} placeholder="공급사 코드(단일·매핑학습용)" full />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Select value={adapterId} onChange={(v) => setAdapterId((v as SheetAdapterId) || 'generic')} options={ADAPTER_OPTIONS} size="sm" full placeholder="어댑터" />
        <Input value={headerRow} onChange={setHeaderRow} placeholder="헤더 행(0=첫줄)" full />
      </div>
      {tab === 'sheet' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <Input value={url} onChange={(v) => setUrl(v)} placeholder="구글시트 URL" full style={{ flex: 1, minWidth: 0 }} />
            <Btn size="sm" variant="ghost" onClick={loadSheet} disabled={busy}>불러오기</Btn>
          </div>
          <Input value={gid} onChange={setGid} placeholder="gid(선택·탭)" full />
        </div>
      ) : (
        <>
          {/* 엑셀 붙여넣기 = 열 정렬이 보여야 하므로 고정폭 폰트가 의도적(원자 규격 위에 mono만 덮음) */}
          <Textarea full rows={4} value={paste} onChange={setPaste}
            placeholder={'엑셀 복사→붙여넣기 (첫 줄=헤더, 탭)\n차량번호\t제조사\t모델\t연식'}
            style={{ fontFamily: 'var(--font-mono)' }} />
          <Btn size="sm" variant="ghost" onClick={loadExcel} disabled={busy}>불러오기</Btn>
        </>
      )}

      {table && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SectionLabel>컬럼 매핑 <span style={{ fontSize: 11, fontWeight: FW.body, color: C.faint }}>· 틀린 칸만 바꾸면 학습됩니다</span></SectionLabel>
          <div style={{ maxHeight: 210, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(table[0] || []).map((h, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 6, alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(h || `(빈 헤더 ${i})`)}</div>
                  <div style={{ fontSize: FS.micro, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>예: {String(table[1]?.[i] ?? '')}</div>
                </div>
                <Select value={fieldForCol(i)} onChange={(v) => setColField(i, v)} placeholder="(무시)" size="sm" full
                  options={IMPORT_FIELDS.map((f) => ({ value: f.key, label: f.label }))} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.mute, borderTop: `1px solid ${C.line2}`, paddingTop: 6, lineHeight: 1.55 }}>
            {!masterReady ? (
              <span style={{ color: C.danger }}>차종마스터 없음 — 변환 저장 불가</span>
            ) : (
              <>
                취합 <b>{preview?.imported ?? 0}</b> · 마스터 확정 <b style={{ color: C.brand }}>{preview?.confirmed ?? 0}</b>
                · 검수 <b style={{ color: preview && preview.review > 0 ? C.warn : C.mute }}>{preview?.review ?? 0}</b>
                <span style={{ color: C.faint }}> (high {preview?.snap.high ?? 0}·중 {preview?.snap.medium ?? 0}·검토 {preview?.snap.low ?? 0}{preview?.snap.none ? `·미매칭 ${preview.snap.none}` : ''})</span>
                {preview?.skipped ? ` · 건너뜀 ${preview.skipped}` : ''}
              </>
            )}
            {!('car_number' in mapping) && <span style={{ color: C.danger }}> · ⚠ 차량번호 컬럼 지정 필요</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn size="sm" variant="ghost" onClick={saveMapping} disabled={busy}>매핑·URL 저장</Btn>
            <Btn
              size="sm"
              onClick={convertAndSave}
              disabled={busy || !masterReady || !preview?.products.length || !('car_number' in mapping)}
            >
              {`차종 변환 후 저장 (${preview?.products.length ?? 0})`}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function safeProfile(v: unknown): MappingProfile | undefined {
  try { const o = typeof v === 'string' ? JSON.parse(v) : v; return o && typeof o === 'object' ? (o as MappingProfile) : undefined; } catch { return undefined; }
}
