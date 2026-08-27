'use client';

import type { ComponentProps, RefObject } from 'react';
import { ENTITIES, type EntityRecord, type Field } from '@/lib/intake/entities';
import { catalogOptions, type VehicleCatalog } from '@/lib/domain/vehicle-catalog';
import {
  PaneHead, PaneBody, Btn, ButtonLabel, FormCard, WorkFields, WorkModeBanner, workMode,
  CenterNote, Dropzone, Badge, FW, FS, THUMB_W, ICON, C, R,
} from '@/components/ui';
import { PhotoUpload } from '@/components/PhotoUpload';
import { PriceMatrix } from '@/components/PriceMatrix';
import { ClipboardPaste, Copy, RotateCcw, ScanLine } from 'lucide-react';

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
  /** 차종사전(신규마스터) — 차명 축의 선택지. 못 읽었으면 빈 사전이고, 그때도 손입력은 그대로 된다. */
  catalog: VehicleCatalog;
  onReset: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onOcrFiles: (files: FileList | null) => void;
  /* onMasterPick·onRematch 는 뺐다(2026-08-22) — 차종마스터 선택기·재매칭 UI 를 걷어내면서 부를 곳이 없어졌다. */
  onFieldChange: (key: string, value: string) => void;
  onPriceChange: (price: Price) => void;
  onPhotosChange: (photos: Photos) => void;
  onInteriorChange: (url: string | null) => void;
};

const INV_ACCENT: Record<string, 'main' | 'sub' | 'trace'> = {
  '차량정보': 'main',
  '차량번호': 'main',
  '상태 · 구분 · 정책': 'main',
  '공급사': 'sub',
  '부가 제원': 'sub',
  '공급사 원문 (2중 보관)': 'trace',
  '원가 · 이력 · 등록증': 'trace',
};

function editorHelpers(model: InventoryEditorModel) {
  const byKey = Object.fromEntries(ENTITIES.product.fields.map((field) => [field.key, field]));
  const group = (keys: string[]): Field[] => keys.map((key) => byKey[key]).filter(Boolean) as Field[];
  const mode = workMode(model.creating, model.editing);
  /**
   * ★**차종사전(신규마스터)이 차명 축의 선택지를 준다**(사장님 2026-08-23
   *   「기존 재고관리 상품등록은 신규마스터를 반영해서 입력값을 만든다」).
   *   앞 축이 정해질수록 뒤 축이 좁아진다 — 제조사를 고르면 그 제조사의 모델만, 모델을 고르면 그 세부모델만.
   *   ⚠ 닫힌 목록이 아니다. 사전에 없는 이름도 그대로 칠 수 있다(`catalog` 칸 = 입력창 + 추천목록).
   */
  const picked = {
    maker: String(model.form.maker ?? '').trim(),
    model: String(model.form.model ?? '').trim(),
    sub_model: String(model.form.sub_model ?? '').trim(),
  };
  const catalogOpts: Record<string, string[]> = {};
  for (const field of ENTITIES.product.fields) {
    if (field.type !== 'catalog' || !field.catalogAxis) continue;
    catalogOpts[field.key] = catalogOptions(model.catalog, field.catalogAxis, picked);
  }
  const section = (title: string, keys: string[], cols = 2, hint?: string) => {
    const accent = INV_ACCENT[title] || 'sub';
    return (
      <WorkFields
        mode={mode}
        title={title}
        hint={hint}
        fields={group(keys)}
        form={model.form}
        onChange={model.onFieldChange}
        cols={cols}
        selectOptions={catalogOpts}
        accent={accent}
      />
    );
  };
  return { mode, group, catalogOpts, section };
}

const EMPTY_NOTE = '상품을 고르거나 · 상품등록을 누르세요.';

