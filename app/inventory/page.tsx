'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { vehicleName } from '@/lib/domain/product';
import { PaneHead, Btn, FormGrid, C } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { VehicleMasterPicker } from '@/components/VehicleMasterPicker';
import { PhotoUpload } from '@/components/PhotoUpload';
import { PriceMatrix } from '@/components/PriceMatrix';

// 재고관리 = [매물 목록 | 매물 편집 | 공급사 소스 연동]. 파인더와 같은 데이터의 "편집 렌즈". 공급사=자기 매물만.
// 공급사 업로드: 구글시트 URL 저장(배포 후 자동 fetch) + 엑셀/시트 붙여넣기(헤더 자동매핑→반영).
const HMAP: Record<string, string> = { '차량번호': 'car_number', '차번': 'car_number', '제조사': 'maker', '메이커': 'maker', '모델': 'model', '세부모델': 'sub_model', '트림': 'trim_name', '연식': 'year', '연료': 'fuel_type', '주행': 'mileage', '주행거리': 'mileage', '색상': 'ext_color', '외장색': 'ext_color', '내장색': 'int_color', '차종': 'vehicle_class', '상태': 'vehicle_status', '구분': 'product_type', '인승': 'seats', '배기량': 'engine_cc' };
const mapHeader = (h: string): string => { const t = h.trim(); if (HMAP[t]) return HMAP[t]; const k = Object.keys(HMAP).find((kk) => t.includes(kk)); return k ? HMAP[k] : ''; };

