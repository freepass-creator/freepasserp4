'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, type EntityRecord, type Field } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { newId } from '@/lib/domain/ids';
import { vehicleName } from '@/lib/domain/product';
import { PaneHead, Btn, FormGrid, C } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { toast } from '@/components/Toaster';
import { buildJonghapTsv } from '@/lib/domain/jonghap';
import { snapToMaster, applySnap, reconcileToMaster, type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { useIsMobile } from '@/lib/use-mobile';
import { VehicleMasterPicker } from '@/components/VehicleMasterPicker';
import { PhotoUpload } from '@/components/PhotoUpload';
import { PriceMatrix } from '@/components/PriceMatrix';

// 재고관리 = [매물 목록 | 매물 편집 | 공급사 소스 연동]. 파인더와 같은 데이터의 "편집 렌즈". 공급사=자기 매물만.
// 공급사 업로드: 구글시트 URL 저장(배포 후 자동 fetch) + 엑셀/시트 붙여넣기(헤더 자동매핑→반영).
const HMAP: Record<string, string> = { '차량번호': 'car_number', '차번': 'car_number', '제조사': 'maker', '메이커': 'maker', '모델': 'model', '세부모델': 'sub_model', '트림': 'trim_name', '연식': 'year', '연료': 'fuel_type', '주행': 'mileage', '주행거리': 'mileage', '색상': 'ext_color', '외장색': 'ext_color', '내장색': 'int_color', '차종': 'vehicle_class', '상태': 'vehicle_status', '구분': 'product_type', '인승': 'seats', '배기량': 'engine_cc' };
const mapHeader = (h: string): string => { const t = h.trim(); if (HMAP[t]) return HMAP[t]; const k = Object.keys(HMAP).find((kk) => t.includes(kk)); return k ? HMAP[k] : ''; };

export default function Inventory() {
  const co = getCompanyId();
  const router = useRouter();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [q, setQ] = useState('');
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const mobile = useIsMobile();

  const myProvider = () => (getRole() === 'provider' ? actor('provider').code : String(form.provider_company_code || 'sup_jeil'));
  const load = async (r: Role) => { const all = await getStore().list('product', co); const mine = r === 'provider' ? all.filter((p) => String(p.provider_company_code) === actor('provider').code) : all; setRows(mine); return mine; };
  const selectP = (p: EntityRecord) => { setSel(String(p.product_code)); setForm({ ...p }); setDirty(false); };
  const clearSel = () => { setSel(null); setForm({}); setDirty(false); };
  useEffect(() => { (async () => { await seedIfEmpty(co); const r = getRole(); if (r !== 'admin' && r !== 'provider') { router.replace('/'); return; } setSheetUrl(typeof window !== 'undefined' ? localStorage.getItem('fp4_sheet_' + r) || '' : ''); setPolicies(await getStore().list('policy', co)); const all = await load(r); if (all.length) selectP(all[0]); })(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const on = (e: Event) => { (async () => { const all = await load((e as CustomEvent).detail as Role); clearSel(); if (all.length) selectP(all[0]); })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, []);

  const [clip, setClip] = useState<EntityRecord | null>(null);
  const onChange = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const norm = (v: unknown) => String(v ?? '').replace(/\s/g, '');
  const save = async () => {
    if (!String(form.product_code || '').trim()) { toast('상품코드는 필수입니다', 'error'); return; }
    // 차량번호 중복검증 — 다른 상품이 같은 차번이면 차단(erp3 bindCarNumberDupCheck)
    if (form.car_number) {
      const all = await getStore().list('product', co);
      const dup = all.find((p) => p.car_number && norm(p.car_number) === norm(form.car_number) && String(p.product_code) !== String(form.product_code) && p._deleted !== true);
      if (dup) { toast(`이미 등록된 차량번호 (공급사 ${dup.provider_company_code || '?'})`, 'error'); return; }
    }
    await getStore().save('product', co, [form]); await getStore().update('product', co, String(form.product_code), form); setDirty(false); await load(getRole()); toast('저장되었습니다', 'ok');
  };
  // 입력초기화(차번·공급사·상태만 유지) / 복사(식별·사진 제외) / 붙여넣기
  const resetForm = () => {
    setForm((f) => {
      const keep: EntityRecord = { product_code: f.product_code, car_number: f.car_number, provider_company_code: f.provider_company_code, vehicle_status: f.vehicle_status || '상품화중', product_type: f.product_type || '재렌트' };
      const META = new Set(['companyId', 'createdAt', 'createdBy', 'updatedAt', 'deletedAt']);
      const cleared: EntityRecord = {};
      for (const k of Object.keys(f)) if (!(k in keep) && !k.startsWith('_') && !META.has(k)) cleared[k] = ''; // 빈값 저장→merge로 실제 클리어(키 삭제 시 안 지워지던 버그)
      return { ...f, ...cleared, ...keep };
    });
    setDirty(true);
  };
  const copyForm = () => { const { car_number, vin, product_code, photos, image_urls, ...rest } = form; void car_number; void vin; void product_code; void photos; void image_urls; setClip(rest); };
  const pasteForm = () => { if (clip) { setForm((f) => ({ ...f, ...clip })); setDirty(true); } };
  // 자동차등록증 OCR(로컬 GPU) → 빈 칸만 자동채움 + 원본 OCR 텍스트 보존(_ocr_registration)
  const [ocrBusy, setOcrBusy] = useState(false);
  const [master, setMaster] = useState<MasterEntry[] | null>(null);
  const ocrRef = useRef<HTMLInputElement | null>(null);
  // 차종 SSOT 정규화 — 현재 폼 차종을 차종마스터 실재 조합으로 스냅(사용자 검토형). 신원=덮어쓰기, 스펙=빈칸만.
  const normalizeVehicle = async () => {
    let entries = master;
    if (!entries) { try { const r = await fetch('/data/vehicle-master.json'); const d = await r.json(); entries = (d.entries || d) as MasterEntry[]; setMaster(entries); } catch { toast('차종마스터 로드 실패', 'error'); return; } }
    const res = snapToMaster(form, entries);
    if (!res) { toast('매칭되는 차종을 찾지 못했습니다', 'error'); return; }
    setForm((f) => applySnap(f, res)); // 계단식 스냅 SSOT — 신원=트리노드 덮어쓰기, 스펙=노드값 우선
    setDirty(true);
    const span = res.year_start ? ` [${res.year_start}~${res.year_end}]` : '';
    toast(`차종 정규화: ${res.maker} ${res.sub_model}${span} (${res.confidence})`, res.confidence === 'low' ? 'info' : 'ok');
  };
  const [reconBusy, setReconBusy] = useState(false);
  // 전체 차종 재구현 — v3에서 당겨온 매물 원자를 차종마스터 계단트리로 일괄 재스냅 → v4 오버레이 canonical 저장(v3 무변경).
  const reconcileAll = async () => {
    if (reconBusy) return;
    setReconBusy(true);
    try {
      let entries = master;
      if (!entries) { const r = await fetch('/data/vehicle-master.json'); const d = await r.json(); entries = (d.entries || d) as MasterEntry[]; setMaster(entries); }
      const all = await getStore().list('product', co);
      const target = getRole() === 'provider' ? all.filter((p) => String(p.provider_company_code) === actor('provider').code) : all;
      const { patches, high, medium, low, unmatched } = reconcileToMaster(target, entries);
      if (!patches.length) { toast('재구현할 매물이 없습니다', 'info'); return; }
      const n = await getStore().bulkPatch('product', co, patches.map(({ key, patch }) => ({ key, patch })));
      await load(getRole());
      toast(`차종 재구현 ${n}건 · 확신 high ${high}·중 ${medium}·검토 ${low}${unmatched ? `·미매칭 ${unmatched}` : ''}`, low || unmatched ? 'info' : 'ok');
    } catch (e) { toast('재구현 오류: ' + String(e), 'error'); }
    finally { setReconBusy(false); }
  };
  const runOcr = async (files: FileList | null) => {
    if (!files || !files.length || ocrBusy) return;
    setOcrBusy(true);
    try {
      const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(files[0]); });
      const resp = await fetch('/api/ocr/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataUrl: url }) });
      const data = await resp.json();
      if (!resp.ok || data.error) { toast('OCR 실패: ' + (data.error || resp.status), 'error'); return; }
      const fields: Record<string, string> = data.fields || {};
      const keys = Object.keys(fields);
      setForm((prev) => { const next = { ...prev }; for (const k of keys) if (!String(next[k] ?? '').trim()) next[k] = fields[k]; next._ocr_registration = data.text || ''; return next; });
      setDirty(true);
      toast(keys.length ? `OCR 완료 — 빈 칸 자동채움: ${keys.join(', ')}` : 'OCR 완료 — 인식 항목 없음. 선명한 사진으로 다시', keys.length ? 'ok' : 'info');
    } catch (e) { toast('OCR 오류: ' + String(e), 'error'); }
    finally { setOcrBusy(false); if (ocrRef.current) ocrRef.current.value = ''; }
  };
  const newP = () => { const c = newId('product'); setSel(c); setForm({ product_code: c, vehicle_status: '상품화중', product_type: '재렌트', provider_company_code: getRole() === 'provider' ? actor('provider').code : '' }); setDirty(true); };
  const saveLink = () => { if (typeof window !== 'undefined') localStorage.setItem('fp4_sheet_' + getRole(), sheetUrl); toast('시트 링크 저장됨 (자동 불러오기는 배포 후)', 'ok'); };
  const copyJonghap = async () => {
    const [prods, pols] = await Promise.all([getStore().list('product', co), getStore().list('policy', co)]);
    const { tsv, count } = buildJonghapTsv(prods, pols);
    await navigator.clipboard?.writeText(tsv).catch(() => {});
    toast(`종합표 ${count}행 복사됨 — 구글시트 종합탭에 붙여넣기`, 'ok');
  };
  const importPaste = async () => {
    const lines = paste.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) { toast('헤더 행 + 데이터 행이 필요합니다', 'error'); return; }
    const cols = lines[0].split('\t').map(mapHeader);
    const pv = myProvider();
    const all = await getStore().list('product', co);
    const existByCar = new Map(all.filter((p) => p.car_number).map((p) => [norm(p.car_number), String(p.product_code)]));
    const recs: EntityRecord[] = [];
    let skipped = 0;
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split('\t');
      const rec: EntityRecord = {};
      cols.forEach((f, ci) => { if (f && cells[ci] != null && cells[ci].trim() !== '') rec[f] = cells[ci].trim(); });
      if (!rec.car_number) continue;
      rec.provider_company_code = pv;
      rec.product_code = `EXT-${pv}-${rec.car_number}`;
      const exist = existByCar.get(norm(rec.car_number));
      if (exist && exist !== rec.product_code) { skipped++; continue; } // 다른 상품에 이미 있는 차번 → 중복 방지
      if (!rec.vehicle_status) rec.vehicle_status = '출고가능';
      if (!rec.product_type) rec.product_type = '재렌트';
      recs.push(rec);
    }
    if (!recs.length) { toast(skipped ? `모두 중복 차번(${skipped}건) — 반영 없음` : '불러올 행이 없습니다 (차량번호 컬럼 필요)', 'error'); return; }
    await getStore().save('product', co, recs);
    for (const r of recs) await getStore().update('product', co, String(r.product_code), r);
    setPaste(''); await load(getRole());
    toast(`${recs.length}건 반영${skipped ? ` · 중복 차번 ${skipped}건 제외` : ''}`, 'ok');
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
  // 역할별 섹션(원자 사전) — erp3 자산정보/가격/사진 3카드 이식. 내부·파생(image_urls·catalog_id·fp_options·review_status·provider_name)은 폼서 제외(전용 에디터/자동).
  const byKey = Object.fromEntries(ENTITIES.product.fields.map((f) => [f.key, f]));
  const grp = (keys: string[]): Field[] => keys.map((k) => byKey[k]).filter(Boolean) as Field[];
  const secTitle: CSSProperties = { fontSize: 12, fontWeight: 800, color: C.ink, margin: '2px 0 5px' };
  const FG = (keys: string[], cols = 2) => <FormGrid fields={grp(keys)} form={form} onChange={onChange} cols={cols} />;
  const Section = (title: string, keys: string[], cols = 2) => <div><div style={secTitle}>{title}</div>{FG(keys, cols)}</div>;
  const editPane = (
    <>
      <PaneHead title="매물 편집" right={<Btn size="sm" onClick={save} disabled={!dirty}>저장</Btn>} />
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sel ? <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.faint }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: C.mute }}>{String(form.product_code)}</span>
            <span>{String(form.provider_company_code || '')}</span>
            <span style={{ flex: 1 }} />
            <Btn variant="ghost" size="sm" onClick={resetForm}>초기화</Btn>
            <Btn variant="ghost" size="sm" onClick={copyForm}>복사</Btn>
            <Btn variant="ghost" size="sm" onClick={pasteForm} disabled={!clip}>붙여넣기</Btn>
            {dirty && <span style={{ color: '#9a3412' }}>● 미저장</span>}
          </div>
          {/* 상태·구분·정책 = 매물 분류(맨 위). 2열 정렬 — 외로운 긴 줄 없이 관련끼리 가로로. */}
          <div>
            <div style={secTitle}>상태 · 구분 · 정책</div>
            {FG(['vehicle_status', 'product_type'])}
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 9, marginTop: 9 }}>
              <label style={{ fontSize: 11.5, color: C.mute }}>무보증 가능
                <select value={String(form.deposit_free || '')} onChange={(e) => onChange('deposit_free', e.target.value)} style={{ ...inp, marginTop: 3, background: form.deposit_free ? '#fff' : '#fff7ed' }}>
                  <option value="">—</option><option value="예">예</option><option value="아니오">아니오</option>
                </select>
              </label>
              <label style={{ fontSize: 11.5, color: C.mute }}>정책 연결
                <select value={String(form.policy_code || '')} onChange={(e) => onChange('policy_code', e.target.value)} style={{ ...inp, marginTop: 3 }}>
                  <option value="">— 정책 선택 —</option>
                  {policies.filter((pl) => !form.provider_company_code || String(pl.provider_company_code) === String(form.provider_company_code)).map((pl) => (
                    <option key={String(pl.policy_code)} value={String(pl.policy_code)}>{String(pl.policy_name || pl.policy_code)} ({String(pl.policy_code)})</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {/* 자동차등록증 OCR(로컬 GPU) — 빈 칸 자동채움 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.line}`, borderRadius: 4, background: '#f8fbff', padding: '8px 10px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.brand }}>자동차등록증 OCR</div>
              <div style={{ fontSize: 10.5, color: C.faint }}>등록증 사진 → 차번·차대·연료·배기량·인승·용도·최초등록 자동채움(빈 칸만)</div>
            </div>
            <input ref={ocrRef} type="file" accept="image/*" onChange={(e) => runOcr(e.target.files)} style={{ display: 'none' }} />
            <Btn size="sm" onClick={() => ocrRef.current?.click()} disabled={ocrBusy}>{ocrBusy ? '인식 중…' : '등록증 올리기'}</Btn>
          </div>
          {/* 신원 = 차종마스터 자동채움 + 보정 */}
          <VehicleMasterPicker onPick={(v) => { setForm((f) => ({ ...f, ...v })); setDirty(true); }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -4 }}>
            {(form.gen_year_start || form._snap_confidence) ? (
              <span style={{ fontSize: 11, color: C.mute }}>
                {form.gen_year_start ? `생산 ${form.gen_year_start}~${form.gen_year_end}` : ''}
                {form._snap_confidence ? `${form.gen_year_start ? ' · ' : ''}매칭 ${form._snap_confidence}` : ''}
              </span>
            ) : null}
            <span style={{ flex: 1 }} />
            <Btn variant="ghost" size="sm" onClick={normalizeVehicle}>차종 정규화 (마스터 매칭)</Btn>
          </div>
          {Section('신원 (차종)', ['car_number', 'maker', 'model', 'sub_model', 'variant', 'trim_name', 'vehicle_class'])}
          {Section('제원 · 스펙', ['year', 'fuel_type', 'engine_cc', 'seats', 'drive_type', 'transmission', 'mileage', 'usage', 'ext_color', 'int_color', 'first_registration_date'])}
          {Section('선택옵션', ['options'], 1)}
          <PriceMatrix price={form.price} onChange={(p) => { setForm((f) => ({ ...f, price: p })); setDirty(true); }} />
          <PhotoUpload photos={form.photos} onChange={(ps) => { setForm((f) => ({ ...f, photos: ps })); setDirty(true); }} />
          {getRole() === 'admin' && Section('원가 · 이력 · 등록증', ['vehicle_price', 'location', 'vin', 'vehicle_age_expiry_date', 'cert_car_name', 'type_number', 'engine_type', 'partner_memo'])}
        </> : <div style={{ color: C.faint, fontSize: 12.5 }}>매물을 선택하세요.</div>}
      </div>
    </>
  );
  const syncPane = (
    <>
      <PaneHead title="공급사 업로드" />
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 히어로 = 원버튼: 매물 전체 불러와 차종마스터 자동 정합 */}
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, background: '#f8fbff', padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.brand, marginBottom: 3 }}>매물 전체 불러오기</div>
          <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5, marginBottom: 9 }}>공급사 매물을 전부 끌어와 차종마스터 계단트리(제조사→모델→세대→파워트레인→트림)로 자동 정합. 결과는 항상 실존 조합, 저신뢰만 검토 표시.</div>
          <Btn onClick={reconcileAll} disabled={reconBusy}>{reconBusy ? '불러오는 중…' : '전체 불러와 차종 정합'}</Btn>
        </div>
        {/* 보조 도구(작게) */}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.mute, marginTop: 2 }}>보조 도구</div>
        <Btn size="sm" variant="ghost" onClick={copyJonghap}>종합표 TSV 복사</Btn>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="구글시트 URL" style={{ ...inp, marginTop: 0, flex: 1, minWidth: 0 }} />
          <Btn size="sm" variant="ghost" onClick={saveLink}>저장</Btn>
        </div>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'엑셀/시트 붙여넣기 — 첫 줄=헤더(탭)\n차량번호\t제조사\t모델\t연식\t연료'} rows={5} style={{ ...inp, marginTop: 0, fontFamily: 'var(--font-mono)', resize: 'vertical' }} />
        <Btn size="sm" variant="ghost" onClick={importPaste}>붙여넣기 반영</Btn>
      </div>
    </>
  );

  const panes: WorkPane[] = [
    { key: 'edit', title: '매물 편집', node: editPane },
    { key: 'sync', title: '공급사 업로드', node: syncPane, width: 360 },
  ];
  return <WorkPage title="재고" listCount={rows ? rows.length : ''} list={rows === null ? <div style={{ padding: 24, color: C.faint }}>불러오는 중…</div> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
    search={{ value: q, onChange: setQ, placeholder: '차량·차번·제조사·상태' }} actions={<Btn size="sm" onClick={newP}>매물 등록</Btn>} />;
}
