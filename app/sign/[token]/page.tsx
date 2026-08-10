'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Check, Eraser, FileDown, ImagePlus, Send } from 'lucide-react';
import {
  Btn, ButtonLabel, C, DetailRow, Dropzone, fmtPhone, FS, FW, ICON, Input,
  ListGroup, Loading, R,
} from '@/components/ui';
import { toast } from '@/components/Toaster';

const REQUIRED_CONSENTS = ['rental_terms', 'privacy', 'credit', 'gps'] as const;
const UPFRONT_CONSENTS = ['privacy', 'credit', 'gps'] as const;
const CONSENT_LABELS: Record<(typeof REQUIRED_CONSENTS)[number], string> = {
  rental_terms: '자동차 대여계약 및 약관',
  privacy: '개인정보 수집·이용',
  credit: '신용정보 조회·제공',
  gps: '차량 위치(GPS) 수집',
};
const CLIENT_IMAGE_BYTES = 1_350_000;
const S = (value: unknown) => String(value ?? '').trim();

type ConsentPage = {
  key?: string;
  title?: string;
  note?: string;
  rows?: Array<{ label?: string; value?: string; article?: string }>;
  confirmLabel?: string;
  requireReadThrough?: boolean;
};

type PublicSnapshot = {
  contract?: Record<string, unknown>;
  contractKind?: { title?: string; label?: string; maturity?: string; maturityNote?: string };
  template?: { label?: string; version?: string };
  consentGroups?: ConsentPage[];
  consentPages?: ConsentPage[];
  consentAtoms?: Array<{
    key?: string;
    label?: string;
    group?: string;
    required?: boolean;
    items?: string[];
    purpose?: string;
    retention?: string;
    recipients?: Array<{ name?: string; purpose?: string }>;
    refusalNote?: string;
  }>;
  agreement?: {
    title?: string;
    version?: string;
    confirmLabel?: string;
    sections?: Array<{ t?: string; b?: string }>;
  };
};

type PublicResponse = {
  ok?: boolean;
  error?: string;
  status?: string;
  rejectReason?: string;
  documentUrl?: string;
  supplementItems?: string[];
  progress?: Record<string, number>;
  expiresAt?: number;
  snapshot?: PublicSnapshot | null;
};

type JourneyStep = {
  kind: 'summary' | 'privacy' | 'identity' | 'section' | 'agreement' | 'signature';
  key: string;
  title: string;
  page?: ConsentPage;
};

