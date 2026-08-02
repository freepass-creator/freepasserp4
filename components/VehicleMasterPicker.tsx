'use client';
import { useEffect, useMemo, useState } from 'react';
import { C, R, Select, Input, FW, FS } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import {
  makerDisplay,
  masterVariantLabel,
  masterVariantOptionLabel,
  variantSeatsDiffer,
  realMasterTrims,
  resolveExactMasterPath,
  masterMakerGroups,
  masterModels,
  masterSubs,
  type MasterEntry,
} from '@/lib/domain/vehicle-master-match';
import { loadVehicleMaster, peekVehicleMaster } from '@/lib/domain/vehicle-master-load';

// 차종 마스터: 제조사→모델→세부모델→파워트레인→세부트림 → 추가표기(자유) → (페이지)선택옵션.
// 마스터 경로만 드롭다운. 추가표기 = 규격 밖 텍스트(런칭·휠 등).
type Entry = MasterEntry;
export type VehiclePick = {
  maker: string; model: string; sub_model: string; catalog_id: string;
  variant: string; trim_name: string; trim_extra: string;
  fuel_type: string; engine_cc: string; seats: string; drive_type: string;
  gen_year_start?: string; gen_year_end?: string;
};

export type VehicleMasterValue = {
  maker?: string; model?: string; sub_model?: string;
  catalog_id?: string; variant?: string; trim_name?: string; trim_extra?: string;
};

