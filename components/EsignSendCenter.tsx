'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, FileSignature, FileText, ListChecks, RotateCcw } from 'lucide-react';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { isAdminUiAllowed } from '@/lib/auth-gate';
import { createDirectEsignContract } from '@/lib/domain/deal';
import {
  draftInputRecord,
  draftTemplateFields,
  emptyEsignDraftInput,
  esignCenterBucket,
  esignContractSource,
  isEsignCenterContract,
  validateEsignCenterContract,
  type EsignDraftInput,
} from '@/lib/domain/esign-center';
import {
  contractKindFor,
  findTemplate,
  STANDARD_CONTRACT_TEMPLATES,
  standardTemplateSelectionError,
} from '@/lib/domain/esign-templates';
import { ALL_POLICY_FIELDS, canIssueContract } from '@/lib/domain/policy-tier';
import {
  ESIGN_POLICY_DRAFT_SESSION_KEY,
  ESIGN_POLICY_SELECTION_SESSION_KEY,
  type EsignPolicySelection,
} from '@/lib/domain/esign-policy-return';
import { NAV_LABEL } from '@/lib/tabbar';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { EsignCenterListRow, EsignCreateRow } from '@/components/list-rows';
import { FreepassEsignLinkPane, FreepassEsignProgressPane } from '@/components/FreepassEsignPanes';
import { toast } from '@/components/Toaster';
import {
  Badge,
  Btn,
  ButtonLabel,
  C,
  CenterNote,
  DetailRow,
  FS,
  FormGrid,
  ICON,
  ListGroup,
  Loading,
  PaneBody,
  PaneHead,
  SectionLabel,
  won,
} from '@/components/ui';

const S = (value: unknown) => String(value ?? '').trim();
const today = () => {
  const date = new Date();
  const p2 = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
};

const CUSTOMER_FIELDS: Field[] = [
  { key: 'contractDate', label: '계약일', type: 'date', required: true, manual: true },
  { key: 'customerName', label: '고객명', type: 'text', required: true, manual: true },
  { key: 'customerPhone', label: '연락처', type: 'text', required: true, manual: true },
];

const BUSINESS_FIELDS: Field[] = [
  { key: 'customerIsBusiness', label: '사업자 계약', type: 'select', options: ['예', '아니오'], manual: true },
  { key: 'customerCompanyName', label: '법인/상호', type: 'text', manual: true },
  { key: 'customerBusinessNumber', label: '사업자등록번호', type: 'text', manual: true },
];

const VEHICLE_FIELDS: Field[] = [
  { key: 'vehicleName', label: '모델명', type: 'text', required: true, manual: true },
  { key: 'carNumber', label: '차량번호', type: 'text', manual: true, note: '신차·번호미정이면 비울 수 있습니다' },
  { key: 'options', label: '옵션', type: 'text', manual: true },
];

const CONTRACT_TERM_FIELDS: Field[] = [
  { key: 'rentMonths', label: '대여기간(개월)', type: 'number', required: true, manual: true },
  { key: 'rentAmount', label: '월 대여료(원)', type: 'number', required: true, manual: true },
  { key: 'depositAmount', label: '보증금(원)', type: 'number', manual: true },
  { key: 'paymentTiming', label: '대여료 납부 조건', type: 'select', options: ['선불', '후불'], required: true, manual: true, note: '정책 기본값을 가져오며 이번 계약에서 변경할 수 있습니다' },
];

const OPTIONAL_TERM_FIELDS: Field[] = [
  { key: 'depositInstallment', label: '보증금 분납', type: 'text', manual: true },
  { key: 'annualMileage', label: '약정주행거리', type: 'text', manual: true, note: '비우면 선택 정책값 적용' },
  { key: 'buyoutPrice', label: '만기인수가·인수옵션', type: 'text', manual: true, note: '인수 조건이 있는 계약만 입력 · 비우면 만기 반납' },
  { key: 'driverAge', label: '운전자 연령', type: 'text', manual: true, note: '비우면 선택 정책값 적용' },
  { key: 'driverScope', label: '운전자 범위', type: 'text', manual: true, note: '비우면 선택 정책값 적용' },
];

const EXTRA_TERM_FIELDS: Field[] = [
  { key: 'maintenanceProduct', label: '정비상품', type: 'text', manual: true },
  { key: 'emergencyContact', label: '비상연락처', type: 'text', manual: true },
  { key: 'specialTerms', label: '건별 특약', type: 'text', manual: true },
];