async function prepareImage(file: File, label: string): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error(`${label}는 사진 파일만 가능합니다.`);
  if (file.size <= CLIENT_IMAGE_BYTES) return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error(`${label} 사진을 읽지 못했습니다. JPG 또는 PNG로 다시 첨부해 주세요.`));
      next.src = objectUrl;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(`${label} 사진을 처리하지 못했습니다.`);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    let quality = 0.82;
    let blob: Blob | null = null;
    while (quality >= 0.46) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= CLIENT_IMAGE_BYTES) break;
      quality -= 0.1;
    }
    if (!blob || blob.size > CLIENT_IMAGE_BYTES) {
      throw new Error(`${label} 사진 용량을 줄이지 못했습니다. 화면을 캡처한 뒤 다시 첨부해 주세요.`);
    }
    const baseName = file.name.replace(/\.[^.]+$/, '') || label;
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function ConsentChoice({
  consentKey,
  checked,
  onToggle,
}: {
  consentKey: (typeof REQUIRED_CONSENTS)[number];
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Btn full title={CONSENT_LABELS[consentKey]} variant={checked ? 'solid' : 'ghost'} onClick={onToggle} style={{ justifyContent: 'flex-start' }}>
      <span style={{ width: 18 }}>{checked ? <Check size={ICON.sm} aria-hidden /> : null}</span>
      {CONSENT_LABELS[consentKey]} (필수)
    </Btn>
  );
}

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicResponse | null | undefined>(undefined);
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_id: '', customer_address: '',
    driver_license_no: '', emergency_name: '', emergency_phone: '',
  });
  const [consents, setConsents] = useState<Set<string>>(new Set());
  const [confirmations, setConfirmations] = useState<Record<string, number>>({});
  const [readThrough, setReadThrough] = useState<Record<string, boolean>>({});
  const [summaryConfirmedAt, setSummaryConfirmedAt] = useState(0);
  const [agreementReadAt, setAgreementReadAt] = useState(0);
  const [idCard, setIdCard] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparingImage, setPreparingImage] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const selfieRef = useRef<HTMLInputElement>(null);
  const readRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/freepass-esign/public/${encodeURIComponent(String(token))}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as PublicResponse;
        if (!response.ok && !body.status) throw new Error(body.error || '전자계약을 열지 못했습니다.');
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setView(body);
        const contract = body.snapshot?.contract || {};
        setForm((prev) => ({
          ...prev,
          customer_name: S(contract.customer_name),
          customer_phone: fmtPhone(S(contract.customer_phone)),
          customer_address: S(contract.customer_address),
        }));
      })
      .catch((error) => {
        if (!cancelled) setView({ error: error instanceof Error ? error.message : '전자계약을 열지 못했습니다.' });
      });
    return () => { cancelled = true; };
  }, [token]);

  const snapshot = view?.snapshot || {};
  const pages = useMemo(
    () => snapshot.consentPages || snapshot.consentGroups || [],
    [snapshot.consentGroups, snapshot.consentPages],
  );
  const steps = useMemo<JourneyStep[]>(() => [
    { kind: 'summary', key: 'summary', title: '계약 확인' },
    { kind: 'privacy', key: 'privacy', title: '수집 동의' },
    { kind: 'identity', key: 'identity', title: '본인확인' },
    ...pages.map((page) => ({ kind: 'section' as const, key: S(page.key), title: S(page.title) || '계약조건', page })),
    { kind: 'agreement', key: 'agreement', title: '약관' },
    { kind: 'signature', key: 'signature', title: '서명' },
  ], [pages]);
  const step = steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))];

  useEffect(() => {
    const key = step?.key;
    const element = readRef.current;
    if (!key || !element) return;
    const frame = window.requestAnimationFrame(() => {
      if (element.scrollHeight <= element.clientHeight + 2) {
        setReadThrough((prev) => ({ ...prev, [key]: true }));
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step?.key]);

  const pos = (event: PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  const start = (event: React.PointerEvent) => {
    drawing.current = true;
    const context = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(event.nativeEvent);
    context.beginPath();
    context.moveTo(x, y);
    canvasRef.current!.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent) => {
    if (!drawing.current) return;
    event.preventDefault();
    const canvas = canvasRef.current!;
    const context = canvas.getContext('2d')!;
    const { x, y } = pos(event.nativeEvent);
    context.lineTo(x, y);
    context.strokeStyle = getComputedStyle(canvas).color;
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
    inked.current = true;
  };
  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    inked.current = false;
  };
  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const toggleConsent = (key: string) => setConsents((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const chooseImage = async (file: File | null, label: string, assign: (next: File | null) => void) => {
    if (!file) return assign(null);
    setPreparingImage(true);
    try {
      const next = await prepareImage(file, label);
      assign(next);
      if (next.size < file.size) toast(`${label} 사진 용량을 자동으로 줄였습니다.`, 'ok');
    } catch (error) {
      assign(null);
      toast(error instanceof Error ? error.message : `${label} 사진을 처리하지 못했습니다.`, 'error');
    } finally {
      setPreparingImage(false);
    }
  };
  const onRead = () => {
    const element = readRef.current;
    if (!element || !step?.key) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 8) {
      setReadThrough((prev) => ({ ...prev, [step.key]: true }));
    }
  };
  const markProgress = async (key: string) => {
    const response = await fetch(`/api/freepass-esign/public/${encodeURIComponent(String(token))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'progress', step: key }),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || '진행정보를 저장하지 못했습니다.');
  };

  const next = async () => {
    if (!step || busy) return;
    if (step.kind === 'privacy' && !UPFRONT_CONSENTS.every((key) => consents.has(key))) {
      return toast('필수 개인정보 동의를 각각 선택해 주세요.', 'error');
    }
    if (step.kind === 'identity') {
      if (!form.customer_name.trim() || !form.customer_phone.trim()) return toast('성명과 연락처를 입력해 주세요.', 'error');
      if (!idCard || !selfie) return toast('신분증과 본인 셀카를 모두 첨부해 주세요.', 'error');
    }
    if (step.kind === 'section') {
      if (step.page?.requireReadThrough && !readThrough[step.key]) return toast('아래까지 모두 확인해 주세요.', 'error');
    }
    if (step.kind === 'agreement') {
      if (!readThrough.agreement) return toast('약관을 끝까지 읽어 주세요.', 'error');
      if (!consents.has('rental_terms')) return toast('자동차 대여계약 및 약관에 동의해 주세요.', 'error');
    }
    setBusy(true);
    try {
      await markProgress(step.key);
      const at = Date.now();
      if (step.kind === 'summary') setSummaryConfirmedAt(at);
      if (step.kind === 'section') setConfirmations((prev) => ({ ...prev, [step.key]: at }));
      if (step.kind === 'agreement') setAgreementReadAt(at);
      setStepIndex((index) => Math.min(index + 1, steps.length - 1));
    } catch (error) {
      toast(error instanceof Error ? error.message : '진행정보를 저장하지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy || preparingImage) return;
    if (!inked.current) return toast('전자서명을 입력해 주세요.', 'error');
    if (!REQUIRED_CONSENTS.every((key) => consents.has(key))) return toast('필수 동의가 남았습니다.', 'error');
    if (pages.some((page) => !confirmations[S(page.key)])) return toast('확인하지 않은 계약 조건이 있습니다.', 'error');
    if (!idCard || !selfie) return toast('신분증과 본인 셀카를 모두 첨부해 주세요.', 'error');
    setBusy(true);
    try {
      const payload = new FormData();
      payload.set('payload', JSON.stringify({
        ...form,
        signature: canvasRef.current!.toDataURL('image/png'),
        consents: [...consents],
        sectionConfirmations: confirmations,
        summaryConfirmedAt,
        agreementReadAt,
      }));
      payload.set('idCard', idCard);
      payload.set('selfie', selfie);
      const response = await fetch(`/api/freepass-esign/public/${encodeURIComponent(String(token))}`, {
        method: 'POST', body: payload, cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as PublicResponse;
      if (!response.ok) throw new Error(body.error || '전자계약 제출에 실패했습니다.');
      setView((prev) => ({ ...(prev || {}), status: '검토대기' }));
      toast('본인확인 자료와 전자서명을 제출했습니다.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '전자계약 제출에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const wrap: CSSProperties = { maxWidth: 640, margin: '0 auto', padding: '18px 16px 56px' };
  if (view === undefined) return <Loading />;
  if (!view || view.error) return (
    <main style={wrap}>
      <h1 style={{ fontSize: FS.page }}>지금은 열 수 없는 링크입니다</h1>
      <p style={{ color: C.mute, fontSize: FS.body }}>{view?.error || '이미 제출을 마쳤거나 링크가 만료되었습니다.'}</p>
    </main>
  );
  if (view.status === '검토대기' || view.status === '서명완료') return (
    <main style={wrap}>
      <div style={{ textAlign: 'center', padding: '40px 0' }}>
        <div style={{ color: C.ok, display: 'flex', justifyContent: 'center' }}><Check size={40} aria-hidden /></div>
        <h1 style={{ fontSize: FS.page, fontWeight: FW.title, margin: '8px 0 4px' }}>
          {view.status === '서명완료' ? '전자계약이 완료되었습니다' : '제출이 접수되었습니다'}
        </h1>
        <p style={{ color: C.mute, fontSize: FS.body }}>
          {view.status === '서명완료' ? '관리자 확인과 문서 봉인이 완료되었습니다.' : '담당자가 신분증·셀카·서명을 확인한 뒤 계약을 확정합니다.'}
        </p>
        {view.status === '서명완료' && view.documentUrl ? (
          <Btn title="서명 완료 계약서 받기" onClick={() => window.open(view.documentUrl, '_blank', 'noreferrer')}>
            <ButtonLabel icon={<FileDown size={ICON.md} aria-hidden />}>서명 완료 계약서 받기</ButtonLabel>
          </Btn>
        ) : null}
      </div>
    </main>
  );

  const contract = snapshot.contract || {};
  const label: CSSProperties = { fontSize: FS.sub, color: C.mute, fontWeight: FW.strong };
  const inputStyle: CSSProperties = { display: 'block', marginTop: 4 };
  const upfrontDone = UPFRONT_CONSENTS.every((key) => consents.has(key));
  const stepNo = Math.min(stepIndex + 1, steps.length);

  return (
    <main style={wrap}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: FS.sub, color: C.mute, letterSpacing: '0.04em' }}>프리패스 · 전자계약</div>
          <span style={{ flex: 1 }} />
          <div style={{ fontSize: FS.cap, color: C.faint }}>{stepNo} / {steps.length}</div>
        </div>
        <h1 style={{ fontSize: FS.page, fontWeight: FW.title, margin: '4px 0 8px' }}>{step?.title || '전자계약'}</h1>
        <div style={{ height: 4, background: C.line2, overflow: 'hidden', borderRadius: R }}>
          <div style={{ width: `${(stepNo / Math.max(steps.length, 1)) * 100}%`, height: '100%', background: C.brand }} />
        </div>
      </header>

      {view.rejectReason ? (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: R, background: C.warnBg, color: C.warn, fontSize: FS.sub, fontWeight: FW.strong }}>
          보완 요청: {view.rejectReason}
          {(view.supplementItems || []).length ? ` · ${(view.supplementItems || []).join(' · ')}` : ''}
        </div>
      ) : null}

      {step?.kind === 'summary' ? (
        <>
          <div style={{ fontSize: FS.title, fontWeight: FW.title, marginBottom: 4 }}>
            {S(form.customer_name) ? `${S(form.customer_name)}님, 아래 계약이 맞습니까?` : '아래 계약 내용을 먼저 확인해 주세요.'}
          </div>
          <p style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.6 }}>
            차종·차량번호·기간·금액이 다르면 서명하지 말고 계약 담당자에게 알려 주세요.
          </p>
          <ListGroup header={S(snapshot.contractKind?.title) || S(snapshot.template?.label) || '자동차 대여 계약서'}>
            <DetailRow label="차량" value={[contract.car_number_snapshot, contract.vehicle_name_snapshot].filter(Boolean).join(' · ') || '—'} stacked />
            <DetailRow label="계약기간" value={contract.rent_month_snapshot ? `${contract.rent_month_snapshot}개월` : '—'} />
            <DetailRow label="월 대여료" value={`${Number(contract.rent_amount_snapshot || 0).toLocaleString('ko-KR')}원`} />
            <DetailRow label="보증금" value={Number(contract.deposit_amount_snapshot || 0) ? `${Number(contract.deposit_amount_snapshot).toLocaleString('ko-KR')}원` : '무보증'} />
            <DetailRow label="계약번호" value={S(contract.contract_code) || '—'} />
          </ListGroup>
        </>
      ) : null}

      {step?.kind === 'privacy' ? (
        <>
          <div style={{ fontSize: FS.title, fontWeight: FW.title }}>먼저 동의가 필요합니다</div>
          <p style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.6 }}>
            신분증과 얼굴 사진을 받기 전에 필요한 동의를 각각 받습니다. 미리 선택된 항목은 없습니다.
          </p>
          {(snapshot.consentAtoms || []).filter((atom) => atom.group !== 'bank').map((atom) => (
            <ListGroup key={atom.key} header={atom.label}>
              <DetailRow label="수집·이용 항목" value={(atom.items || []).join(', ') || '—'} stacked />
              <DetailRow label="목적" value={atom.purpose || '—'} stacked />
              <DetailRow label="보유기간" value={atom.retention || '—'} stacked />
              <DetailRow label="동의 거부 시" value={atom.refusalNote || '—'} stacked />
            </ListGroup>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {UPFRONT_CONSENTS.map((key) => (
              <ConsentChoice key={key} consentKey={key} checked={consents.has(key)} onToggle={() => toggleConsent(key)} />
            ))}
          </div>
          {!upfrontDone ? <p style={{ color: C.warn, fontSize: FS.cap }}>모든 필수 항목을 선택해야 계속할 수 있습니다.</p> : null}
        </>
      ) : null}

      {step?.kind === 'identity' ? (
        <>
          <div style={{ fontSize: FS.title, fontWeight: FW.title, marginBottom: 8 }}>계약자 정보</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={label}>성명 *<Input value={form.customer_name} onChange={(value) => set('customer_name', value)} full style={inputStyle} /></label>
            <label style={label}>연락처 *<Input value={form.customer_phone} onChange={(value) => set('customer_phone', fmtPhone(value))} inputMode="tel" full style={inputStyle} /></label>
            <label style={label}>주민등록번호<Input value={form.customer_id} onChange={(value) => set('customer_id', value)} inputMode="numeric" placeholder="본인확인용" full style={inputStyle} /></label>
            <label style={label}>운전면허번호<Input value={form.driver_license_no} onChange={(value) => set('driver_license_no', value)} full style={inputStyle} /></label>
            <label style={label}>주소<Input value={form.customer_address} onChange={(value) => set('customer_address', value)} full style={inputStyle} /></label>
            <label style={label}>비상연락 성명<Input value={form.emergency_name} onChange={(value) => set('emergency_name', value)} full style={inputStyle} /></label>
            <label style={label}>비상연락처<Input value={form.emergency_phone} onChange={(value) => set('emergency_phone', fmtPhone(value))} inputMode="tel" full style={inputStyle} /></label>
          </div>
          <div style={{ fontSize: FS.title, fontWeight: FW.title, margin: '20px 0 8px' }}>본인확인 자료</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            <Dropzone variant="photo" active={!!idCard} onClick={() => idRef.current?.click()} title="신분증 사진 첨부">
              <ImagePlus size={ICON.md} color={idCard ? C.ok : C.faint} />
              <span style={{ fontSize: FS.sub, fontWeight: FW.strong }}>{idCard?.name || '신분증 사진'}</span>
              <span style={{ fontSize: FS.micro, color: C.faint }}>{preparingImage ? '사진 준비 중' : '큰 파일은 자동 압축'}</span>
              <input ref={idRef} type="file" accept="image/*" style={{ display: 'none' }} onClick={(event) => event.stopPropagation()} onChange={(event) => { void chooseImage(event.target.files?.[0] || null, '신분증', setIdCard); event.currentTarget.value = ''; }} />
            </Dropzone>
            <Dropzone variant="photo" active={!!selfie} onClick={() => selfieRef.current?.click()} title="본인 셀카 첨부">
              <ImagePlus size={ICON.md} color={selfie ? C.ok : C.faint} />
              <span style={{ fontSize: FS.sub, fontWeight: FW.strong }}>{selfie?.name || '본인 셀카'}</span>
              <span style={{ fontSize: FS.micro, color: C.faint }}>{preparingImage ? '사진 준비 중' : '얼굴이 선명한 사진'}</span>
              <input ref={selfieRef} type="file" accept="image/*" capture="user" style={{ display: 'none' }} onClick={(event) => event.stopPropagation()} onChange={(event) => { void chooseImage(event.target.files?.[0] || null, '본인 셀카', setSelfie); event.currentTarget.value = ''; }} />
            </Dropzone>
          </div>
          <p style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.6 }}>자동 인증기관 조회가 아니라 담당자가 신분증과 셀카를 대조하는 방식입니다.</p>
        </>
      ) : null}

      {step?.kind === 'section' && step.page ? (
        <>
          <p style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.6 }}>{step.page.note}</p>
          <div
            ref={readRef}
            onScroll={onRead}
            style={{ maxHeight: 420, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: R }}
          >
            <ListGroup>
              {(step.page.rows || []).map((row, index) => (
                <DetailRow key={`${row.label}-${index}`} label={row.label || '항목'} value={row.value || '—'} stacked />
              ))}
            </ListGroup>
          </div>
          {step.page.requireReadThrough && !readThrough[step.key] ? <p style={{ color: C.warn, fontSize: FS.cap }}>아래까지 모두 확인하면 다음으로 갈 수 있습니다.</p> : null}
        </>
      ) : null}

      {step?.kind === 'agreement' ? (
        <>
          <p style={{ fontSize: FS.sub, color: C.mute }}>약관을 끝까지 읽은 뒤 계약과 약관 동의를 선택해 주세요.</p>
          <div
            ref={readRef}
            onScroll={onRead}
            style={{ height: 420, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: 12 }}
          >
            {(snapshot.agreement?.sections || []).map((section, index) => (
              <section key={`${section.t}-${index}`} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.ink, marginBottom: 4 }}>{section.t}</div>
                <div style={{ fontSize: FS.cap, lineHeight: 1.75, color: C.mute }}>{section.b}</div>
              </section>
            ))}
            <div style={{ textAlign: 'center', color: C.faint, fontSize: FS.cap }}>— 약관 끝 —</div>
          </div>
          {!readThrough.agreement ? <p style={{ color: C.warn, fontSize: FS.cap }}>약관을 끝까지 내려 읽어 주세요.</p> : null}
          <div style={{ marginTop: 10 }}>
            <ConsentChoice consentKey="rental_terms" checked={consents.has('rental_terms')} onToggle={() => toggleConsent('rental_terms')} />
          </div>
        </>
      ) : null}

      {step?.kind === 'signature' ? (
        <>
          <div style={{ fontSize: FS.title, fontWeight: FW.title }}>무엇에 서명하나</div>
          <p style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.6 }}>아래 서명은 위 계약서·확인한 모든 조건·약관에 대한 전자서명입니다.</p>
          <ListGroup>
            <DetailRow label="계약서" value={S(snapshot.contractKind?.title) || S(snapshot.template?.label) || '자동차 대여 계약서'} />
            <DetailRow label="약관" value={`${S(snapshot.agreement?.title) || '자동차 대여 약관'} · ${S(snapshot.agreement?.version) || '—'}`} stacked />
            <DetailRow label="계약 조건 확인" value={`${Object.keys(confirmations).length} / ${pages.length} 섹션`} />
            <DetailRow label="필수 동의" value={`${[...consents].length} / ${REQUIRED_CONSENTS.length}건`} />
            <DetailRow label="본인확인 자료" value={idCard && selfie ? '신분증·셀카 첨부' : '누락'} />
          </ListGroup>
          <div style={{ fontSize: FS.title, fontWeight: FW.title, margin: '20px 0 8px', display: 'flex', alignItems: 'center' }}>
            전자서명 <span style={{ flex: 1 }} />
            <Btn title="서명 지우기" size="sm" variant="ghost" onClick={clearSignature}><ButtonLabel icon={<Eraser size={ICON.md} aria-hidden />}>지우기</ButtonLabel></Btn>
          </div>
          <Dropzone variant="sign" style={{ background: C.taupeBg, width: '100%', padding: 0, overflow: 'hidden' }}>
            <canvas
              ref={canvasRef}
              width={600}
              height={180}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={() => { drawing.current = false; }}
              onPointerLeave={() => { drawing.current = false; }}
              aria-label="전자서명 입력 영역"
              style={{ width: '100%', aspectRatio: '600 / 180', display: 'block', color: C.ink, touchAction: 'none', cursor: 'crosshair' }}
            />
          </Dropzone>
          <p style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.6 }}>서명시각과 단계별 확인시각이 기록되며, 관리자 확정 후에는 내용을 바꿀 수 없습니다.</p>
        </>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
        <Btn title="이전" variant="ghost" disabled={stepIndex <= 0 || busy} onClick={() => setStepIndex((index) => Math.max(0, index - 1))}>
          <ButtonLabel icon={<ArrowLeft size={ICON.md} aria-hidden />}>이전</ButtonLabel>
        </Btn>
        {step?.kind === 'signature' ? (
          <Btn full title="본인확인 자료와 전자서명 제출" disabled={busy || preparingImage} onClick={() => void submit()}>
            <ButtonLabel icon={<Send size={ICON.md} aria-hidden />}>{busy ? '안전하게 제출 중…' : '확인하고 전자서명 제출'}</ButtonLabel>
          </Btn>
        ) : (
          <Btn full title="다음" disabled={busy || preparingImage} onClick={() => void next()}>
            {busy ? '확인 기록 중…' : step?.kind === 'summary' ? '맞습니다, 계속하기' : step?.kind === 'section' ? (step.page?.confirmLabel || '확인하고 다음') : step?.kind === 'agreement' ? (snapshot.agreement?.confirmLabel || '동의하고 서명으로') : '다음'}
          </Btn>
        )}
      </div>
    </main>
  );
}
