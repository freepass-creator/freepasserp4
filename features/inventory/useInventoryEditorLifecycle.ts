'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { getStore } from '@/lib/store';
import { ENTITIES, type EntityRecord } from '@/lib/intake/entities';
import { actor, getRole, type Role } from '@/lib/domain/deal';
import { newId } from '@/lib/domain/ids';
import { joinEventTags, vehicleName } from '@/lib/domain/product';
import { vehicleLockedBy, blockingContractFor } from '@/lib/domain/settlement-engine';
import { applyColors, snapColor } from '@/lib/domain/color-master';
import { confirmDialog, toast } from '@/components/Toaster';
import { haptic } from '@/lib/haptics';
import { NAV_LABEL } from '@/lib/tabbar';
import { deleteManagedFile } from '@/lib/firebase/storage-files';
import { buildSheetManualFieldList, isLegacySheetOwnedBlock } from '@/lib/domain/sheet-merge';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type EditorLifecycleOptions = {
  companyId: string;
  selectedCode: string | null;
  form: EntityRecord;
  rows: EntityRecord[] | null;
  creating: boolean;
  setSelectedCode: StateSetter<string | null>;
  setForm: StateSetter<EntityRecord>;
  setDirty: StateSetter<boolean>;
  setCreating: StateSetter<boolean>;
  setEditing: StateSetter<boolean>;
  reload: (role: Role) => Promise<EntityRecord[]>;
};

