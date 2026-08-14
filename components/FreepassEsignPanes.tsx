'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { getAuthClient } from '@/lib/firebase/client';
import {
  contractKindFor,
  defaultStandardTemplate,
  findTemplate,
  maturityOf,
  standardTemplateSelectionError,
} from '@/lib/domain/esign-templates';
import { ESIGN_STEPS } from '@/lib/domain/esign-progress';
import { copyText } from '@/lib/clipboard';
import { toast } from '@/components/Toaster';
import {
  Badge, Btn, ButtonLabel, C, CenterNote, DetailRow, FS, FW, ICON,
  Input, ListGroup, SectionLabel, Textarea,
} from '@/components/ui';
import { CheckCircle2, Copy, ExternalLink, FileDown, Link2Off, RefreshCw, Smartphone, XCircle } from 'lucide-react';

type Rec = Record<string, unknown>;
type AdminState = {
  contract?: EntityRecord;
  snapshot?: {
    consentPages?: Array<{
      key?: string;
      title?: string;
      note?: string;
      rows?: Array<{ label?: string; value?: string }>;
    }>;
    template?: { label?: string; version?: string };
    contractKind?: { title?: string; maturity?: string };
  } | null;
  session?: {
    status?: string;
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
    assetUrls?: { idCard?: string; selfie?: string };
  } | null;
  events?: Array<{ type?: string; at?: number; reason?: string; items?: string[]; handoverDate?: string }>;
};

const S = (value: unknown) => String(value ?? '').trim();
const N = (value: unknown) => Number(value || 0) || 0;
const won = (value: unknown) => `${N(value).toLocaleString('ko-KR')}원`;

