'use client';
import { useEffect, useState } from 'react';
import { getStore } from '@/lib/store';
import { getRole, actor } from '@/lib/domain/deal';
import { toast } from '@/components/Toaster';
import { Btn, C, SectionLabel } from '@/components/ui';
import { type EntityRecord } from '@/lib/intake/entities';
import { type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { fetchSheetTable, parseDelimited, importSheetTable, type ImportResult, type MappingProfile } from '@/lib/domain/sheet-import';

// 공급사 매물 취합 = ① 시트 연동(관리자=전체 자동 / 공급사=자기 시트) ② 엑셀 붙여넣기. 둘 다 같은 엔진.
//  미리보기(쓰기 없음)로 자동매핑·차종스냅 확인 → "취합 저장"으로 v4 반영.
export function SheetSync({ co, onImported }: { co: string; onImported: () => void }) {
  const role = getRole();
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState<'sheet' | 'excel'>('sheet');
  const [url, setUrl] = useState('');
  const [prov, setProv] = useState(isAdmin ? '' : (actor('provider').code || ''));
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<EntityRecord[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [snapAgg, setSnapAgg] = useState({ high: 0, medium: 0, low: 0, none: 0 });
  const [master, setMaster] = useState<MasterEntry[] | null>(null);

  useEffect(() => { setUrl(typeof window !== 'undefined' ? localStorage.getItem('fp4_sheet_' + role) || '' : ''); }, [role]);
  const loadMaster = async (): Promise<MasterEntry[]> => {
    if (master) return master;
    const r = await fetch('/data/vehicle-master.json'); const d = await r.json();
    const e = (d.entries || d) as MasterEntry[]; setMaster(e); return e;
  };
  const reset = () => { setPending([]); setSummary(''); setSnapAgg({ high: 0, medium: 0, low: 0, none: 0 }); };
  const aggregate = (results: { label: string; res?: ImportResult; err?: string }[]) => {
    const prods: EntityRecord[] = []; const lines: string[] = []; const agg = { high: 0, medium: 0, low: 0, none: 0 };
    for (const { label, res, err } of results) {
      if (err) { lines.push(`✗ ${label} — ${err}`); continue; }
      if (!res) continue;
      prods.push(...res.products);
      (['high', 'medium', 'low', 'none'] as const).forEach((k) => { agg[k] += res.snap[k]; });
      lines.push(`✓ ${label} — ${res.imported}매물${res.skipped ? ` (건너뜀 ${res.skipped})` : ''}`);
    }
    setPending(prods); setSummary(lines.join('\n')); setSnapAgg(agg);
  };

  // ── 관리자 전체 연동 = 공급사별 지정 시트(partner.sheet_url) 순회 ──
  const syncAll = async () => {
    if (busy) return; setBusy(true); reset();
    try {
      const entries = await loadMaster();
      const partners = (await getStore().list('partner', co)).filter((p) => String(p.sheet_url || '').trim());
      if (!partners.length) { toast('시트가 지정된 공급사가 없습니다 (파트너에 구글시트 URL 등록)', 'info'); return; }
      const results = await Promise.all(partners.map(async (p) => {
        const label = String(p.name || p.partner_name || p.partner_code);
        try {
          const table = await fetchSheetTable(String(p.sheet_url));
          const profile = p.mapping_profile ? safeProfile(p.mapping_profile) : undefined;
          return { label, res: importSheetTable(table, { providerCode: String(p.partner_code || p._key), entries, profile }) };
        } catch (e) { return { label, err: String((e as Error).message || e) }; }
      }));
      aggregate(results);
      toast(`전체 연동 미리보기: ${partners.length}개 공급사`, 'ok');
    } catch (e) { toast('전체 연동 실패: ' + String(e), 'error'); } finally { setBusy(false); }
  };

  // ── 단일 시트 연동(공급사=자기 / 관리자=코드 지정) ──
  const syncOne = async () => {
    if (busy) return;
    if (!url.trim()) { toast('구글시트 URL을 입력하세요', 'error'); return; }
    if (!prov.trim()) { toast('공급사 코드를 지정하세요', 'error'); return; }
    setBusy(true); reset();
    try {
      const entries = await loadMaster();
      const table = await fetchSheetTable(url.trim());
      const res = importSheetTable(table, { providerCode: prov.trim(), entries });
      aggregate([{ label: prov.trim(), res }]);
      if (typeof window !== 'undefined') localStorage.setItem('fp4_sheet_' + role, url.trim());
    } catch (e) { toast('시트 연동 실패: ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };

  // ── 엑셀/시트 붙여넣기(탭 구분) ──
  const importExcel = async () => {
    if (!paste.trim()) { toast('엑셀 내용을 붙여넣으세요', 'error'); return; }
    if (!prov.trim()) { toast('공급사 코드를 지정하세요', 'error'); return; }
    setBusy(true); reset();
    try {
      const entries = await loadMaster();
      const table = parseDelimited(paste, '\t');
      const res = importSheetTable(table, { providerCode: prov.trim(), entries });
      aggregate([{ label: prov.trim() + ' (엑셀)', res }]);
    } catch (e) { toast('엑셀 반영 실패: ' + String(e), 'error'); } finally { setBusy(false); }
  };

  // ── 취합 저장 = v4 반영(규칙 배포 후 동작, 미배포면 에러 안내) ──
  const commit = async () => {
    if (!pending.length) return; setBusy(true);
    try {
      const r = await getStore().save('product', co, pending);
      toast(`취합 저장: ${r.saved}건 반영${r.duplicates ? ` · 중복 ${r.duplicates}` : ''}`, 'ok');
      reset(); onImported();
    } catch (e) { toast('저장 실패(규칙 배포 필요): ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };

  const tabBtn = (k: 'sheet' | 'excel', label: string) => (
    <button onClick={() => setTab(k)} style={{ flex: 1, height: 30, fontSize: 12, fontWeight: tab === k ? 800 : 500, border: `1px solid ${tab === k ? C.brand : C.line}`, borderRadius: 4, background: tab === k ? '#eef4ff' : '#fff', color: tab === k ? C.brand : C.mute, cursor: 'pointer' }}>{label}</button>
  );
  const inp: React.CSSProperties = { width: '100%', height: 30, padding: '0 8px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 12, boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>{tabBtn('sheet', '시트 연동')}{tabBtn('excel', '엑셀 업로드')}</div>

      {isAdmin && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, background: '#f8fbff', padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.brand, marginBottom: 3 }}>전체 연동하기</div>
          <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5, marginBottom: 8 }}>공급사별로 지정된 시트(파트너 구글시트 URL)를 한 번에 당겨 취합. 차종마스터 자동 정합.</div>
          <Btn onClick={syncAll} disabled={busy}>{busy ? '연동 중…' : '전체 공급사 시트 연동'}</Btn>
        </div>
      )}

      {tab === 'sheet' ? (
        <>
          {isAdmin && <input value={prov} onChange={(e) => setProv(e.target.value)} placeholder="공급사 코드(단일 연동 시)" style={inp} />}
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="구글시트 URL (링크 보기 가능/게시)" style={inp} />
          <Btn size="sm" variant="ghost" onClick={syncOne} disabled={busy}>{busy ? '…' : '이 시트 미리보기'}</Btn>
        </>
      ) : (
        <>
          {isAdmin && <input value={prov} onChange={(e) => setProv(e.target.value)} placeholder="공급사 코드" style={inp} />}
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'엑셀 복사 → 붙여넣기 (첫 줄=헤더, 탭 구분)\n차량번호\t제조사\t모델\t연식\t연료'} rows={5} style={{ ...inp, height: 'auto', padding: 8, fontFamily: 'var(--font-mono)', resize: 'vertical' }} />
          <Btn size="sm" variant="ghost" onClick={importExcel} disabled={busy}>엑셀 미리보기</Btn>
        </>
      )}

      {(summary || pending.length > 0) && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, background: '#fff', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SectionLabel>미리보기 · 취합 {pending.length}매물</SectionLabel>
          <div style={{ fontSize: 11, color: C.mute }}>차종 정합: 확신 high {snapAgg.high} · 중 {snapAgg.medium} · 검토 {snapAgg.low}{snapAgg.none ? ` · 미매칭 ${snapAgg.none}` : ''}</div>
          {summary && <pre style={{ margin: 0, fontSize: 11, color: C.mute, whiteSpace: 'pre-wrap', maxHeight: 140, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>{summary}</pre>}
          <Btn onClick={commit} disabled={busy || !pending.length}>{busy ? '저장 중…' : `취합 저장 (${pending.length}매물 → v4)`}</Btn>
        </div>
      )}
    </div>
  );
}

function safeProfile(v: unknown): MappingProfile | undefined {
  try { const o = typeof v === 'string' ? JSON.parse(v) : v; return o && typeof o === 'object' ? (o as MappingProfile) : undefined; } catch { return undefined; }
}
