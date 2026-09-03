'use client';

/**
 * 계약서관리(전자계약) — 저장된 계약 한 건의 작업면 두 칸.
 *
 * 정본: docs/ESIGN_SEND_CENTER_REDESIGN_2026-08-19.md + 사장님 2026-08-19 «4칸» 배치
 *   목록 | 계약 진행(스테퍼·발송 전 확인·현재 단계·요약·이력) | 계약서·링크(A4·링크·PDF)
 *   · 단계 축 하나(작성 → 발송 전 → 고객 작성 중 → 검토 대기 → 완료) — 스테퍼·카드·이력이 같은 이름
 *   · 상태는 한 번만 읽는다(useFreepassEsign) — 두 칸이 같은 값을 본다
 *   · 플래그(확인 필요·만료·해지·보완 요청됨)는 단계와 섞지 않는다
 *   · 「고객 진행」은 발행 스냅샷의 실제 여정 + session.progress 시각 — 서버 응답에 이미 있는 값만 쓴다
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { getAuthClient } from '@/lib/firebase/client';
import { useSession } from '@/lib/auth-context';
import {
  contractKindFor,
  defaultStandardTemplate,
  findTemplate,
  maturityOf,
  standardTemplateSelectionError,
} from '@/lib/domain/esign-templates';
import {
  ESIGN_CENTER_STAGES,
  esignAdditionalDriverLimit,
  esignCenterFlagLabel,
  esignCenterFlags,
  esignCenterStage,
  type EsignCenterFlags,
  type EsignCenterStage,
  type EsignCheck,
} from '@/lib/domain/esign-center';
import { ALL_POLICY_FIELDS, policyReadiness } from '@/lib/domain/policy-tier';
import type { EsignTemplate } from '@/lib/domain/esign-templates';
import { copyText } from '@/lib/clipboard';
import { toast } from '@/components/Toaster';
import {
  Badge, Btn, ButtonLabel, C, CenterNote, Checkbox, FormCard, FS, ICON,
  Input, Message, WorkInput, WorkRow, WorkTable, WorkTextarea,
} from '@/components/ui';
import { CheckCircle2, Copy, ExternalLink, FileDown, FileText, Link2Off, RefreshCw, XCircle } from 'lucide-react';
import { EsignCustomerWalkthroughButton } from '@/components/EsignCustomerWalkthrough';

type Rec = Record<string, unknown>;
export type AdminState = {
  contract?: EntityRecord;
  snapshot?: {
    consentPages?: Array<{
      key?: string;
      title?: string;
      note?: string;
      rows?: Array<{ label?: string; value?: string }>;
    }>;
    additionalDriverPolicy?: { limit?: number; cost?: string };
    requiredDocuments?: Array<{ key?: string; label?: string; required?: boolean }>;
    consentProfile?: { version?: string; cmsRequiredBeforeHandover?: boolean };
    template?: { label?: string; version?: string };
    contractKind?: { title?: string; maturity?: string; insuranceSide?: string };
  } | null;
  session?: {
    status?: string;
    customerLinkUsable?: boolean;
    reissueRequiresNewContract?: boolean;
    issuedAt?: number;
    openedAt?: number;
    submittedAt?: number;
    approvedAt?: number;
    expiresAt?: number;
    rejectReason?: string;
    progress?: Record<string, number>;
    supplementItems?: string[];
    supplements?: Array<{ items?: string[]; reason?: string; requestedAt?: number }>;
  } | null;
  submission?: {
    status?: string;
    customerName?: string;
    customerPhone?: string;
    driverLicenseNo?: boolean;
    signature?: string;
    idCard?: boolean;
    selfie?: boolean;
    additionalDrivers?: Array<{
      name?: string;
      relation?: string;
      phone?: string;
      driverLicenseNo?: boolean;
      license?: boolean;
      assetUrl?: string;
    }>;
    supportingDocuments?: Array<{
      key?: string;
      label?: string;
      required?: boolean;
      originalName?: string;
      submitted?: boolean;
      assetUrl?: string;
    }>;
    assetUrls?: { idCard?: string; selfie?: string };
  } | null;
  events?: Array<{ type?: string; at?: number; reason?: string; items?: string[]; handoverDate?: string }>;
};

const S = (value: unknown) => String(value ?? '').trim();
const N = (value: unknown) => Number(value || 0) || 0;
const won = (value: unknown) => `${N(value).toLocaleString('ko-KR')}원`;

async function bearer(forceRefresh = false) {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  // Firebase SDK가 만료 여부를 확인하고 필요할 때만 갱신한다. 매 요청마다 강제 갱신하면
  // 클라이언트와 로컬 서버의 수초 시계차 때문에 막 발급된 토큰이 미래 토큰으로 보일 수 있다.
  return user.getIdToken(forceRefresh);
}

async function adminFetch(url: string, init: RequestInit = {}) {
  const request = async (forceRefresh = false) => {
    const token = await bearer(forceRefresh);
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      cache: 'no-store',
    });
  };
  let response = await request(false);
  // 브라우저에 Firebase 사용자는 남아 있는데 ID 토큰만 만료된 경우가 있다.
  // 관리자에게 다시 로그인하라고 하기 전에 SDK로 한 번만 새 토큰을 받아 재시도한다.
  if (response.status === 401 && getAuthClient()?.currentUser) response = await request(true);
  return response;
}

async function stateFor(contractCode: string): Promise<AdminState> {
  const response = await adminFetch(`/api/freepass-esign/contracts/${encodeURIComponent(contractCode)}`);
  const body = await response.json().catch(() => ({})) as AdminState & { error?: string };
  if (!response.ok) throw new Error(body.error || '전자계약 상태를 불러오지 못했습니다.');
  return body;
}

async function actionFor(contractCode: string, body: Rec): Promise<AdminState> {
  const response = await adminFetch(`/api/freepass-esign/contracts/${encodeURIComponent(contractCode)}`, {
    method: 'POST', body: JSON.stringify(body),
  });
  const raw = await response.text();
  let result: AdminState & { error?: string } = {};
  try { result = raw ? JSON.parse(raw) as AdminState & { error?: string } : {}; }
  catch { /* Next 런타임 오류 HTML은 아래 상태코드 안내로 처리한다. */ }
  if (!response.ok) {
    const fallback = process.env.NODE_ENV === 'development'
      ? `전자계약 작업을 완료하지 못했습니다. (HTTP ${response.status})`
      : '전자계약 작업을 완료하지 못했습니다.';
    throw new Error(result.error || fallback);
  }
  return result;
}

async function openProtected(url: string) {
  const viewer = window.open('about:blank', '_blank');
  if (viewer) viewer.opener = null;
  try {
    const response = await adminFetch(url);
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || '문서를 열지 못했습니다.');
    }
    const blobUrl = URL.createObjectURL(await response.blob());
    if (viewer) viewer.location.replace(blobUrl);
    else window.location.assign(blobUrl);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
  } catch (error) {
    viewer?.close();
    throw error;
  }
}

