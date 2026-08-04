'use client';

import type { ComponentProps, RefObject } from 'react';
import { ENTITIES, type EntityRecord, type Field } from '@/lib/intake/entities';
import {
  PaneHead, PaneBody, Btn, ButtonLabel, FormGrid, FormReadList, FormCard, C, R, CenterNote, Dropzone,
  SectionLabel, Select, Message, FW, FS, THUMB_W, ICON, ListGroup, DetailRow,
} from '@/components/ui';
import { VehicleMasterPicker } from '@/components/VehicleMasterPicker';
import { SnapTrace } from '@/components/SnapTrace';
import { PhotoUpload } from '@/components/PhotoUpload';
import { PriceMatrix } from '@/components/PriceMatrix';
import { ClipboardPaste, Copy, RotateCcw, ScanLine } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';

type MasterPick = Parameters<NonNullable<ComponentProps<typeof VehicleMasterPicker>['onPick']>>[0];
type Price = ComponentProps<typeof PriceMatrix>['price'];
type Photos = ComponentProps<typeof PhotoUpload>['photos'];

export type InventoryEditorModel = {
  selected: boolean;
  selectedCode: string | null;
  form: EntityRecord;
  creating: boolean;
  editing: boolean;
  dirty: boolean;
  clipboardAvailable: boolean;
  ocrBusy: boolean;
  ocrInputRef: RefObject<HTMLInputElement>;
  policies: EntityRecord[];
  partners: EntityRecord[];
  supplierPhotos: string[];
  isAdmin: boolean;
  onReset: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onOcrFiles: (files: FileList | null) => void;
  onMasterPick: (value: MasterPick) => void;
  onRematch: () => void;
  onFieldChange: (key: string, value: string) => void;
  onPriceChange: (price: Price) => void;
  onPhotosChange: (photos: Photos) => void;
  onInteriorChange: (url: string | null) => void;
};

function editorHelpers(model: InventoryEditorModel, readAsRows = false) {
  const byKey = Object.fromEntries(ENTITIES.product.fields.map((field) => [field.key, field]));
  const group = (keys: string[]): Field[] => keys.map((key) => byKey[key]).filter(Boolean) as Field[];
  const canEdit = model.creating || model.editing;
  const fields = (keys: string[], cols = 2) => (
    <FormGrid fields={group(keys)} form={model.form} onChange={model.onFieldChange} cols={cols} disabled={!canEdit} />
  );
  const section = (title: string, keys: string[], cols = 2, hint?: string) => (
    readAsRows
      ? <FormReadList header={title} footer={hint} fields={group(keys)} form={model.form} />
      : <FormCard title={title} hint={hint}>{fields(keys, cols)}</FormCard>
  );
  return { canEdit, group, fields, section };
}

const EMPTY_NOTE = '상품을 고르거나 · 상품등록을 누르세요.';