const SUPPLIER_FIELDS: Field[] = [
  { key: 'providerCompanyCode', label: '계약회사(렌터카사)', type: 'select', required: true, manual: true },
];

const POLICY_FIELDS: Field[] = [
  { key: 'policyCode', label: '적용할 계약 정책', type: 'select', required: true, manual: true },
];

const TEMPLATE_FIELDS: Field[] = [
  { key: 'standardTemplateId', label: '사용할 계약서', type: 'select', required: true, manual: true },
];

function contractKey(row: EntityRecord | null | undefined) {
  return S(row?.contract_code || row?._key);
}

function partnerKey(row: EntityRecord | null | undefined) {
  return S(row?.partner_code || row?._key || row?.provider_company_code);
}

function policyKey(row: EntityRecord | null | undefined) {
  return S(row?.policy_code || row?._key);
}

export function EsignSendCenter() {
  const router = useRouter();
  const companyId = getCompanyId();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [contracts, setContracts] = useState<EntityRecord[] | null>(null);
  const [partners, setPartners] = useState<EntityRecord[]>([]);
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [draft, setDraft] = useState<EsignDraftInput | null>(null);
  const [busy, setBusy] = useState(false);
  const policyReturnApplied = useRef(false);

  const load = useCallback(async () => {
    const [contractRows, partnerRows, policyRows] = await Promise.all([
      getStore().list('contract', companyId),
      getStore().list('partner', companyId).catch(() => [] as EntityRecord[]),
      getStore().list('policy', companyId).catch(() => [] as EntityRecord[]),
    ]);
    setContracts(contractRows);
    setPartners(partnerRows);
    setPolicies(policyRows);
  }, [companyId]);

  useEffect(() => {
    if (!isAdminUiAllowed()) { router.replace('/'); return; }
    setAllowed(true);
    void load().catch(() => setContracts([]));
  }, [load, router]);

  useEffect(() => {
    if (contracts == null || policyReturnApplied.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('resume') !== 'policy') return;
    policyReturnApplied.current = true;
    try {
      const savedDraft = JSON.parse(sessionStorage.getItem(ESIGN_POLICY_DRAFT_SESSION_KEY) || 'null') as EsignDraftInput | null;
      const selection = JSON.parse(sessionStorage.getItem(ESIGN_POLICY_SELECTION_SESSION_KEY) || 'null') as EsignPolicySelection | null;
      if (savedDraft) {
        setSelectedCode('');
        setDraft({
          ...savedDraft,
          providerCompanyCode: selection?.providerCompanyCode || savedDraft.providerCompanyCode,
          policyCode: selection?.policyCode || savedDraft.policyCode,
        });
      }
    } catch {
      toast('정책 화면에서 작성 중이던 계약값을 복원하지 못했습니다.', 'error');
    } finally {
      sessionStorage.removeItem(ESIGN_POLICY_DRAFT_SESSION_KEY);
      sessionStorage.removeItem(ESIGN_POLICY_SELECTION_SESSION_KEY);
      window.history.replaceState(null, '', '/esign');
    }
  }, [contracts]);

  const selected = useMemo(
    () => (contracts || []).find((row) => contractKey(row) === selectedCode) || null,
    [contracts, selectedCode],
  );
  const partnerMap = useMemo(() => new Map(partners.map((row) => [partnerKey(row), row])), [partners]);
  const policyMap = useMemo(() => new Map(policies.map((row) => [policyKey(row), row])), [policies]);
  const selectedPartner = selected ? partnerMap.get(S(selected.provider_company_code)) || null : null;
  const selectedPolicy = selected ? policyMap.get(S(selected.policy_code)) || null : null;
  const selectedTemplate = selected ? findTemplate(selected.standard_template_id) : null;

  const draftPartner = draft ? partnerMap.get(draft.providerCompanyCode) || null : null;
  const draftPolicy = draft ? policyMap.get(draft.policyCode) || null : null;
  const draftChecks = useMemo(
    () => draft ? validateEsignCenterContract(draftInputRecord(draft), draftPartner, draftPolicy) : [],
    [draft, draftPartner, draftPolicy],
  );
  const draftBlocks = draftChecks.filter((row) => row.level === 'BLOCK');
  const draftTemplate = draft ? findTemplate(draft.standardTemplateId) : null;
  const draftContractKind = draftTemplate && draft ? contractKindFor(draftTemplate, draft.maturity) : null;
  const draftTemplateError = draftTemplate && draftContractKind
    ? standardTemplateSelectionError(draftTemplate, draftContractKind, draftPolicy)
    : '사용할 계약서를 선택해 주세요.';
  const appliedPolicyRows = useMemo(() => {
    if (!draftPolicy) return [];
    return ALL_POLICY_FIELDS
      .filter((field) => field.exposure === 'contract')
      .map((field) => ({ ...field, value: S(draftPolicy[field.key]) }))
      .filter((field) => field.value);
  }, [draftPolicy]);

  const policiesForDraft = useMemo(() => {
    if (!draft?.providerCompanyCode) return [];
    return policies.filter((row) => {
      const provider = S(row.provider_company_code);
      return provider === draft.providerCompanyCode;
    });
  }, [draft?.providerCompanyCode, policies]);

  const policyOptionLabel = (row: EntityRecord) => {
    const gate = canIssueContract(row);
    const age = S(row.basic_driver_age);
    const ageLabel = !age ? '' : /만|세/.test(age) ? age : `만 ${age}세 이상`;
    const parts = [
      S(row.policy_name || policyKey(row)),
      S(row.insurer_name),
      ageLabel,
      S(row.own_damage_compensation) ? `자차 ${S(row.own_damage_compensation)}` : '',
      gate.ok ? '발송 가능' : gate.layer === 'contract' ? `확인 ${gate.missing.length}` : '공급사 작성',
    ];
    return parts.filter(Boolean).join(' · ');
  };

  const contractSuppliers = useMemo(() => {
    return partners.filter((row) => !/영업|sales/i.test(S(row.partner_type || row.type || row.role)));
  }, [partners]);

  /** 이 발송센터에서 새로 만든 계약만 표시한다. 기존 ERP 계약원장은 섞지 않는다. */
  const sendAll = useMemo(() => (contracts || [])
    .filter(isEsignCenterContract)
    .filter((row) => ['direct', 'excel'].includes(esignContractSource(row))), [contracts]);
  const sendRows = useMemo(() => sendAll.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [row.customer_name, row.vehicle_name_snapshot, row.car_number_snapshot, row.contract_code]
      .some((value) => S(value).toLowerCase().includes(q));
  }), [sendAll, query]);

  const setDraftValue = (key: string, value: string) => {
    if (key === 'policyCode') {
      const chosen = policies.find((row) => policyKey(row) === value);
      setDraft((current) => current ? {
        ...current,
        policyCode: value,
        paymentTiming: (S(chosen?.payment_timing) === '후불' ? '후불' : '선불'),
      } : current);
      return;
    }
    setDraft((current) => current ? { ...current, [key]: value } : current);
    if (key !== 'providerCompanyCode') return;
    const compatible = policies.find((row) => {
      const provider = S(row.provider_company_code);
      return provider === value;
    });
    setDraft((current) => current ? {
      ...current,
      providerCompanyCode: value,
      policyCode: policyKey(compatible),
      paymentTiming: (S(compatible?.payment_timing) === '후불' ? '후불' : '선불'),
    } : current);
  };

  const beginDirect = () => {
    setSelectedCode('');
    setDraft(emptyEsignDraftInput('direct', today()));
  };

  const preserveDraftForPolicy = () => {
    if (!draft) return;
    sessionStorage.setItem(ESIGN_POLICY_DRAFT_SESSION_KEY, JSON.stringify(draft));
    sessionStorage.removeItem(ESIGN_POLICY_SELECTION_SESSION_KEY);
  };

  const openPolicyEditor = (href: string) => {
    preserveDraftForPolicy();
    window.location.assign(href);
  };

  const createDraft = async (previewWindow?: Window | null) => {
    if (!draft || busy) { previewWindow?.close(); return; }
    if (draftTemplateError || !draftTemplate || !draftContractKind) {
      previewWindow?.close();
      toast(draftTemplateError || '계약서 종류와 만기를 확인해 주세요.', 'error');
      return;
    }
    if (draftBlocks.length) {
      previewWindow?.close();
      toast(draftBlocks.map((row) => row.message).join(' · '), 'error');
      return;
    }
    setBusy(true);
    try {
      const code = await createDirectEsignContract({
        source: draft.source,
        importTemplateId: draft.importTemplateId,
        providerCompanyCode: draft.providerCompanyCode,
        policyCode: draft.policyCode,
        standardTemplateId: draftTemplate.id,
        contractKind: draftContractKind.key,
        maturity: draft.maturity,
        contractDate: draft.contractDate,
        customerName: draft.customerName,
        customerPhone: draft.customerPhone,
        customerAddress: draft.customerAddress,
        customerIsBusiness: draft.customerIsBusiness,
        customerCompanyName: draft.customerCompanyName,
        customerBusinessNumber: draft.customerBusinessNumber,
        vehicleName: draft.vehicleName,
        carNumber: draft.carNumber,
        modelYear: draft.modelYear,
        fuel: draft.fuel,
        rentMonths: Number(draft.rentMonths),
        rentAmount: Number(draft.rentAmount),
        depositAmount: Number(draft.depositAmount),
        paymentTiming: draft.paymentTiming,
        templateFields: draftTemplateFields(draft),
      });
      await load();
      setSelectedCode(code);
      setDraft(null);
      if (previewWindow) previewWindow.location.replace(`/esign/preview/${encodeURIComponent(code)}`);
      toast('전자계약 초안을 만들었습니다. 내용을 확인하고 발송 링크를 만드세요.', 'ok');
    } catch (error) {
      previewWindow?.close();
      toast(error instanceof Error ? error.message : '전자계약 초안을 만들지 못했습니다.', 'error');
    } finally { setBusy(false); }
  };

  if (allowed == null || contracts == null) return <Loading />;

  const selectedChecks = selected ? validateEsignCenterContract(selected, selectedPartner, selectedPolicy) : [];
  const sourceLabel = selected ? ({ erp: 'ERP 계약', excel: 'Excel 입력', direct: '직접 작성' }[esignContractSource(selected)]) : '';
  const dataPane = draft ? (
    <>
      <PaneHead title="계약서 직접 작성" count={draftBlocks.length ? `BLOCK ${draftBlocks.length}` : '발송 준비'} />
      <PaneBody pad>
        <SectionLabel>① 계약회사와 정책 선택</SectionLabel>
        <div style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.5 }}>
          프리패스에 등록된 렌터카 공급사만 표시됩니다. 공급사를 고르면 그 회사에 연결된 정책만 불러옵니다.
        </div>
        <FormGrid
          fields={SUPPLIER_FIELDS}
          form={draft as unknown as EntityRecord}
          onChange={setDraftValue}
          cols={1}
          selectOptions={{
            providerCompanyCode: contractSuppliers.map((row) => {
              const code = partnerKey(row);
              const linked = policies.filter((policy) => S(policy.provider_company_code) === code);
              return {
                value: code,
                label: `${S(row.name || row.partner_name || code)} · ${linked.length ? `정책 ${linked.length}개` : '정책 필요'}`,
              };
            }),
          }}
        />
        {draft.providerCompanyCode && policiesForDraft.length > 0 ? (
          <FormGrid
            fields={POLICY_FIELDS}
            form={draft as unknown as EntityRecord}
            onChange={setDraftValue}
            cols={1}
            selectOptions={{
              policyCode: policiesForDraft.map((row) => ({ value: policyKey(row), label: policyOptionLabel(row) })),
            }}
          />
        ) : null}
        {draft.providerCompanyCode && policiesForDraft.length === 0 ? (
          <>
            <Badge tone="red" variant="solid">이 계약회사에 연결된 정책이 없어 계약서를 만들 수 없습니다.</Badge>
            <Btn
              onClick={() => openPolicyEditor(`/policy?new=1&provider=${encodeURIComponent(draft.providerCompanyCode)}&edit=1&return=esign`)}
              variant="ghost"
              title="선택한 계약회사의 정책 만들기"
            >
              이 계약회사 정책 만들기
            </Btn>
          </>
        ) : null}
        {draftPolicy && !canIssueContract(draftPolicy).ok ? (
          <>
            <Badge tone="amber" variant="solid">{canIssueContract(draftPolicy).reason}</Badge>
            <Btn
              onClick={() => openPolicyEditor(`/policy?policy=${encodeURIComponent(policyKey(draftPolicy))}&section=ins&edit=1&return=esign`)}
              variant="ghost"
              title="선택한 정책의 보험 필수값 확인"
            >
              이 정책 필수값 확인
            </Btn>
          </>
        ) : null}
        {draftPartner && draftPolicy ? (
          <ListGroup header="자동 적용되는 회원사·정책값" footer={`이 값은 ${NAV_LABEL.policy}에서만 변경할 수 있습니다.`}>
            <DetailRow label="회원사" value={S(draftPartner.name || draftPartner.partner_name)} />
            <DetailRow label="계약 정책" value={S(draftPolicy.policy_name || draftPolicy.policy_code)} />
            <DetailRow label="임대인" value={[draftPartner.ceo || draftPartner.ceo_name, draftPartner.phone].filter(Boolean).join(' · ') || '정책 확인 필요'} stacked />
            <DetailRow label="사업장" value={S(draftPartner.address) || '정책 확인 필요'} stacked />
            <DetailRow label="입금계좌" value={[draftPartner.bank_name, draftPartner.bank_account, draftPartner.bank_holder].filter(Boolean).join(' · ') || '정책 확인 필요'} stacked />
            {appliedPolicyRows.map((field) => (
              <DetailRow key={field.key} label={field.label} value={field.value} stacked />
            ))}
          </ListGroup>
        ) : null}

        <SectionLabel>② 사용할 계약서 선택</SectionLabel>
        <FormGrid
          fields={TEMPLATE_FIELDS}
          form={draft as unknown as EntityRecord}
          onChange={setDraftValue}
          cols={1}
          selectOptions={{
            standardTemplateId: STANDARD_CONTRACT_TEMPLATES.map((template) => ({ value: template.id, label: template.label })),
          }}
        />
        {draftTemplate ? (
          <ListGroup footer={draftTemplate.note}>
            <DetailRow label="계약서" value={draftTemplate.title} />
            <DetailRow label="보험" value={draftTemplate.insuranceSide === '고객직접' ? '고객 별도 가입' : '대여료에 포함'} />
          </ListGroup>
        ) : null}
        {draftTemplateError ? <Badge tone="red" variant="solid">{draftTemplateError}</Badge> : null}

        <SectionLabel>③ 이번 계약에서 달라지는 값</SectionLabel>
        <SectionLabel>직원이 입력할 고객 정보</SectionLabel>
        <FormGrid fields={CUSTOMER_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
        <div style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.5 }}>
          주민등록번호·주소·운전면허증 사진은 고객이 서명 링크에서 직접 입력·첨부합니다. 면허번호는 별도로 받지 않습니다.
        </div>
        <SectionLabel>차량 정보</SectionLabel>
        <FormGrid fields={VEHICLE_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
        <SectionLabel>대여·금액 조건</SectionLabel>
        <FormGrid fields={CONTRACT_TERM_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
        <details>
          <summary style={{ cursor: 'pointer', color: C.mute, fontSize: FS.sub }}>사업자·인수형·건별 특약이 있을 때만 추가 입력</summary>
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <SectionLabel>사업자 정보</SectionLabel>
            <FormGrid fields={BUSINESS_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
            <SectionLabel>건별 계약 조건</SectionLabel>
            <FormGrid fields={OPTIONAL_TERM_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
            <FormGrid fields={EXTRA_TERM_FIELDS} form={draft as unknown as EntityRecord} onChange={setDraftValue} cols={2} showNotes />
          </div>
        </details>
        <SectionLabel>④ 발송 전 검토</SectionLabel>
        <ListGroup footer="BLOCK가 없으면 발송할 수 있고, WARNING은 발송 전 확인할 항목입니다.">
          {draftChecks.map((check) => (
            <DetailRow
              key={check.key}
              label={check.label}
              value={<Badge tone={check.level === 'BLOCK' ? 'red' : check.level === 'WARNING' ? 'amber' : 'green'} variant={check.level === 'BLOCK' ? 'solid' : 'fill'}>{check.message}</Badge>}
            />
          ))}
        </ListGroup>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn
            disabled={busy || draftBlocks.length > 0}
            onClick={() => {
              const preview = window.open('about:blank', '_blank');
              if (preview) preview.opener = null;
              void createDraft(preview);
            }}
          >
            <ButtonLabel icon={<FileText size={ICON.md} aria-hidden />}>{busy ? '저장 중…' : '저장하고 A4 검토'}</ButtonLabel>
          </Btn>
          <Btn variant="ghost" disabled={busy || draftBlocks.length > 0} onClick={() => void createDraft()}>
            <ButtonLabel icon={<FileSignature size={ICON.md} aria-hidden />}>초안만 저장</ButtonLabel>
          </Btn>
          <Btn variant="ghost" onClick={beginDirect}>
            <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>입력 초기화</ButtonLabel>
          </Btn>
        </div>
      </PaneBody>
    </>
  ) : selected ? (
    <>
      <PaneHead title="계약 데이터" count={sourceLabel} />
      <PaneBody pad>
        <Btn full title="전자계약서 고객 화면과 문서 보기" onClick={() => window.open(`/esign/preview/${encodeURIComponent(contractKey(selected))}`, '_blank', 'noreferrer')}>
          <ButtonLabel icon={<FileText size={ICON.md} aria-hidden />}>전자계약서 화면 보기</ButtonLabel>
        </Btn>
        <ListGroup>
          <DetailRow label="회원사" value={S(selectedPartner?.name || selected.provider_company_code)} />
          <DetailRow label="계약서" value={selectedTemplate?.label || '계약서 확인 필요'} stacked />
          <DetailRow label="적용 정책" value={S(selectedPolicy?.policy_name || selected.policy_code)} stacked />
          <DetailRow label="고객" value={[selected.customer_name, selected.customer_phone].filter(Boolean).join(' · ')} />
          <DetailRow label="차량" value={[selected.vehicle_name_snapshot, selected.car_number_snapshot].filter(Boolean).join(' · ')} stacked />
          <DetailRow label="대여조건" value={`${Number(selected.rent_month_snapshot) || '—'}개월 · 월 ${won(Number(selected.rent_amount_snapshot) || 0)}`} />
          <DetailRow label="보증금" value={won(Number(selected.deposit_amount_snapshot) || 0)} />
        </ListGroup>
        <SectionLabel>발송 전 검증</SectionLabel>
        <ListGroup>
          {selectedChecks.map((check) => (
            <DetailRow
              key={check.key}
              label={check.label}
              value={<Badge tone={check.level === 'BLOCK' ? 'red' : check.level === 'WARNING' ? 'amber' : 'green'} variant={check.level === 'BLOCK' ? 'solid' : 'fill'}>{check.message}</Badge>}
            />
          ))}
        </ListGroup>
      </PaneBody>
    </>
  ) : (
    <>
      <PaneHead title="계약 데이터" />
      <CenterNote>왼쪽의 새 계약서 직접 작성을 눌러 시작하세요.</CenterNote>
    </>
  );

  const panes: WorkPane[] = [
    { key: 'data', title: '계약 데이터', icon: Database, node: dataPane },
    {
      key: 'send', title: '검토·링크', icon: FileSignature, node: (
        <><PaneHead title="계약서 검토·링크 생성" /><PaneBody pad><FreepassEsignLinkPane contract={selected} policy={selectedPolicy} onChanged={load} /></PaneBody></>
      ),
    },
    {
      key: 'progress', title: '진행', icon: ListChecks, node: (
        <><PaneHead title="전자계약 진행상황" /><PaneBody pad><FreepassEsignProgressPane contract={selected} onChanged={load} /></PaneBody></>
      ),
    },
  ];

  const contractList = sendRows.length ? sendRows.map((row) => {
    const checks = validateEsignCenterContract(
      row,
      partnerMap.get(S(row.provider_company_code)) || null,
      policyMap.get(S(row.policy_code)) || null,
    );
    return (
      <EsignCenterListRow
        key={contractKey(row)}
        contract={row}
        bucket={esignCenterBucket(row, checks)}
        providerName={S(partnerMap.get(S(row.provider_company_code))?.name)}
        selected={selectedCode === contractKey(row)}
        onClick={() => { setDraft(null); setSelectedCode(contractKey(row)); }}
      />
    );
  }) : <CenterNote minHeight={0}>새로 만든 전자계약이 여기에 표시됩니다.</CenterNote>;

  const list = (
    <>
      <EsignCreateRow selected={!!draft} onClick={beginDirect} />
      {contractList}
    </>
  );

  return (
    <>
      <WorkPage
        title="전자계약"
        statusCount={sendAll.length}
        listCount={sendRows.length}
        list={list}
        panes={panes}
        selected={!!selected || !!draft}
        onBack={() => { setSelectedCode(''); setDraft(null); }}
        backKind={draft ? 'cancel' : 'list'}
        search={{ value: query, onChange: setQuery, placeholder: '고객·차량·계약번호 검색' }}
        mobileLayout="swap"
        contextTitle={draft ? '직접 작성' : S(selected?.customer_name)}
        listMaxWidth={420}
      />
    </>
  );
}
