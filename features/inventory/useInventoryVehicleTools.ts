'use client';

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { mapOcrToEntity, type EntityRecord } from '@/lib/intake/entities';
import {
  applySnap, resolveExactMasterPath, snapToMaster, type MasterEntry,
} from '@/lib/domain/vehicle-master-match';
import { applyColors } from '@/lib/domain/color-master';
import { toast } from '@/components/Toaster';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type VehicleToolsOptions = {
  form: EntityRecord;
  selectedCode: string | null;
  setSelectedCode: StateSetter<string | null>;
  setForm: StateSetter<EntityRecord>;
  setDirty: StateSetter<boolean>;
  setCreating: StateSetter<boolean>;
  setEditing: StateSetter<boolean>;
};

export function useInventoryVehicleTools({
  form,
  selectedCode,
  setSelectedCode,
  setForm,
  setDirty,
  setCreating,
  setEditing,
}: VehicleToolsOptions) {
  const [ocrBusy, setOcrBusy] = useState(false);
  const [master, setMaster] = useState<MasterEntry[] | null>(null);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);
  const selectionGeneration = useRef(0);
  const selectedCodeRef = useRef<string | null>(selectedCode);
  selectedCodeRef.current = selectedCode;

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
    selectedCodeRef.current = code;
    setSelectedCode(code);
    setForm({ ...product });
    setDirty(false);
    setCreating(false);
    setEditing(false);
    try {
      const entries = await loadMaster();
      if (generation !== selectionGeneration.current || selectedCodeRef.current !== code) return;

      // 목록 조회·행 선택은 반드시 read-only다. 정규화 결과는 화면에만 미리
      // 보여주고, 실제 저장은 사용자가 수정 모드에서 저장할 때만 수행한다.
      const colored = applyColors(product);
      const result = resolveExactMasterPath(entries, product) ? null : snapToMaster(product, entries);
      const preview = result
        ? applyColors(applySnap(product, result, { source: 'select' }))
        : colored;
      if (generation !== selectionGeneration.current || selectedCodeRef.current !== code) return;
      setForm(preview);
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
      const fields = mapOcrToEntity('product', data.fields || {});
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