export function InventoryFixedPane({ model }: { model: InventoryEditorModel }) {
  const { form } = model;
  const mobile = useIsMobile();
  const readAsRows = mobile && !(model.creating || model.editing);
  const { canEdit, group, section } = editorHelpers(model, readAsRows);
  const modeBanner = model.creating ? (
    <Message variant="info">신규 상품 등록 — 등록증(사진·파일) 올리기 또는 차종 마스터부터 입력하세요.</Message>
  ) : model.editing ? (
    <Message variant="warning">수정 중 · 저장해야 반영됩니다</Message>
  ) : null;

  return (
    <>
      <PaneHead title="기본정보" />
      <PaneBody pad>
        {model.selected ? <>
          {modeBanner}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: FS.cap, color: C.faint, minHeight: 18 }}>
            {form.provider_company_code ? <span>{String(form.provider_company_code)}</span> : null}
            <span style={{ flex: 1 }} />
            {canEdit && model.dirty ? <span style={{ color: C.warn }}>● 미저장</span> : null}
          </div>
          {canEdit ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
              <Btn title="입력 초기화" variant="ghost" size="sm" onClick={model.onReset}>
                <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>초기화</ButtonLabel>
              </Btn>
              {!model.creating && (
                <Btn title="상품 복사" variant="ghost" size="sm" onClick={model.onCopy}>
                  <ButtonLabel icon={<Copy size={ICON.md} aria-hidden />}>복사</ButtonLabel>
                </Btn>
              )}
              <Btn title="상품 붙여넣기" variant="ghost" size="sm" onClick={model.onPaste} disabled={!model.clipboardAvailable}>
                <ButtonLabel icon={<ClipboardPaste size={ICON.md} aria-hidden />}>붙여넣기</ButtonLabel>
              </Btn>
            </div>
          ) : null}
          {canEdit ? <div style={{
            border: `1px solid ${C.line}`, borderRadius: R, background: C.selected, padding: '10px 12px',
            opacity: canEdit ? 1 : 0.75, pointerEvents: canEdit ? undefined : 'none',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <SectionLabel mt={0} mb={0}>자동차등록증</SectionLabel>
            <div style={{ fontSize: FS.micro, color: C.faint, lineHeight: 1.4 }}>사진·PDF · 빈 칸 자동채움</div>
            <input ref={model.ocrInputRef} type="file" accept="image/*,application/pdf,.pdf" onChange={(e) => model.onOcrFiles(e.target.files)} style={{ display: 'none' }} />
            <Dropzone
              variant="file"
              disabled={model.ocrBusy || !canEdit}
              onClick={() => model.ocrInputRef.current?.click()}
              title={model.ocrBusy ? '등록증 인식 중' : '등록증 올리기'}
              style={{ padding: '12px 10px', width: '100%' }}
            >
              <ScanLine size={16} color={C.brand} aria-hidden />
              <span style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.brand }}>
                {model.ocrBusy ? '인식 중…' : '등록증 올리기'}
              </span>
            </Dropzone>
          </div> : null}
          {readAsRows ? (
            <FormReadList
              header="차종 마스터"
              fields={group(['maker', 'model', 'sub_model', 'variant', 'trim_name', 'trim_extra'])}
              form={form}
            />
          ) : <div style={{ pointerEvents: canEdit ? undefined : 'none', opacity: canEdit ? 1 : 0.85 }}>
            <SectionLabel mt={0}>차종 마스터</SectionLabel>
            <VehicleMasterPicker
              key={model.selectedCode || 'none'}
              value={{
                maker: String(form.maker || ''), model: String(form.model || ''),
                sub_model: String(form.sub_model || ''), catalog_id: String(form.catalog_id || ''),
                variant: String(form.variant || ''), trim_name: String(form.trim_name || ''),
                trim_extra: String(form.trim_extra || ''),
              }}
              onPick={model.onMasterPick}
            />
          </div>}
          {(form.gen_year_start || form._snap_confidence) ? (
            <div style={{ fontSize: FS.cap, color: C.mute, marginTop: -4 }}>
              {form.gen_year_start ? `생산 ${form.gen_year_start}~${form.gen_year_end}` : ''}
              {form._snap_confidence ? `${form.gen_year_start ? ' · ' : ''}매칭 ${form._snap_confidence}` : ''}
            </div>
          ) : null}
          {!model.creating && (
            <SnapTrace
              form={form}
              onRematch={canEdit && (form._needs_master_review || form._snap_confidence === 'low' || !form._snapped) ? model.onRematch : undefined}
            />
          )}
          {section('선택옵션', ['options'], 1, '구분 = , 또는 /')}
          {section('신원', ['car_number', 'vehicle_class'], 2, '차량번호는 필수 · 차종분류=세그먼트[ 차형]')}
          {model.isAdmin && readAsRows ? (
            <ListGroup header="공급사" footer="계약·채팅·정산의 공급사 권한 범위">
              <DetailRow
                label="공급사"
                value={(() => {
                  const code = String(form.provider_company_code || '');
                  const partner = model.partners.find((item) => String(item.partner_code || item._key || '') === code);
                  return partner ? `${String(partner.name || partner.company_name || partner.partner_name || code)} (${code})` : code;
                })()}
              />
            </ListGroup>
          ) : model.isAdmin ? (
            <FormCard title="공급사" hint="계약·채팅·정산의 공급사 권한 범위를 결정합니다.">
              <label style={{ fontSize: FS.cap, color: C.mute }}>공급사 *
                <div style={{ marginTop: 3 }}>
                  <Select
                    value={String(form.provider_company_code || '')}
                    onChange={(value) => model.onFieldChange('provider_company_code', value)}
                    placeholder="— 공급사 선택 —"
                    full
                    disabled={!canEdit}
                    options={model.partners
                      // 레거시 공급사 파트너는 partner_type이 비어 있는 경우가 있다.
                      // 영업채널로 명시된 파트너만 제외하고 관리자에게 배정 후보로 제공한다.
                      .filter((partner) => String(partner.partner_type || '') !== '영업채널')
                      .map((partner) => ({
                        value: String(partner.partner_code || partner._key || ''),
                        label: `${String(partner.name || partner.company_name || partner.partner_name || partner.partner_code || '공급사')} (${String(partner.partner_code || partner._key || '')})`,
                      }))
                      .filter((option) => option.value)}
                  />
                </div>
              </label>
            </FormCard>
          ) : null}
          {section('제원 · 스펙', ['year', 'fuel_type', 'engine_cc', 'seats', 'drive_type', 'transmission', 'usage', 'ext_color', 'int_color', 'first_registration_date'], 2)}
          {model.isAdmin && section('원가 · 이력 · 등록증', ['vehicle_price', 'location', 'vin', 'vehicle_age_expiry_date', 'cert_car_name', 'type_number', 'engine_type', 'partner_memo'])}
        </> : <CenterNote>{EMPTY_NOTE}</CenterNote>}
      </PaneBody>
    </>
  );
}

