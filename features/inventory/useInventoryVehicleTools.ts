'use client';

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getStore, patchListCache } from '@/lib/store';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  applySnap, resolveExactMasterPath, snapToMaster, SNAP_TRACK_KEYS, type MasterEntry,
} from '@/lib/domain/vehicle-master-match';
import { applyColors } from '@/lib/domain/color-master';
import { toast } from '@/components/Toaster';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type VehicleToolsOptions = {
  companyId: string;
  form: EntityRecord;
  setSelectedCode: StateSetter<string | null>;
  setForm: StateSetter<EntityRecord>;
  setRows: StateSetter<EntityRecord[] | null>;
  setDirty: StateSetter<boolean>;
  setCreating: StateSetter<boolean>;
  setEditing: StateSetter<boolean>;
};

export function useInventoryVehicleTools({
  companyId,
  form,
  setSelectedCode,
  setForm,
  setRows,
  setDirty,
  setCreating,
  setEditing,
}: VehicleToolsOptions) {
  const [ocrBusy, setOcrBusy] = useState(false);
  const [master, setMaster] = useState<MasterEntry[] | null>(null);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);
  const selectionGeneration = useRef(0);

  const loadMaster = useCallback(async (): Promise<MasterEntry[]> => {
    if (master?.length) return master;
    const { loadVehicleMaster } = await import('@/lib/domain/vehicle-master-load');
    const entries = await loadVehicleMaster();
    setMaster(entries);
    return entries;
  }, [master]);

  const selectProduct = async (product: EntityRecord) => {
    const code = String(product.product_code);
    const generation = ++selectionGeneration.current;
    setSelectedCode(code);
    setForm({ ...product });
    setDirty(false);
    setCreating(false);
    setEditing(false);
    try {
      const entries = await loadMaster();
      if (generation !== selectionGeneration.current) return;

      const persistColors = async (source: EntityRecord): Promise<EntityRecord> => {
        const colored = applyColors(source);
        const colorChanged = String(source.ext_color ?? '') !== String(colored.ext_color ?? '')
          || String(source.int_color ?? '') !== String(colored.int_color ?? '');
        if (!colorChanged) return colored;
        setForm(colored);
        const colorPatch: EntityRecord = {
          ext_color: colored.ext_color,
          int_color: colored.int_color,
          _raw_ext_color: colored._raw_ext_color,
          _raw_int_color: colored._raw_int_color,
          _colors_snapped: colored._colors_snapped,
        };
        try {
          await getStore().update('product', companyId, code, colorPatch);
        } catch (error) {
          console.warn('[inventory] 색상 자동저장 거부:', error);
          toast(`상품 자동보정 저장 실패: ${String((error as Error)?.message || error)}`, 'error');
          return colored;
        }
        if (generation !== selectionGeneration.current) return colored;
        const mergedColor = { ...source, ...colorPatch };
        patchListCache('product', companyId, code, mergedColor);
        setRows((previous) => (previous || []).map((row) => (
          String(row.product_code) === code ? { ...row, ...colorPatch } : row
        )));
        setForm(mergedColor);
        return mergedColor;
      };

      if (resolveExactMasterPath(entries, product)) {
        await persistColors(product);
        return;
      }
      const result = snapToMaster(product, entries);
      if (!result) {
        await persistColors(product);
        return;
      }
      const applied = applyColors(applySnap(product, result, { source: 'select' }));
      if (generation !== selectionGeneration.current) return;
      const exact = resolveExactMasterPath(entries, applied);
      setForm(applied);
      if (!exact || (result.confidence !== 'high' && result.confidence !== 'medium')) {
        if (result.confidence === 'low') setDirty(true);
        return;
      }
      const trackChanged = SNAP_TRACK_KEYS.some(
        (key) => String(product[key] ?? '').trim() !== String(applied[key] ?? '').trim(),
      );
      const colorChanged = String(product.ext_color ?? '') !== String(applied.ext_color ?? '')
        || String(product.int_color ?? '') !== String(applied.int_color ?? '');
      const needsWrite = trackChanged || colorChanged || !product._snapped
        || product._snap_confidence !== result.confidence
        || (!!product._needs_master_review !== !!applied._needs_master_review);
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
      try {
        await getStore().update('product', companyId, code, patch);
      } catch (error) {
        console.warn('[inventory] 마스터스냅 자동저장 거부:', error);
        toast(`상품 자동보정 저장 실패: ${String((error as Error)?.message || error)}`, 'error');
        return;
      }
      if (generation !== selectionGeneration.current) return;
      const mergedSnap = { ...product, ...patch };
      patchListCache('product', companyId, code, mergedSnap);
      setRows((previous) => (previous || []).map((row) => (
        String(row.product_code) === code ? { ...row, ...patch } : row
      )));
      setForm(mergedSnap);
      setDirty(false);
    } catch {
      // 마스터 로드 실패 시 원본 폼 유지
    }
  };

  const normalizeVehicle = async () => {
    try {
      const entries = await loadMaster();
      const result = snapToMaster(form, entries);
      if (!result) {
        toast('매칭되는 차종을 찾지 못했습니다', 'error');
        return;
      }
      setForm((current) => applyColors(applySnap(current, result, { source: 'manual' })));
      setDirty(true);
      const span = result.year_start ? ` [${result.year_start}~${result.year_end}]` : '';
      toast(`차종 정규화: ${result.maker} ${result.sub_model}${span} (${result.confidence})`, result.confidence === 'low' ? 'info' : 'ok');
    } catch {
      toast('차종마스터 로드 실패', 'error');
    }
  };

  const applyMasterPick = (value: Parameters<typeof applyPickerValue>[1]) => {
    setForm((current) => applyPickerValue(current, value));
    setDirty(true);
  };

  const runOcr = async (files: FileList | null) => {
    if (!files || !files.length || ocrBusy) return;
    setOcrBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(files[0]);
      });
      const response = await fetch('/api/ocr/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        toast('OCR 실패: ' + (data.error || response.status), 'error');
        return;
      }
      const fields: Record<string, string> = data.fields || {};
      const keys = Object.keys(fields);
      setForm((previous) => {
        const next = { ...previous };
        for (const key of keys) if (!String(next[key] ?? '').trim()) next[key] = fields[key];
        next._ocr_registration = data.text || '';
        return applyColors(next);
      });
      setDirty(true);
      toast(keys.length ? `OCR 완료 — 빈 칸 자동채움: ${keys.join(', ')}` : 'OCR 완료 — 인식 항목 없음. 선명한 사진으로 다시', keys.length ? 'ok' : 'info');
    } catch (error) {
      toast('OCR 오류: ' + String(error), 'error');
    } finally {
      setOcrBusy(false);
      if (ocrInputRef.current) ocrInputRef.current.value = '';
    }
  };

  return { loadMaster, selectProduct, normalizeVehicle, applyMasterPick, runOcr, ocrBusy, ocrInputRef };
}

type PickerValue = {
  maker: string;
  model: string;
  sub_model: string;
  catalog_id: string;
  gen_year_start?: string;
  gen_year_end?: string;
  variant?: string;
  trim_name?: string;
  trim_extra?: string;
  fuel_type?: string;
  engine_cc?: string;
  seats?: string;
  drive_type?: string;
};

function applyPickerValue(current: EntityRecord, value: PickerValue): EntityRecord {
  const next = applySnap(current, {
    maker: value.maker,
    model: value.model,
    sub_model: value.sub_model,
    gen_code: value.catalog_id,
    year_start: value.gen_year_start,
    year_end: value.gen_year_end,
    variant: value.variant || undefined,
    trim_name: value.trim_name || '',
    fuel_type: value.fuel_type || undefined,
    engine_cc: value.engine_cc || undefined,
    seats: value.seats || undefined,
    drive_type: value.drive_type || undefined,
    confidence: 'high',
  }, { source: 'picker' });
  return { ...next, trim_extra: value.trim_extra ?? '' };
}