export function useInventoryEditorLifecycle({
  companyId,
  selectedCode,
  form,
  rows,
  creating,
  setSelectedCode,
  setForm,
  setDirty,
  setCreating,
  setEditing,
  reload,
}: EditorLifecycleOptions) {
  const [clipboard, setClipboard] = useState<EntityRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const clearSelection = () => {
    setSelectedCode(null);
    setForm({});
    setDirty(false);
    setCreating(false);
    setEditing(false);
  };

  const changeField = (key: string, value: string) => {
    if (key === 'ext_color' || key === 'int_color') {
      const kind = key === 'int_color' ? 'int' : 'ext';
      const raw = String(value || '').trim();
      const snapped = snapColor(raw, kind);
      const nextValue = snapped || (raw ? '기타' : '');
      setForm((current) => {
        const next: EntityRecord = { ...current, [key]: nextValue };
        if (raw && nextValue !== raw) {
          const rawKey = key === 'int_color' ? '_raw_int_color' : '_raw_ext_color';
          if (!next[rawKey]) next[rawKey] = raw;
          next._colors_snapped = true;
        }
        return next;
      });
      setDirty(true);
      return;
    }
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    if (saving) return;
    if (!String(form.product_code || '').trim()) {
      toast('상품코드는 필수입니다', 'error');
      return;
    }
    /**
     * ★**필수는 차량번호 · 모델명 둘뿐**(사장님 2026-08-23 「필수입력은 차량번호야 모델명인 거지」).
     *
     * ⚠ 전에는 `entities` 에 `required: true` 를 달아도 **여기서 안 봤다** — 화면에 빨간 별표만 뜨고
     *   빈 채로 그대로 저장됐다. 「필수」라고 적어 두고 안 막는 것은 안 적은 것보다 나쁘다(막힌 줄 알고 넘어간다).
     *   그래서 선언(`ENTITIES.product.fields[].required`)을 **여기가 강제**한다 — 필수를 늘리려면 선언만 고치면 된다.
     *
     * ⚠ 필수를 함부로 늘리지 마라. 막히면 사람이 아무 값이나 적어 넣는다 —
     *   빈칸은 «모른다»지만 아무 값이나는 «틀린 값»이고, 틀린 값은 손님에게 나간다.
     *   (2026-08-23 실측: 판매가능 474대 중 모델명·차번이 빈 차는 0대라 이 게이트가 기존 차를 막지 않는다)
     */
    const missing = ENTITIES.product.fields
      .filter((field) => field.required && !String(form[field.key] ?? '').trim())
      .map((field) => field.label);
    if (missing.length) {
      toast(`${missing.join(' · ')} 은(는) 필수입니다`, 'error');
      return;
    }
    setSaving(true);
    try {
      const role = getRole();
      if (role === 'admin' && !String(form.provider_company_code || '').trim()) {
        toast('공급사를 선택하세요 — 계약·채팅·정산 연결에 필요합니다', 'error');
        return;
      }
      if (role === 'provider') {
        const providerCode = actor('provider').code;
        if (!providerCode) {
          toast('공급사 코드가 없습니다 — 설정·로그인을 확인하세요', 'error');
          return;
        }
        const existing = await getStore().get('product', companyId, String(form.product_code));
        if (existing && String(existing.provider_company_code || '') !== providerCode) {
          toast('다른 공급사 상품은 수정할 수 없습니다', 'error');
          return;
        }
        if (String(form.provider_company_code || '') && String(form.provider_company_code) !== providerCode) {
          toast('공급사 코드를 변경할 수 없습니다', 'error');
          return;
        }
      }
      if (form.car_number) {
        const normalizedPlate = normalizePlate(form.car_number);
        const all = await getStore().list('product', companyId);
        const duplicate = all.find((product) => (
          product.car_number
          && normalizePlate(product.car_number) === normalizedPlate
          && String(product.product_code) !== String(form.product_code)
          && product._deleted !== true
        ));
        if (duplicate) {
          toast(`이미 등록된 차량번호 (공급사 ${duplicate.provider_company_code || '?'})`, 'error');
          return;
        }
      }

      const locked = await vehicleLockedBy(String(form.product_code));
      const stamped = role === 'provider'
        ? { ...form, provider_company_code: actor('provider').code }
        : form;
      const withPromotion: EntityRecord = {
        ...stamped,
        event_tags: joinEventTags(String(stamped.event_tags || '').split(/[,/#|]/)),
      };
      const colored = applyColors(withPromotion);
      if (colored !== withPromotion) setForm(colored);
      const previous = (rows ?? []).find((candidate) =>
        String(candidate.product_code) === String(form.product_code)
      );
      const statusChangedByUser = !locked.status
        && previous
        && String(previous.vehicle_status || '') !== String(colored.vehicle_status || '');
      const manualFieldCandidate = locked.status && previous
        ? { ...colored, vehicle_status: previous.vehicle_status }
        : colored;
      const sheetManualFields = previous
        ? buildSheetManualFieldList(previous, manualFieldCandidate)
        : [];
      const editableRecord = sheetManualFields.length
        ? { ...colored, _sheet_manual_fields: sheetManualFields }
        : colored;
      const patch = locked.status
        ? { ...editableRecord, vehicle_status: locked.status, locked_by_contract: locked.byContract }
        : statusChangedByUser
          ? {
              ...editableRecord,
              // 사람이 상태를 바꾼 순간부터 시트 자동차단 소유권은 끝난다. 이 표식이
              // 남으면 다음 시트 재등장에서 수기 보류까지 자동 해제될 수 있다.
              sheet_status_owner: null,
              sheet_block_reason: null,
              sheet_blocked_at: null,
              allow_sheet_reactivate: null,
              // sheet_status_owner 도입 전 표식도 사람의 상태 변경과 함께 소유권을 끝낸다.
              status_label: isLegacySheetOwnedBlock(previous) ? null : colored.status_label,
            }
          : editableRecord;
      try {
        await getStore().save('product', companyId, [patch]);
        await getStore().update('product', companyId, String(form.product_code), patch);
      } catch (error) {
        toast(`저장 실패: ${String((error as Error)?.message || error)}`, 'error');
        return;
      }
      const removedPhotos = photoUrls(previous?.photos).filter((url) =>
        !photoUrls(patch.photos).includes(url)
      );
      if (removedPhotos.length) {
        try {
          await Promise.all(removedPhotos.map(deleteManagedFile));
        } catch (error) {
          toast(`상품은 저장됐지만 제거한 사진 원본 정리 실패: ${String((error as Error)?.message || error)}`, 'error');
        }
      }
      setDirty(false);
      setCreating(false);
      setEditing(false);
      await reload(getRole());
      if (locked.status && form.vehicle_status !== locked.status) {
        setForm((current) => ({ ...current, vehicle_status: locked.status }));
        toast(locked.status === '계약중'
          ? '계약금이 확인된 계약이 있어 차량상태는 계약중으로 유지됩니다'
          : '완료 계약이 있어 차량상태는 출고불가로 유지됩니다', 'info');
      } else {
        toast('저장되었습니다', 'ok');
      }
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    const row = (rows ?? []).find((candidate) => String(candidate.product_code) === selectedCode);
    const original = new Set(photoUrls(row?.photos));
    const unsavedUploads = photoUrls(form.photos).filter((url) => !original.has(url));
    if (unsavedUploads.length) {
      void Promise.all(unsavedUploads.map((url) => deleteManagedFile(url).catch(() => undefined)));
    }
    if (creating) {
      clearSelection();
      return;
    }
    if (row) {
      setForm({ ...row });
      setDirty(false);
      setEditing(false);
    } else {
      clearSelection();
    }
  };

  const startEdit = () => {
    setEditing(true);
    haptic.tap();
  };

  const remove = async () => {
    if (!selectedCode || !form.product_code) return;
    const role = getRole();
    if (role === 'provider') {
      const providerCode = actor('provider').code;
      if (String(form.provider_company_code || '') !== providerCode) {
        toast('다른 공급사 상품은 삭제할 수 없습니다', 'error');
        return;
      }
    }
    const blocking = await blockingContractFor(String(form.product_code));
    if (blocking) {
      toast(`진행 중인 계약(${blocking})이 있는 상품은 삭제할 수 없습니다`, 'error');
      return;
    }
    if (!await confirmDialog({
      title: '상품 삭제',
      message: `상품 ${form.car_number || vehicleName(form) || '선택 항목'}을(를) 삭제할까요?\n휴지통에서 복구할 수 있습니다.`,
      danger: true,
      okLabel: '삭제',
    })) return;
    try {
      await getStore().remove('product', companyId, String(form.product_code), `${NAV_LABEL.inventory} 삭제`);
    } catch (error) {
      toast(`삭제 실패: ${String((error as Error)?.message || error)}`, 'error');
      return;
    }
    clearSelection();
    await reload(role);
    haptic.impact();
    toast('상품이 삭제되었습니다', 'ok');
  };

  const resetForm = () => {
    setForm((current) => {
      const keep: EntityRecord = {
        product_code: current.product_code,
        car_number: current.car_number,
        provider_company_code: current.provider_company_code,
        vehicle_status: current.vehicle_status || '상품화중',
        product_type: current.product_type || '중고렌트',
      };
      const metadata = new Set(['companyId', 'createdAt', 'createdBy', 'updatedAt', 'deletedAt']);
      const cleared: EntityRecord = {};
      for (const key of Object.keys(current)) {
        if (!(key in keep) && !key.startsWith('_') && !metadata.has(key)) cleared[key] = '';
      }
      return { ...current, ...cleared, ...keep };
    });
    setDirty(true);
  };

  const copyForm = () => {
    const { car_number, vin, product_code, photos, image_urls, ...copyable } = form;
    void car_number;
    void vin;
    void product_code;
    void photos;
    void image_urls;
    setClipboard(copyable);
  };

  const pasteForm = () => {
    if (!clipboard) return;
    setForm((current) => applyColors({ ...current, ...clipboard }));
    setDirty(true);
  };

  const createProduct = () => {
    const code = newId('product');
    setSelectedCode(code);
    setForm({
      product_code: code,
      vehicle_status: '상품화중',
      product_type: '중고렌트',
      provider_company_code: getRole() === 'provider' ? actor('provider').code : '',
    });
    setDirty(true);
    setCreating(true);
    setEditing(true);
  };

  return {
    clipboardAvailable: !!clipboard,
    saving,
    clearSelection,
    changeField,
    save,
    cancelEdit,
    startEdit,
    remove,
    resetForm,
    copyForm,
    pasteForm,
    createProduct,
  };
}

function normalizePlate(value: unknown) {
  return String(value ?? '').replace(/\s/g, '');
}

function photoUrls(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