export default function Inventory() {
  const co = getCompanyId();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [q, setQ] = useState('');

  const myProvider = () => (getRole() === 'provider' ? actor('provider').code : String(form.provider_company_code || 'SP-01'));
  const load = async (r: Role) => { const all = await getStore().list('product', co); const mine = r === 'provider' ? all.filter((p) => String(p.provider_company_code) === actor('provider').code) : all; setRows(mine); return mine; };
  const selectP = (p: EntityRecord) => { setSel(String(p.product_code)); setForm({ ...p }); setDirty(false); };
  const clearSel = () => { setSel(null); setForm({}); setDirty(false); };
  useEffect(() => { (async () => { await seedIfEmpty(co); setSheetUrl(typeof window !== 'undefined' ? localStorage.getItem('fp4_sheet_' + getRole()) || '' : ''); const all = await load(getRole()); if (all.length) selectP(all[0]); })(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const on = (e: Event) => { (async () => { const all = await load((e as CustomEvent).detail as Role); clearSel(); if (all.length) selectP(all[0]); })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, []);

  const onChange = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const save = async () => { if (!String(form.product_code || '').trim()) { alert('상품코드 필수'); return; } await getStore().save('product', co, [form]); await getStore().update('product', co, String(form.product_code), form); setDirty(false); await load(getRole()); };
  const newP = () => { const c = `PD-${Date.now().toString(36).slice(-6).toUpperCase()}`; setSel(c); setForm({ product_code: c, vehicle_status: '상품화중', product_type: '재렌트', provider_company_code: getRole() === 'provider' ? actor('provider').code : '' }); setDirty(true); };
  const saveLink = () => { if (typeof window !== 'undefined') localStorage.setItem('fp4_sheet_' + getRole(), sheetUrl); alert('시트 링크 저장됨. 자동 불러오기는 배포(서버) 후 동작합니다.'); };
  const importPaste = async () => {
    const lines = paste.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) { alert('헤더 행 + 데이터 행이 필요합니다.'); return; }
    const cols = lines[0].split('\t').map(mapHeader);
    const pv = myProvider();
    const recs: EntityRecord[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split('\t');
      const rec: EntityRecord = {};
      cols.forEach((f, ci) => { if (f && cells[ci] != null && cells[ci].trim() !== '') rec[f] = cells[ci].trim(); });
      if (!rec.car_number) continue;
      rec.provider_company_code = pv;
      rec.product_code = `EXT-${pv}-${rec.car_number}`;
      if (!rec.vehicle_status) rec.vehicle_status = '출고가능';
      if (!rec.product_type) rec.product_type = '재렌트';
      recs.push(rec);
    }
    if (!recs.length) { alert('불러올 행이 없습니다(차량번호 컬럼 필요).'); return; }
    await getStore().save('product', co, recs);
    for (const r of recs) await getStore().update('product', co, String(r.product_code), r);
    setPaste(''); await load(getRole());
    alert(`${recs.length}건 반영되었습니다.`);
  };

  const shown = (rows || []).filter((p) => !q || [vehicleName(p), p.car_number, p.maker, p.model, p.sub_model, p.vehicle_status, p.provider_company_code].join(' ').toLowerCase().includes(q.toLowerCase()));
  const listEl = shown.length === 0
    ? <div style={{ padding: 24, textAlign: 'center', color: C.faint, fontSize: 12.5 }}>{q ? '검색 결과 없음' : '매물 없음'}</div>
    : <div>{shown.map((p) => {
        const on = String(p.product_code) === sel;
        return (
          <div key={String(p.product_code)} onClick={() => selectP(p)} style={{ padding: '11px 14px', borderBottom: `1px solid ${C.line2}`, cursor: 'pointer', background: on ? '#eef4ff' : 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vehicleName(p)}</span>
              <span style={{ fontSize: 10.5, color: C.faint, flex: '0 0 auto', fontFamily: 'var(--font-mono)' }}>{String(p.car_number || '')}</span>
            </div>
            <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2 }}>{[p.vehicle_status, p.product_type, p.provider_company_code].filter(Boolean).join(' · ')}</div>
          </div>
        );
      })}</div>;

  const inp: CSSProperties = { display: 'block', width: '100%', marginTop: 4, padding: '8px 9px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 13, boxSizing: 'border-box' };
  const editPane = (
    <>
      <PaneHead title="매물 편집" right={<Btn size="sm" onClick={save} disabled={!dirty}>저장</Btn>} />
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sel ? <>
          <VehicleMasterPicker onPick={(v) => { setForm((f) => ({ ...f, ...v })); setDirty(true); }} />
          <PhotoUpload photos={form.photos} onChange={(ps) => { setForm((f) => ({ ...f, photos: ps })); setDirty(true); }} />
          <PriceMatrix price={form.price} onChange={(p) => { setForm((f) => ({ ...f, price: p })); setDirty(true); }} />
          <FormGrid fields={ENTITIES.product.fields} form={form} onChange={onChange} cols={2} />
        </> : <div style={{ color: C.faint, fontSize: 12.5 }}>매물을 선택하세요.</div>}
      </div>
    </>
  );
  const syncPane = (
    <>
      <PaneHead title="공급사 소스 연동" />
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>구글시트 연동</div>
        <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/…" style={inp} />
        <Btn size="sm" onClick={saveLink}>링크 저장</Btn>
        <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>매핑(컬럼 대응)을 공급사에 저장 → 코드 수정 없이 렌트사 추가. 자동 불러오기는 배포 후.</div>
        <div style={{ height: 1, background: C.line2, margin: '4px 0' }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>엑셀·시트 붙여넣기</div>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'첫 줄 = 헤더(탭 구분)\n차량번호\t제조사\t모델\t연식\t연료\t주행\t색상\t상태'} rows={7} style={{ ...inp, fontFamily: 'var(--font-mono)', resize: 'vertical' }} />
        <Btn size="sm" onClick={importPaste}>불러오기 · 반영</Btn>
        <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>헤더명 자동매핑(차량번호·제조사·모델·연식·연료·주행·색상·차종·상태). 5단계 규격화·가격맵은 후속.</div>
      </div>
    </>
  );

  const panes: WorkPane[] = [
    { key: 'edit', title: '매물 편집', node: editPane },
    { key: 'sync', title: '공급사 업로드', node: syncPane },
  ];
  return <WorkPage title="재고" listCount={rows ? rows.length : ''} list={rows === null ? <div style={{ padding: 24, color: C.faint }}>불러오는 중…</div> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
    search={{ value: q, onChange: setQ, placeholder: '차량·차번·제조사·상태' }} actions={<Btn size="sm" onClick={newP}>매물 등록</Btn>} />;
}