export function InventoryFixedPane({ model }: { model: InventoryEditorModel }) {
  const { form } = model;
  const { mode, section } = editorHelpers(model);
  const canEdit = mode !== 'view';

  return (
    <>
      <PaneHead
        title="기본 정보"
        count={model.creating ? '신규 입력' : model.editing ? '수정 중' : model.selected ? '조회' : undefined}
        right={canEdit && model.dirty ? <Badge tone="amber">미저장</Badge> : undefined}
      />
      <PaneBody pad>
        {model.selected ? <>
          {mode !== 'view' ? (
            <WorkModeBanner
              mode={mode}
              create="신규 상품 등록 — 등록증(사진·파일) 올리기 또는 차종·차명부터 입력하세요."
            />
          ) : null}
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
          {canEdit ? <FormCard title="자동차등록증" hint="사진·PDF · 빈 칸 자동채움">
            <div style={{ display: 'grid', gap: 8 }}>
            <input ref={model.ocrInputRef} type="file" accept="image/*,application/pdf,.pdf" onChange={(e) => model.onOcrFiles(e.target.files)} style={{ display: 'none' }} />
            <Dropzone
              variant="file"
              disabled={model.ocrBusy || !canEdit}
              onClick={() => model.ocrInputRef.current?.click()}
              title={model.ocrBusy ? '등록증 인식 중' : '등록증 올리기'}
            >
              <ScanLine size={ICON.md} color={C.brand} aria-hidden />
              <span style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.brand }}>
                {model.ocrBusy ? '인식 중…' : '등록증 올리기'}
              </span>
            </Dropzone>
            </div>
          </FormCard> : null}
          {/*
            **차명 축의 선택지는 «차종사전(신규마스터)»이 준다**(사장님 2026-08-23
              「차종마스터 관련 싹 다 걷어내고 정제칸을 정확히 반영한다 · 기존 재고관리 상품등록은 신규마스터를 반영해서 입력값을 만든다」).

            옛 차종마스터(public/data/vehicle-master.json 1.7MB)는 **따로 관리하는 대장**이라 시트와 갈렸다 —
            트림을 못 찾으면 빈칸으로 만들었고, 이름엔 개발 코드가 박혀 있었고(「디 올 뉴 싼타페 MX5」),
            한 번 확정된 값은 시트가 못 덮었다. 그래서 2026-08-22 참조를 끊고 여기를 자유 텍스트로 뒀는데,
            그러니 이번엔 **손으로 넣은 차와 시트에서 온 차의 이름이 갈렸다.**

            지금 사전(vehicle-catalog.json)은 **공급사 정제칸에 실제로 적혀 있는 조합**에서 파생한다.
            따로 관리할 대장이 없으니 어긋날 대상이 없다. 정제칸을 고치면 사전이 따라오고, 반대 방향은 없다.
            ⚠ 닫힌 목록이 아니다 — 사전에 없는 이름도 그대로 칠 수 있다(새 차는 언제나 목록 밖에서 온다).
          */}
          {/*
            ★**판매시트와 같은 차례**(사장님 2026-08-22 「재고관리도 모델 세부모델 세부트림으로 정리하고 거기에 연식 배기량 이런 거
              넣을 수 있게 · 시트랑 ERP랑 일치시키면 되거든」).
            공급사 정제칸 = 판매시트 = ERP 가 같은 축·같은 차례로 서야 «어디를 고치면 되나»가 헷갈리지 않는다.
            ⚠ 파워트레인(variant)·추가표기(trim_extra)는 뺐다 — 파워트레인은 폐지(연료·배기량이 그 자리),
              추가표기는 실측 0대이고 정제칸에도 없다.
          */}
          {/* 차례·구성은 판매시트와 같다. 선택옵션은 세부트림 다음 한 줄(섹션 아님) — 항목은 칩. */}
          {section('차량정보', ['maker', 'model', 'sub_model', 'trim_name', 'options', 'ext_color', 'int_color', 'year', 'mileage', 'fuel_type', 'engine_cc', 'battery_capacity', 'vehicle_class', 'origin', 'drive_type', 'seats'], 2,
            '공급사 정제시트·판매시트와 같은 차례 — 여기 값이 곧 ERP 값이다')}
          {/*
            ★**공급사 원문 두 칸 — 「2중 보관」**(사장님 2026-08-23 「차명이랑 옵션 공급사가 기본으로 입력한 칸은
              별도로 수집해서 보관한다 2중 보관이지」).
            위 칸들은 정제값이라 «우리가 어떻게 바꿔 읽었나»이고, 여기는 «공급사가 뭐라고 적었나»다.
            정제가 틀렸을 때 되짚을 유일한 근거이므로 손대지 않는다.
          */}
          {section('공급사 원문 (2중 보관)', ['supplier_vehicle_name', 'supplier_options'], 1,
            '공급사가 적은 그대로 — 고치지 마세요. 정제가 틀렸을 때 대조하는 자리입니다')}
          {section('차량번호', ['car_number'], 2, '차량번호는 필수')}
          {model.isAdmin ? (() => {
            const providerOptions = model.partners
              .filter((partner) => String(partner.partner_type || '') !== '영업채널')
              .map((partner) => ({
                value: String(partner.partner_code || partner._key || ''),
                label: `${String(partner.name || partner.company_name || partner.partner_name || partner.partner_code || '공급사')} (${String(partner.partner_code || partner._key || '')})`,
              }))
              .filter((option) => option.value);
            const providerField: Field = { key: 'provider_company_code', label: '공급사', type: 'select', required: true };
            return (
              <WorkFields
                mode={mode}
                title="공급사"
                hint="계약·채팅·정산의 공급사 권한 범위를 결정합니다."
                accent="sub"
                cols={1}
                fields={[providerField]}
                form={model.form}
                onChange={model.onFieldChange}
                selectOptions={{ provider_company_code: providerOptions }}
              />
            );
          })() : null}
          {/* 시트가 나르지 않는 칸 — 여기 값은 ERP 에만 있다(정제칸에 없으므로 동기가 채우지도 지우지도 않는다). */}
          {section('부가 제원', ['transmission', 'usage', 'first_registration_date', 'accident_history'], 2,
            '판매시트에 없는 값 — ERP 에서만 관리한다')}
          {model.isAdmin && section('원가 · 이력 · 등록증', ['vehicle_price', 'location', 'vin', 'vehicle_age_expiry_date', 'cert_car_name', 'type_number', 'engine_type', 'partner_memo'])}
        </> : <CenterNote>{EMPTY_NOTE}</CenterNote>}
      </PaneBody>
    </>
  );
}

