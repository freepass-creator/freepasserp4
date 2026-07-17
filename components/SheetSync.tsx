'use client';
import { useEffect, useMemo, useState } from 'react';
import { getStore } from '@/lib/store';
import { getRole, actor } from '@/lib/domain/deal';
import { toast } from '@/components/Toaster';
import { Btn, C, SectionLabel } from '@/components/ui';
import { type EntityRecord } from '@/lib/intake/entities';
import { type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { fetchSheetTable, parseDelimited, importSheetTable, autoMapHeaders, IMPORT_FIELDS, type MappingProfile } from '@/lib/domain/sheet-import';

// 공급사 매물 취합 = ① 시트 연동(관리자=전체 자동 / 단일) ② 엑셀 붙여넣기. 둘 다 같은 엔진 + 컬럼 매핑 학습.
export function SheetSync({ co, onImported }: { co: string; onImported: () => void }) {
  const role = getRole();
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState<'sheet' | 'excel'>('sheet');
  const [url, setUrl] = useState('');
  const [prov, setProv] = useState(isAdmin ? '' : (actor('provider').code || ''));
  const [paste, setPaste] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);   // 로드된 시트/엑셀 표(헤더+행)
  const [mapping, setMapping] = useState<MappingProfile>({});     // {필드:컬럼idx}
  const [busy, setBusy] = useState(false);
  const [master, setMaster] = useState<MasterEntry[] | null>(null);
  const [bulk, setBulk] = useState<{ summary: string; products: EntityRecord[]; count: number } | null>(null);

  useEffect(() => { fetch('/data/vehicle-master.json').then((r) => r.json()).then((d) => setMaster((d.entries || d) as MasterEntry[])).catch(() => setMaster([])); }, []);
  const clear = () => { setTable(null); setMapping({}); setBulk(null); };

  // 단일 시트 불러오기 → 표 + 저장된 프로파일(있으면) 또는 자동매핑
  const loadSheet = async () => {
    if (!url.trim()) { toast('구글시트 URL을 입력하세요', 'error'); return; }
    setBusy(true); setBulk(null);
    try {
      const t = await fetchSheetTable(url.trim());
      if (t.length < 2) { toast('헤더 + 데이터 행이 필요합니다', 'error'); return; }
      setTable(t);
      setMapping(await loadProfile(prov) || autoMapHeaders(t[0]));
      if (typeof window !== 'undefined') localStorage.setItem('fp4_sheet_' + role, url.trim());
    } catch (e) { toast('시트 불러오기 실패: ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };
  const loadExcel = async () => {
    if (!paste.trim()) { toast('엑셀 내용을 붙여넣으세요', 'error'); return; }
    const t = parseDelimited(paste, '\t');
    if (t.length < 2) { toast('헤더 + 데이터 행이 필요합니다', 'error'); return; }
    setBulk(null); setTable(t); setMapping(await loadProfile(prov) || autoMapHeaders(t[0]));
  };
  const loadProfile = async (code: string): Promise<MappingProfile | null> => {
    if (!code.trim()) return null;
    try { const p = await getStore().get('partner', co, code.trim()); return p?.mapping_profile ? (safeProfile(p.mapping_profile) ?? null) : null; } catch { return null; }
  };

  // 미리보기(파생) — 현재 표+매핑으로 취합(쓰기 없음).
  const preview = useMemo(() => (table && master ? importSheetTable(table, { providerCode: prov.trim() || 'preview', entries: master, profile: Object.keys(mapping).length ? mapping : undefined }) : null), [table, mapping, master, prov]);

  // 컬럼(i) → 매핑 필드 변경
  const fieldForCol = (i: number) => Object.keys(mapping).find((f) => mapping[f] === i) || '';
  const setColField = (i: number, field: string) => {
    const next: MappingProfile = { ...mapping };
    for (const f of Object.keys(next)) if (next[f] === i) delete next[f];  // 이 컬럼의 기존 매핑 제거
    if (field) next[field] = i;                                            // 필드는 한 컬럼만(다른 컬럼서 옮겨옴)
    setMapping(next);
  };

  const saveMapping = async () => {
    if (!prov.trim()) { toast('공급사 코드를 지정해야 매핑을 저장합니다', 'error'); return; }
    setBusy(true);
    try { await getStore().update('partner', co, prov.trim(), { mapping_profile: JSON.stringify(mapping) } as EntityRecord); toast(`매핑 저장됨 — ${prov.trim()} 프로파일(다음 연동부터 자동)`, 'ok'); }
    catch (e) { toast('매핑 저장 실패(규칙 배포 필요): ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };
  const commit = async () => {
    const prods = preview?.products || [];
    if (!prods.length) return;
    setBusy(true);
    try { const r = await getStore().save('product', co, prods); toast(`취합 저장: ${r.saved}건${r.duplicates ? ` · 중복 ${r.duplicates}` : ''}`, 'ok'); clear(); onImported(); }
    catch (e) { toast('저장 실패(규칙 배포 필요): ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };

  // 관리자 전체 연동 = 공급사별 지정 시트 순회(각자 프로파일)
  const syncAll = async () => {
    if (busy || !master) return; setBusy(true); clear();
    try {
      const partners = (await getStore().list('partner', co)).filter((p) => String(p.sheet_url || '').trim());
      if (!partners.length) { toast('시트가 지정된 공급사가 없습니다', 'info'); return; }
      const prods: EntityRecord[] = []; const lines: string[] = [];
      await Promise.all(partners.map(async (p) => {
        const label = String(p.name || p.partner_name || p.partner_code);
        try {
          const t = await fetchSheetTable(String(p.sheet_url));
          const res = importSheetTable(t, { providerCode: String(p.partner_code || p._key), entries: master, profile: safeProfile(p.mapping_profile) });
          prods.push(...res.products); lines.push(`✓ ${label} — ${res.imported}매물 (정합 ${res.snap.high + res.snap.medium})`);
        } catch (e) { lines.push(`✗ ${label} — ${String((e as Error).message || e)}`); }
      }));
      setBulk({ summary: lines.join('\n'), products: prods, count: prods.length });
      toast(`전체 연동 미리보기: ${partners.length}개 공급사 · ${prods.length}매물`, 'ok');
    } catch (e) { toast('전체 연동 실패: ' + String(e), 'error'); } finally { setBusy(false); }
  };
  const commitBulk = async () => {
    if (!bulk?.products.length) return; setBusy(true);
    try { const r = await getStore().save('product', co, bulk.products); toast(`전체 취합 저장: ${r.saved}건${r.duplicates ? ` · 중복 ${r.duplicates}` : ''}`, 'ok'); clear(); onImported(); }
    catch (e) { toast('저장 실패(규칙 배포 필요): ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };

  const inp: React.CSSProperties = { width: '100%', height: 30, padding: '0 8px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 12, boxSizing: 'border-box' };
  const tabBtn = (k: 'sheet' | 'excel', label: string) => (
    <button onClick={() => { setTab(k); clear(); }} style={{ flex: 1, height: 30, fontSize: 12, fontWeight: tab === k ? 800 : 500, border: `1px solid ${tab === k ? C.brand : C.line}`, borderRadius: 4, background: tab === k ? '#eef4ff' : '#fff', color: tab === k ? C.brand : C.mute, cursor: 'pointer' }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {isAdmin && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, background: '#f8fbff', padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.brand, marginBottom: 3 }}>전체 연동하기</div>
          <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5, marginBottom: 8 }}>공급사별 지정 시트(파트너 URL)를 각자 매핑 프로파일로 한 번에 취합. 차종마스터 자동 정합.</div>
          <Btn onClick={syncAll} disabled={busy || !master}>{busy ? '연동 중…' : '전체 공급사 시트 연동'}</Btn>
          {bulk && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <pre style={{ margin: 0, fontSize: 11, color: C.mute, whiteSpace: 'pre-wrap', maxHeight: 130, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>{bulk.summary}</pre>
              <Btn size="sm" onClick={commitBulk} disabled={busy || !bulk.count}>{`취합 저장 (${bulk.count}매물)`}</Btn>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>{tabBtn('sheet', '시트 연동')}{tabBtn('excel', '엑셀 업로드')}</div>
      {isAdmin && <input value={prov} onChange={(e) => setProv(e.target.value)} placeholder="공급사 코드(단일)" style={inp} />}
      {tab === 'sheet' ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="구글시트 URL (링크 보기/게시)" style={{ ...inp, flex: 1, minWidth: 0 }} />
          <Btn size="sm" variant="ghost" onClick={loadSheet} disabled={busy}>불러오기</Btn>
        </div>
      ) : (
        <>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'엑셀 복사→붙여넣기 (첫 줄=헤더, 탭)\n차량번호\t제조사\t모델\t연식'} rows={4} style={{ ...inp, height: 'auto', padding: 8, fontFamily: 'var(--font-mono)', resize: 'vertical' }} />
          <Btn size="sm" variant="ghost" onClick={loadExcel} disabled={busy}>불러오기</Btn>
        </>
      )}

      {table && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, background: '#fff', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SectionLabel>컬럼 매핑 <span style={{ fontSize: 11, fontWeight: 400, color: C.faint }}>· 틀린 칸만 바꾸면 학습됩니다</span></SectionLabel>
          <div style={{ maxHeight: 210, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(table[0] || []).map((h, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 6, alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(h || `(빈 헤더 ${i})`)}</div>
                  <div style={{ fontSize: 10.5, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>예: {String(table[1]?.[i] ?? '')}</div>
                </div>
                <select value={fieldForCol(i)} onChange={(e) => setColField(i, e.target.value)} style={{ ...inp, height: 26, fontSize: 11.5 }}>
                  <option value="">(무시)</option>
                  {IMPORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.mute, borderTop: `1px solid ${C.line2}`, paddingTop: 6 }}>
            취합 <b>{preview?.imported ?? 0}</b>매물 · 차종 정합 high {preview?.snap.high ?? 0}·중 {preview?.snap.medium ?? 0}·검토 {preview?.snap.low ?? 0}{preview?.snap.none ? `·미매칭 ${preview.snap.none}` : ''}
            {preview?.skipped ? ` · 건너뜀 ${preview.skipped}` : ''}
            {!('car_number' in mapping) && <span style={{ color: '#c0453a' }}> · ⚠ 차량번호 컬럼 지정 필요</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn size="sm" variant="ghost" onClick={saveMapping} disabled={busy}>매핑 저장</Btn>
            <Btn size="sm" onClick={commit} disabled={busy || !preview?.imported}>{`취합 저장 (${preview?.imported ?? 0})`}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function safeProfile(v: unknown): MappingProfile | undefined {
  try { const o = typeof v === 'string' ? JSON.parse(v) : v; return o && typeof o === 'object' ? (o as MappingProfile) : undefined; } catch { return undefined; }
}