function stamp(ms: unknown) {
  const at = N(ms);
  if (!at) return '—';
  return new Date(at).toLocaleString('ko-KR', { hour12: false });
}

/** 스테퍼·진행 행에 붙는 짧은 시각 — «08.19 14:05». */
function shortStamp(ms: unknown) {
  const at = N(ms);
  if (!at) return '';
  const date = new Date(at);
  const p2 = (value: number) => String(value).padStart(2, '0');
  return `${p2(date.getMonth() + 1)}.${p2(date.getDate())} ${p2(date.getHours())}:${p2(date.getMinutes())}`;
}

/** 이력 라벨 — 스테퍼 단계 이름과 같은 말을 쓴다. */
const EVENT_LABEL: Record<string, string> = {
  issued: '링크 만듦', opened: '고객 열람', submitted: '고객 제출',
  rejected: '보완 요청', approved: '승인·봉인', revoked: '링크 해지',
  handover_confirmed: '인도일 확정',
};
const SUPPLEMENT_ITEMS = [
  { key: 'identity', label: '운전면허증·얼굴 사진' },
  { key: 'documents', label: '추가 제출서류' },
  { key: 'contract', label: '계약정보' },
  { key: 'agreement', label: '약관확인' },
  { key: 'signature', label: '서명' },
] as const;
const SUPPLEMENT_LABEL: Record<string, string> = Object.fromEntries(SUPPLEMENT_ITEMS.map((item) => [item.key, item.label]));

/**
 * 계약 한 건의 전자계약 상태 — 두 칸(계약 진행 · 계약서·링크)이 이 한 벌을 나눠 쓴다.
 * 손님이 움직이는 동안(발행~검토 대기)만 5초 폴링. 완료·미발행은 한 번이면 된다.
 */
export function useFreepassEsign(contract: EntityRecord | null, onChanged: () => void | Promise<void>) {
  const code = S(contract?.contract_code);
  const [state, setState] = useState<AdminState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!code) { setState(null); return; }
    try { setState(await stateFor(code)); setLoadError(''); }
    catch (error) {
      setState(null);
      setLoadError(error instanceof Error ? error.message : '전자계약 상태를 불러오지 못했습니다.');
    }
  }, [code]);
  useEffect(() => { void load(); }, [load]);

  const current = (state?.contract || contract || {}) as EntityRecord;
  const sessionStatus = S(state?.session?.status);
  const issued = S(current.esign_provider) === 'freepass' && !!S(current.esign_id);
  const stage = esignCenterStage(current, sessionStatus);
  const polling = !!code && issued && stage !== '완료';
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [load, polling]);

  const run = useCallback(async (body: Rec, success: string) => {
    if (busy || !code) return;
    setBusy(true);
    try {
      setState(await actionFor(code, body));
      await onChanged();
      toast(success, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '전자계약 작업에 실패했습니다.', 'error');
    } finally { setBusy(false); }
  }, [busy, code, onChanged]);

  return { code, state, current, sessionStatus, issued, stage, busy, setBusy, loadError, load, run };
}
export type FreepassEsign = ReturnType<typeof useFreepassEsign>;

/**
 * 단계 스테퍼 — 이 화면의 유일한 단계 표기. 현재 단계만 진하게, 지난 단계는 시각 한 줄.
 * 초안(작성)에서도, 저장된 계약에서도 같은 컴포넌트를 쓴다.
 */
export function EsignStageStepper({
  current,
  times = {},
  flagLabel = '',
}: {
  current: EsignCenterStage;
  /** 지난 단계에 붙일 완료 시각(ms). */
  times?: Partial<Record<EsignCenterStage, number>>;
  flagLabel?: string;
}) {
  const currentIndex = ESIGN_CENTER_STAGES.indexOf(current);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }} aria-label="전자계약 단계">
      {ESIGN_CENTER_STAGES.map((stage, index) => {
        const done = index < currentIndex || (current === '완료' && index === currentIndex);
        const here = index === currentIndex && current !== '완료';
        const time = shortStamp(times[stage]);
        return (
          <div key={stage} style={{ display: 'grid', gap: 2, justifyItems: 'start' }}>
            <Badge tone={done ? 'green' : here ? 'blue' : 'gray'} variant={done ? 'fill' : here ? 'solid' : 'line'}>
              {index + 1}. {stage}
            </Badge>
            <span style={{ fontSize: FS.micro, color: C.faint, minHeight: 12, paddingLeft: 2 }}>{time}</span>
          </div>
        );
      })}
      {flagLabel ? (
        <div style={{ display: 'grid', gap: 2 }}>
          <Badge tone="red" variant="solid">{flagLabel}</Badge>
          <span style={{ fontSize: FS.micro, minHeight: 12 }} />
        </div>
      ) : null}
    </div>
  );
}

/** 표가 아닌 단계 묶음(다음 할 일·버튼). 라벨|값 섹션은 WorkTable을 직접 붙인다 — FormCard로 감싸지 않는다. */
export function EsignStageCard({
  title,
  description,
  tone = 'active',
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  tone?: 'active' | 'flag' | 'quiet';
  children?: ReactNode;
}) {
  return (
    <FormCard title={title} hint={tone === 'flag' ? undefined : description}>
      {tone === 'flag' && description ? <Message variant="danger">{description}</Message> : null}
      {children}
    </FormCard>
  );
}

/** 「발송 전 확인」 — BLOCK/WARNING 목록. 초안·저장본 공용, 이름도 하나. */
/** 공급사(파트너) 레코드가 비어서 나는 문제 — 「파트너사관리에서 입력」 안내가 붙는다. */
export const PARTNER_PROBLEM_KEYS = new Set([
  'partner_profile', 'company_name', 'company_biz_no', 'company_ceo', 'company_address',
  'rental_business_no', 'payment_bank', 'payment_account_no', 'payment_account_holder',
]);
export const POLICY_PROBLEM_KEYS = new Set(['policy', 'policy_readiness', 'additional_driver_cost']);

