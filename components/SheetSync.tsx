'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStore } from '@/lib/store';
import { getRole, actor } from '@/lib/domain/deal';
import { confirmDialog, toast } from '@/components/Toaster';
import { Btn, C, FS, FW, Input, PillTabs, R, Select, SectionLabel, Textarea, NUM } from '@/components/ui';
import { type EntityRecord } from '@/lib/intake/entities';
import { type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { fetchSheetTable, parseDelimited, autoMapHeaders, IMPORT_FIELDS, prepareMasterIngress, type MappingProfile } from '@/lib/domain/sheet-import';
import { commitSupplierProducts, previewSupplierTable } from '@/lib/domain/master-ingress';
import { loadVehicleMaster, peekVehicleMaster } from '@/lib/domain/vehicle-master-load';
import { ADAPTER_OPTIONS, resolveAdapter, type SheetAdapterId } from '@/lib/domain/sheet-adapters';
import {
  listSheetPartners,
  fetchAllPartnerSheets,
  commitFetchedPartnerSheets,
  type PartnerSheetRow,
} from '@/lib/domain/sheet-sync-all';
import { DEFAULT_SUPPLIER_HUB_URL, syncHubSheetUrls } from '@/lib/domain/sheet-hub-sync';
import {
  countAutoplusStock,
  importAutoplusMerged,
  AUTOPLUS_GID_MAIN,
} from '@/lib/domain/sheet-autoplus';
import {
  formatSheetDiffBanner,
  summarizeSheetDiff,
  type SheetDiffSummary,
} from '@/lib/domain/sheet-diff';
import { Database, Download, Link2, RefreshCw, Save, Upload } from 'lucide-react';

/** 아이카식 표준 양식 — autoMapHeaders 별칭과 정합. 컬럼명 변경 금지. */
const STANDARD_SHEET_HEADERS = [
  '차량번호', '제조사', '모델', '세부모델', '트림', '연식', '최초등록일', '연료', '배기량', '주행거리',
  '외장', '내장', '인승', '변속기', '상태', '구분', '옵션',
  '1개월', '6개월', '12개월', '24개월', '36개월', '48개월', '60개월', '단기보증', '장기보증',
] as const;

const STANDARD_SHEET_EXAMPLE = [
  '12가3456', '현대', '쏘나타', 'DN8', '인스퍼레이션', '2022', '2022-03', '가솔린', '2000', '35000',
  '흰색', '검정', '5', '자동', '출고가능', '중고렌트', '파노라마선루프',
  '', '', '650000', '', '580000', '', '540000', '3000000', '5000000',
] as const;

const STANDARD_SHEET_HINT =
  '상태=출고가능/출고협의/계약중/출고불가, 배차중은 자동 제외됨. 대여료는 개월 열에 월 렌트료(원), 보증금은 단기(12개월↓)/장기(24개월↑).';

function downloadStandardSheetTemplate() {
  const csv = `\uFEFF${STANDARD_SHEET_HEADERS.join(',')}\n${STANDARD_SHEET_EXAMPLE.join(',')}\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = '프리패스_공급사_표준양식.csv';
  a.click();
  URL.revokeObjectURL(href);
  toast('표준 양식 다운로드됨');
}

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
  const [headerRow, setHeaderRow] = useState('0');
  const [adapterId, setAdapterId] = useState<SheetAdapterId>('autoplus');
  const [prov, setProv] = useState(isAdmin ? '' : (actor('provider').code || ''));
  const [paste, setPaste] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<MappingProfile>({});
  /** 오토플러스 2탭 병합 유입 — table 미리보기 대신 이 배열 사용 */
  const [mergedProducts, setMergedProducts] = useState<EntityRecord[] | null>(null);
  const [diffBanner, setDiffBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const [master, setMaster] = useState<MasterEntry[] | null>(() => peekVehicleMaster());
  const [roster, setRoster] = useState<PartnerSheetRow[]>([]);
  const [bulkLog, setBulkLog] = useState<string>('');
  const [partnerHint, setPartnerHint] = useState('');
  const [pending, setPending] = useState<{
    fetched: Awaited<ReturnType<typeof fetchAllPartnerSheets>>;
    banners: string[];
    totals: {
      new: number; status: number; content: number; absent: number;
      unchanged: number; rentedExcluded: number;
    };
    at: number;
  } | null>(null);

  const refreshRoster = useCallback(async () => {
    if (!isAdmin) return;
    try { setRoster(await listSheetPartners(co)); } catch { setRoster([]); }
  }, [co, isAdmin]);

  // roster 바뀌면 검증 스냅샷 무효
  useEffect(() => { setPending(null); }, [roster]);

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

  const clear = () => { setTable(null); setMapping({}); setBulkLog(''); setMergedProducts(null); setDiffBanner(''); };
  const prepared = (raw: string[][]) => resolveAdapter(adapterId).prepareTable(raw, { headerRow: Math.max(0, Number(headerRow) || 0) });
  const masterReady = !!(master && master.length);

  const loadSheet = async () => {
    if (!url.trim()) { toast('구글시트 URL을 입력하세요', 'error'); return; }
    if (!masterReady && adapterId === 'autoplus') {
      toast('차종마스터 로드 후 오토플러스 2탭을 불러올 수 있습니다', 'error');
      return;
    }
    setBusy(true); setBulkLog(''); setMergedProducts(null); setDiffBanner('');
    try {
      if (adapterId === 'autoplus') {
        const res = await importAutoplusMerged({
          url: url.trim(),
          providerCode: prov.trim() || 'preview',
          entries: master!,
          profile: Object.keys(mapping).length ? mapping : undefined,
          fetchTable: fetchSheetTable,
          headerRow: Math.max(0, Number(headerRow) || 0),
        });
        // 매핑 UI용 = 본탭 prepare 결과(라벨 적용됨)
        const rawMain = await fetchSheetTable(url.trim(), AUTOPLUS_GID_MAIN);
        const t = prepared(rawMain);
        setTable(t.length >= 2 ? t : [['차량번호'], ...res.products.slice(0, 1).map((p) => [String(p.car_number || '')])]);
        setMapping(await loadProfile(prov) || autoMapHeaders(t[0] || ['차량번호']));
        setMergedProducts(res.products);
        setBulkLog(`오토플러스 2탭 — 본 ${res.mainN}+프로모 ${res.promoOnlyN}=${res.imported} · 재고(출고가능+보류) ${res.stock}`);
        if (typeof window !== 'undefined') localStorage.setItem('fp4_sheet_' + role, url.trim());
      } else {
        const raw = await fetchSheetTable(url.trim(), gid.trim() || undefined);
        const t = prepared(raw);
        if (t.length < 2) { toast('헤더 + 데이터 행이 필요합니다(헤더 행 번호 확인)', 'error'); return; }
        setTable(t);
        setMapping(await loadProfile(prov) || autoMapHeaders(t[0]));
        if (typeof window !== 'undefined') localStorage.setItem('fp4_sheet_' + role, url.trim());
      }
    } catch (e) { toast('시트 불러오기 실패: ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };
  const loadExcel = async () => {
    if (!paste.trim()) { toast('엑셀 내용을 붙여넣으세요', 'error'); return; }
    const t = prepared(parseDelimited(paste, '\t'));
    if (t.length < 2) { toast('헤더 + 데이터 행이 필요합니다', 'error'); return; }
    setBulkLog(''); setMergedProducts(null); setDiffBanner(''); setTable(t); setMapping(await loadProfile(prov) || autoMapHeaders(t[0]));
  };
  const loadProfile = async (code: string): Promise<MappingProfile | null> => {
    if (!code.trim()) return null;
    try { const p = await getStore().get('partner', co, code.trim()); return p?.mapping_profile ? (safeProfile(p.mapping_profile) ?? null) : null; } catch { return null; }
  };

  const preview = useMemo(() => {
    if (mergedProducts && masterReady) {
      const { products, confirmed, review } = prepareMasterIngress(mergedProducts);
      const snap = { high: 0, medium: 0, low: 0, none: 0 };
      for (const p of mergedProducts) {
        const c = String(p._snap_confidence || '');
        if (c === 'high' || c === 'medium' || c === 'low') snap[c]++;
        else snap.none++;
      }
      return {
        products,
        imported: mergedProducts.length,
        confirmed,
        review,
        skipped: 0,
        rentedExcluded: 0,
        snap,
        mapping,
        total: mergedProducts.length,
      };
    }
    return table && masterReady
      ? previewSupplierTable(table, {
          providerCode: prov.trim() || 'preview',
          master: master!,
          profile: Object.keys(mapping).length ? mapping : undefined,
        })
      : null;
  }, [mergedProducts, table, mapping, master, masterReady, prov]);

  /** 저장 전 diff 배너 — 유입 대비 기존 재고 */
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!preview?.products.length || !prov.trim()) {
        if (alive) setDiffBanner('');
        return;
      }
      try {
        const existing = await getStore().list('product', co);
        const diff: SheetDiffSummary = summarizeSheetDiff({
          incoming: preview.products,
          existing,
          providerCode: prov.trim(),
        });
        const stock = countAutoplusStock(preview.products);
        if (alive) setDiffBanner(formatSheetDiffBanner(diff, stock));
      } catch {
        if (alive) setDiffBanner('');
      }
    };
    void run();
    return () => { alive = false; };
  }, [preview, prov, co]);

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

  /** 차종마스터 틀로 변환 후 저장 — master-ingress SSOT. 저장 전 diff 확인. */
  const convertAndSave = async () => {
    if (!masterReady) { toast('차종마스터가 없습니다 — 변환 불가', 'error'); return; }
    if (!preview?.products.length) return;
    if (!mergedProducts && !('car_number' in mapping)) { toast('차량번호 컬럼을 지정하세요', 'error'); return; }
    const ok = await confirmDialog({
      message: (diffBanner || `취합 ${preview.products.length}건`)
        + (preview.rentedExcluded > 0 ? `\n배차중 제외 ${preview.rentedExcluded}` : '')
        + '\n\n차종 변환 후 재고에 저장할까요?\n(신규 soft-merge · 부재→출고불가는 일괄 연동에서)',
    });
    if (!ok) return;
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

  /** 관리자: 허브 시트 → partner.sheet_url만 (매물 파싱 없음). */
  const syncHubUrls = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      message: '공급사 허브 시트에서 URL을 읽어 파트너 sheet_url에 반영할까요?\n(매물은 가져오지 않습니다. erp에 없는 코드는 생성하지 않습니다.)',
    });
    if (!ok) return;
    setBusy(true); setBulkLog('');
    try {
      const r = await syncHubSheetUrls(co, DEFAULT_SUPPLIER_HUB_URL);
      setBulkLog(r.lines.map((l) => l.message).join('\n'));
      toast(
        `허브 URL 동기 — 갱신 ${r.updated} · 동일 ${r.unchanged} · 파트너없음 ${r.missingPartner} (허브 ${r.hubCount})`,
        r.missingPartner || r.updated === 0 ? 'info' : 'ok',
      );
      await refreshRoster();
    } catch (e) {
      toast('허브 동기 실패: ' + String((e as Error).message || e), 'error');
    } finally { setBusy(false); }
  };

  /** 관리자: 전체 시트 fetch+diff만(쓰기 없음). 스냅샷을 pending에 보관. */
  const validateAll = async () => {
    if (busy) return;
    if (!masterReady) { toast('차종마스터 로드 실패 — 검증 불가', 'error'); return; }
    if (!roster.length) { toast('시트 URL이 등록된 공급사가 없습니다 — 허브 URL 동기 또는 파트너에 주소를 넣으세요', 'info'); return; }
    setBusy(true); setBulkLog(''); setPending(null);
    try {
      const fetched = await fetchAllPartnerSheets(co, master!);
      const existing = await getStore().list('product', co);
      const banners: string[] = [];
      const totals = { new: 0, status: 0, content: 0, absent: 0, unchanged: 0, rentedExcluded: 0 };
      for (const line of fetched.lines) {
        if (!line.ok) continue;
        const re = typeof (line as { rentedExcluded?: number }).rentedExcluded === 'number'
          ? Number((line as { rentedExcluded?: number }).rentedExcluded)
          : 0;
        totals.rentedExcluded += re;
        if (!line.products.length) continue;
        const diff = summarizeSheetDiff({
          incoming: line.products,
          existing,
          providerCode: line.code,
        });
        const stock = countAutoplusStock(line.products);
        banners.push(`${line.label}: ${formatSheetDiffBanner(diff, stock)}`);
        totals.new += diff.new;
        totals.status += diff.status;
        totals.content += diff.content;
        totals.absent += diff.absent;
        totals.unchanged += diff.unchanged;
      }
      setPending({ fetched, banners, totals, at: Date.now() });
      setBulkLog([...fetched.lines.map((l) => l.message), ...(banners.length ? ['— diff —', ...banners] : [])].join('\n'));
      toast(
        fetched.products.length || totals.rentedExcluded
          ? `검증 완료 — 동기화 눌러 반영 (취합 ${fetched.products.length}·배차중 제외 ${totals.rentedExcluded})`
          : '검증 완료 — 가져올 매물 없음',
        fetched.products.length ? 'ok' : 'info',
      );
    } catch (e) {
      setPending(null);
      toast('검증 실패: ' + String((e as Error).message || e), 'error');
    } finally { setBusy(false); }
  };

  /** 관리자: 검증 스냅샷 그대로 커밋(재fetch 금지). */
  const commitPending = async () => {
    if (busy || !pending) return;
    if (!masterReady) { toast('차종마스터 로드 실패 — 동기화 불가', 'error'); return; }
    const { totals, banners, fetched } = pending;
    const summary = `신규 ${totals.new} · 상태변경 ${totals.status} · 내용수정 ${totals.content}`
      + ` · 부재→출고불가 ${totals.absent} · 배차중 제외 ${totals.rentedExcluded} · 무변경 ${totals.unchanged}`;
    const ok = await confirmDialog({
      message: `${summary}\n\n${banners.slice(0, 8).join('\n')}${banners.length > 8 ? `\n…외 ${banners.length - 8}` : ''}`
        + `\n\n등록 시트 ${roster.length}곳 → 재고에 동기화할까요?\n(검증 스냅샷 그대로 · 재조회 없음)`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await commitFetchedPartnerSheets(co, master!, fetched);
      const logLines = [
        ...r.lines.map((l) => l.message),
        ...(r.absent.notes.length ? ['— 부재처리 —', ...r.absent.notes] : []),
      ];
      setBulkLog(logLines.join('\n'));
      if (!r.commit && !r.absent.blocked) {
        toast(r.failCount ? `연동 실패 ${r.failCount}곳 · 매물 0건` : '가져올 매물 없음', 'error');
      } else {
        toast(
          `동기화 완료 — 공급사 ${r.okCount}/${r.partnerCount}`
          + (r.commit ? ` · 신규 ${r.commit.created} · 갱신 ${r.commit.updated}` : '')
          + (r.absent.blocked ? ` · 부재→출고불가 ${r.absent.blocked}` : '')
          + (r.ingress ? ` · 확정 ${r.ingress.confirmed}·검수 ${r.ingress.review}` : ''),
          r.failCount || r.absent.skipped_guard || (r.ingress && r.ingress.review > 0) ? 'info' : 'ok',
        );
        onImported();
      }
      setPending(null);
      await refreshRoster();
    } catch (e) {
      toast('동기화 실패: ' + String((e as Error).message || e), 'error');
    } finally { setBusy(false); }
  };

  const fmtSync = (t: number | null) => {
    if (!t) return '미연동';
    try { return new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
  };

  const fmtPendingAt = (t: number) => {
    try { return new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {isAdmin && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.selected, padding: 10 }}>
          <div style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.brand, marginBottom: 3 }}>공급사 시트 일괄 변환</div>
          <div style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.5, marginBottom: 8 }}>
            관리자가 버튼으로 실행(자동 아님). 신규·기존 soft-merge · 시트에 없는 차는 출고불가(삭제 없음). fetch 실패·급감 시 부재처리 스킵.
          </div>
          {roster.length === 0 ? (
            <div style={{ fontSize: FS.cap, color: C.mute, marginBottom: 8 }}>등록된 시트 없음 → 「허브 URL 동기」또는 `/members`에 구글시트 URL</div>
          ) : (
            <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {roster.map((p) => (
                <div key={p.code} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: FS.cap, minWidth: 0 }}>
                  <span style={{ fontWeight: FW.strong, color: C.ink, flex: '0 0 auto' }}>{p.name}</span>
                  <span style={{ color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }} title={p.url}>{p.url}</span>
                  <span style={{ color: C.mute, flex: '0 0 auto', fontFamily: NUM, fontSize: FS.micro }}>{fmtSync(p.lastSyncedAt)}</span>
                </div>
              ))}
            </div>
          )}
          {pending && (
            <div style={{
              fontSize: FS.cap, color: C.ink, lineHeight: 1.55, marginBottom: 8,
              padding: '8px 10px', borderRadius: R, background: C.taupeBg, border: `1px solid ${C.line}`,
            }}>
              <div style={{ fontWeight: FW.title, color: C.brand, marginBottom: 2 }}>
                검증 결과 {fmtPendingAt(pending.at) ? `· ${fmtPendingAt(pending.at)}` : ''}
                <span style={{ fontWeight: FW.body, color: C.faint }}> · 취합 {pending.fetched.products.length}대</span>
              </div>
              신규 {pending.totals.new} · 상태변경 {pending.totals.status} · 내용수정 {pending.totals.content}
              {' '}· 부재→출고불가 {pending.totals.absent} · 배차중 제외 {pending.totals.rentedExcluded}
              {' '}· 무변경 {pending.totals.unchanged}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <Btn mobileIcon={<Link2 size={18} />} title="허브 시트 → partner.sheet_url" variant="ghost" onClick={syncHubUrls} disabled={busy}>
              허브 URL 동기
            </Btn>
            <Btn
              mobileIcon={<RefreshCw size={18} />}
              title={busy ? '검증 중' : `데이터 검증 ${roster.length}개`}
              variant="ghost"
              onClick={validateAll}
              disabled={busy || !masterReady || !roster.length}
            >
              {busy && !pending ? '검증 중…' : `데이터 검증 (${roster.length})`}
            </Btn>
            <Btn
              mobileIcon={<Save size={18} />}
              title={pending ? `동기화 · 검증 ${pending.fetched.products.length}대` : '먼저 데이터 검증'}
              onClick={commitPending}
              disabled={busy || !pending}
            >
              {pending
                ? `동기화 (${roster.length}) · ${pending.fetched.products.length}대`
                : `동기화 (${roster.length})`}
            </Btn>
            <Btn
              mobileIcon={<Download size={18} />}
              title="아이카식 표준 양식 CSV"
              variant="ghost"
              onClick={downloadStandardSheetTemplate}
              disabled={busy}
            >
              표준 템플릿
            </Btn>
          </div>
          <div style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.45, marginTop: 6 }} title={STANDARD_SHEET_HINT}>
            {STANDARD_SHEET_HINT}
          </div>
          {bulkLog && (
            <pre style={{ margin: '8px 0 0', fontSize: FS.cap, color: C.mute, whiteSpace: 'pre-wrap', maxHeight: 130, overflowY: 'auto', fontFamily: NUM }}>{bulkLog}</pre>
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
            <Btn mobileIcon={<Upload size={18} />} title="구글시트 불러오기" size="sm" variant="ghost" onClick={loadSheet} disabled={busy}>불러오기</Btn>
          </div>
          <Input value={gid} onChange={setGid} placeholder="gid(선택·탭)" full />
        </div>
      ) : (
        <>
          {/* 엑셀 붙여넣기 = 열 정렬이 보여야 하므로 고정폭 폰트가 의도적(원자 규격 위에 mono만 덮음) */}
          <Textarea full rows={4} value={paste} onChange={setPaste}
            placeholder={'엑셀 복사→붙여넣기 (첫 줄=헤더, 탭)\n차량번호\t제조사\t모델\t연식'}
            style={{ fontFamily: NUM }} />
          <Btn mobileIcon={<Upload size={18} />} title="엑셀 붙여넣기 불러오기" size="sm" variant="ghost" onClick={loadExcel} disabled={busy}>불러오기</Btn>
        </>
      )}

      {table && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SectionLabel>컬럼 매핑 <span style={{ fontSize: FS.cap, fontWeight: FW.body, color: C.faint }}>· 틀린 칸만 바꾸면 학습됩니다</span></SectionLabel>
          <div style={{ maxHeight: 210, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(table[0] || []).map((h, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 6, alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: FS.sub, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(h || `(빈 헤더 ${i})`)}</div>
                  <div style={{ fontSize: FS.micro, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>예: {String(table[1]?.[i] ?? '')}</div>
                </div>
                <Select value={fieldForCol(i)} onChange={(v) => setColField(i, v)} placeholder="(무시)" size="sm" full
                  options={IMPORT_FIELDS.map((f) => ({ value: f.key, label: f.label }))} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: FS.cap, color: C.mute, borderTop: `1px solid ${C.line2}`, paddingTop: 6, lineHeight: 1.55 }}>
            {!masterReady ? (
              <span style={{ color: C.danger }}>차종마스터 없음 — 변환 저장 불가</span>
            ) : (
              <>
                취합 <b>{preview?.imported ?? 0}</b> · 마스터 확정 <b style={{ color: C.brand }}>{preview?.confirmed ?? 0}</b>
                · 검수 <b style={{ color: preview && preview.review > 0 ? C.warn : C.mute }}>{preview?.review ?? 0}</b>
                <span style={{ color: C.faint }}> (high {preview?.snap.high ?? 0}·중 {preview?.snap.medium ?? 0}·검토 {preview?.snap.low ?? 0}{preview?.snap.none ? `·미매칭 ${preview.snap.none}` : ''})</span>
                {preview?.skipped ? ` · 건너뜀 ${preview.skipped}` : ''}
                {preview && preview.rentedExcluded > 0 ? (
                  <span style={{ color: C.faint }}> · 배차중 제외 {preview.rentedExcluded}</span>
                ) : null}
              </>
            )}
            {!mergedProducts && !('car_number' in mapping) && <span style={{ color: C.danger }}> · ⚠ 차량번호 컬럼 지정 필요</span>}
          </div>
          {diffBanner && (
            <div style={{
              fontSize: FS.cap, color: C.ink, lineHeight: 1.55,
              padding: '8px 10px', borderRadius: R, background: C.selected, border: `1px solid ${C.line}`,
            }}>
              <div style={{ fontWeight: FW.title, color: C.brand, marginBottom: 2 }}>저장 전 변경 요약</div>
              {diffBanner}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn mobileIcon={<Database size={18} />} title="매핑과 URL 저장" size="sm" variant="ghost" onClick={saveMapping} disabled={busy}>매핑·URL 저장</Btn>
            <Btn
              mobileIcon={<Save size={18} />}
              title={`동기화 ${preview?.products.length ?? 0}건`}
              size="sm"
              onClick={convertAndSave}
              disabled={busy || !masterReady || !preview?.products.length || (!mergedProducts && !('car_number' in mapping))}
            >
              {`동기화 (${preview?.products.length ?? 0})`}
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
