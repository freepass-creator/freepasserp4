'use client';
import { useEffect, useRef, useState } from 'react';
import { getStore, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, VEHICLE_STATES, PRODUCT_TYPES, type EntityRecord, type Field } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { newId } from '@/lib/domain/ids';
import { vehicleName, joinEventTags, canonProductType } from '@/lib/domain/product';
import { matchProductQuery } from '@/lib/domain/search';
import { withProviderNames } from '@/lib/domain/identity';
import { vehicleLockedBy, blockingContractFor } from '@/lib/domain/settlement-engine';
import { PaneHead, PaneBody, Btn, FormGrid, FormCard, C, R, NUM, Loading, CenterNote, SectionLabel, Select, Badge, Page, FilterChips, Message, PageActions, FW, FS } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { toast } from '@/components/Toaster';
import { haptic } from '@/lib/haptics';
import { buildJonghapTsv } from '@/lib/domain/jonghap';
import { snapToMaster, applySnap, resolveExactMasterPath, SNAP_TRACK_KEYS, type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { applyColors } from '@/lib/domain/color-master';
import { VehicleMasterPicker } from '@/components/VehicleMasterPicker';
import { SnapTrace } from '@/components/SnapTrace';
import { PhotoUpload } from '@/components/PhotoUpload';
import { useResolvedLinkPhotos } from '@/components/use-product-photos';
import dynamic from 'next/dynamic';
import { PriceMatrix } from '@/components/PriceMatrix';
import { useIsMobile } from '@/lib/use-mobile';
import { InventoryListRow } from '@/components/list-rows';
import { NAV_LABEL } from '@/lib/tabbar';

type InvSort = 'status' | 'name' | 'plate' | 'code';
const INV_SORTS: { value: InvSort; label: string }[] = [
  { value: 'status', label: '상태순' },
  { value: 'name', label: '차명순' },
  { value: 'plate', label: '차번순' },
  { value: 'code', label: '코드순' },
];
const PAGE = 100; // 첫 화면·더보기 단위(파인더와 동일)
const PAGE_HARD = 500;
const INV_STATUS_CHIPS = [
  { key: 'all' as const, label: '전체' },
  ...VEHICLE_STATES.map((s) => ({ key: s, label: s })),
];
const INV_TYPE_CHIPS = [
  { key: 'all' as const, label: '전체' },
  ...PRODUCT_TYPES.map((t) => ({ key: t, label: t })),
];

const SheetSync = dynamic(() => import('@/components/SheetSync').then((m) => m.SheetSync), {
  ssr: false,
  loading: () => <CenterNote>시트 연동 불러오는 중…</CenterNote>,
});

// 재고관리 = [매물 목록 | 매물 편집 | 공급사 소스 연동]. 파인더와 같은 데이터의 "편집 렌즈".
// 목록에서 선택 = 차종마스터 규격으로 맞춤(high·중 DB 반영). 공급사=자기 매물만.

export default function Inventory() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [rows, setRows] = useState<EntityRecord[] | null>(() => peekList('product', co));
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<EntityRecord>({});
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [ok, setOk] = useState<boolean | null>(null);
  const [gateMsg, setGateMsg] = useState('');
  const [clip, setClip] = useState<EntityRecord | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [master, setMaster] = useState<MasterEntry[] | null>(null);
  const [sort, setSort] = useState<InvSort | ''>('');
  const [stFlt, setStFlt] = useState<string>('all');
  const [typeFlt, setTypeFlt] = useState<string>('all');
  const [limit, setLimit] = useState(PAGE);
  /** 신규 작성 중(아직 DB 없음). 기존 = 보기 → 수정 눌러야 편집. */
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const ocrRef = useRef<HTMLInputElement | null>(null);
  const supplierPhotos = useResolvedLinkPhotos(form);
  const selectGen = useRef(0);

  const loadMaster = async (): Promise<MasterEntry[]> => {
    if (master?.length) return master;
    const { loadVehicleMaster } = await import('@/lib/domain/vehicle-master-load');
    const entries = await loadVehicleMaster();
    setMaster(entries);
    return entries;
  };

  const load = async (r: Role) => {
    const [all, partners] = await Promise.all([getStore().list('product', co), getStore().list('partner', co)]);
    const mine = r === 'provider' ? all.filter((p) => String(p.provider_company_code) === actor('provider').code) : all;
    const named = withProviderNames(mine, partners);
    setRows(named);
    return named;
  };

  /** 목록에서 고르면 차종마스터 규격으로 맞춤 — 마스터 실경로(exact)일 때만 DB 반영. */
  const selectP = async (p: EntityRecord) => {
    const code = String(p.product_code);
    const gen = ++selectGen.current;
    setSel(code);
    setForm({ ...p });
    setDirty(false);
    setCreating(false);
    setEditing(false);
    try {
      const entries = await loadMaster();
      if (gen !== selectGen.current) return;
      // 이미 마스터 실경로면 그대로(드롭다운이 규격에 딱 맞음)
      if (resolveExactMasterPath(entries, p)) return;
      const res = snapToMaster(p, entries);
      if (!res) {
        const colored = applyColors(p);
        if (colored !== p && (colored.ext_color !== p.ext_color || colored.int_color !== p.int_color)) {
          setForm(colored);
          if (String(colored.ext_color || '') !== String(p.ext_color || '')
            || String(colored.int_color || '') !== String(p.int_color || '')) {
            const colorPatch: EntityRecord = {
              ext_color: colored.ext_color,
              int_color: colored.int_color,
              _raw_ext_color: colored._raw_ext_color,
              _raw_int_color: colored._raw_int_color,
              _colors_snapped: colored._colors_snapped,
            };
            await getStore().update('product', co, code, colorPatch);
            if (gen !== selectGen.current) return;
            setForm({ ...p, ...colorPatch });
          }
        }
        return;
      }
      const applied = applyColors(applySnap(p, res, { source: 'select' }));
      if (gen !== selectGen.current) return;
      // 스냅 결과가 마스터 실경로가 아니면 폼만 검토용 — 임의 DB 덮지 않음
      const exact = resolveExactMasterPath(entries, applied);
      setForm(applied);
      if (!exact || (res.confidence !== 'high' && res.confidence !== 'medium')) {
        if (res.confidence === 'low') setDirty(true);
        return;
      }
      const trackChanged = SNAP_TRACK_KEYS.some(
        (k) => String(p[k] ?? '').trim() !== String(applied[k] ?? '').trim(),
      );
      const colorChanged = String(p.ext_color ?? '') !== String(applied.ext_color ?? '')
        || String(p.int_color ?? '') !== String(applied.int_color ?? '');
      const needsWrite = trackChanged || colorChanged || !p._snapped || p._snap_confidence !== res.confidence
        || (!!p._needs_master_review !== !!applied._needs_master_review);
      if (!needsWrite) return;
      const patch: EntityRecord = {
        maker: applied.maker, model: applied.model, sub_model: applied.sub_model, catalog_id: applied.catalog_id,
        gen_year_start: applied.gen_year_start, gen_year_end: applied.gen_year_end,
        variant: applied.variant, trim_name: applied.trim_name,
        fuel_type: applied.fuel_type, engine_cc: applied.engine_cc, seats: applied.seats, drive_type: applied.drive_type,
        year: applied.year, vehicle_class: applied.vehicle_class,
        ext_color: applied.ext_color, int_color: applied.int_color,
        _raw_ext_color: applied._raw_ext_color, _raw_int_color: applied._raw_int_color,
        _colors_snapped: applied._colors_snapped,
        _snap_confidence: applied._snap_confidence, _snapped: true,
        _raw_vehicle: applied._raw_vehicle, _snap_at: applied._snap_at, _snap_history: applied._snap_history,
        _needs_master_review: false,
      };
      await getStore().update('product', co, code, patch);
      if (gen !== selectGen.current) return;
      const named = await load(getRole());
      if (gen !== selectGen.current) return;
      const fresh = named.find((x) => String(x.product_code) === code);
      if (fresh) setForm({ ...fresh, ...patch });
      setDirty(false);
    } catch {
      /* 마스터 로드 실패 시 원본 폼 유지 */
    }
  };
  const clearSel = () => { setSel(null); setForm({}); setDirty(false); setCreating(false); setEditing(false); };
  useEffect(() => {
    (async () => {
      try {
        await seedIfEmpty(co);
        const r = getRole();
        if (r !== 'admin' && r !== 'provider') {
          setGateMsg(`${NAV_LABEL.inventory}는 공급사·관리자만 사용할 수 있습니다. 설정에서 역할을 바꾸세요.`);
          setOk(false);
          return;
        }
        // 목록 먼저 그리고 → 마스터·첫행 스냅은 백그라운드(첫 페인트 블로킹 금지)
        setPolicies(await getStore().list('policy', co));
        const all = await load(r);
        setOk(true);
        void loadMaster().catch(() => {});
        // 계약/정책과 동일 — 모바일=목록부터, 웹=콕핏용 첫행
        if (!mobile && all.length) void selectP(all[0]);
      } catch (e) {
        setGateMsg('재고 로드 실패: ' + String((e as Error).message || e));
        setOk(false);
      }
    })();
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => {
    const on = (e: Event) => {
      (async () => {
        const r = (e as CustomEvent).detail as Role;
        if (r !== 'admin' && r !== 'provider') {
          setGateMsg(`${NAV_LABEL.inventory}는 공급사·관리자만 사용할 수 있습니다.`);
          setOk(false);
          return;
        }
        setOk(true);
        setGateMsg('');
        const all = await load(r);
        clearSel();
        if (!mobile && all.length) void selectP(all[0]);
      })();
    };
    window.addEventListener('fp:role', on);
    return () => window.removeEventListener('fp:role', on);
    /* eslint-disable-next-line */
  }, [mobile]);

  // 메뉴에서 재고관리 재진입 → 목록
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === '/inventory') clearSel();
    };
    window.addEventListener('fp:work-list', on);
    return () => window.removeEventListener('fp:work-list', on);
  }, []);

  // 검색·필터·정렬 바뀌면 더보기 리셋
  useEffect(() => { setLimit(PAGE); }, [q, stFlt, typeFlt, sort]);

  const onChange = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const norm = (v: unknown) => String(v ?? '').replace(/\s/g, '');
  const save = async () => {
    if (!String(form.product_code || '').trim()) { toast('상품코드는 필수입니다', 'error'); return; }
    const role = getRole();
    // 공급사 소유권 — 타사 매물 저장 차단 + 귀속코드 강제
    if (role === 'provider') {
      const me = actor('provider').code;
      if (!me) { toast('공급사 코드가 없습니다 — 설정·로그인을 확인하세요', 'error'); return; }
      const existing = await getStore().get('product', co, String(form.product_code));
      if (existing && String(existing.provider_company_code || '') !== me) {
        toast('다른 공급사 매물은 수정할 수 없습니다', 'error');
        return;
      }
      if (String(form.provider_company_code || '') && String(form.provider_company_code) !== me) {
        toast('공급사 코드를 변경할 수 없습니다', 'error');
        return;
      }
    }
    // 차량번호 중복검증 — 다른 상품이 같은 차번이면 차단(erp3 bindCarNumberDupCheck)
    if (form.car_number) {
      const all = await getStore().list('product', co);
      const dup = all.find((p) => p.car_number && norm(p.car_number) === norm(form.car_number) && String(p.product_code) !== String(form.product_code) && p._deleted !== true);
      if (dup) { toast(`이미 등록된 차량번호 (공급사 ${dup.provider_company_code || '?'})`, 'error'); return; }
    }
    // vehicle_status 단일 writer 보호 — 진행중/완료 계약이 걸린 매물은 폼값으로 상태를 못 덮음(엔진 잠금 우선, 중복판매 desync 방지).
    const locked = await vehicleLockedBy(String(form.product_code));
    const lock = locked.status;
    const stamped = role === 'provider'
      ? { ...form, provider_company_code: actor('provider').code }
      : form;
    const withPromo: EntityRecord = { ...stamped, event_tags: joinEventTags(String(stamped.event_tags || '').split(/[,/#|]/)) };
    // 락이 걸려 있으면 상태와 함께 소유 계약도 각인 — 상태만 맞고 주인이 비면 재클릭이 자기잠금으로 막힌다.
    const patch = lock ? { ...withPromo, vehicle_status: lock, locked_by_contract: locked.byContract } : withPromo;
    await getStore().save('product', co, [patch]); await getStore().update('product', co, String(form.product_code), patch);
    setDirty(false);
    setCreating(false);
    setEditing(false);
    await load(getRole());
    if (lock && form.vehicle_status !== lock) {
      setForm((f) => ({ ...f, vehicle_status: lock }));
      toast(lock === '계약중'
        ? '계약금이 확인된 계약이 있어 차량상태는 계약중으로 유지됩니다'
        : '완료 계약이 있어 차량상태는 출고불가로 유지됩니다', 'info');
    }
    else toast('저장되었습니다', 'ok');
  };

  /** 신규 작성 취소 → 목록. 기존 수정 취소 → 저장된 값으로 되돌리고 보기 모드. */
  const cancelEdit = () => {
    if (creating) { clearSel(); return; }
    const row = (rows ?? []).find((r) => String(r.product_code) === sel);
    if (row) { setForm({ ...row }); setDirty(false); setEditing(false); }
    else clearSel();
  };

  const startEdit = () => { setEditing(true); haptic.tap(); };

  /** 소프트삭제 — 계약 잠금(진행/완료)이면 차단. */
  const removeP = async () => {
    if (!sel || !form.product_code) return;
    const role = getRole();
    if (role === 'provider') {
      const me = actor('provider').code;
      if (String(form.provider_company_code || '') !== me) { toast('다른 공급사 매물은 삭제할 수 없습니다', 'error'); return; }
    }
    // 락(입금선점)만 보면 서류 단계 진행 중인 매물이 삭제된다 → 진행 중인 계약 전체를 차단 기준으로.
    const blocking = await blockingContractFor(String(form.product_code));
    if (blocking) { toast(`진행 중인 계약(${blocking})이 있는 매물은 삭제할 수 없습니다`, 'error'); return; }
    if (typeof window !== 'undefined' && !window.confirm(`매물 ${form.car_number || form.product_code}을(를) 삭제할까요?\n휴지통에서 복구할 수 있습니다.`)) return;
    await getStore().remove('product', co, String(form.product_code), `${NAV_LABEL.inventory} 삭제`);
    clearSel();
    await load(role);
    haptic.impact();
    toast('매물이 삭제되었습니다', 'ok');
  };
  // 입력초기화(차번·공급사·상태만 유지) / 복사(식별·사진 제외) / 붙여넣기
  const resetForm = () => {
    setForm((f) => {
      const keep: EntityRecord = { product_code: f.product_code, car_number: f.car_number, provider_company_code: f.provider_company_code, vehicle_status: f.vehicle_status || '상품화중', product_type: f.product_type || '중고렌트' };
      const META = new Set(['companyId', 'createdAt', 'createdBy', 'updatedAt', 'deletedAt']);
      const cleared: EntityRecord = {};
      for (const k of Object.keys(f)) if (!(k in keep) && !k.startsWith('_') && !META.has(k)) cleared[k] = ''; // 빈값 저장→merge로 실제 클리어(키 삭제 시 안 지워지던 버그)
      return { ...f, ...cleared, ...keep };
    });
    setDirty(true);
  };
  const copyForm = () => { const { car_number, vin, product_code, photos, image_urls, ...rest } = form; void car_number; void vin; void product_code; void photos; void image_urls; setClip(rest); };
  const pasteForm = () => { if (clip) { setForm((f) => ({ ...f, ...clip })); setDirty(true); } };
  // 차종 SSOT 정규화 — 현재 폼 차종을 차종마스터 실재 조합으로 스냅(사용자 검토형). 신원=덮어쓰기, 스펙=빈칸만.
  const normalizeVehicle = async () => {
    try {
      const entries = await loadMaster();
      const res = snapToMaster(form, entries);
      if (!res) { toast('매칭되는 차종을 찾지 못했습니다', 'error'); return; }
      setForm((f) => applySnap(f, res, { source: 'manual' }));
      setDirty(true);
      const span = res.year_start ? ` [${res.year_start}~${res.year_end}]` : '';
      toast(`차종 정규화: ${res.maker} ${res.sub_model}${span} (${res.confidence})`, res.confidence === 'low' ? 'info' : 'ok');
    } catch { toast('차종마스터 로드 실패', 'error'); }
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
  const newP = () => {
    const c = newId('product');
    setSel(c);
    setForm({ product_code: c, vehicle_status: '상품화중', product_type: '중고렌트', provider_company_code: getRole() === 'provider' ? actor('provider').code : '' });
    setDirty(true);
    setCreating(true);
    setEditing(true);
  };
  const copyJonghap = async () => {
    const role = getRole();
    const [prodsAll, polsAll] = await Promise.all([getStore().list('product', co), getStore().list('policy', co)]);
    const me = role === 'provider' ? actor('provider').code : '';
    const prods = role === 'provider'
      ? prodsAll.filter((p) => String(p.provider_company_code || '') === me)
      : prodsAll;
    // 정책 = 자기 전용 + 공용(연결 가능 범위와 동일)
    const pols = role === 'provider'
      ? polsAll.filter((pl) => {
          const ppc = String(pl.provider_company_code || '');
          return !ppc || ppc === me;
        })
      : polsAll;
    const { tsv, count } = buildJonghapTsv(prods, pols);
    await navigator.clipboard?.writeText(tsv).catch(() => {});
    toast(`종합표 ${count}행 복사됨 — 구글시트 종합탭에 붙여넣기`, 'ok');
  };

  if (ok === false) {
    return (
      <Page title={NAV_LABEL.inventory}>
        <CenterNote>{gateMsg || '접근 불가'}</CenterNote>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <Btn href="/settings" size="sm">설정에서 역할 변경</Btn>
          {getRole() === 'admin' && <Btn href="/dev" size="sm" variant="ghost">개발도구</Btn>}
        </div>
      </Page>
    );
  }
  if (ok !== true) return <Loading />;

  const filtered = (rows || [])
    .filter((p) => matchProductQuery(p, q))
    .filter((p) => stFlt === 'all' || String(p.vehicle_status || '') === stFlt)
    .filter((p) => typeFlt === 'all' || canonProductType(p.product_type) === typeFlt)
    .slice()
    .sort((a, b) => {
      if (!sort) return 0;
      if (sort === 'name') return vehicleName(a).localeCompare(vehicleName(b), 'ko');
      if (sort === 'plate') return String(a.car_number || '').localeCompare(String(b.car_number || ''), 'ko');
      if (sort === 'code') return String(a.product_code || '').localeCompare(String(b.product_code || ''), 'ko');
      const ai = VEHICLE_STATES.indexOf(String(a.vehicle_status || '') as typeof VEHICLE_STATES[number]);
      const bi = VEHICLE_STATES.indexOf(String(b.vehicle_status || '') as typeof VEHICLE_STATES[number]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || vehicleName(a).localeCompare(vehicleName(b), 'ko');
    });
  const shown = filtered.slice(0, limit);
  const moreN = Math.max(0, filtered.length - limit);
  const listEl = filtered.length === 0
    ? (
      <CenterNote>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <span>{q || stFlt !== 'all' || typeFlt !== 'all' ? '검색 결과 없음' : '매물 없음'}</span>
          {(q || stFlt !== 'all' || typeFlt !== 'all') ? (
            <Btn size="sm" variant="ghost" onClick={() => { setQ(''); setStFlt('all'); setTypeFlt('all'); }}>조건 해제</Btn>
          ) : null}
        </div>
      </CenterNote>
    )
    : (
      <div>
        {shown.map((p) => (
          <InventoryListRow
            key={String(p.product_code)}
            p={p}
            selected={String(p.product_code) === sel}
            onClick={() => { haptic.tap(); selectP(p); }}
          />
        ))}
        {moreN > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap',
            padding: '12px 14px', borderTop: `1px solid ${C.line2}`,
          }}>
            <span style={{ fontSize: FS.sub, color: C.mute }}>
              {shown.length.toLocaleString()} / {filtered.length.toLocaleString()}대
            </span>
            <Btn variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
              더보기 · {Math.min(PAGE, moreN).toLocaleString()}대
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => {
              if (filtered.length > PAGE_HARD) {
                setLimit(PAGE_HARD);
                toast(`성능상 ${PAGE_HARD.toLocaleString()}대까지 표시합니다. 검색·필터로 좁혀주세요.`, 'info');
              } else setLimit(filtered.length);
            }}>전체 보기</Btn>
          </div>
        )}
      </div>
    );

  // 역할별 섹션 — erp3 자산/가격/사진 카드. FormCard = 입력 구역 테두리(어디에 치는지).
  const byKey = Object.fromEntries(ENTITIES.product.fields.map((f) => [f.key, f]));
  const grp = (keys: string[]): Field[] => keys.map((k) => byKey[k]).filter(Boolean) as Field[];
  const canEdit = creating || editing;
  const FG = (keys: string[], cols = 2) => <FormGrid fields={grp(keys)} form={form} onChange={onChange} cols={cols} disabled={!canEdit} />;
  const Section = (title: string, keys: string[], cols = 2, hint?: string) => (
    <FormCard title={title} hint={hint}>{FG(keys, cols)}</FormCard>
  );
  const modeBanner = creating ? (
    <Message variant="info">신규 매물 등록 — 등록증 올리기 또는 차종 마스터부터 입력하세요.</Message>
  ) : editing ? (
    <Message variant="warning">수정 중 · 저장해야 반영됩니다</Message>
  ) : null;
  // 매물편집 = 독립 패널 2개(고정/변동) — 웹 나란히(각 패널 스크롤) / 모바일 스택(한 스크롤로 이어짐).
  // 취소·저장·수정·삭제 = 하단 독만 (PaneHead에 두지 않음).
  const fixedPane = (
    <>
      <PaneHead title="기본정보" />
      <PaneBody pad>
        {sel ? <>
          {modeBanner}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.faint, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: NUM, fontWeight: FW.strong, color: C.mute }}>{String(form.product_code)}</span>
            <span>{String(form.provider_company_code || '')}</span>
            <span style={{ flex: 1 }} />
            {canEdit ? (
              <>
                <Btn variant="ghost" size="sm" onClick={resetForm}>초기화</Btn>
                <Btn variant="ghost" size="sm" onClick={copyForm}>복사</Btn>
                <Btn variant="ghost" size="sm" onClick={pasteForm} disabled={!clip}>붙여넣기</Btn>
                {dirty && <span style={{ color: C.warn }}>● 미저장</span>}
              </>
            ) : null}
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.line}`, borderRadius: R,
            background: C.selected, padding: '8px 10px',
            opacity: canEdit ? 1 : 0.75, pointerEvents: canEdit ? undefined : 'none',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: FW.title, color: C.brand }}>① 자동차등록증</div>
              <div style={{ fontSize: FS.micro, color: C.faint }}>올리면 차번·차대·연료·배기·인승·용도·최초등록 자동채움(빈 칸만)</div>
            </div>
            <input ref={ocrRef} type="file" accept="image/*" onChange={(e) => runOcr(e.target.files)} style={{ display: 'none' }} />
            <Btn size="sm" onClick={() => ocrRef.current?.click()} disabled={ocrBusy || !canEdit}>{ocrBusy ? '인식 중…' : '등록증 올리기'}</Btn>
          </div>
          <div style={{ pointerEvents: canEdit ? undefined : 'none', opacity: canEdit ? 1 : 0.85 }}>
            <div style={{ fontSize: 12, fontWeight: FW.title, color: C.brand, marginBottom: 6 }}>② 차종 마스터</div>
            <VehicleMasterPicker
              key={sel || 'none'}
              value={{
                maker: String(form.maker || ''),
                model: String(form.model || ''),
                sub_model: String(form.sub_model || ''),
                catalog_id: String(form.catalog_id || ''),
                variant: String(form.variant || ''),
                trim_name: String(form.trim_name || ''),
                trim_extra: String(form.trim_extra || ''),
              }}
              onPick={(v) => {
              setForm((f) => {
                const next = applySnap(f, {
                  maker: v.maker,
                  model: v.model,
                  sub_model: v.sub_model,
                  gen_code: v.catalog_id,
                  year_start: v.gen_year_start,
                  year_end: v.gen_year_end,
                  variant: v.variant || undefined,
                  trim_name: v.trim_name || '',
                  fuel_type: v.fuel_type || undefined,
                  engine_cc: v.engine_cc || undefined,
                  seats: v.seats || undefined,
                  drive_type: v.drive_type || undefined,
                  confidence: 'high',
                }, { source: 'picker' });
                return { ...next, trim_extra: v.trim_extra ?? '' };
              });
              setDirty(true);
            }} />
          </div>
          {(form.gen_year_start || form._snap_confidence) ? (
            <div style={{ fontSize: 11, color: C.mute, marginTop: -4 }}>
              {form.gen_year_start ? `생산 ${form.gen_year_start}~${form.gen_year_end}` : ''}
              {form._snap_confidence ? `${form.gen_year_start ? ' · ' : ''}매칭 ${form._snap_confidence}` : ''}
            </div>
          ) : null}
          <SnapTrace
            form={form}
            onRematch={canEdit && (form._needs_master_review || form._snap_confidence === 'low' || !form._snapped) ? normalizeVehicle : undefined}
          />
          {Section('③ 신원', ['car_number', 'vehicle_class'], 2, '차량번호는 필수')}
          {Section('선택옵션', ['options'], 1)}
          {Section('제원 · 스펙', ['year', 'fuel_type', 'engine_cc', 'seats', 'drive_type', 'transmission', 'usage', 'ext_color', 'int_color', 'first_registration_date'], 2)}
          {getRole() === 'admin' && Section('원가 · 이력 · 등록증', ['vehicle_price', 'location', 'vin', 'vehicle_age_expiry_date', 'cert_car_name', 'type_number', 'engine_type', 'partner_memo'])}
        </> : <CenterNote>왼쪽에서 매물을 고르거나 · 매물 등록을 누르세요.</CenterNote>}
      </PaneBody>
    </>
  );
  const varPane = (
    <>
      <PaneHead title="운영정보" />
      <PaneBody pad>
        {sel ? <>
          <FormCard title="상태 · 구분 · 정책" hint="매물 운영 상태와 연결 정책">
            {FG(['vehicle_status', 'product_type'])}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 9, marginTop: 9 }}>
              <label style={{ fontSize: FS.cap, color: C.mute }}>무보증 가능
                <div style={{ marginTop: 3 }}><Select value={String(form.deposit_free || '')} onChange={(v) => onChange('deposit_free', v)} options={['예', '아니오']} placeholder="—" full disabled={!canEdit} /></div>
              </label>
              <label style={{ fontSize: FS.cap, color: C.mute }}>정책 연결
                <div style={{ marginTop: 3 }}><Select value={String(form.policy_code || '')} onChange={(v) => onChange('policy_code', v)} placeholder="— 정책 선택 —" full disabled={!canEdit}
                  options={policies.filter((pl) => {
                    const pc = String(form.provider_company_code || '');
                    const ppc = String(pl.provider_company_code || '');
                    if (!pc) return true;
                    return !ppc || ppc === pc;
                  }).map((pl) => ({
                    value: String(pl.policy_code),
                    label: `${String(pl.policy_name || pl.policy_code)}${pl.provider_company_code ? '' : ' · 공용'} (${String(pl.policy_code)})`,
                  }))} /></div>
              </label>
            </div>
            <div style={{ marginTop: 10 }}>{FG(['event_tags'], 1)}</div>
          </FormCard>
          {Section('주행 · 사고', ['mileage', 'accident_history'])}
          <div style={{ pointerEvents: canEdit ? undefined : 'none', opacity: canEdit ? 1 : 0.85 }}>
            <SectionLabel mt={0}>대여료 · 보증금</SectionLabel>
            <div style={{ fontSize: FS.cap, color: C.faint, margin: '-2px 0 8px', lineHeight: 1.4 }}>넣은 기간만 매물에 노출</div>
            <PriceMatrix price={form.price} onChange={(p) => { setForm((f) => ({ ...f, price: p })); setDirty(true); }} />
          </div>
          <div style={{ pointerEvents: canEdit ? undefined : 'none', opacity: canEdit ? 1 : 0.85 }}>
            <SectionLabel mt={0}>사진</SectionLabel>
            <div style={{ fontSize: FS.cap, color: C.faint, margin: '-2px 0 8px', lineHeight: 1.4 }}>탭=크게 · 꾹=대표/실내/삭제</div>
            <PhotoUpload
              hideTitle
              photos={form.photos}
              interiorUrl={String(form.interior_photo || '')}
              onChange={(ps) => { setForm((f) => ({ ...f, photos: ps })); setDirty(true); }}
              onInteriorChange={(url) => { setForm((f) => ({ ...f, interior_photo: url || '' })); setDirty(true); }}
            />
          </div>
          {supplierPhotos.length > 0 && (
            <div>
              <SectionLabel mt={0}>공급사 사진 <span style={{ fontSize: 11, fontWeight: FW.body, color: C.faint }}>· 연동(읽기전용) {supplierPhotos.length}장</span></SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 6 }}>
                {supplierPhotos.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer" style={{ display: 'block', aspectRatio: '4 / 3', borderRadius: R, overflow: 'hidden', background: C.placeholder, border: `1px solid ${C.line}` }}>
                    <img src={u} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </> : <CenterNote>왼쪽에서 매물을 고르거나 · 매물 등록을 누르세요.</CenterNote>}
      </PaneBody>
    </>
  );
  const syncPane = (
    <>
      <PaneHead title="공급사 업로드" />
      <PaneBody pad>
        {/* 전수 차종변환 = /dev 개발도구. 여기는 공급사 시트 취합만. */}
        <div style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.mute }}>공급사 시트 취합</div>
        <SheetSync co={co} onImported={() => load(getRole())} />
        <div style={{ height: 1, background: C.line2, margin: '2px 0' }} />
        <Btn size="sm" variant="ghost" onClick={copyJonghap}>종합표 TSV 복사 (ERP→시트)</Btn>
      </PaneBody>
    </>
  );

  // 편집 = 기본·운영·업로드 3패널.
  const panes: WorkPane[] = [
    { key: 'fixed', title: '기본', node: fixedPane },
    { key: 'var', title: '운영', node: varPane },
    { key: 'sync', title: '업로드', node: syncPane },
  ];
  // 목록·보기=상품+·수정·삭제. 신규/수정=취소·저장.
  const dockActions = !sel || (!creating && !editing) ? (
    <PageActions
      primary={{ label: '상품+', onClick: newP }}
      edit={sel && !creating && !editing ? { onClick: startEdit } : undefined}
      remove={sel && !creating && !editing ? { onClick: removeP } : undefined}
    />
  ) : (
    <PageActions cancel={{ onClick: cancelEdit }} save={{ onClick: save, disabled: !dirty }} />
  );
  const fltCount = (stFlt !== 'all' ? 1 : 0) + (typeFlt !== 'all' ? 1 : 0);
  return (
    <>
      <WorkPage title={NAV_LABEL.inventory} statusLabel="출고가능"
        statusCount={(rows || []).filter((p) => {
          const st = String(p.vehicle_status || '');
          return st === '즉시출고' || st === '출고가능';
        }).length}
        countSuffix="대"
        listCount={filtered.length}
        list={rows === null ? <Loading /> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
        contextTitle={sel ? (creating ? '신규 매물' : (vehicleName(form) || String(form.car_number || form.product_code || ''))) : undefined}
        search={{ value: q, onChange: setQ, placeholder: '차번·차명·코드·옵션·공급사·메모…' }}
        actions={dockActions}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '차번·차명·코드·옵션·공급사·메모…' },
          sort: { value: sort, onChange: (v) => setSort(v as InvSort | ''), options: INV_SORTS },
          filter: {
            count: fltCount,
            title: '재고 필터',
            onClear: () => { setStFlt('all'); setTypeFlt('all'); },
            body: (
              <>
                <SectionLabel mt={0}>매물상태</SectionLabel>
                <FilterChips value={stFlt} onChange={setStFlt} options={INV_STATUS_CHIPS} />
                <SectionLabel>상품구분</SectionLabel>
                <FilterChips value={typeFlt} onChange={setTypeFlt} options={INV_TYPE_CHIPS} />
              </>
            ),
          },
          hints: [
            ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
            ...(sort ? [INV_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...(stFlt !== 'all' ? [stFlt] : []),
            ...(typeFlt !== 'all' ? [typeFlt] : []),
          ],
          onClearHints: () => { setQ(''); setSort(''); setStFlt('all'); setTypeFlt('all'); setLimit(PAGE); },
        }}
      />
    </>
  );
}