export function VehicleMasterPicker({
  value,
  onPick,
}: {
  value?: VehicleMasterValue | null;
  onPick: (v: VehiclePick) => void;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(() => peekVehicleMaster());
  const [maker, setMaker] = useState('');
  const [model, setModel] = useState('');
  const [smId, setSmId] = useState('');
  const [vIdx, setVIdx] = useState(-1);
  const [trim, setTrim] = useState('');
  const [extra, setExtra] = useState('');
  const [pathOk, setPathOk] = useState<boolean | null>(null);

  useEffect(() => {
    loadVehicleMaster()
      .then((entries) => setEntries(entries))
      .catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    if (!entries?.length) return;
    setExtra(String(value?.trim_extra ?? '').trim());
    if (!value || !(value.maker || value.model || value.sub_model || value.catalog_id)) {
      setMaker(''); setModel(''); setSmId(''); setVIdx(-1); setTrim('');
      setPathOk(null);
      return;
    }
    const path = resolveExactMasterPath(entries, value);
    if (path) {
      setMaker(path.entry.maker);
      setModel(path.entry.model);
      setSmId(path.entry.id);
      setVIdx(path.variantIndex);
      setTrim(path.trim);
      setPathOk(true);
      return;
    }
    // 완전경로 실패해도 제조사·모델·세부가 마스터에 있으면 드롭다운은 유지(없는 차로 싹 지우지 않음).
    const mk = String(value.maker || '').trim();
    const md = String(value.model || '').trim();
    const sb = String(value.sub_model || '').trim();
    const hasMaker = !!mk && entries.some((e) => e.maker === mk);
    const hasModel = hasMaker && !!md && entries.some((e) => e.maker === mk && e.model === md);
    const subHit = hasModel && sb
      ? entries.find((e) => e.maker === mk && e.model === md && e.sub_model === sb)
      : undefined;
    setMaker(hasMaker ? mk : '');
    setModel(hasModel ? md : '');
    setSmId(subHit ? subHit.id : '');
    setVIdx(-1);
    setTrim('');
    setPathOk(false);
  }, [
    entries,
    value?.maker, value?.model, value?.sub_model,
    value?.catalog_id, value?.variant, value?.trim_name, value?.trim_extra,
  ]);

  const makerGroups = useMemo(() => (entries ? masterMakerGroups(entries) : []), [entries]);
  const models = useMemo(() => (entries ? masterModels(entries, maker) : []), [entries, maker]);
  const subs = useMemo(() => (entries ? masterSubs(entries, maker, model) : []), [entries, maker, model]);
  const sub = subs.find((e) => e.id === smId) || null;
  const variants = sub ? sub.variants : [];
  const variant = vIdx >= 0 ? variants[vIdx] : null;
  const trims = variant ? realMasterTrims(variant.trims) : [];
  const noTrimGrade = !!variant && trims.length === 0;
  const showSeat = variantSeatsDiffer(variants);

  const buildPick = (t: string, ex: string): VehiclePick | null => {
    if (!sub || !variant) return null;
    return {
      maker, model, sub_model: sub.sub_model, catalog_id: sub.gen_code,
      variant: masterVariantLabel(variant), trim_name: t, trim_extra: ex,
      fuel_type: variant.fuel || '',
      engine_cc: variant.displacement_l != null && variant.displacement_l > 0
        ? String(Math.round(variant.displacement_l * 1000))
        : '',
      seats: showSeat && variant.seat != null ? String(variant.seat) : '',
      drive_type: variant.drivetrain || '',
      gen_year_start: sub.year_start || undefined,
      gen_year_end: sub.year_end || undefined,
    };
  };

  const emit = (t: string) => {
    setTrim(t);
    const pick = buildPick(t, extra);
    if (!pick) return;
    onPick(pick);
    setPathOk(true);
  };

  const commitExtra = (ex: string) => {
    setExtra(ex);
    if (!variant) return;
    const pick = buildPick(trim, ex);
    if (!pick) return;
    onPick(pick);
  };

  const pickVariant = (v: string) => {
    const idx = v === '' ? -1 : Number(v);
    setVIdx(idx);
    setTrim('');
    setPathOk(null);
    if (idx < 0 || !sub) return;
    const vv = variants[idx];
    if (!vv) return;
    // 세부트림 후보가 있어도 미선택('') 가능 — 파워트레인만으로 규격 확정(베뉴 프리미엄 강제 금지)
    const seatShow = variantSeatsDiffer(variants);
    onPick({
      maker, model, sub_model: sub.sub_model, catalog_id: sub.gen_code,
      variant: masterVariantLabel(vv), trim_name: '', trim_extra: extra,
      fuel_type: vv.fuel || '',
      engine_cc: vv.displacement_l != null && vv.displacement_l > 0
        ? String(Math.round(vv.displacement_l * 1000))
        : '',
      seats: seatShow && vv.seat != null ? String(vv.seat) : '',
      drive_type: vv.drivetrain || '',
      gen_year_start: sub.year_start || undefined,
      gen_year_end: sub.year_end || undefined,
    });
    setPathOk(true);
  };

  const mobile = useIsMobile();

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: '10px 12px' }}>
      <div style={{ fontSize: FS.cap, color: C.mute, marginBottom: 7, minHeight: 16 }}>
        {entries === null && <span style={{ color: C.faint }}>불러오는 중…</span>}
        {entries && entries.length === 0 && <span style={{ color: C.danger }}>마스터 로드 실패</span>}
        {entries && entries.length > 0 && pathOk === true && (
          <span style={{ color: C.ok, fontWeight: FW.strong }}>
            규격 일치{noTrimGrade ? ' (세부트림 없음)' : (trim ? '' : ' (세부트림 미선택)')}
          </span>
        )}
        {entries && entries.length > 0 && pathOk === false && (
          <span style={{ color: C.danger, fontWeight: FW.strong }}>마스터에 없는 값 — 아래에서 규격 선택</span>
        )}
        {entries && entries.length > 0 && pathOk == null && (
          <span style={{ color: C.faint }}>{entries.length.toLocaleString()}세대</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
        <Select
          full
          placeholder="제조사"
          value={maker}
          onChange={(v) => { setMaker(v); setModel(''); setSmId(''); setVIdx(-1); setTrim(''); setPathOk(null); }}
          groups={makerGroups.filter((g) => g.makers.length).map((g) => ({
            label: `── ${g.origin} ──`,
            options: g.makers,
          }))}
        />
        <Select full placeholder="모델" value={model} disabled={!maker} onChange={(v) => { setModel(v); setSmId(''); setVIdx(-1); setTrim(''); setPathOk(null); }} options={models} />
        <Select full placeholder="세부모델" value={smId} disabled={!model} onChange={(v) => { setSmId(v); setVIdx(-1); setTrim(''); setPathOk(null); }} options={subs.map((s) => ({ value: s.id, label: `${s.sub_model}${s.year_start ? ` (${s.year_start}~${s.year_end})` : ''}` }))} />
        <Select full placeholder="파워트레인" value={vIdx < 0 ? '' : String(vIdx)} disabled={!sub} onChange={pickVariant}
          options={variants.map((v, i) => ({
            value: String(i),
            label: masterVariantOptionLabel(v, variants),
          }))} />
        <Select
          full
          placeholder={noTrimGrade ? '세부트림 없음' : '세부트림 · 미선택'}
          value={trim}
          disabled={!variant || noTrimGrade}
          onChange={emit}
          options={trims}
        />
      </div>
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: FS.micro, color: C.mute, marginBottom: 3 }}>추가표기 · 마스터 밖 자유입력 (런칭·휠·패키지 등)</div>
        {/* 같은 카드의 Select 5개가 기본(md)이라 여기만 sm이면 바닥선이 4px 어긋난다. */}
        <Input
          full
          placeholder={variant ? '예: 20인치+ECS 런칭' : '파워트레인 선택 후 입력'}
          value={extra}
          disabled={!variant}
          onChange={commitExtra}
        />
      </div>
      {/* 확정된 규격 요약. **제조사부터 쓴다** — 바로 아래 차종변환 줄이 제조사를 포함하는데
          여기만 세부모델부터 시작해서, 같은 패널 위아래로 표기가 갈려 보였다.
          제조사·모델은 위 드롭다운이 이미 확정한 값이라 값 자체는 중복이지만,
          "이 줄이 무슨 차를 가리키는지"가 줄 하나로 읽혀야 한다. */}
      {variant && (
        <div style={{ marginTop: 6, fontSize: FS.cap, color: C.mute }}>
          마스터 · {[makerDisplay(maker) || maker, sub?.sub_model].filter(Boolean).join(' ')} · {masterVariantLabel(variant)}
          {variant.drivetrain ? ` · ${variant.drivetrain}` : ''}
          {noTrimGrade ? ' · 세부트림 없음' : (trim ? ` · ${trim}` : ' · 세부트림 미선택')}
          {extra ? ` · +${extra}` : ''}
        </div>
      )}
    </div>
  );
}