export function InventoryVariablePane({ model }: { model: InventoryEditorModel }) {
  const { form } = model;
  const mobile = useIsMobile();
  const readAsRows = mobile && !(model.creating || model.editing);
  const { canEdit, group, fields, section } = editorHelpers(model, readAsRows);
  const providerCode = String(form.provider_company_code || '');
  const policyField: Field = {
    key: 'policy_code',
    label: '정책 연결',
    type: 'select',
    manual: true,
  };
  const policyOptions = model.policies.filter((policy) => {
    const policyProviderCode = String(policy.provider_company_code || '');
    return !providerCode || !policyProviderCode || policyProviderCode === providerCode;
  }).map((policy) => ({
    value: String(policy.policy_code),
    label: `${String(policy.policy_name || policy.policy_code)}${policy.provider_company_code ? '' : ' · 공용'} (${String(policy.policy_code)})`,
  }));
  return (
    <>
      <PaneHead title="운영정보" />
      <PaneBody pad>
        {model.selected ? <>
          {readAsRows ? (
            <FormReadList
              header="상태 · 구분 · 정책"
              footer="상품 운영 상태와 연결 정책"
              fields={[...group(['vehicle_status', 'product_type', 'deposit_free']), policyField, ...group(['event_tags'])]}
              form={model.form}
              selectOptions={{ policy_code: policyOptions }}
            />
          ) : <FormCard title="상태 · 구분 · 정책" hint="상품 운영 상태와 연결 정책">
            <FormGrid
              fields={[...group(['vehicle_status', 'product_type', 'deposit_free']), policyField]}
              form={model.form}
              onChange={model.onFieldChange}
              cols={1}
              disabled={!canEdit}
              selectOptions={{ policy_code: policyOptions }}
            />
            <div style={{ marginTop: 10 }}>{fields(['event_tags'], 1)}</div>
          </FormCard>}
          {section('주행 · 사고', ['mileage', 'accident_history'])}
          <div>
            <SectionLabel mt={0}>대여료 · 보증금</SectionLabel>
            <div style={{ fontSize: FS.cap, color: C.faint, margin: '-2px 0 8px', lineHeight: 1.4 }}>넣은 기간만 상품에 노출</div>
            <PriceMatrix price={form.price} onChange={model.onPriceChange} readOnly={!canEdit} />
          </div>
          <div>
            <SectionLabel mt={0}>사진</SectionLabel>
            <div style={{ fontSize: FS.cap, color: C.faint, margin: '-2px 0 8px', lineHeight: 1.4 }}>
              {canEdit ? '탭=크게 · 꾹=대표/실내/삭제' : '탭하면 크게 볼 수 있습니다'}
            </div>
            <PhotoUpload hideTitle productCode={String(form.product_code || model.selectedCode || '')} photos={form.photos} interiorUrl={String(form.interior_photo || '')}
              onChange={model.onPhotosChange} onInteriorChange={model.onInteriorChange} readOnly={!canEdit} />
          </div>
          {model.supplierPhotos.length > 0 && (
            <div>
              <SectionLabel mt={0}>공급사 사진 <span style={{ fontSize: FS.cap, fontWeight: FW.body, color: C.faint }}>· 연동(읽기전용) {model.supplierPhotos.length}장</span></SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_W}px, 1fr))`, gap: 6 }}>
                {model.supplierPhotos.map((url, index) => (
                  <a key={index} href={url} target="_blank" rel="noreferrer" style={{ display: 'block', aspectRatio: '4 / 3', borderRadius: R, overflow: 'hidden', background: C.placeholder, border: `1px solid ${C.line}` }}>
                    <img src={url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </> : <CenterNote>{EMPTY_NOTE}</CenterNote>}
      </PaneBody>
    </>
  );
}