export function InventoryVariablePane({ model }: { model: InventoryEditorModel }) {
  const { form } = model;
  const { mode, group, catalogOpts } = editorHelpers(model);
  const canEdit = mode !== 'view';
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
      <PaneHead title="운영 조건" count={model.creating ? '신규 입력' : model.editing ? '수정 중' : model.selected ? '조회' : undefined} />
      <PaneBody pad>
        {model.selected ? <>
          <WorkFields
              title="상태 · 구분 · 정책"
              hint="상품 운영 상태와 연결 정책"
              accent="main"
              cols={1}
              mode={mode}
              fields={[...group(['vehicle_status', 'product_type', 'deposit_free']), policyField, ...group(['event_tags'])]}
              form={model.form}
              onChange={model.onFieldChange}
              selectOptions={{ ...catalogOpts, policy_code: policyOptions }}
            />
          <PriceMatrix price={form.price} onChange={model.onPriceChange} readOnly={!canEdit} />
          <FormCard title="사진" hint={canEdit ? '탭=크게 · 꾹=대표/실내/삭제' : '탭하면 크게 볼 수 있습니다'}>
            <PhotoUpload hideTitle productCode={String(form.product_code || model.selectedCode || '')} photos={form.photos} interiorUrl={String(form.interior_photo || '')}
              onChange={model.onPhotosChange} onInteriorChange={model.onInteriorChange} readOnly={!canEdit} />
          </FormCard>
          {model.supplierPhotos.length > 0 && (
            <FormCard title={`공급사 사진 · 연동(읽기전용) ${model.supplierPhotos.length}장`}>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_W}px, 1fr))`, gap: 6 }}>
                {model.supplierPhotos.map((url, index) => (
                  <a key={index} href={url} target="_blank" rel="noreferrer" style={{ display: 'block', aspectRatio: '4 / 3', borderRadius: R, overflow: 'hidden', background: C.placeholder, border: `1px solid ${C.line}` }}>
                    <img src={url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </a>
                ))}
              </div>
            </FormCard>
          )}
        </> : <CenterNote>{EMPTY_NOTE}</CenterNote>}
      </PaneBody>
    </>
  );
}
