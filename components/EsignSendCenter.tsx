'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, FileSignature, ListChecks, PenLine } from 'lucide-react';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { getAuthClient } from '@/lib/firebase/client';
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
  type EsignCenterBucket,
  type EsignDraftInput,
} from '@/lib/domain/esign-center';
import type { EsignExcelImport } from '@/lib/domain/esign-excel';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { EsignCenterListRow } from '@/components/list-rows';
import { FreepassEsignLinkPane, FreepassEsignProgressPane } from '@/components/FreepassEsignPanes';
import { toast } from '@/components/Toaster';
import {
  AddTile,
  Badge,
  Btn,
  ButtonLabel,
  C,
  CenterNote,
  DetailRow,
  FilterChips,
  FormGrid,
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

const DRAFT_FIELDS: Field[] = [
  { key: 'providerCompanyCode', label: '렌터카사', type: 'select', required: true, manual: true },
  { key: 'policyCode', label: '계약 정책', type: 'select', required: true, manual: true },
  { key: 'contractDate', label: '계약일', type: 'date', required: true, manual: true },
  { key: 'customerName', label: '고객명', type: 'text', required: true, manual: true },
  { key: 'customerPhone', label: '연락처', type: 'text', required: true, manual: true },
  { key: 'customerAddress', label: '고객 주소', type: 'text', manual: true },
  { key: 'customerIsBusiness', label: '사업자 계약', type: 'select', options: ['예', '아니오'], manual: true },
  { key: 'customerCompanyName', label: '법인/상호', type: 'text', manual: true },
  { key: 'customerBusinessNumber', label: '사업자등록번호', type: 'text', manual: true },
  { key: 'vehicleName', label: '차량·세부트림', type: 'text', required: true, manual: true },
  { key: 'carNumber', label: '차량번호', type: 'text', manual: true, note: '신차·번호미정이면 비울 수 있습니다' },
  { key: 'modelYear', label: '연식', type: 'text', manual: true },
  { key: 'fuel', label: '유종', type: 'text', manual: true },
  { key: 'options', label: '옵션', type: 'text', manual: true },
  { key: 'colorExterior', label: '외장색', type: 'text', manual: true },
  { key: 'currentMileage', label: '현재주행거리', type: 'text', manual: true },
  { key: 'rentMonths', label: '대여기간(개월)', type: 'number', required: true, manual: true },
  { key: 'rentAmount', label: '월 대여료(원)', type: 'number', required: true, manual: true },
  { key: 'depositAmount', label: '보증금(원)', type: 'number', manual: true },
  { key: 'depositInstallment', label: '보증금 분납', type: 'text', manual: true },
  { key: 'annualMileage', label: '약정주행거리', type: 'text', manual: true },
  { key: 'buyoutPrice', label: '만기인수가', type: 'text', manual: true },
  { key: 'driverAge', label: '운전자 연령', type: 'text', manual: true },
  { key: 'driverScope', label: '운전자 범위', type: 'text', manual: true },
  { key: 'maintenanceProduct', label: '정비상품', type: 'text', manual: true },
  { key: 'emergencyContact', label: '비상연락처', type: 'text', manual: true },
  { key: 'specialTerms', label: '건별 특약', type: 'text', manual: true },
];

const PARTNER_PROFILE_FIELDS: Field[] = [
  { key: 'ceo', label: '대표자', type: 'text', manual: true },
  { key: 'phone', label: '대표번호', type: 'text', manual: true },
  { key: 'address', label: '사업장 주소', type: 'text', manual: true },
  { key: 'bank_name', label: '입금은행', type: 'text', manual: true },
  { key: 'bank_account', label: '입금계좌번호', type: 'text', manual: true },
  { key: 'bank_holder', label: '예금주', type: 'text', manual: true },
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

function matches(row: EntityRecord, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    row.customer_name, row.customer_phone, row.vehicle_name_snapshot, row.car_number_snapshot,
    row.contract_code, row.provider_company_code,
  ].some((value) => S(value).toLowerCase().includes(q));
}

export function EsignSendCenter() {
  const router = useRouter();
  const companyId = getCompanyId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [contracts, setContracts] = useState<EntityRecord[] | null>(null);
  const [partners, setPartners] = useState<EntityRecord[]>([]);
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState<EsignCenterBucket>('발송대기');
  const [selectedCode, setSelectedCode] = useState('');
  const [erpPicking, setErpPicking] = useState(false);
  const [draft, setDraft] = useState<EsignDraftInput | null>(null);
  const [excelMeta, setExcelMeta] = useState<EsignExcelImport | null>(null);
  const [partnerForm, setPartnerForm] = useState<EntityRecord>({});
  const [busy, setBusy] = useState(false);

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

  const selected = useMemo(
    () => (contracts || []).find((row) => contractKey(row) === selectedCode) || null,
    [contracts, selectedCode],
  );
  const partnerMap = useMemo(() => new Map(partners.map((row) => [partnerKey(row), row])), [partners]);
  const policyMap = useMemo(() => new Map(policies.map((row) => [policyKey(row), row])), [policies]);
  const selectedPartner = selected ? partnerMap.get(S(selected.provider_company_code)) || null : null;
  const selectedPolicy = selected ? policyMap.get(S(selected.policy_code)) || null : null;

  const draftPartner = draft ? partnerMap.get(draft.providerCompanyCode) || null : null;
  const draftPolicy = draft ? policyMap.get(draft.policyCode) || null : null;
  const draftChecks = useMemo(
    () => draft ? validateEsignCenterContract(draftInputRecord(draft), draftPartner, draftPolicy) : [],
    [draft, draftPartner, draftPolicy],
  );
  const draftBlocks = draftChecks.filter((row) => row.level === 'BLOCK');

  useEffect(() => {
    const profile = draftPartner || {};
    setPartnerForm(Object.fromEntries(PARTNER_PROFILE_FIELDS.map((field) => [field.key, profile[field.key] ?? ''])));
  }, [draftPartner]);

  const centerRows = useMemo(() => (contracts || []).filter(isEsignCenterContract), [contracts]);
  const decorated = useMemo(() => centerRows.map((row) => {
    const checks = validateEsignCenterContract(
      row,
      partnerMap.get(S(row.provider_company_code)) || null,
      policyMap.get(S(row.policy_code)) || null,
    );
    return { row, checks, bucket: esignCenterBucket(row, checks) };
  }), [centerRows, partnerMap, policyMap]);
  const counts = useMemo(() => {
    const result: Record<EsignCenterBucket, number> = { 발송대기: 0, 서명중: 0, 확인필요: 0, 완료: 0 };
    for (const item of decorated) result[item.bucket] += 1;
    return result;
  }, [decorated]);

  const erpRows = useMemo(() => (contracts || [])
    .filter((row) => esignContractSource(row) === 'erp' && S(row.contract_status) !== '계약취소')
    .filter((row) => matches(row, query)), [contracts, query]);
  const shown = useMemo(() => decorated
    .filter((item) => item.bucket === bucket && matches(item.row, query)), [decorated, bucket, query]);

  const policiesForDraft = useMemo(() => {
    if (!draft?.providerCompanyCode) return policies;
    return policies.filter((row) => {
      const provider = S(row.provider_company_code);
      return !provider || provider === draft.providerCompanyCode;
    });
  }, [draft?.providerCompanyCode, policies]);

  const setDraftValue = (key: string, value: string) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    if (key !== 'providerCompanyCode') return;
    const compatible = policies.find((row) => {
      const provider = S(row.provider_company_code);
      return !provider || provider === value;
    });
    setDraft((current) => current ? { ...current, providerCompanyCode: value, policyCode: policyKey(compatible) } : current);
  };

  const beginDirect = () => {
    setErpPicking(false);
    setSelectedCode('');
    setExcelMeta(null);
    setDraft(emptyEsignDraftInput('direct', today()));
  };

  const uploadExcel = async (file: File) => {
    const user = getAuthClient()?.currentUser;
    if (!user) throw new Error('관리자 로그인이 필요합니다.');
    const data = new FormData();
    data.set('file', file);
    const response = await fetch('/api/freepass-esign/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      body: data,
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({})) as { result?: EsignExcelImport; error?: string };
    if (!response.ok || !body.result) throw new Error(body.error || '엑셀 계약서를 읽지 못했습니다.');
    const imported = body.result;
    const provider = partners.find((row) => /손오공/.test(`${S(row.name)} ${S(row.alias)}`))
      || partners.find((row) => partnerKey(row) === 'RP012');
    const providerCode = partnerKey(provider);
    const policy = policies.find((row) => {
      const code = S(row.provider_company_code);
      return !code || code === providerCode;
    });
    setExcelMeta(imported);
    setErpPicking(false);
    setSelectedCode('');
    setDraft({
      ...emptyEsignDraftInput('excel', today()),
      ...imported.form,
      source: 'excel',
      importTemplateId: imported.templateId,
      providerCompanyCode: providerCode,
      policyCode: policyKey(policy),
    });
  };

  const onExcelPicked = async (file: File | null) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      await uploadExcel(file);
      toast('엑셀 입력값을 불러왔습니다. 발송 전 내용을 확인해 주세요.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '엑셀 계약서를 읽지 못했습니다.', 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const savePartnerProfile = async () => {
    if (!draftPartner) { toast('렌터카사를 먼저 골라 주세요.', 'error'); return; }
    setBusy(true);
    try {
      await getStore().update('partner', companyId, partnerKey(draftPartner), partnerForm);
      await load();
      toast('업체 고정값을 저장했습니다. 이미 발송한 계약에는 적용되지 않습니다.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '업체 고정값을 저장하지 못했습니다.', 'error');
    } finally { setBusy(false); }
  };

  const createDraft = async () => {
    if (!draft || busy) return;
    if (draftBlocks.length) {
      toast(draftBlocks.map((row) => row.message).join(' · '), 'error');
      return;
    }
    setBusy(true);
    try {
      const code = await createDirectEsignContract({
        source: draft.source,
        importTemplateId: draft.importTemplateId,
        importAdapterId: excelMeta?.adapterId,
        providerCompanyCode: draft.providerCompanyCode,
        policyCode: draft.policyCode,
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
        templateFields: draftTemplateFields(draft),
      });
      await load();
      setSelectedCode(code);
      setDraft(null);
      setExcelMeta(null);
      setBucket('발송대기');
      toast('전자계약 초안을 만들었습니다. 내용을 확인하고 발송 링크를 만드세요.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '전자계약 초안을 만들지 못했습니다.', 'error');
    } finally { setBusy(false); }
  };

  if (allowed == null || contracts == null) return <Loading />;

  const selectedChecks = selected ? validateEsignCenterContract(selected, selectedPartner, selectedPolicy) : [];
  const sourceLabel = selected ? ({ erp: 'ERP 계약', excel: 'Excel 입력', direct: '직접 작성' }[esignContractSource(selected)]) : '';
  const dataPane = draft ? (
    <>
      <PaneHead title={draft.source === 'excel' ? 'Excel 입력값 확인' : '계약서 직접 작성'} count={draftBlocks.length ? `BLOCK ${draftBlocks.length}` : '발송 준비'} />
      <PaneBody pad>
        {excelMeta ? (
          <ListGroup header="Excel Import" footer="원본 엑셀과 주민등록번호·면허번호는 저장하지 않습니다.">
            <DetailRow label="인식 양식" value={excelMeta.templateId} />
            <DetailRow label="입력 어댑터" value={excelMeta.adapterId} />
            <DetailRow label="민감정보 제외" value={excelMeta.skippedSensitiveFields.join(' · ')} stacked />
          </ListGroup>
        ) : null}
        {excelMeta?.warnings.map((warning) => <Badge key={warning} tone="amber">{warning}</Badge>)}
        <SectionLabel>계약별 변경값</SectionLabel>
        <FormGrid
          fields={DRAFT_FIELDS}
          form={draft as unknown as EntityRecord}
          onChange={setDraftValue}
          cols={2}
          showNotes
          selectOptions={{
            providerCompanyCode: partners.map((row) => ({ value: partnerKey(row), label: S(row.name || row.partner_name || partnerKey(row)) })),
            policyCode: policiesForDraft.map((row) => ({ value: policyKey(row), label: S(row.policy_name || policyKey(row)) })),
          }}
        />
        <SectionLabel>검증</SectionLabel>
        <ListGroup footer="BLOCK가 없으면 발송할 수 있고, WARNING은 발송 전 확인할 항목입니다.">
          {draftChecks.map((check) => (
            <DetailRow
              key={check.key}
              label={check.label}
              value={<Badge tone={check.level === 'BLOCK' ? 'red' : check.level === 'WARNING' ? 'amber' : 'green'} variant={check.level === 'BLOCK' ? 'solid' : 'fill'}>{check.message}</Badge>}
            />
          ))}
        </ListGroup>
        <SectionLabel>업체 고정값</SectionLabel>
        <FormGrid fields={PARTNER_PROFILE_FIELDS} form={partnerForm} onChange={(key, value) => setPartnerForm((current) => ({ ...current, [key]: value }))} cols={2} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn variant="ghost" disabled={busy || !draftPartner} onClick={() => void savePartnerProfile()}>업체 고정값 저장</Btn>
          <Btn disabled={busy || draftBlocks.length > 0} onClick={() => void createDraft()}>{busy ? '저장 중…' : '계약서 초안 만들기'}</Btn>
          <Btn variant="ghost" onClick={() => { setDraft(null); setExcelMeta(null); }}>취소</Btn>
        </div>
      </PaneBody>
    </>
  ) : selected ? (
    <>
      <PaneHead title="계약 데이터" count={sourceLabel} />
      <PaneBody pad>
        <ListGroup>
          <DetailRow label="고객" value={[selected.customer_name, selected.customer_phone].filter(Boolean).join(' · ')} />
          <DetailRow label="차량" value={[selected.vehicle_name_snapshot, selected.car_number_snapshot].filter(Boolean).join(' · ')} stacked />
          <DetailRow label="렌터카사" value={S(selectedPartner?.name || selected.provider_company_code)} />
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
      <CenterNote>엑셀 계약서를 넣거나 직접 작성하거나 ERP 계약을 고르세요.</CenterNote>
    </>
  );

  const panes: WorkPane[] = [
    { key: 'data', title: '계약 데이터', icon: Database, node: dataPane },
    {
      key: 'send', title: '발송', icon: FileSignature, node: (
        <><PaneHead title="프리패스 전자계약 발송" /><PaneBody pad><FreepassEsignLinkPane contract={selected} policy={selectedPolicy} onChanged={load} /></PaneBody></>
      ),
    },
    {
      key: 'progress', title: '진행', icon: ListChecks, node: (
        <><PaneHead title="전자계약 진행상황" /><PaneBody pad><FreepassEsignProgressPane contract={selected} onChanged={load} /></PaneBody></>
      ),
    },
  ];

  const listHeader = (
    <div style={{ padding: 12, borderBottom: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 10, background: C.taupeBg }}>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        hidden
        onChange={(event) => void onExcelPicked(event.target.files?.[0] || null)}
      />
      <AddTile
        label={busy ? 'Excel 읽는 중…' : 'Excel 계약서 넣기'}
        title="Excel 계약서 넣기"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        style={{ minHeight: 48, aspectRatio: 'auto' }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn full variant="ghost" onClick={beginDirect}>
          <ButtonLabel icon={<PenLine aria-hidden />}>직접 작성</ButtonLabel>
        </Btn>
        <Btn full variant={erpPicking ? 'solid' : 'ghost'} onClick={() => { setDraft(null); setExcelMeta(null); setSelectedCode(''); setErpPicking((value) => !value); }}>
          <ButtonLabel icon={<Database aria-hidden />}>ERP 계약에서</ButtonLabel>
        </Btn>
      </div>
      {!erpPicking ? (
        <FilterChips
          value={bucket}
          onChange={setBucket}
          options={(['발송대기', '서명중', '확인필요', '완료'] as EsignCenterBucket[]).map((key) => ({ key, label: key, count: counts[key] }))}
        />
      ) : <Badge tone="blue">ERP 계약을 검색해 선택하세요</Badge>}
    </div>
  );

  const list = erpPicking ? (
    erpRows.length ? erpRows.map((row) => {
      const checks = validateEsignCenterContract(row, partnerMap.get(S(row.provider_company_code)), policyMap.get(S(row.policy_code)));
      return <EsignCenterListRow key={contractKey(row)} contract={row} bucket={esignCenterBucket(row, checks)} providerName={S(partnerMap.get(S(row.provider_company_code))?.name)} selected={selectedCode === contractKey(row)} onClick={() => { setSelectedCode(contractKey(row)); setErpPicking(false); }} />;
    }) : <CenterNote>검색할 ERP 계약이 없습니다.</CenterNote>
  ) : shown.length ? shown.map((item) => (
    <EsignCenterListRow
      key={contractKey(item.row)}
      contract={item.row}
      bucket={item.bucket}
      providerName={S(partnerMap.get(S(item.row.provider_company_code))?.name)}
      selected={selectedCode === contractKey(item.row)}
      onClick={() => { setDraft(null); setExcelMeta(null); setSelectedCode(contractKey(item.row)); }}
    />
  )) : <CenterNote>이 상태의 전자계약이 없습니다.</CenterNote>;

  return (
    <WorkPage
      title="전자계약"
      statusLabel="전자계약"
      statusCount={centerRows.length}
      attentionLabel="확인"
      attentionCount={counts.확인필요}
      listCount={erpPicking ? erpRows.length : shown.length}
      listHeader={listHeader}
      list={list}
      panes={panes}
      selected={!!selected || !!draft}
      onBack={() => { setSelectedCode(''); setDraft(null); setExcelMeta(null); setErpPicking(false); }}
      backKind={draft ? 'cancel' : 'list'}
      search={{ value: query, onChange: setQuery, placeholder: erpPicking ? '계약번호·고객·차량 검색' : '고객·차량·렌터카사 검색' }}
      mobileLayout="swap"
      contextTitle={draft ? (draft.source === 'excel' ? 'Excel 입력값 확인' : '직접 작성') : S(selected?.customer_name)}
      listMaxWidth={480}
    />
  );
}
