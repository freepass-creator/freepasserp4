'use client';

import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { mapOcrToEntity, type EntityRecord } from '@/lib/intake/entities';
import { applyColors } from '@/lib/domain/color-master';
import { toast } from '@/components/Toaster';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type VehicleToolsOptions = {
  setSelectedCode: StateSetter<string | null>;
  setForm: StateSetter<EntityRecord>;
  setDirty: StateSetter<boolean>;
  setCreating: StateSetter<boolean>;
  setEditing: StateSetter<boolean>;
};

export function useInventoryVehicleTools({
  setSelectedCode,
  setForm,
  setDirty,
  setCreating,
  setEditing,
}: VehicleToolsOptions) {
  const [ocrBusy, setOcrBusy] = useState(false);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);

  const selectProduct = (product: EntityRecord) => {
    setSelectedCode(String(product.product_code));
    setForm({ ...product });
    setDirty(false);
    setCreating(false);
    setEditing(false);
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

  return { selectProduct, runOcr, ocrBusy, ocrInputRef };
}