export function EsignProblemList({
  problems,
  header = '발송 전 확인',
  footer,
  onFixPolicy,
  onFixPartner,
  partnerName = '',
}: {
  problems: EsignCheck[];
  /** 목록 머리 — 단계 카드 안에서는 「지금 없는 것」처럼 그 자리 말로 바꾼다(사장님 2026-08-20). */
  header?: string;
  footer?: string;
  onFixPolicy?: (() => void) | null;
  /** 공급사 정보가 비어 있을 때 — 파트너사관리로. 사장님 2026-08-19 「전자계약 보내려면 파트너관리 가서 정보를 다 입력하라고」 */
  onFixPartner?: (() => void) | null;
  partnerName?: string;
}) {
  if (!problems.length) return null;
  const partnerProblems = problems.filter((check) => PARTNER_PROBLEM_KEYS.has(check.key));
  const resolvedFooter = footer
    || (partnerProblems.length ? `공급사 정보(${partnerProblems.map((check) => check.label).join('·')})를 확인해 주세요.` : undefined);
  return (
    <>
      <WorkTable title={header} hint={resolvedFooter}>
        {problems.map((check) => (
          <WorkRow
            key={check.key}
            label={check.label}
          >
            <Badge tone={check.level === 'BLOCK' ? 'red' : 'amber'} variant={check.level === 'BLOCK' ? 'solid' : 'fill'}>{check.message}</Badge>
          </WorkRow>
        ))}
      </WorkTable>
      {onFixPolicy || (onFixPartner && partnerProblems.length) ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {onFixPartner && partnerProblems.length ? (
            <Btn size="sm" onClick={onFixPartner}>파트너사관리에서 {partnerName || '공급사'} 정보 입력</Btn>
          ) : null}
          {onFixPolicy ? <Btn variant="ghost" size="sm" onClick={onFixPolicy}>파트너사관리에서 정책 수정</Btn> : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * 칸 4 「계약내용 확인」 — 선택한 공급사·계약서·정책이 어떤 조건인지 **접지 않고 쭉 펼쳐** 보여준다
 * (사장님 2026-08-19 「선택한 정책이 어떤 조건인지 4번에서 계약내용 확인으로 쭉 펼쳐서」).
 * 초안(작성)과 미발행 계약 둘 다 이 한 벌을 쓴다. 비어 있는 값은 「미입력」으로 빨갛게 — 어디서 채우는지 footer 에.
 */
export function EsignContractContentPane({
  partner,
  policy,
  template,
  summary,
}: {
  partner: EntityRecord | null;
  policy: EntityRecord | null;
  template: EsignTemplate | null;
  /** 요약 행 — 계약 요약(공급사·계약서·정책·차량·대여조건·특약)은 호출하는 쪽이 만든다. */
  summary: Array<{ label: string; value: ReactNode; stacked?: boolean }>;
}) {
  const missing = <Badge tone="red" variant="solid">미입력</Badge>;
  const val = (value: unknown): ReactNode => (S(value) ? S(value) : missing);
  const readiness = policy ? policyReadiness(policy, partner) : null;
  const missingKeys = new Set([...(readiness?.contractMissing || []), ...(readiness?.salesMissing || [])].map((field) => field.key));
  const contractFields = ALL_POLICY_FIELDS.filter((field) => field.exposure === 'contract');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, minWidth: 0, overflowWrap: 'anywhere' }}>
      <WorkTable title="계약내용 확인 · 요약">
        {summary.map((row) => <WorkRow key={row.label} label={row.label}>{row.value}</WorkRow>)}
        {template ? <WorkRow label="보험">{template.insuranceSide === '고객직접' ? '보험별도 · 고객이 직접 가입' : '보험포함 · 공급사 가입'}</WorkRow> : null}
      </WorkTable>
      <WorkTable title="공급사(임대인) 정보 — 계약서에 그대로 실림" hint="비어 있는 값은 파트너사관리에서 입력합니다. 다 채워야 링크를 만들 수 있습니다.">
        <WorkRow label="상호">{val(partner?.name || partner?.partner_name)}</WorkRow>
        <WorkRow label="사업자등록번호">{val(partner?.business_number || partner?.business_no)}</WorkRow>
        <WorkRow label="대표자 · 대표번호">{S(partner?.ceo || partner?.ceo_name) ? [partner?.ceo || partner?.ceo_name, partner?.phone].filter(Boolean).join(' · ') : missing}</WorkRow>
        <WorkRow label="주소">{val(partner?.address)}</WorkRow>
        <WorkRow label="입금계좌">{S(partner?.bank_account) ? [partner?.bank_name, partner?.bank_account, partner?.bank_holder].filter(Boolean).join(' · ') : missing}</WorkRow>
      </WorkTable>
      <WorkTable
        title={`계약정책 조건 · ${S(policy?.policy_name || policy?.policy_code) || '정책 미선택'}`}
        hint="계약서·약관에 실리는 값입니다. 정책관리에서만 변경합니다."
      >
        {policy ? contractFields.map((field) => (
          <WorkRow
            key={field.key}
            label={field.article ? `${field.label} · ${field.article}` : field.label}
          >
            {S(policy[field.key]) ? S(policy[field.key]) : (missingKeys.has(field.key) ? missing : '—')}
          </WorkRow>
        )) : <WorkRow label="계약정책">공급사와 계약서 종류를 고르면 정책 조건이 여기 펼쳐집니다</WorkRow>}
      </WorkTable>
    </div>
  );
}

function draftFieldOf(contract: EntityRecord, key: string): string {
  try {
    const raw = typeof contract.contract_draft === 'string' ? JSON.parse(contract.contract_draft) : contract.contract_draft;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return S((raw as Rec)[key]);
  } catch { /* 깨진 초안은 빈값 */ }
  return '';
}
const specialTermsOf = (contract: EntityRecord) => draftFieldOf(contract, 'special_terms');
/** 계약서관리 초안이 굳힌 보증금 납부 방식(일시납·N회 분납·무보증) — 없으면 빈값(발송 전 확인이 잡는다). */
const depositInstallmentOf = (contract: EntityRecord) => draftFieldOf(contract, 'deposit_installment');

/**
 * 계약 요약 — 저장된 계약 한 건의 «한 벌» 요약. 다른 곳에 같은 표를 또 그리지 않는다.
 * 라벨은 용어표(§2-3): 공급사·계약서·계약정책·고객·차량·대여조건·추가 운전자·특약.
 */
export function EsignContractSummary({
  contract,
  policy,
  providerName,
}: {
  contract: EntityRecord;
  policy: EntityRecord | null;
  providerName: string;
}) {
  const template = findTemplate(contract.standard_template_id) || defaultStandardTemplate();
  const additionalDriverLimit = esignAdditionalDriverLimit(policy);
  const specialTerms = specialTermsOf(contract);
  return (
    <WorkTable title="계약 요약">
      <WorkRow label="공급사">{providerName || S(contract.provider_company_code) || '—'}</WorkRow>
      <WorkRow label="계약서">{template.label}</WorkRow>
      <WorkRow label="계약정책">{S(policy?.policy_name || contract.policy_code) || '—'}</WorkRow>
      <WorkRow label="고객">{[contract.customer_name, contract.customer_phone].filter(Boolean).join(' · ') || '미지정 · 링크를 받은 사람이 직접 입력'}</WorkRow>
      <WorkRow label="차량">{[contract.car_number_snapshot || '차량번호 미정', contract.vehicle_name_snapshot].filter(Boolean).join(' · ') || '—'}</WorkRow>
      <WorkRow label="대여조건">{[
          N(contract.rent_month_snapshot) ? `${N(contract.rent_month_snapshot)}개월` : '',
          `월 ${won(contract.rent_amount_snapshot)}`,
          `보증금 ${won(contract.deposit_amount_snapshot)}`,
          depositInstallmentOf(contract) && depositInstallmentOf(contract) !== '무보증' ? depositInstallmentOf(contract) : '',
          S(contract.payment_timing_snapshot),
          S(contract.driver_age_snapshot),
        ].filter(Boolean).join(' · ')}</WorkRow>
      <WorkRow label="추가 운전자">{additionalDriverLimit ? `고객이 링크에서 입력 (최대 ${additionalDriverLimit}명)` : '해당 없음'}</WorkRow>
      <WorkRow label="특약">{specialTerms || '없음'}</WorkRow>
    </WorkTable>
  );
}

/** 발행 스냅샷의 실제 손님 여정 — 진행 행의 순서·이름은 여기서만 정한다. */
function journeyRows(state: AdminState | null): Array<{ key: string; label: string }> {
  const rows: Array<{ key: string; label: string }> = [
    { key: 'summary', label: '계약 확인' },
    { key: 'privacy', label: '수집 동의' },
    { key: 'identity', label: '본인확인' },
  ];
  if (N(state?.snapshot?.additionalDriverPolicy?.limit) > 0) rows.push({ key: 'additional_driver', label: '추가 운전자' });
  for (const page of state?.snapshot?.consentPages || []) {
    const key = S(page.key);
    if (key) rows.push({ key, label: S(page.title) || '계약조건' });
  }
  rows.push({ key: 'agreement', label: '약관' }, { key: 'signature', label: '서명' });
  return rows;
}

function stageTimes(esign: FreepassEsign): Partial<Record<EsignCenterStage, number>> {
  const events = esign.state?.events || [];
  const eventAt = (type: string) => N(events.filter((event) => S(event.type) === type).map((event) => N(event.at)).sort((a, b) => b - a)[0]);
  return {
    '작성': N(esign.current.created_at || esign.current.createdAt),
    '발송 전': eventAt('issued'),
    '고객 작성 중': N(esign.state?.session?.openedAt) || eventAt('opened'),
    '검토 대기': N(esign.state?.session?.submittedAt) || eventAt('submitted'),
    '완료': N(esign.state?.session?.approvedAt) || eventAt('approved'),
  };
}

function flagsOf(esign: FreepassEsign, problems: EsignCheck[]): EsignCenterFlags {
  return esignCenterFlags(esign.current, problems, Date.now(), N(esign.state?.session?.expiresAt));
}

/* ─────────────────────────────────────────────────────────────
 * 칸 2·3 — 계약 진행: 스테퍼 · 발송 전 확인 · 현재 단계 · 요약 · 이력
 * ───────────────────────────────────────────────────────────── */
export function FreepassEsignStagePane({
  esign,
  policy,
  providerName,
  problems,
  onFixPolicy = null,
  onFixPartner = null,
}: {
  esign: FreepassEsign;
  policy: EntityRecord | null;
  providerName: string;
  problems: EsignCheck[];
  /** 정책 문제일 때 「파트너사관리에서 정책 수정」 — 이동은 화면(센터)이 안다(파트너사관리 › 운영정책 인라인 편집기). */
  onFixPolicy?: (() => void) | null;
  onFixPartner?: (() => void) | null;
}) {
  const currentUser = useSession();
  const canReview = currentUser?.role === 'admin';
  const { code, state, current, sessionStatus, issued, stage, busy, setBusy, loadError, load, run } = esign;
  const [reason, setReason] = useState('');
  const [supplementItems, setSupplementItems] = useState<Set<string>>(new Set(['identity', 'signature']));
  const [customerInsuranceEvidenceConfirmed, setCustomerInsuranceEvidenceConfirmed] = useState(false);

  const flags = flagsOf(esign, problems);
  const statePending = !state;
  const customerInsuranceEvidenceRequired = state?.snapshot?.contractKind?.insuranceSide === '고객직접'
    || (state?.snapshot?.requiredDocuments || []).some((document) => document.key === 'customer_insurance_certificate');
  const cmsRequiredBeforeHandover = state?.snapshot?.consentProfile?.cmsRequiredBeforeHandover === true;
  const needsConsentReissue = issued
    && ['sent', 'opened'].includes(sessionStatus)
    && state?.session?.customerLinkUsable === false;
  const reissueRequiresNewContract = needsConsentReissue
    && state?.session?.reissueRequiresNewContract === true;
  const legacyCompletedSession = issued
    && stage === '완료'
    && state?.session?.customerLinkUsable === false;
  useEffect(() => {
    setCustomerInsuranceEvidenceConfirmed(false);
  }, [code, state?.session?.submittedAt]);
  const flagLabel = esignCenterFlagLabel(flags);
  const blocked = problems.filter((check) => check.level === 'BLOCK');
  const times = stageTimes(esign);

  const savedHandover = current.esign_handover && typeof current.esign_handover === 'object'
    ? current.esign_handover as Rec
    : null;
  const savedDate = S(savedHandover?.handover_datetime).slice(0, 10);
  const [handoverDate, setHandoverDate] = useState(savedDate);
  useEffect(() => { setHandoverDate(savedDate); }, [savedDate, code]);

  const openAsset = async (url: string) => {
    try { await openProtected(url); }
    catch (error) { toast(error instanceof Error ? error.message : '사진을 열지 못했습니다.', 'error'); }
  };
  const toggleSupplement = (key: string) => setSupplementItems((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const saveHandover = async () => {
    if (busy || !/^\d{4}-\d{2}-\d{2}$/.test(handoverDate)) return;
    setBusy(true);
    try {
      const response = await adminFetch(`/api/freepass-esign/contracts/${encodeURIComponent(code)}/handover`, {
        method: 'POST', body: JSON.stringify({ handover_datetime: handoverDate }),
      });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || '인도일을 저장하지 못했습니다.');
      await load();
      toast('인도일을 확정했습니다.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '인도일을 저장하지 못했습니다.', 'error');
    } finally { setBusy(false); }
  };

  const progress = state?.session?.progress || {};
  const journey = useMemo(() => journeyRows(state), [state]);
  const firstOpenIndex = journey.findIndex((row) => !N(progress[row.key]));
  const lastSupplement = (state?.session?.supplements || []).slice(-1)[0];
  const supplementCount = (state?.session?.supplements || []).length;
  const events = state?.events || [];

  let stageCard: ReactNode = null;
  if (statePending && issued) {
    stageCard = (
      <EsignStageCard
        tone="flag"
        title="전자계약 상태 확인 중"
        description="서버에서 현재 전자계약 기준을 확인하고 있습니다. 확인이 끝날 때까지 고객 링크를 전달하지 마세요."
      />
    );
  } else if (needsConsentReissue) {
    stageCard = (
      <EsignStageCard
        tone="flag"
        title="고객 링크를 다시 만들어야 합니다"
        description={reissueRequiresNewContract
          ? '이전 동의 기준 링크는 더 이상 고객 정보를 받지 않습니다. 이 구 회차는 서버 동결 기준이 없어 새 계약서를 만들어야 합니다.'
          : '이전 동의 기준 링크는 더 이상 고객 정보를 받지 않습니다. 「계약서·링크」에서 새 고객 링크를 만드세요.'}
      />
    );
  } else if ((flags.revoked || flags.expired) && !needsConsentReissue) {
    stageCard = (
      <EsignStageCard
        tone="flag"
        title={flags.revoked ? '링크가 해지되었습니다' : '링크 유효기간이 끝났습니다'}
        description="「계약서·링크」에서 새 링크를 만들면 고객이 처음부터 다시 작성합니다."
      />
    );
  } else if (stage === '발송 전' && !issued) {
    stageCard = (
      <EsignStageCard
        title="계약서를 확인하고 링크를 만들 차례"
        description={blocked.length
          ? `발송 전 확인 ${blocked.length}건을 해결하면 「계약서·링크」에서 링크를 만들 수 있습니다.`
          : '「계약서·링크」에서 A4를 확인한 뒤 링크를 만듭니다. 링크는 자동 발송되지 않습니다.'}
      />
    );
  } else if (stage === '발송 전') {
    stageCard = (
      <WorkTable
        title="링크를 고객에게 전달할 차례"
        hint="「계약서·링크」에서 링크를 복사해 전달하세요. 고객이 열면 「고객 작성 중」으로 넘어갑니다."
      >
        <WorkRow label="링크 만든 시각">{stamp(times['발송 전'])}</WorkRow>
        <WorkRow label="유효기한">{stamp(state?.session?.expiresAt || current.sign_expires_at)}</WorkRow>
      </WorkTable>
    );
  } else if (stage === '고객 작성 중') {
    stageCard = (
      <>
        <Message variant={flags.rejected ? 'warning' : 'info'}>
          {flags.rejected
            ? `보완 요청 ${supplementCount}회 · 고객이 같은 링크에서 다시 제출하면 「검토 대기」로 돌아옵니다.`
            : '고객이 제출하면 「검토 대기」로 넘어옵니다. 여기서 할 일은 없습니다.'}
        </Message>
        {flags.rejected && lastSupplement ? (
          <WorkTable title="보완 요청 내용">
            <WorkRow label="요청 항목">{(lastSupplement.items || []).map((key) => SUPPLEMENT_LABEL[key] || key).join(' · ') || '—'}</WorkRow>
            <WorkRow label="사유">{S(lastSupplement.reason) || '—'}</WorkRow>
            <WorkRow label="요청 시각">{stamp(lastSupplement.requestedAt)}</WorkRow>
          </WorkTable>
        ) : null}
        <WorkTable title="고객 진행">
          {journey.map((row, index) => {
            const at = N(progress[row.key]);
            const here = !at && index === firstOpenIndex;
            return (
              <WorkRow key={row.key} label={row.label} valueStyle={{ color: at ? C.ok : here ? C.warn : C.faint }}>{at ? `완료 · ${shortStamp(at)}` : here ? '지금' : '—'}</WorkRow>
            );
          })}
        </WorkTable>
      </>
    );
  } else if (stage === '검토 대기') {
    const submission = state?.submission;
    stageCard = (
      <>
        <Message variant="info">본인확인 자료와 서명을 눈으로 확인합니다. 승인하는 순간 PDF가 만들어지고 봉인됩니다.</Message>
        {!canReview ? (
          <CenterNote minHeight={0}>관리자가 본인확인 자료와 서명을 검토합니다.</CenterNote>
        ) : !submission ? (
          loadError
            ? <Message variant="danger">제출물을 불러오지 못했습니다.</Message>
            : <CenterNote minHeight={0}>제출물을 불러오는 중입니다.</CenterNote>
        ) : (
          <>
            <WorkTable title="제출자">
              <WorkRow label="이름 · 연락처">{[submission.customerName, submission.customerPhone].filter(Boolean).join(' · ') || '—'}</WorkRow>
              <WorkRow label="운전면허번호" valueStyle={{ color: submission.driverLicenseNo ? C.ok : C.danger }}>{submission.driverLicenseNo ? '접수' : '누락'}</WorkRow>
              <WorkRow label="운전면허증" valueStyle={{ color: submission.idCard ? C.ok : C.danger }}>{submission.idCard ? '접수' : '누락'}</WorkRow>
              <WorkRow label="본인 얼굴 사진" valueStyle={{ color: submission.selfie ? C.ok : C.danger }}>{submission.selfie ? '접수' : '누락'}</WorkRow>
            </WorkTable>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {submission.assetUrls?.idCard ? <Btn title="운전면허증 확인" variant="ghost" onClick={() => void openAsset(submission.assetUrls!.idCard!)}>운전면허증 확인</Btn> : null}
              {submission.assetUrls?.selfie ? <Btn title="본인 얼굴 사진 확인" variant="ghost" onClick={() => void openAsset(submission.assetUrls!.selfie!)}>본인 얼굴 사진 확인</Btn> : null}
            </div>
            {(submission.additionalDrivers || []).length ? (
              <>
                <WorkTable title="추가 운전자">
                  {(submission.additionalDrivers || []).map((driver, index) => (
                    <WorkRow key={`${driver.name}-${index}`} label={`추가 운전자 ${index + 1}`} valueStyle={{ color: driver.driverLicenseNo && driver.license ? C.ok : C.danger }}>{[
                        driver.name,
                        driver.relation,
                        driver.phone,
                        driver.driverLicenseNo && driver.license ? '면허자료 접수' : '면허자료 누락',
                      ].filter(Boolean).join(' · ')}</WorkRow>
                  ))}
                </WorkTable>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(submission.additionalDrivers || []).map((driver, index) => driver.assetUrl ? (
                    <Btn key={driver.assetUrl} title={`추가 운전자 ${index + 1} 면허증 확인`} variant="ghost" onClick={() => void openAsset(driver.assetUrl!)}>
                      추가 운전자 {index + 1} 면허증
                    </Btn>
                  ) : null)}
                </div>
              </>
            ) : null}
            {(submission.supportingDocuments || []).length ? (
              <>
                <WorkTable title="공급사 요청서류">
                  {(submission.supportingDocuments || []).map((document, index) => (
                    <WorkRow key={document.key || index} label={document.label || `추가서류 ${index + 1}`} valueStyle={{ color: document.submitted ? C.ok : C.danger }}>{[document.required ? '필수' : '선택', document.originalName || '파일명 없음'].join(' · ')}</WorkRow>
                  ))}
                </WorkTable>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(submission.supportingDocuments || []).map((document, index) => document.assetUrl ? (
                    <Btn key={document.assetUrl} title={`${document.label || `추가서류 ${index + 1}`} 확인`} variant="ghost" onClick={() => void openAsset(document.assetUrl!)}>
                      {document.label || `추가서류 ${index + 1}`}
                    </Btn>
                  ) : null)}
                </div>
              </>
            ) : null}
            {submission.signature ? (
              <FormCard title="고객 서명">
                <img src={submission.signature} alt="고객 전자서명" style={{ display: 'block', maxWidth: '100%', maxHeight: 120 }} />
              </FormCard>
            ) : null}
            {sessionStatus === 'pending_review' ? (
              <>
                <FormCard title="보완 요청 항목">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {SUPPLEMENT_ITEMS.map((item) => (
                      <Btn key={item.key} title={item.label} size="sm" variant={supplementItems.has(item.key) ? 'solid' : 'ghost'} onClick={() => toggleSupplement(item.key)}>
                        {item.label}
                      </Btn>
                    ))}
                  </div>
                </FormCard>
                <WorkTable title="보완 사유">
                  <WorkRow label="사유">
                    <WorkTextarea value={reason} onChange={setReason} placeholder="보완 사유 (예: 운전면허증 글자가 흐려 확인이 어렵습니다)" full />
                  </WorkRow>
                </WorkTable>
                {customerInsuranceEvidenceRequired ? (
                  <Message variant="warning">
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <Checkbox
                      checked={customerInsuranceEvidenceConfirmed}
                      onChange={setCustomerInsuranceEvidenceConfirmed}
                      ariaLabel="가입증명서의 회사 질권 설정 확인"
                      style={{ marginTop: 2 }}
                    />
                    <span><b>자동차보험 가입증명서에서 회사 질권 설정을 확인했습니다.</b><br />확인 후 승인하면 파일의 해시와 확인시각만 봉인되며, 보험증권 원본은 비공개로 보관됩니다.</span>
                    </label>
                  </Message>
                ) : null}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Btn title="본인확인 및 전자서명 승인 — PDF 생성·봉인" disabled={busy || (customerInsuranceEvidenceRequired && !customerInsuranceEvidenceConfirmed)} onClick={() => void run({ action: 'approve', ...(customerInsuranceEvidenceRequired ? { customerInsuranceEvidenceConfirmed } : {}) }, '승인하고 봉인했습니다.')}>
                    <ButtonLabel icon={<CheckCircle2 size={ICON.md} aria-hidden />}>승인</ButtonLabel>
                  </Btn>
                  <Btn title="같은 링크로 보완 요청" variant="ghost" disabled={busy || supplementItems.size === 0} onClick={() => void run({ action: 'reject', reason, items: [...supplementItems] }, '같은 링크로 보완을 요청했습니다.')}>
                    <ButtonLabel icon={<XCircle size={ICON.md} aria-hidden />}>보완 요청</ButtonLabel>
                  </Btn>
                </div>
              </>
            ) : (
              <Badge tone="amber" variant="fill">{sessionStatus === 'approving' ? '승인 처리 중' : sessionStatus === 'rejecting' ? '보완 요청 처리 중' : '처리 중'}</Badge>
            )}
          </>
        )}
      </>
    );
  } else if (stage === '완료') {
    stageCard = (
      <>
        <Message variant="info">
          {legacyCompletedSession
            ? '구 동의 기준으로 완료된 회차입니다. 봉인 PDF 열람은 유지하지만 인도·차량잠금·정산은 현행 전자계약으로 새로 진행해야 합니다.'
            : cmsRequiredBeforeHandover
            ? '승인 시점의 데이터·서명·타임스탬프로 봉인됐습니다. CMS 별도 등록이 끝나기 전에는 인도일을 확정할 수 없습니다.'
            : '승인 시점의 데이터·서명·타임스탬프로 봉인됐습니다. PDF는 「계약서·링크」에서 엽니다. 인도일을 확정하면 계약 시작·종료일이 정해집니다.'}
        </Message>
        <WorkTable title="봉인">
          <WorkRow label="승인·봉인">{stamp(times['완료'])}</WorkRow>
          <WorkRow label="봉인 해시">{S(current.esign_seal_hash) ? `${S(current.esign_seal_hash).slice(0, 16)}…` : '—'}</WorkRow>
        </WorkTable>
        {canReview && legacyCompletedSession ? (
          <Message variant="warning">
            구 동의 기준 회차는 인도일을 확정할 수 없습니다. 봉인 PDF만 보관하고, 현행 동의 기준으로 새 전자계약을 만들어 진행하세요.
          </Message>
        ) : canReview ? (
          <>
            <WorkTable title="인도일 확정">
              <WorkRow label="인도일">
                {savedDate
                  ? `${savedDate}${savedHandover?.contract_start ? ` · ${S(savedHandover.contract_start)} ~ ${S(savedHandover.contract_end)}` : ''}`
                  : '아직 인도일 없음'}
              </WorkRow>
              {cmsRequiredBeforeHandover ? null : (
                <WorkRow label="확정">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <WorkInput type="date" value={handoverDate} onChange={setHandoverDate} ariaLabel="차량 인도일" full />
                    <Btn title={savedDate ? '인도일 다시 확정' : '인도일 확정'} disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(handoverDate)} onClick={() => void saveHandover()}>
                      {busy ? '저장 중…' : savedDate ? '인도일 다시 확정' : '인도일 확정'}
                    </Btn>
                  </div>
                </WorkRow>
              )}
            </WorkTable>
            {cmsRequiredBeforeHandover ? (
              <Message variant="warning">
                CMS 출금동의·예금주 인증은 별도 등록 절차입니다. 현재 전자계약에는 실제 CMS 등록 기능이 없으므로, 등록 증빙이 연동되기 전까지 인도일을 확정할 수 없습니다.
              </Message>
            ) : null}
          </>
        ) : null}
      </>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, minWidth: 0, overflowWrap: 'anywhere' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <EsignStageStepper current={stage} times={times} flagLabel={flagLabel} />
        </div>
        {issued ? (
          <Btn title="진행상황 새로고침" variant="ghost" size="sm" onClick={() => void load()}>
            <ButtonLabel icon={<RefreshCw size={ICON.md} aria-hidden />}>새로고침</ButtonLabel>
          </Btn>
        ) : null}
      </div>
      {loadError ? <Message variant="danger">{loadError}</Message> : null}
      {stage !== '완료' ? (
        <EsignProblemList
          problems={problems}
          onFixPolicy={onFixPolicy}
          onFixPartner={onFixPartner}
          partnerName={providerName}
        />
      ) : null}
      {stageCard}
      <EsignContractSummary contract={current} policy={policy} providerName={providerName} />
      {issued ? (
        <WorkTable title="이력" hint="운전면허증·얼굴 사진 원본과 서명은 공개 계약 데이터가 아니라 서버 전용 저장소에 보관됩니다.">
          {events.length ? events.map((event, index) => (
            <WorkRow key={`${event.type}-${event.at}-${index}`} label={EVENT_LABEL[S(event.type)] || S(event.type)}>{[stamp(event.at), event.handoverDate, ...(event.items || []).map((key) => SUPPLEMENT_LABEL[key] || key)].filter(Boolean).join(' · ')}</WorkRow>
          )) : <WorkRow label="진행 이력">—</WorkRow>}
        </WorkTable>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 칸 4 — 계약서·링크: A4 미리보기 · 링크 만들기/복사/해지 · 모바일 미리보기 · 완료 PDF
 * ───────────────────────────────────────────────────────────── */
export function FreepassEsignDocumentPane({
  esign,
  policy,
  partner,
  providerName,
  problems,
  basePath = '/esign',
  onCreateNewContract = null,
}: {
  esign: FreepassEsign;
  policy: EntityRecord | null;
  partner: EntityRecord | null;
  providerName: string;
  problems: EsignCheck[];
  basePath?: string;
  onCreateNewContract?: (() => void) | null;
}) {
  const { code, state, current, sessionStatus, issued, stage, busy, run } = esign;
  const flags = flagsOf(esign, problems);
  const blocked = problems.filter((check) => check.level === 'BLOCK');
  // 목록 캐시는 구형 public URL을 잠깐 품고 있을 수 있다. 서버 상태 응답을 받기 전에는
  // bearer 링크를 화면·클립보드·고객 미리보기 어느 쪽에도 쓰지 않는다.
  const statePending = !state;
  const savedLink = statePending ? '' : S(current.esign_sign_url);
  const linkExpiresAt = N(state?.session?.expiresAt || current.sign_expires_at);
  const tpl = findTemplate(current.standard_template_id) || defaultStandardTemplate();
  const maturity = maturityOf(current) || '반납형';
  const spec = contractKindFor(tpl, maturity);
  const selectionError = tpl && spec ? standardTemplateSelectionError(tpl, spec, policy) : '';
  // v1 링크는 고객 화면에서 개인정보를 더 받지 않고 재발행 안내(409)로 닫는다.
  // 목록에서 계속 복사·따라보기가 가능하면 끊긴 링크를 다시 전달하게 되므로, 영업 화면도
  // 같은 경계를 보여 주고 현재 정책으로 새 v2 링크를 발행하게 한다.
  const needsConsentReissue = issued
    && ['sent', 'opened'].includes(sessionStatus)
    && state?.session?.customerLinkUsable === false;
  const reissueRequiresNewContract = needsConsentReissue
    && state?.session?.reissueRequiresNewContract === true;
  const link = needsConsentReissue ? '' : savedLink;
  const linkRecoveryNeeded = issued && !savedLink && ['sent', 'opened'].includes(sessionStatus);

  const issue = (success: string) => run({ action: 'issue', standardTemplateId: tpl.id, contractKind: spec?.key }, success);
  const copyLink = () => {
    if (!link) { toast('복사할 링크가 없습니다.', 'error'); return; }
    void copyText(link).then((ok) => toast(ok ? '링크를 복사했습니다. 고객에게 전달하세요.' : '링크 복사에 실패했습니다.', ok ? 'ok' : 'error'));
  };
  const previewUrl = (view: 'mobile' | 'a4') => {
    const params = new URLSearchParams();
    if (view === 'a4') params.set('view', 'a4');
    params.set('back', basePath);
    return `/esign/preview/${encodeURIComponent(code)}?${params.toString()}`;
  };
  const a4Button = (
    <Btn title="A4 PDF 계약서와 약관 미리보기" variant="ghost" onClick={() => window.open(previewUrl('a4'), '_blank', 'noreferrer')}>
      <ButtonLabel icon={<ExternalLink size={ICON.md} aria-hidden />}>A4 미리보기</ButtonLabel>
    </Btn>
  );
  /**
   * 손님 화면 — 새 탭 대신 **오버레이로 보면서 「다음」을 눌러 안내**한다(사장님 2026-08-20).
   *   같은 출처 링크에 ?preview=1 을 붙여 폰 프레임으로 띄운다(열람·제출 기록 없음).
   */
  const mobileButton = issued && link ? (
    <EsignCustomerWalkthroughButton
      url={`${link}${link.includes('?') ? '&' : '?'}preview=1`}
      customerName={S(current.customer_name)}
    />
  ) : null;
  const linkBlock = (
    <div style={{ display: 'grid', gap: 5 }}>
      <Message variant="info">고객 링크 · 유효기한 {linkExpiresAt ? stamp(linkExpiresAt) : '—'}</Message>
      <Input value={link} onChange={() => {}} ariaLabel="고객 링크" type="url" full readOnly style={{ minWidth: 0 }} />
      <Btn full title="링크 복사" disabled={!link} onClick={copyLink}>
        <ButtonLabel icon={<Copy size={ICON.md} aria-hidden />}>링크 복사</ButtonLabel>
      </Btn>
    </div>
  );

  let card: ReactNode;
  if (statePending && issued) {
    card = (
      <EsignStageCard
        tone="flag"
        title="고객 링크 확인 중"
        description="서버에서 현재 전자계약 기준을 확인하고 있습니다. 확인이 끝날 때까지 링크를 전달하지 마세요."
      />
    );
  } else if ((flags.revoked || flags.expired) && !needsConsentReissue) {
    card = (
      <EsignStageCard tone="flag" title="링크 다시 만들기" description={flags.revoked ? '해지된 링크는 다시 쓸 수 없습니다.' : '유효기간이 지난 링크는 다시 쓸 수 없습니다.'}>
        <Btn full title="같은 계약 내용으로 새 고객 링크 만들기" disabled={busy || blocked.length > 0} onClick={() => void issue('새 링크를 만들었습니다. 링크를 복사해 고객에게 전달하세요.')}>
          {busy ? '링크 만드는 중…' : '링크 다시 만들기'}
        </Btn>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{a4Button}</div>
      </EsignStageCard>
    );
  } else if (needsConsentReissue) {
    card = (
      <EsignStageCard
        tone="flag"
        title={reissueRequiresNewContract ? '새 계약서 만들기' : '고객 링크 다시 만들기'}
        description={reissueRequiresNewContract
          ? '이전 동의 기준 링크는 더 이상 고객 정보를 받지 않습니다. 이 구 회차는 서버 동결 기준이 없어 새 계약서로 다시 작성해야 합니다.'
          : '이전 동의 기준 링크는 더 이상 고객 정보를 받지 않습니다. 현재 계약 조건으로 새 고객 링크를 만드세요.'}
      >
        <Btn
          full
          title={reissueRequiresNewContract ? '새 전자계약 초안 만들기' : '현재 계약 조건으로 새 고객 링크 만들기'}
          disabled={busy || (reissueRequiresNewContract && !onCreateNewContract)}
          onClick={() => {
            if (reissueRequiresNewContract) onCreateNewContract?.();
            else void issue('새 동의 기준으로 고객 링크를 만들었습니다. 링크를 복사해 고객에게 전달하세요.');
          }}
        >
          {busy ? '링크 만드는 중…' : reissueRequiresNewContract ? '새 계약서 만들기' : '새 고객 링크 만들기'}
        </Btn>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{a4Button}</div>
      </EsignStageCard>
    );
  } else if (linkRecoveryNeeded) {
    card = (
      <EsignStageCard
        tone="flag"
        title="고객 링크 복구"
        description="기존 링크를 서버 전용 보관소로 안전하게 옮깁니다. 기존 링크를 확인할 수 없으면 새 링크로 교체합니다."
      >
        <Btn
          full
          title="고객 링크를 안전하게 복구하거나 새로 발행"
          disabled={busy}
          onClick={() => void issue('고객 링크를 안전하게 복구했습니다. 링크를 복사해 고객에게 전달하세요.')}
        >
          {busy ? '링크 복구 중…' : '고객 링크 복구'}
        </Btn>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{a4Button}</div>
      </EsignStageCard>
    );
  } else if (stage === '발송 전' && !issued) {
    card = (
      <>
        {selectionError ? <Badge tone="red" variant="solid">{selectionError}</Badge> : null}
        <WorkTable
          title="A4 확인 → 링크 만들기"
          hint="링크는 자동 발송되지 않습니다. 만든 뒤 복사해서 고객에게 전달합니다."
        >
          <WorkRow label="계약서">{tpl.label}</WorkRow>
          <WorkRow label="보험">{tpl.insuranceSide === '고객직접' ? '보험별도' : '보험포함'}</WorkRow>
          <WorkRow label="만기">{S(current.contract_draft).includes('buyback_price') ? '인수옵션 · 계약서 기재값' : '반납'}</WorkRow>
        </WorkTable>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{a4Button}</div>
        <Btn
          full
          title={blocked.length ? `발송 전 확인 ${blocked.length}건을 먼저 해결해야 링크를 만들 수 있습니다` : '고객이 본인확인하고 서명할 링크 만들기'}
          disabled={busy || !!selectionError || blocked.length > 0}
          onClick={() => void issue('링크를 만들었습니다. 링크를 복사해 고객에게 전달하세요.')}
        >
          {busy ? '링크 만드는 중…' : blocked.length ? `링크 만들기 · 확인 ${blocked.length}건` : '링크 만들기'}
        </Btn>
        <Message variant="info">수신자를 미리 지정하지 않는 링크입니다. 최초 제출자가 계약자로 접수됩니다.</Message>
      </>
    );
  } else if (stage === '발송 전' || stage === '고객 작성 중') {
    card = (
      <EsignStageCard title="고객 링크" description={stage === '발송 전' ? '복사해서 고객에게 전달하세요.' : '고객이 작성 중인 링크입니다. 다시 보내야 하면 복사하세요.'}>
        {linkBlock}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {mobileButton}
          {a4Button}
          {['sent', 'opened'].includes(sessionStatus) ? (
            <Btn title="링크 해지" variant="ghost" disabled={busy} onClick={() => void run({ action: 'revoke' }, '링크를 해지했습니다.')}>
              <ButtonLabel icon={<Link2Off size={ICON.md} aria-hidden />}>링크 해지</ButtonLabel>
            </Btn>
          ) : null}
        </div>
      </EsignStageCard>
    );
  } else if (stage === '검토 대기') {
    card = (
      <EsignStageCard title="계약서" description="고객이 제출을 마쳤습니다. 승인하면 완료 PDF가 여기서 열립니다.">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{a4Button}</div>
      </EsignStageCard>
    );
  } else if (stage === '완료') {
    card = (
      <EsignStageCard title="완료 PDF" description="봉인된 완료본입니다. 봉인 검증 페이지에서 해시를 대조할 수 있습니다.">
        <Btn full title="완료 PDF 열기" onClick={() => void openProtected(`/api/freepass-esign/contracts/${encodeURIComponent(code)}/document?format=pdf`).catch((e) => toast(String(e.message || e), 'error'))}>
          <ButtonLabel icon={<FileDown size={ICON.md} aria-hidden />}>완료 PDF</ButtonLabel>
        </Btn>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn title="차량별 또는 같은 임차인 여러 차량의 사실확인서 발급" variant="ghost" onClick={() => window.open(`/erp5/esign/issuance?contract=${encodeURIComponent(code)}`, '_blank', 'noreferrer')}>
            <ButtonLabel icon={<FileText size={ICON.md} aria-hidden />}>발급 서류</ButtonLabel>
          </Btn>
          {current.esign_verify_url ? (
            <Btn title="봉인 검증 페이지" variant="ghost" onClick={() => window.open(S(current.esign_verify_url), '_blank', 'noreferrer')}>봉인 검증</Btn>
          ) : null}
        </div>
      </EsignStageCard>
    );
  } else {
    card = <CenterNote minHeight={0}>계약 상태를 확인하는 중입니다.</CenterNote>;
  }

  const consentPages = state?.snapshot?.consentPages || [];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, minWidth: 0, overflowWrap: 'anywhere' }}>
      {card}
      {consentPages.length ? (
        <>
          {/* 발행 뒤에는 발행 당시 동결값이 계약내용이다 — 접지 않고 쭉 펼친다(고객이 보는 섹션 순서 그대로). */}
          {consentPages.map((page) => (
            <WorkTable key={page.key || page.title} title={page.title} hint={page.note}>
              {(page.rows || []).map((row, index) => (
                <WorkRow key={`${row.label}-${index}`} label={row.label || '항목'}>{row.value || '—'}</WorkRow>
              ))}
            </WorkTable>
          ))}
        </>
      ) : (
        <EsignContractContentPane
          partner={partner}
          policy={policy}
          template={tpl}
          summary={[
            { label: '공급사', value: providerName || S(current.provider_company_code) || '—' },
            { label: '계약서', value: tpl.label, stacked: true },
            { label: '차량', value: [current.car_number_snapshot || '차량번호 미정', current.vehicle_name_snapshot].filter(Boolean).join(' · ') || '—', stacked: true },
            {
              label: '대여조건',
              value: [
                N(current.rent_month_snapshot) ? `${N(current.rent_month_snapshot)}개월` : '',
                `월 ${won(current.rent_amount_snapshot)}`,
                `보증금 ${won(current.deposit_amount_snapshot)}`,
                depositInstallmentOf(current) && depositInstallmentOf(current) !== '무보증' ? depositInstallmentOf(current) : '',
                S(current.payment_timing_snapshot),
                S(current.driver_age_snapshot),
              ].filter(Boolean).join(' · '),
              stacked: true,
            },
            { label: '특약', value: specialTermsOf(current) || '없음', stacked: true },
          ]}
        />
      )}
    </div>
  );
}

/** 칸 4 — 초안(작성)·선택 없음일 때: 여기서 무엇이 열리는지 한 줄. */
export function EsignDocumentPlaceholder({ drafting }: { drafting: boolean }) {
  return (
    <EsignStageCard
      tone="quiet"
      title={drafting ? '계약내용 확인' : '계약서·링크'}
      description={drafting
        ? '공급사·계약서 종류·계약정책을 고르면 그 조건이 여기 쭉 펼쳐집니다.'
        : '계약을 고르면 그 계약의 A4·고객 링크·완료 PDF가 여기 열립니다.'}
    />
  );
}