async function bearer(forceRefresh = false) {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('관리자 로그인이 필요합니다.');
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

export function FreepassEsignLinkPane({
  contract,
  policy,
  onChanged,
}: {
  contract: EntityRecord | null;
  policy: EntityRecord | null;
  onChanged: () => void | Promise<void>;
}) {
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

  if (!contract) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionLabel>계약서 작성에서 할 일</SectionLabel>
      <ListGroup>
        <DetailRow label="계약서 확인" value="선택한 회사·계약서와 건별 조건을 최종 확인" stacked />
        <DetailRow label="서면 계약" value="A4 계약서를 출력해 자필서명 또는 법인 기명날인" stacked />
        <DetailRow label="전자계약" value="고객 작성용 보안 링크를 생성해 본인확인·전자서명" stacked />
      </ListGroup>
      <CenterNote minHeight={0}>입력 패널에서 회사와 계약서를 선택하고 조건값을 입력한 뒤 초안을 만드세요.</CenterNote>
    </div>
  );
  const current = state?.contract || contract;
  const issued = S(current.esign_provider) === 'freepass' && !!S(current.esign_id);
  const completed = S(current.sign_status) === '서명완료';
  const link = S(current.esign_sign_url);
  const sessionStatus = S(state?.session?.status);
  const linkExpiresAt = N(state?.session?.expiresAt || current.sign_expires_at);
  const expired = !completed
    && !['pending_review', 'signed'].includes(sessionStatus)
    && linkExpiresAt > 0
    && linkExpiresAt <= Date.now();
  const linkInactive = sessionStatus === 'revoked' || N(current.sign_revoked_at) > 0 || expired;
  const linkStatusLabel = ({
    sent: '발행', opened: '고객 열람', pending_review: '관리자 검토대기',
    approving: '승인 처리 중', signed: '완료', revoked: '해지',
  } as Record<string, string>)[sessionStatus] || S(current.sign_status) || '상태 확인 중';
  const tpl = findTemplate(current.standard_template_id) || defaultStandardTemplate();
  const maturity = maturityOf(current) || '반납형';
  const spec = contractKindFor(tpl, maturity);
  const selectionError = tpl && spec ? standardTemplateSelectionError(tpl, spec, policy) : '';

  const copyLink = () => {
    if (!link) {
      toast('복사할 계약 링크가 없습니다.', 'error');
      return;
    }
    void copyText(link).then((ok) => toast(
      ok ? '계약 링크를 복사했습니다. 영업자에게 전달하세요.' : '링크 복사에 실패했습니다.',
      ok ? 'ok' : 'error',
    ));
  };

  const run = async (body: Rec, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      setState(await actionFor(code, body));
      await onChanged();
      toast(success, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '전자계약 작업에 실패했습니다.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionLabel>프리패스 데이터 확인</SectionLabel>
      {loadError ? <Badge tone="red" variant="solid">{loadError}</Badge> : null}
      <ListGroup>
        <DetailRow label="고객" value={[current.customer_name, current.customer_phone].filter(Boolean).join(' · ') || '값 필요'} />
        <DetailRow label="차량" value={[current.car_number_snapshot, current.vehicle_name_snapshot].filter(Boolean).join(' · ') || '값 필요'} />
        <DetailRow label="대여조건" value={`${N(current.rent_month_snapshot) || '—'}개월 · 월 ${won(current.rent_amount_snapshot)} · 보증금 ${won(current.deposit_amount_snapshot)}`} stacked />
      </ListGroup>

      {!issued ? (
        <>
          {selectionError ? <Badge tone="red" variant="solid">{selectionError}</Badge> : null}
          {!selectionError ? (
            <>
              <ListGroup header="발행할 계약서">
                <DetailRow label="확정 계약서" value={tpl.label} />
                <DetailRow label="보험" value={tpl.insuranceSide === '고객직접' ? '보험별도' : '보험포함'} />
                <DetailRow label="만기 인수옵션" value={S(current.contract_draft).includes('buyback_price') ? '계약서 기재값 적용' : '없음 · 만기 반납'} />
              </ListGroup>
              <SectionLabel>① 생성된 계약서 미리보기</SectionLabel>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Btn
                  title="A4 계약서 미리보기"
                  onClick={() => void openProtected(`/api/freepass-esign/contracts/${encodeURIComponent(code)}/document?draft=1`).catch((e) => toast(String(e.message || e), 'error'))}
                >
                  <ButtonLabel icon={<ExternalLink size={ICON.md} aria-hidden />}>A4 미리보기</ButtonLabel>
                </Btn>
                <Btn
                  title="지류 계약용 A4 PDF 열기"
                  variant="ghost"
                  onClick={() => void openProtected(`/api/freepass-esign/contracts/${encodeURIComponent(code)}/document?format=pdf&draft=1`).catch((e) => toast(String(e.message || e), 'error'))}
                >
                  <ButtonLabel icon={<FileDown size={ICON.md} aria-hidden />}>A4 계약서 출력</ButtonLabel>
                </Btn>
              </div>
              <div style={{ fontSize: FS.cap, color: C.faint }}>먼저 고객에게 전달될 계약서와 약관을 확인합니다. 서면 계약이면 이 PDF를 출력해 서명·기명날인합니다.</div>

              <SectionLabel>② 계약 링크 만들기</SectionLabel>
              <Btn
                full
                title="고객이 본인확인하고 서명할 계약 링크 만들기"
                disabled={busy}
                onClick={() => void run({
                  action: 'issue', standardTemplateId: tpl.id, contractKind: spec.key,
                }, '계약 링크를 만들었습니다. 링크를 복사해 영업자에게 전달하세요.')}
              >
                {busy ? '링크 만드는 중…' : '계약 링크 만들기'}
              </Btn>
              <div style={{ fontSize: FS.cap, color: C.faint }}>링크만 생성됩니다. 링크를 복사해 영업자에게 전달하면 영업자가 고객에게 안내합니다.</div>
            </>
          ) : null}
        </>
      ) : (
        <>
          {completed ? (
            <Badge tone="green" variant="solid">완료 계약서는 읽기 전용입니다. 완료 PDF는 진행상황에서 내려받으세요.</Badge>
          ) : linkInactive ? (
            <>
              <Badge tone="amber" variant="solid">
                {expired ? '고객 작성 링크의 유효기간이 끝났습니다.' : '고객 작성 링크가 해지되었습니다.'}
              </Badge>
              <Btn
                title="같은 계약 내용으로 새 고객 작성 링크 생성"
                disabled={busy}
                onClick={() => void run({
                  action: 'issue', standardTemplateId: tpl.id, contractKind: spec.key,
                }, '새 전자서명 링크를 만들었습니다.')}
              >
                {busy ? '새 링크 생성 중…' : '새 링크 다시 생성'}
              </Btn>
            </>
          ) : (
            <>
              <SectionLabel>① 계약 링크 복사·전달</SectionLabel>
              <ListGroup>
                <DetailRow label="링크 상태" value={linkStatusLabel} />
                <DetailRow label="유효기한" value={linkExpiresAt ? stamp(linkExpiresAt) : '확인 필요'} />
              </ListGroup>
              <div style={{ display: 'grid', gap: 5 }}>
                <div style={{ fontSize: FS.cap, color: C.mute }}>계약 링크</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
                  <Input
                    value={link}
                    onChange={() => {}}
                    ariaLabel="계약 링크"
                    type="url"
                    full
                    readOnly
                    style={{ minWidth: 0 }}
                  />
                  <Btn title="계약 링크 복사" disabled={!link} onClick={copyLink}>
                    <ButtonLabel icon={<Copy size={ICON.md} aria-hidden />}>링크 복사</ButtonLabel>
                  </Btn>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Btn title="고객 모바일 화면과 전자계약서 보기" variant="ghost" onClick={() => window.open(`/esign/preview/${encodeURIComponent(code)}`, '_blank', 'noreferrer')}>
                  <ButtonLabel icon={<Smartphone size={ICON.md} aria-hidden />}>고객 화면 미리보기</ButtonLabel>
                </Btn>
                <Btn title="고객 화면 열기" variant="ghost" onClick={() => window.open(link, '_blank', 'noreferrer')}>
                  <ButtonLabel icon={<ExternalLink size={ICON.md} aria-hidden />}>고객 화면</ButtonLabel>
                </Btn>
                <Btn title="링크 해지" variant="ghost" disabled={busy} onClick={() => void run({ action: 'revoke' }, '서명 링크를 해지했습니다.')}>
                  <ButtonLabel icon={<Link2Off size={ICON.md} aria-hidden />}>링크 해지</ButtonLabel>
                </Btn>
              </div>
              <div style={{ fontSize: FS.cap, color: C.faint }}>링크를 복사해 영업자에게 전달하세요. 영업자가 고객에게 전달하면 고객이 직접 정보를 입력하고 계약 내용을 확인·서명합니다.</div>
              <SectionLabel>② A4 계약서 확인·출력</SectionLabel>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Btn title="A4 초안 미리보기" variant="ghost" onClick={() => void openProtected(`/api/freepass-esign/contracts/${encodeURIComponent(code)}/document?draft=1`).catch((e) => toast(String(e.message || e), 'error'))}>
                  미리보기
                </Btn>
                <Btn title="A4 초안 PDF" onClick={() => void openProtected(`/api/freepass-esign/contracts/${encodeURIComponent(code)}/document?format=pdf&draft=1`).catch((e) => toast(String(e.message || e), 'error'))}>
                  <ButtonLabel icon={<FileDown size={ICON.md} aria-hidden />}>A4 계약서 출력</ButtonLabel>
                </Btn>
              </div>
              <div style={{ fontSize: FS.cap, color: C.faint }}>전자계약은 링크를 복사해 전달하고, 서면 계약은 위 A4 계약서를 출력해 서명·기명날인합니다.</div>
            </>
          )}
          {(state?.snapshot?.consentPages || []).length ? (
            <details>
              <summary style={{ cursor: 'pointer', color: C.mute, fontSize: FS.sub }}>발행 당시 계약 내용 보기</summary>
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5 }}>
                  발행 당시 값으로 동결된 내용입니다. 고객은 아래 섹션을 하나씩 확인한 뒤 서명합니다.
                </div>
                {(state?.snapshot?.consentPages || []).map((page) => (
                  <ListGroup key={page.key || page.title} header={page.title} footer={page.note}>
                    {(page.rows || []).map((row, index) => (
                      <DetailRow key={`${row.label}-${index}`} label={row.label || '항목'} value={row.value || '—'} stacked />
                    ))}
                  </ListGroup>
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  issued: '링크 발행', opened: '고객 열람', submitted: '본인확인·서명 제출',
  rejected: '보완 요청', approved: '관리자 승인·봉인', revoked: '링크 해지',
  handover_confirmed: '인도일 확정',
};
const SUPPLEMENT_ITEMS = [
  { key: 'identity', label: '운전면허증·셀카' },
  { key: 'contract', label: '계약정보' },
  { key: 'agreement', label: '약관확인' },
  { key: 'signature', label: '서명' },
] as const;

export function FreepassEsignProgressPane({
  contract,
  onChanged,
}: {
  contract: EntityRecord | null;
  onChanged: () => void | Promise<void>;
}) {
  const code = S(contract?.contract_code);
  const [state, setState] = useState<AdminState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reason, setReason] = useState('');
  const [supplementItems, setSupplementItems] = useState<Set<string>>(new Set(['identity', 'signature']));
  const current = state?.contract || contract;
  const savedHandover = current?.esign_handover && typeof current.esign_handover === 'object'
    ? current.esign_handover as Rec
    : null;
  const savedDate = S(savedHandover?.handover_datetime).slice(0, 10);
  const [handoverDate, setHandoverDate] = useState(savedDate);
  const load = useCallback(async () => {
    if (!code) { setState(null); return; }
    try { setState(await stateFor(code)); setLoadError(''); }
    catch (error) {
      setState(null);
      setLoadError(error instanceof Error ? error.message : '전자계약 진행상황을 불러오지 못했습니다.');
    }
  }, [code]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [code, load]);
  useEffect(() => { setHandoverDate(savedDate); }, [savedDate, code]);

  if (!contract) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionLabel>발송 후 진행 흐름</SectionLabel>
      <ListGroup>
        <DetailRow label="1. 발송" value="고객에게 보안 링크 전달" />
        <DetailRow label="2. 고객 확인" value="계약조건·약관 확인 및 본인인증" />
        <DetailRow label="3. 전자서명" value="고객 서명 제출" />
        <DetailRow label="4. 관리자 확인" value="서명 검토·보완 요청 또는 승인" />
        <DetailRow label="5. 완료" value="봉인 PDF 보관 및 인도일 확정" />
      </ListGroup>
      <CenterNote minHeight={0}>계약서를 발송하면 각 단계의 시간과 상태가 여기에 표시됩니다.</CenterNote>
    </div>
  );
  const active = current || contract;
  const sessionStatus = S(state?.session?.status);
  const issued = S(active.esign_provider) === 'freepass' && !!S(active.esign_id);
  if (!issued) return loadError
    ? <Badge tone="red" variant="solid">{loadError}</Badge>
    : <CenterNote>③에서 프리패스 전자계약 링크를 먼저 만드세요.</CenterNote>;
  const progress = Math.max(0, Math.min(8, N(active.esign_progress)));
  const displayStatus = sessionStatus === 'approving' ? '승인 처리 중' : (S(active.sign_status) || '발행');

  const run = async (body: Rec, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      setState(await actionFor(code, body));
      await onChanged();
      toast(success, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '전자계약 작업에 실패했습니다.', 'error');
    } finally { setBusy(false); }
  };

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
      await Promise.all([load(), onChanged()]);
      toast('인도일을 확정했습니다.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '인도일을 저장하지 못했습니다.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {loadError ? <Badge tone="red" variant="solid">{loadError}</Badge> : null}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge tone={displayStatus === '서명완료' ? 'green' : displayStatus === '반려' ? 'red' : displayStatus === '검토대기' ? 'amber' : 'blue'} variant="solid">
          {displayStatus}
        </Badge>
        <span style={{ flex: 1 }} />
        <Btn title="진행상황 새로고침" variant="ghost" onClick={() => void load()}>
          <ButtonLabel icon={<RefreshCw size={ICON.md} aria-hidden />}>새로고침</ButtonLabel>
        </Btn>
      </div>

      <SectionLabel>고객 진행</SectionLabel>
      <ListGroup>
        {ESIGN_STEPS.map((step, index) => {
          const done = displayStatus === '서명완료' || index < progress;
          const here = displayStatus !== '서명완료' && index === progress && sessionStatus !== 'sent';
          return <DetailRow key={step.key} label={step.label} value={done ? '완료' : here ? '지금' : '—'} valueColor={done ? C.ok : here ? C.warn : C.faint} />;
        })}
      </ListGroup>

      <SectionLabel>본인확인·서명 검토</SectionLabel>
      {state?.submission ? (
        <>
          <ListGroup>
            <DetailRow label="제출자" value={[state.submission.customerName, state.submission.customerPhone].filter(Boolean).join(' · ') || '—'} />
            <DetailRow label="운전면허번호" value={state.submission.driverLicenseNo ? '접수' : '누락'} valueColor={state.submission.driverLicenseNo ? C.ok : C.danger} />
            <DetailRow label="운전면허증" value={state.submission.idCard ? '접수' : '누락'} valueColor={state.submission.idCard ? C.ok : C.danger} />
            <DetailRow label="본인 셀카" value={state.submission.selfie ? '접수' : '누락'} valueColor={state.submission.selfie ? C.ok : C.danger} />
          </ListGroup>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {state.submission.assetUrls?.idCard ? <Btn title="운전면허증 확인" variant="ghost" onClick={() => void openAsset(state.submission!.assetUrls!.idCard!)}>운전면허증 확인</Btn> : null}
            {state.submission.assetUrls?.selfie ? <Btn title="셀카 확인" variant="ghost" onClick={() => void openAsset(state.submission!.assetUrls!.selfie!)}>셀카 확인</Btn> : null}
          </div>
          {(state.submission.additionalDrivers || []).length ? (
            <>
              <SectionLabel>추가 운전자 확인</SectionLabel>
              <ListGroup>
                {(state.submission.additionalDrivers || []).map((driver, index) => (
                  <DetailRow
                    key={`${driver.name}-${index}`}
                    label={`추가 운전자 ${index + 1}`}
                    value={[
                      driver.name,
                      driver.relation,
                      driver.phone,
                      driver.driverLicenseNo && driver.license ? '면허자료 접수' : '면허자료 누락',
                    ].filter(Boolean).join(' · ')}
                    valueColor={driver.driverLicenseNo && driver.license ? C.ok : C.danger}
                    stacked
                  />
                ))}
              </ListGroup>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(state.submission.additionalDrivers || []).map((driver, index) => driver.assetUrl ? (
                  <Btn key={driver.assetUrl} title={`추가 운전자 ${index + 1} 면허증 확인`} variant="ghost" onClick={() => void openAsset(driver.assetUrl!)}>
                    추가 운전자 {index + 1} 면허증
                  </Btn>
                ) : null)}
              </div>
            </>
          ) : null}
          {state.submission.signature ? (
            <div style={{ padding: 8, border: `1px solid ${C.line}`, background: C.inverse }}>
              <div style={{ fontSize: FS.cap, color: C.mute, marginBottom: 4 }}>고객 서명</div>
              <img src={state.submission.signature} alt="고객 전자서명" style={{ display: 'block', maxWidth: '100%', maxHeight: 120 }} />
            </div>
          ) : null}
        </>
      ) : <div style={{ fontSize: FS.cap, color: C.faint }}>고객 제출을 기다리는 중입니다.</div>}

      {sessionStatus === 'pending_review' ? (
        <>
          <SectionLabel>보완 요청</SectionLabel>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SUPPLEMENT_ITEMS.map((item) => (
              <Btn key={item.key} title={item.label} size="sm" variant={supplementItems.has(item.key) ? 'solid' : 'ghost'} onClick={() => toggleSupplement(item.key)}>
                {item.label}
              </Btn>
            ))}
          </div>
          <Textarea value={reason} onChange={setReason} placeholder="사유 (예: 운전면허증 글자가 흐려 확인이 어렵습니다)" full />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Btn title="전자계약 보완 요청" variant="ghost" disabled={busy || supplementItems.size === 0} onClick={() => void run({ action: 'reject', reason, items: [...supplementItems] }, '같은 보안 링크로 보완을 요청했습니다.')}>
              <ButtonLabel icon={<XCircle size={ICON.md} aria-hidden />}>보완 요청</ButtonLabel>
            </Btn>
            <Btn title="본인확인 및 전자서명 승인" disabled={busy} onClick={() => void run({ action: 'approve' }, '전자계약을 승인하고 봉인했습니다.')}>
              <ButtonLabel icon={<CheckCircle2 size={ICON.md} aria-hidden />}>확인 후 승인</ButtonLabel>
            </Btn>
          </div>
        </>
      ) : null}

      {displayStatus === '서명완료' ? (
        <>
          <SectionLabel>서명 완료본</SectionLabel>
          <Btn title="서명 완료 PDF" onClick={() => void openProtected(`/api/freepass-esign/contracts/${encodeURIComponent(code)}/document?format=pdf`).catch((e) => toast(String(e.message || e), 'error'))}>
            <ButtonLabel icon={<FileDown size={ICON.md} aria-hidden />}>완료 PDF 열기</ButtonLabel>
          </Btn>
          {active.esign_verify_url ? <Btn title="봉인 검증" variant="ghost" onClick={() => window.open(S(active.esign_verify_url), '_blank', 'noreferrer')}>봉인 검증</Btn> : null}
          <SectionLabel>인도일 확정</SectionLabel>
          <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5 }}>
            실제 차량 인도일을 계약 시작일로 확정하고 대여기간으로 종료일을 계산합니다.
          </div>
          {savedDate ? (
            <div style={{ fontSize: FS.cap, fontWeight: FW.strong }}>
              인도일 {savedDate}
              {savedHandover?.contract_start ? ` · ${S(savedHandover.contract_start)} ~ ${S(savedHandover.contract_end)}` : ''}
            </div>
          ) : <div style={{ fontSize: FS.cap, color: C.faint }}>아직 인도일 없음 · 보완 필요</div>}
          <Input type="date" value={handoverDate} onChange={setHandoverDate} ariaLabel="차량 인도일" full />
          <Btn title={savedDate ? '인도일 다시 확정' : '인도일 확정'} disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(handoverDate)} onClick={() => void saveHandover()}>
            {busy ? '저장 중…' : savedDate ? '인도일 다시 확정' : '인도일 확정'}
          </Btn>
        </>
      ) : null}

      <SectionLabel>이력</SectionLabel>
      <ListGroup>
        {(state?.events || []).length ? (state?.events || []).map((event, index) => (
          <DetailRow
            key={`${event.type}-${event.at}-${index}`}
            label={EVENT_LABEL[S(event.type)] || S(event.type)}
            value={[stamp(event.at), event.handoverDate, ...(event.items || [])].filter(Boolean).join(' · ')}
          />
        )) : <DetailRow label="진행 이력" value="—" />}
      </ListGroup>
      <div style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.5 }}>
        운전면허증·셀카 원본과 서명은 공개 계약 데이터가 아니라 서버 전용 저장소에 보관됩니다.
      </div>
    </div>
  );
}
