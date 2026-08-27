'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Check, Eraser, Eye, FileDown, FileText, ImagePlus, Plus, Send, Trash2 } from 'lucide-react';
import {
  Badge, Btn, ButtonLabel, C, DetailRow, Dropzone, fmtPhone, FS, FW, ICON, Input,
  ListGroup, Loading, Message, R,
} from '@/components/ui';
import { toast } from '@/components/Toaster';
import styles from './sign.module.css';

const CLIENT_IMAGE_BYTES = 1_350_000;
const S = (value: unknown) => String(value ?? '').trim();
const formatWon = (value: unknown) => {
  const raw = S(value);
  if (!raw) return '—';
  const digits = raw.replace(/[^\d-]/g, '');
  if (!digits) return raw;
  const amount = Number(digits);
  return Number.isFinite(amount) ? `${amount.toLocaleString('ko-KR')}원` : raw;
};
const formatDeposit = (value: unknown) => {
  const raw = S(value);
  if (!raw) return '—';
  const digits = raw.replace(/[^\d-]/g, '');
  return digits && Number(digits) === 0 ? '무보증' : formatWon(raw);
};
const VEHICLE_MAKER_PREFIX = /^(?:메르세데스[- ]?벤츠|KG모빌리티|르노코리아|르노삼성|한국지엠|제네시스|쉐보레|폭스바겐|캐딜락|포르쉐|폴스타|현대|기아|르노|KGM|쌍용|대우|벤츠|BMW|아우디|테슬라|미니|볼보|지프|BYD)\s+/i;

function compactVehicleModel(
  contract: Record<string, unknown>,
  templateFields?: Record<string, string>,
): string {
  const model = S(contract.model_snapshot) || S(contract.sub_model_snapshot);
  if (model) return model.replace(VEHICLE_MAKER_PREFIX, '').trim() || model;

  let fallback = S(contract.vehicle_name_snapshot);
  const year = S(contract.year_snapshot) || S(templateFields?.model_year);
  const fuel = S(contract.fuel_type_snapshot) || S(templateFields?.fuel);
  if (year) fallback = fallback.replace(new RegExp(`^${year.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '');
  if (fuel) fallback = fallback.replace(new RegExp(`\\s*${fuel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
  fallback = fallback.replace(/\s+(?:\d+(?:\.\d+)?|\d{3,4}cc)$/i, '').trim();
  fallback = fallback.replace(VEHICLE_MAKER_PREFIX, '').trim();
  return fallback || '—';
}

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
  landlord?: { companyName?: string };
  templateFields?: Record<string, string>;
  templateState?: { car?: string; ct?: string; tax?: string };
  contractKind?: { title?: string; label?: string; maturity?: string; maturityNote?: string };
  template?: { label?: string; version?: string };
  additionalDriverPolicy?: {
    allowed?: boolean;
    limit?: number;
    cost?: string;
    driverScope?: string;
  };
  requiredDocuments?: Array<{
    key: string;
    label: string;
    note?: string;
    required?: boolean;
  }>;
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
  consentProfile?: {
    version?: string;
    requiredKeys?: string[];
    cmsRequiredBeforeHandover?: boolean;
    atoms?: Array<{
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
  };
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
  downloadUrl?: string;
  previewDocumentUrl?: string;
  supplementItems?: string[];
  progress?: Record<string, number>;
  uploadedSupportingDocumentKeys?: string[];
  expiresAt?: number;
  snapshot?: PublicSnapshot | null;
};

type JourneyStep = {
  kind: 'summary' | 'privacy' | 'identity' | 'additional-driver' | 'documents' | 'section' | 'agreement' | 'signature';
  key: string;
  title: string;
  page?: ConsentPage;
};

type AdditionalDriverForm = {
  name: string;
  relation: string;
  phone: string;
  driverLicenseNo: string;
  consent: boolean;
};

const emptyAdditionalDriver = (): AdditionalDriverForm => ({
  name: '', relation: '', phone: '', driverLicenseNo: '', consent: false,
});

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

const BUNDLES = [
  { id: 0 as const, name: '확인' },
  { id: 1 as const, name: '작성' },
  { id: 2 as const, name: '동의·서명' },
];

function bundleOf(kind: JourneyStep['kind']): 0 | 1 | 2 {
  if (kind === 'summary' || kind === 'privacy') return 0;
  if (kind === 'identity' || kind === 'additional-driver' || kind === 'documents') return 1;
  return 2;
}

function stepGuide(step: JourneyStep | undefined): string {
  if (!step) return '';
  if (step.kind === 'summary') return '차종·금액·기간이 맞는지 확인합니다.';
  if (step.kind === 'privacy') return '본인확인 자료를 받기 전에 수집 동의를 받습니다.';
  if (step.kind === 'identity') return '계약서에 들어갈 본인 정보와 확인 사진을 작성합니다.';
  if (step.kind === 'additional-driver') return '함께 운전할 사람이 있으면 등록합니다. 없으면 다음으로 가면 됩니다.';
  if (step.kind === 'documents') return '렌터카사 요청서류를 첨부합니다.';
  if (step.kind === 'section') return step.page?.note || '이 조건이 계약 내용입니다. 확인하고 다음으로 갑니다.';
  if (step.kind === 'agreement') return '약관을 끝까지 읽은 뒤 동의를 선택합니다.';
  return '확인한 계약·약관에 전자서명합니다.';
}

function ReqTag() {
  return <Badge tone="red" variant="solid" size={9}>필수</Badge>;
}

function FileThumb({ file }: { file: File | null }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setUrl('');
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!url) return null;
  return <img className={styles.thumb} src={url} alt="" />;
}

function ConditionRow({ label, value, article }: { label: string; value: string; article?: string }) {
  const policyValue = value || '—';
  const isLongValue = policyValue.length > 32;
  return (
    <div className={styles.conditionRow}>
      <div className={styles.conditionLabel}>{label}</div>
      <div className={styles.conditionValue}>
        {isLongValue ? (
          <details className={styles.policyDetail}>
            <summary>
              <span className={styles.policyPreview} title={policyValue}>{policyValue}</span>
              <span className={styles.policyToggle} aria-hidden>전문 보기 ▾</span>
            </summary>
            <div className={styles.policyBody}>{policyValue}</div>
          </details>
        ) : <span>{policyValue}</span>}
        {article ? <span className={styles.articleRef}>관련 약관 {article}</span> : null}
      </div>
    </div>
  );
}

function ConsentChoice({
  consentKey,
  label,
  checked,
  onToggle,
}: {
  consentKey: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Btn full title={label} variant={checked ? 'solid' : 'ghost'} onClick={onToggle} style={{ justifyContent: 'flex-start' }}>
      <span style={{ width: 18 }}>{checked ? <Check size={ICON.sm} aria-hidden /> : null}</span>
      {label} (필수)
    </Btn>
  );
}

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicResponse | null | undefined>(undefined);
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_id: '', customer_address: '',
    driver_license_no: '',
    tax_biz_name: '', tax_biz_no: '', tax_ceo: '', tax_biz_type_item: '', tax_email: '', tax_biz_address: '',
    emergency_relation: '', emergency_name: '', emergency_phone: '',
  });
  const [consents, setConsents] = useState<Set<string>>(new Set());
  const [confirmations, setConfirmations] = useState<Record<string, number>>({});
  const [readThrough, setReadThrough] = useState<Record<string, boolean>>({});
  const [summaryConfirmedAt, setSummaryConfirmedAt] = useState(0);
  const [agreementReadAt, setAgreementReadAt] = useState(0);
  const [idCard, setIdCard] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [additionalDrivers, setAdditionalDrivers] = useState<AdditionalDriverForm[]>([]);
  const [additionalDriverLicenses, setAdditionalDriverLicenses] = useState<Array<File | null>>([]);
  const [supportingFiles, setSupportingFiles] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState(false);
  const [preparingImage, setPreparingImage] = useState(false);
  // 관리자 미리보기(?preview=1) — 서버는 peek 로 읽기만 하고, 화면은 입력 검증·진행 기록·제출을 하지 않는다.
  const [preview, setPreview] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const selfieRef = useRef<HTMLInputElement>(null);
  const additionalDriverLicenseRefs = useRef<Array<HTMLInputElement | null>>([]);
  const supportingFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const readRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const signatureMetrics = useRef({ points: 0, pathLength: 0, last: null as { x: number; y: number } | null });

  useEffect(() => {
    let cancelled = false;
    const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
    setPreview(isPreview);
    void fetch(`/api/freepass-esign/public/${encodeURIComponent(String(token))}${isPreview ? '?peek=1' : ''}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as PublicResponse;
        if (!response.ok && !body.status) throw new Error(body.error || '전자계약을 열지 못했습니다.');
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setView(body);
      })
      .catch((error) => {
        if (!cancelled) setView({ error: error instanceof Error ? error.message : '전자계약을 열지 못했습니다.' });
      });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (view?.status !== '검토대기') return;
    let cancelled = false;
    const refreshCompletion = async () => {
      try {
        const response = await fetch(`/api/freepass-esign/public/${encodeURIComponent(String(token))}`, { cache: 'no-store' });
        const body = await response.json().catch(() => ({})) as PublicResponse;
        if (cancelled || !body.status || body.status === '검토대기') return;
        if (response.ok && body.status === '서명완료') {
          setView(body);
          return;
        }
        // 보완요청·해지·만료는 이전 사진·서명 상태를 재사용하지 않도록 새 응답으로 다시 시작한다.
        window.location.reload();
      } catch { /* 검토대기 화면은 유지하고 다음 주기에 다시 확인한다. */ }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshCompletion();
    }, 5_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshCompletion(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, view?.status]);

  const snapshot = view?.snapshot || {};
  const consentProfile = snapshot.consentProfile || {};
  const consentAtoms = consentProfile.atoms || snapshot.consentAtoms || [];
  const requiredConsents = [...new Set((consentProfile.requiredKeys || []).map(S).filter(Boolean))];
  const upfrontConsents = requiredConsents.filter((key) => key !== 'rental_terms');
  const consentLabel = (key: string) => key === 'rental_terms'
    ? '자동차 대여계약 및 약관'
    : S(consentAtoms.find((atom) => S(atom.key) === key)?.label) || '필수 동의';
  const requiredDocuments = snapshot.requiredDocuments || [];
  const uploadedSupportingDocumentKeys = new Set(view?.uploadedSupportingDocumentKeys || []);
  const additionalDriverLimit = Math.max(0, Math.min(3, Number(snapshot.additionalDriverPolicy?.limit || 0)));
  const additionalDriverCost = S(snapshot.additionalDriverPolicy?.cost) || '—';
  const pages = useMemo(
    () => snapshot.consentPages || snapshot.consentGroups || [],
    [snapshot.consentGroups, snapshot.consentPages],
  );
  const steps = useMemo<JourneyStep[]>(() => [
    { kind: 'summary', key: 'summary', title: '계약 확인' },
    { kind: 'privacy', key: 'privacy', title: '수집 동의' },
    { kind: 'identity', key: 'identity', title: '본인확인' },
    ...(additionalDriverLimit > 0
      ? [{ kind: 'additional-driver' as const, key: 'additional_driver', title: '추가 운전자' }]
      : []),
    ...(requiredDocuments.length
      ? [{ kind: 'documents' as const, key: 'documents', title: '추가서류' }]
      : []),
    ...pages.map((page) => ({ kind: 'section' as const, key: S(page.key), title: S(page.title) || '계약조건', page })),
    { kind: 'agreement', key: 'agreement', title: '약관' },
    { kind: 'signature', key: 'signature', title: '서명' },
  ], [additionalDriverLimit, pages, requiredDocuments.length]);
  const step = steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))];

  /**
   * ★관리자 「손님 화면 따라보기」(사장님 2026-08-20) — 미리보기일 때만 바깥 창이 단계를 넘길 수 있다.
   *   같은 출처의 `fp-esign-preview` 만 받고, 현재 단계를 `fp-esign-preview-state` 로 되돌려 준다.
   *   ⚠ 실제 고객 화면(미리보기 아님)에서는 아무것도 하지 않는다 — 바깥에서 손님 화면을 조종할 수 없어야 한다.
   */
  useEffect(() => {
    if (!preview) return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; action?: string } | null;
      if (!data || data.type !== 'fp-esign-preview') return;
      if (data.action === 'next') setStepIndex((index) => Math.min(index + 1, steps.length - 1));
      else if (data.action === 'prev') setStepIndex((index) => Math.max(index - 1, 0));
      else if (data.action === 'first') setStepIndex(0);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [preview, steps.length]);
  useEffect(() => {
    if (!preview || window.parent === window) return;
    window.parent.postMessage({
      type: 'fp-esign-preview-state',
      index: Math.min(stepIndex, Math.max(steps.length - 1, 0)),
      total: steps.length,
      title: step?.title || '',
    }, window.location.origin);
  }, [preview, stepIndex, steps.length, step?.title]);

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
    signatureMetrics.current.points += 1;
    signatureMetrics.current.last = { x, y };
    canvasRef.current!.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent) => {
    if (!drawing.current) return;
    event.preventDefault();
    const canvas = canvasRef.current!;
    const context = canvas.getContext('2d')!;
    const { x, y } = pos(event.nativeEvent);
    const metrics = signatureMetrics.current;
    if (metrics.last) metrics.pathLength += Math.hypot(x - metrics.last.x, y - metrics.last.y);
    metrics.points += 1;
    metrics.last = { x, y };
    context.lineTo(x, y);
    context.strokeStyle = getComputedStyle(canvas).color;
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
    // 화면에서도 점 찍기·아주 짧은 선을 막고, 서버 PNG 검증과 같은 방향의 안내를 준다.
    inked.current = metrics.points >= 5 && metrics.pathLength >= 55;
  };
  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    inked.current = false;
    signatureMetrics.current = { points: 0, pathLength: 0, last: null };
  };
  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const addAdditionalDriver = () => {
    if (additionalDrivers.length >= additionalDriverLimit) return;
    setAdditionalDrivers((prev) => [...prev, emptyAdditionalDriver()]);
    setAdditionalDriverLicenses((prev) => [...prev, null]);
  };
  const updateAdditionalDriver = (
    index: number,
    key: keyof AdditionalDriverForm,
    value: string | boolean,
  ) => setAdditionalDrivers((prev) => prev.map((driver, slot) => (
    slot === index ? { ...driver, [key]: value } : driver
  )));
  const removeAdditionalDriver = (index: number) => {
    setAdditionalDrivers((prev) => prev.filter((_, slot) => slot !== index));
    setAdditionalDriverLicenses((prev) => prev.filter((_, slot) => slot !== index));
  };
  const setAdditionalDriverLicense = (index: number, file: File | null) => {
    setAdditionalDriverLicenses((prev) => {
      const next = [...prev];
      next[index] = file;
      return next;
    });
  };
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
  const chooseSupportingFile = async (key: string, label: string, file: File | null) => {
    if (!file) {
      setSupportingFiles((prev) => ({ ...prev, [key]: null }));
      return;
    }
    if (file.type === 'application/pdf') {
      if (file.size > 5_000_000) return toast(`${label}은 파일당 5MB 이하여야 합니다.`, 'error');
      setSupportingFiles((prev) => ({ ...prev, [key]: file }));
      return;
    }
    setPreparingImage(true);
    try {
      const next = await prepareImage(file, label);
      setSupportingFiles((prev) => ({ ...prev, [key]: next }));
      if (next.size < file.size) toast(`${label} 사진 용량을 자동으로 줄였습니다.`, 'ok');
    } catch (error) {
      setSupportingFiles((prev) => ({ ...prev, [key]: null }));
      toast(error instanceof Error ? error.message : `${label} 파일을 처리하지 못했습니다.`, 'error');
    } finally {
      setPreparingImage(false);
    }
  };
  const uploadSupportingDocuments = async () => {
    const uploaded = new Set(view?.uploadedSupportingDocumentKeys || []);
    for (const document of requiredDocuments) {
      const file = supportingFiles[document.key];
      if (!file) {
        if (document.required && !uploaded.has(document.key)) throw new Error(`${document.label}을(를) 첨부해 주세요.`);
        continue;
      }
      const response = await fetch(
        `/api/freepass-esign/public/${encodeURIComponent(String(token))}/supporting-document/${encodeURIComponent(document.key)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': file.type,
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
          cache: 'no-store',
        },
      );
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || `${document.label}을(를) 업로드하지 못했습니다.`);
      uploaded.add(document.key);
    }
    setView((prev) => ({ ...(prev || {}), uploadedSupportingDocumentKeys: [...uploaded] }));
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
    if (preview) {
      // 미리보기는 화면만 넘긴다 — 검증도 기록도 없다.
      setStepIndex((index) => Math.min(index + 1, steps.length - 1));
      return;
    }
    if (step.kind === 'privacy' && !upfrontConsents.every((key) => consents.has(key))) {
      return toast('필수 개인정보 동의를 각각 선택해 주세요.', 'error');
    }
    if (step.kind === 'identity') {
      const corporate = view?.snapshot?.templateState?.ct === '법인';
      const soleProprietor = view?.snapshot?.templateState?.tax === '사업자';
      if (!form.customer_name.trim() || !form.customer_phone.trim()) return toast('성명과 연락처를 입력해 주세요.', 'error');
      if (form.customer_id.replace(/\D/g, '').length !== 13) return toast(corporate ? '법인등록번호 13자리를 입력해 주세요.' : '주민등록번호 13자리를 입력해 주세요.', 'error');
      if (corporate ? form.driver_license_no.replace(/\D/g, '').length !== 10 : !form.driver_license_no.trim()) return toast(corporate ? '사업자등록번호 10자리를 입력해 주세요.' : '운전면허번호를 입력해 주세요.', 'error');
      if (soleProprietor && (!form.tax_biz_name.trim() || form.tax_biz_no.replace(/\D/g, '').length !== 10 || !form.tax_ceo.trim() || !form.tax_biz_type_item.trim() || !/^\S+@\S+\.\S+$/.test(form.tax_email) || !form.tax_biz_address.trim())) return toast('세금계산서 사업자 정보를 모두 정확히 입력해 주세요.', 'error');
      if (!form.customer_address.trim()) return toast('계약서에 기재할 주소를 입력해 주세요.', 'error');
      if (!form.emergency_relation.trim() || !form.emergency_name.trim()) return toast('비상연락 관계와 성명을 입력해 주세요.', 'error');
      if (!/^\d{10,11}$/.test(form.emergency_phone.replace(/\D/g, ''))) return toast('비상연락처를 정확히 입력해 주세요.', 'error');
    }
    if (step.kind === 'additional-driver') {
      const incomplete = additionalDrivers.findIndex((driver, index) => (
        !driver.name.trim()
        || !driver.relation.trim()
        || !/^\d{10,11}$/.test(driver.phone.replace(/\D/g, ''))
        || !driver.driverLicenseNo.trim()
        || !additionalDriverLicenses[index]
        || !driver.consent
      ));
      if (additionalDrivers.length > additionalDriverLimit) {
        return toast(`추가 운전자는 최대 ${additionalDriverLimit}명까지 등록할 수 있습니다.`, 'error');
      }
      if (incomplete >= 0) {
        return toast(`추가 운전자 ${incomplete + 1}의 정보·면허증·동의를 모두 확인해 주세요.`, 'error');
      }
    }
    if (step.kind === 'documents') {
      const missing = requiredDocuments.find((document) => (
        document.required
        && !supportingFiles[document.key]
        && !uploadedSupportingDocumentKeys.has(document.key)
      ));
      if (missing) return toast(`${missing.label}을(를) 첨부해 주세요.`, 'error');
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
      if (step.kind === 'documents') await uploadSupportingDocuments();
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
    if (preview) return toast('관리자 미리보기입니다. 제출되지 않습니다.', 'error');
    if (!inked.current) return toast('서명란에 성명을 또렷하게 적어 주세요.', 'error');
    if (!requiredConsents.every((key) => consents.has(key))) return toast('필수 동의가 남았습니다.', 'error');
    if (pages.some((page) => !confirmations[S(page.key)])) return toast('확인하지 않은 계약 조건이 있습니다.', 'error');
    if (!idCard || !selfie) return toast('운전면허증과 본인 셀카를 모두 첨부해 주세요.', 'error');
    setBusy(true);
    try {
      const payload = new FormData();
      payload.set('payload', JSON.stringify({
        ...form,
        additional_drivers: additionalDrivers.map((driver) => ({
          name: driver.name,
          relation: driver.relation,
          phone: driver.phone,
          driver_license_no: driver.driverLicenseNo,
          consentAt: driver.consent ? Date.now() : 0,
        })),
        signature: canvasRef.current!.toDataURL('image/png'),
        consents: [...consents],
        sectionConfirmations: confirmations,
        summaryConfirmedAt,
        agreementReadAt,
      }));
      payload.set('idCard', idCard);
      payload.set('selfie', selfie);
      additionalDriverLicenses.forEach((file, index) => {
        if (file) payload.set(`additionalDriverLicense${index + 1}`, file);
      });
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

  if (view === undefined) return <Loading />;
  if (!view || view.error) return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <div className={styles.statusCard}>
          <h1 style={{ fontSize: FS.page, fontWeight: FW.head, margin: '0 0 8px' }}>지금은 열 수 없는 링크입니다</h1>
          <Message variant="warning">{view?.error || '이미 제출을 마쳤거나 링크가 만료되었습니다.'}</Message>
        </div>
      </div>
    </main>
  );
  if (view.status === '검토대기' || view.status === '서명완료') return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <div className={styles.statusCard}>
          <div style={{ color: C.ok, display: 'flex', justifyContent: 'center' }}><Check size={40} aria-hidden /></div>
          <h1 style={{ fontSize: FS.page, fontWeight: FW.head, margin: '10px 0 6px' }}>
            {view.status === '서명완료' ? '전자계약이 완료되었습니다' : '제출이 접수되었습니다'}
          </h1>
          <Message variant="success">
            {view.status === '서명완료' ? '관리자 확인과 문서 봉인이 완료되었습니다.' : '담당자가 본인확인 자료·추가서류·서명을 확인한 뒤 계약을 확정합니다.'}
          </Message>
          {view.status === '서명완료' && view.documentUrl ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <Btn full title="완료 계약서 보기" variant="ghost" onClick={() => window.open(view.documentUrl, '_blank', 'noreferrer')}>
                <ButtonLabel icon={<Eye size={ICON.md} aria-hidden />}>완료 계약서 보기</ButtonLabel>
              </Btn>
              <Btn full title="완료 계약서 PDF 다운로드" onClick={() => window.open(view.downloadUrl || `${view.documentUrl}?download=1`, '_blank', 'noreferrer')}>
                <ButtonLabel icon={<FileDown size={ICON.md} aria-hidden />}>PDF 다운로드</ButtonLabel>
              </Btn>
              <Message variant="info">
                관리자 확인과 문서 봉인이 끝난 확정본입니다. 보관용으로 내려받아 주세요.
              </Message>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );

  const contract = snapshot.contract || {};
  // 신차·임시번호는 A4 완료본과 같은 값으로 보여 실제 번호처럼 오인되지 않게 한다.
  const vehicleNumber = snapshot.templateState?.car === '신차'
    ? '미정 (신차)'
    : S(contract.car_number_snapshot) || '—';
  const vehicleModel = compactVehicleModel(contract, snapshot.templateFields);
  const label: CSSProperties = { fontSize: FS.sub, color: C.mute, fontWeight: FW.strong };
  const inputStyle: CSSProperties = { display: 'block', marginTop: 4 };
  const upfrontDone = upfrontConsents.every((key) => consents.has(key));
  const stepNo = Math.min(stepIndex + 1, steps.length);
  const bundle = bundleOf(step?.kind || 'summary');
  const rentWon = formatWon(contract.rent_amount_snapshot);
  const depositWon = formatDeposit(contract.deposit_amount_snapshot);
  const rentMonth = S(contract.rent_month_snapshot);
  const periodText = rentMonth ? (rentMonth.endsWith('개월') ? rentMonth : `${rentMonth}개월`) : '—';
  const isSonogongSubscription = /손오공/.test(S(snapshot.landlord?.companyName) || S(snapshot.templateFields?.company_name))
    && /구독/.test(S(snapshot.contractKind?.title) || S(snapshot.template?.label));
  const feeLabel = isSonogongSubscription ? '월 구독료' : '월 대여료';
  const periodLabel = isSonogongSubscription ? '구독기간' : '대여기간';

  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
      <header className={styles.header}>
        <nav className={styles.stepper} aria-label="진행 묶음">
          {BUNDLES.map((item, index) => (
            <div key={item.name} className={`${styles.stepperItem} ${bundle === item.id ? styles.stepperItemOn : ''}`} aria-current={bundle === item.id ? 'step' : undefined} style={{ flex: index === BUNDLES.length - 1 ? 'none' : 1 }}>
              <span className={`${styles.stepperDot} ${bundle === item.id ? styles.stepperDotOn : ''}`}>{index + 1}</span>
              <span className={styles.stepperName}>{item.name}</span>
              {index < BUNDLES.length - 1 ? <span className={styles.stepperLine} /> : null}
            </div>
          ))}
        </nav>
        <div className={styles.headerMeta}>
          <h1 style={{ fontSize: FS.title, fontWeight: FW.head, margin: 0, letterSpacing: '-0.02em' }}>{step?.title || '전자계약'}</h1>
          <span style={{ flex: 1 }} />
          <div style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.meta, fontVariantNumeric: 'tabular-nums' }}>{stepNo} / {steps.length}{preview ? ' · 미리보기' : ''}</div>
        </div>
        <div className={styles.progressTrack} style={{ marginTop: 10 }}>
          <div className={styles.progressValue} style={{ width: `${(stepNo / Math.max(steps.length, 1)) * 100}%` }} />
        </div>
      </header>

      <section className={styles.content}>
      <p className={styles.guide}>{stepGuide(step)}</p>
      {view.rejectReason ? (
        <Message variant="warning">
          보완 요청: {view.rejectReason}
          {(view.supplementItems || []).length ? ` · ${(view.supplementItems || []).join(' · ')}` : ''}
        </Message>
      ) : null}

      {step?.kind === 'summary' ? (
        <>
          <div className={styles.summaryQuad}>
            <div className={styles.summaryCell}>
              <div className={styles.summaryLabel}>{feeLabel}</div>
              <div className={styles.summaryValue}>{rentWon}</div>
            </div>
            <div className={styles.summaryCell}>
              <div className={styles.summaryLabel}>보증금</div>
              <div className={styles.summaryValue}>{depositWon}</div>
            </div>
            <div className={styles.summaryCell}>
              <div className={styles.summaryLabel}>{periodLabel}</div>
              <div className={styles.summaryValue}>{periodText}</div>
            </div>
            <div className={styles.summaryCell}>
              <div className={styles.summaryLabel}>차량</div>
              <div className={styles.summaryValue}>{vehicleNumber}</div>
            </div>
          </div>
          <div style={{ fontSize: FS.title, fontWeight: FW.head, marginBottom: 10, letterSpacing: '-0.015em' }}>
            {S(form.customer_name) ? `${S(form.customer_name)}님, 아래 계약이 맞습니까?` : '아래 계약 내용을 먼저 확인해 주세요.'}
          </div>
          <ListGroup header={S(snapshot.contractKind?.title) || S(snapshot.template?.label) || '자동차 대여 계약서'}>
            <DetailRow label="임대인 회사명" value={S(snapshot.landlord?.companyName) || S(snapshot.templateFields?.company_name) || '—'} />
            <DetailRow label="차량" value={`${vehicleNumber} · ${vehicleModel}`} />
            <DetailRow label={periodLabel} value={periodText} />
            <DetailRow label={feeLabel} value={rentWon} />
            <DetailRow label="보증금" value={depositWon} />
            <DetailRow label="계약번호" value={S(contract.contract_code) || '—'} />
          </ListGroup>
          {isSonogongSubscription ? <ListGroup header="구독 계약 중요 확인">
            <DetailRow label="확인 항목" value="구독료·구독기간 · 만기 반납/인수 · 보험료 포함/별도 · 정비서비스 · 중도해지·반납 조건" stacked />
          </ListGroup> : null}
          <Message variant="info">
            계약서와 아래 모바일 화면은 개인정보 입력이나 동의 없이 먼저 볼 수 있습니다. 미리보기만으로 동의·서명 처리되지 않습니다.
          </Message>
          {view.previewDocumentUrl ? (
            <div style={{ marginTop: 10 }}>
              <Btn full title="계약서 미리보기" onClick={() => window.open(view.previewDocumentUrl, '_blank', 'noreferrer')}>
                <ButtonLabel icon={<Eye size={ICON.md} aria-hidden />}>계약서 미리보기</ButtonLabel>
              </Btn>
            </div>
          ) : null}
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: FS.body, fontWeight: FW.strong, color: C.ink, padding: '10px 0' }}>
              모바일 계약서 전체보기
            </summary>
            <div style={{ display: 'grid', gap: 12 }}>
              {pages.map((page) => (
                <ListGroup key={page.key} header={page.title || '계약 조건'}>
                  {(page.rows || []).map((row, index) => (
                    <DetailRow key={`${page.key}-${row.label}-${index}`} label={row.label || '항목'} value={row.value || '—'} stacked />
                  ))}
                </ListGroup>
              ))}
              <details>
                <summary style={{ cursor: 'pointer', fontSize: FS.sub, fontWeight: FW.strong, color: C.ink, padding: '8px 0' }}>
                  자동차 대여 약관 보기
                </summary>
                <div style={{ display: 'grid', gap: 12, paddingTop: 6 }}>
                  {(snapshot.agreement?.sections || []).map((section, index) => (
                    <section key={`${section.t}-${index}`}>
                      <div style={{ fontSize: FS.sub, fontWeight: FW.strong, marginBottom: 4 }}>{section.t}</div>
                      <div style={{ fontSize: FS.cap, lineHeight: 1.7, color: C.mute }}>{section.b}</div>
                    </section>
                  ))}
                </div>
              </details>
            </div>
          </details>
        </>
      ) : null}

      {step?.kind === 'privacy' ? (
        <>
          {consentAtoms.map((atom) => (
            <ListGroup key={atom.key} header={atom.label}>
              <DetailRow label="수집·이용 항목" value={(atom.items || []).join(', ') || '—'} stacked />
              <DetailRow label="목적" value={atom.purpose || '—'} stacked />
              <DetailRow label="보유기간" value={atom.retention || '—'} stacked />
              <DetailRow label="동의 거부 시" value={atom.refusalNote || '—'} stacked />
            </ListGroup>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {upfrontConsents.map((key) => (
              <ConsentChoice key={key} consentKey={key} label={consentLabel(key)} checked={consents.has(key)} onToggle={() => toggleConsent(key)} />
            ))}
          </div>
          {!upfrontDone ? <Message variant="warning">모든 필수 항목을 선택해야 계속할 수 있습니다.</Message> : null}
          {consentProfile.cmsRequiredBeforeHandover ? (
            <Message variant="info">
              자동이체(CMS) 출금 동의와 예금주 인증은 본계약과 별도로 진행됩니다. 완료 전에는 차량 인도일을 확정할 수 없습니다.
            </Message>
          ) : null}
        </>
      ) : null}

      {step?.kind === 'identity' ? (
        <>
          {(() => { const corporate = view?.snapshot?.templateState?.ct === '법인'; const soleProprietor = view?.snapshot?.templateState?.tax === '사업자'; return <>
          <ListGroup header="계약자 정보">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px 12px' }}>
              <label>
                <div className={styles.fieldLabel}>{corporate ? '법인명' : '성명'} <ReqTag /></div>
                <Input value={form.customer_name} onChange={(value) => set('customer_name', value)} full style={inputStyle} />
              </label>
              <label>
                <div className={styles.fieldLabel}>연락처 <ReqTag /></div>
                <Input value={form.customer_phone} onChange={(value) => set('customer_phone', fmtPhone(value))} inputMode="tel" full style={inputStyle} />
              </label>
              <label>
                <div className={styles.fieldLabel}>{corporate ? '법인등록번호' : '주민등록번호'} <ReqTag /></div>
                <Input value={form.customer_id} onChange={(value) => set('customer_id', value)} inputMode="numeric" placeholder="계약·매출증빙용" full style={inputStyle} />
              </label>
              <label>
                <div className={styles.fieldLabel}>{corporate ? '사업자등록번호' : '운전면허번호'} <ReqTag /></div>
                <Input value={form.driver_license_no} onChange={(value) => set('driver_license_no', value)} placeholder={corporate ? '사업자등록증에 표시된 번호' : '면허증에 표시된 번호'} full style={inputStyle} />
              </label>
              <label>
                <div className={styles.fieldLabel}>주소 <ReqTag /></div>
                <Input value={form.customer_address} onChange={(value) => set('customer_address', value)} full style={inputStyle} />
              </label>
            </div>
          </ListGroup>
          {soleProprietor ? <ListGroup header="세금계산서 사업자 정보">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px 12px' }}>
              <label><div className={styles.fieldLabel}>상호 <ReqTag /></div><Input value={form.tax_biz_name} onChange={(value) => set('tax_biz_name', value)} full style={inputStyle} /></label>
              <label><div className={styles.fieldLabel}>사업자등록번호 <ReqTag /></div><Input value={form.tax_biz_no} onChange={(value) => set('tax_biz_no', value)} inputMode="numeric" full style={inputStyle} /></label>
              <label><div className={styles.fieldLabel}>대표자 <ReqTag /></div><Input value={form.tax_ceo} onChange={(value) => set('tax_ceo', value)} full style={inputStyle} /></label>
              <label><div className={styles.fieldLabel}>업태·종목 <ReqTag /></div><Input value={form.tax_biz_type_item} onChange={(value) => set('tax_biz_type_item', value)} full style={inputStyle} /></label>
              <label><div className={styles.fieldLabel}>세금계산서 이메일 <ReqTag /></div><Input value={form.tax_email} onChange={(value) => set('tax_email', value)} inputMode="email" full style={inputStyle} /></label>
              <label><div className={styles.fieldLabel}>사업장 주소 <ReqTag /></div><Input value={form.tax_biz_address} onChange={(value) => set('tax_biz_address', value)} full style={inputStyle} /></label>
            </div>
          </ListGroup> : null}
          <ListGroup header={corporate ? '담당자 연락처' : '비상 연락처'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px 12px' }}>
              <label>
                <div className={styles.fieldLabel}>{corporate ? '직책·관계' : '관계'} <ReqTag /></div>
                <Input value={form.emergency_relation} onChange={(value) => set('emergency_relation', value)} placeholder="예: 모, 배우자, 형제자매" full style={inputStyle} />
              </label>
              <label>
                <div className={styles.fieldLabel}>성명 <ReqTag /></div>
                <Input value={form.emergency_name} onChange={(value) => set('emergency_name', value)} placeholder="예: 홍길순" full style={inputStyle} />
              </label>
              <label>
                <div className={styles.fieldLabel}>비상연락처 <ReqTag /></div>
                <Input value={form.emergency_phone} onChange={(value) => set('emergency_phone', fmtPhone(value))} inputMode="tel" full style={inputStyle} />
              </label>
            </div>
          </ListGroup>
          <ListGroup header={corporate ? '담당자 본인확인 자료' : '본인확인 자료'}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, padding: '10px 12px 12px' }}>
            <Dropzone variant="photo" active={!!idCard} onClick={() => idRef.current?.click()} title="운전면허증 사진 첨부">
              <FileThumb file={idCard} />
              <ImagePlus size={ICON.md} color={idCard ? C.ok : C.faint} />
              <span style={{ fontSize: FS.sub, fontWeight: FW.strong }}>{idCard?.name || '운전면허증 사진'}</span>
              <ReqTag />
              <span style={{ fontSize: FS.micro, color: C.faint }}>{preparingImage ? '사진 준비 중' : '큰 파일은 자동 압축'}</span>
              <input ref={idRef} type="file" accept="image/*" style={{ display: 'none' }} onClick={(event) => event.stopPropagation()} onChange={(event) => { void chooseImage(event.target.files?.[0] || null, '운전면허증', setIdCard); event.currentTarget.value = ''; }} />
            </Dropzone>
            <Dropzone variant="photo" active={!!selfie} onClick={() => selfieRef.current?.click()} title="본인 셀카 첨부">
              <FileThumb file={selfie} />
              <ImagePlus size={ICON.md} color={selfie ? C.ok : C.faint} />
              <span style={{ fontSize: FS.sub, fontWeight: FW.strong }}>{selfie?.name || '본인 셀카'}</span>
              <ReqTag />
              <span style={{ fontSize: FS.micro, color: C.faint }}>{preparingImage ? '사진 준비 중' : '얼굴이 선명한 사진'}</span>
              <input ref={selfieRef} type="file" accept="image/*" capture="user" style={{ display: 'none' }} onClick={(event) => event.stopPropagation()} onChange={(event) => { void chooseImage(event.target.files?.[0] || null, '본인 셀카', setSelfie); event.currentTarget.value = ''; }} />
            </Dropzone>
            </div>
          </ListGroup></>; })()}
        </>
      ) : null}

      {step?.kind === 'additional-driver' ? (
        <>
          <ListGroup>
            <DetailRow label="운전 가능 범위" value={S(snapshot.additionalDriverPolicy?.driverScope) || '계약서 기재 운전자'} stacked />
            <DetailRow label="추가운전자 비용" value={additionalDriverCost} stacked />
          </ListGroup>

          {additionalDrivers.map((driver, index) => (
            <div key={index} style={{ display: 'grid', gap: 10, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, fontSize: FS.title, fontWeight: FW.strong }}>추가 운전자 {index + 1}</div>
                <Btn title={`추가 운전자 ${index + 1} 삭제`} size="sm" variant="ghost" onClick={() => removeAdditionalDriver(index)}>
                  <ButtonLabel icon={<Trash2 size={ICON.sm} aria-hidden />}>삭제</ButtonLabel>
                </Btn>
              </div>
              <label style={label}><span className={styles.fieldLabel}>성명 <ReqTag /></span><Input value={driver.name} onChange={(value) => updateAdditionalDriver(index, 'name', value)} full style={inputStyle} /></label>
              <label style={label}><span className={styles.fieldLabel}>관계 <ReqTag /></span><Input value={driver.relation} onChange={(value) => updateAdditionalDriver(index, 'relation', value)} placeholder="예: 배우자, 가족" full style={inputStyle} /></label>
              <label style={label}><span className={styles.fieldLabel}>연락처 <ReqTag /></span><Input value={driver.phone} onChange={(value) => updateAdditionalDriver(index, 'phone', fmtPhone(value))} inputMode="tel" full style={inputStyle} /></label>
              <label style={label}><span className={styles.fieldLabel}>운전면허번호 <ReqTag /></span><Input value={driver.driverLicenseNo} onChange={(value) => updateAdditionalDriver(index, 'driverLicenseNo', value)} placeholder="면허증에 표시된 번호" full style={inputStyle} /></label>
              <Dropzone
                variant="photo"
                active={!!additionalDriverLicenses[index]}
                onClick={() => additionalDriverLicenseRefs.current[index]?.click()}
                title={`추가 운전자 ${index + 1} 운전면허증 사진 첨부`}
              >
                <FileThumb file={additionalDriverLicenses[index]} />
                <ImagePlus size={ICON.md} color={additionalDriverLicenses[index] ? C.ok : C.faint} />
                <span style={{ fontSize: FS.sub, fontWeight: FW.strong }}>{additionalDriverLicenses[index]?.name || '운전면허증 사진'}</span>
                <span style={{ fontSize: FS.micro, color: C.faint }}>{preparingImage ? '사진 준비 중' : '큰 파일은 자동 압축'}</span>
                <input
                  ref={(element) => { additionalDriverLicenseRefs.current[index] = element; }}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    void chooseImage(
                      event.target.files?.[0] || null,
                      `추가 운전자 ${index + 1} 운전면허증`,
                      (file) => setAdditionalDriverLicense(index, file),
                    );
                    event.currentTarget.value = '';
                  }}
                />
              </Dropzone>
              <Btn
                full
                title={`추가 운전자 개인정보 제공·면허증 제출${additionalDriverCost === '—' ? '' : ` 및 ${additionalDriverCost} 적용`} 동의`}
                variant={driver.consent ? 'solid' : 'ghost'}
                onClick={() => updateAdditionalDriver(index, 'consent', !driver.consent)}
                style={{ justifyContent: 'flex-start' }}
              >
                <span style={{ width: 18 }}>{driver.consent ? <Check size={ICON.sm} aria-hidden /> : null}</span>
                본인이 직접 입력했으며 개인정보 제공과 면허증 제출에 동의합니다 (필수)
              </Btn>
            </div>
          ))}

          <div style={{ marginTop: 16 }}>
            <Btn
              full
              title="추가 운전자 등록"
              variant="ghost"
              disabled={additionalDrivers.length >= additionalDriverLimit}
              onClick={addAdditionalDriver}
            >
              <ButtonLabel icon={<Plus size={ICON.md} aria-hidden />}>
                {additionalDrivers.length >= additionalDriverLimit
                  ? `최대 ${additionalDriverLimit}명 등록 가능`
                  : '추가 운전자 등록'}
              </ButtonLabel>
            </Btn>
          </div>
          <Message variant="info">
            회사의 운전자격·보험 적용 확인이 완료되기 전에는 추가 운전자가 차량을 운전할 수 없습니다.
          </Message>
        </>
      ) : null}

      {step?.kind === 'documents' ? (
        <>
          <div style={{ display: 'grid', gap: 10 }}>
            {requiredDocuments.map((document) => {
              const file = supportingFiles[document.key];
              const uploaded = uploadedSupportingDocumentKeys.has(document.key);
              return (
                <div key={document.key} style={{ display: 'grid', gap: 5 }}>
                  <Dropzone
                    variant="photo"
                    active={!!file || uploaded}
                    onClick={() => supportingFileRefs.current[document.key]?.click()}
                    title={`${document.label} 첨부`}
                  >
                    <FileThumb file={file && file.type.startsWith('image/') ? file : null} />
                    <FileText size={ICON.md} color={file || uploaded ? C.ok : C.faint} />
                    <span style={{ fontSize: FS.sub, fontWeight: FW.strong }}>
                      {file?.name || (uploaded ? `${document.label} 제출 완료` : document.label)}
                    </span>
                    {document.required ? <ReqTag /> : null}
                    <span style={{ fontSize: FS.micro, color: C.faint }}>
                      {document.required ? '필수 · ' : '선택 · '}사진 또는 PDF · 파일당 5MB 이하
                    </span>
                    <input
                      ref={(element) => { supportingFileRefs.current[document.key] = element; }}
                      type="file"
                      accept="image/*,application/pdf"
                      style={{ display: 'none' }}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        void chooseSupportingFile(document.key, document.label, event.target.files?.[0] || null);
                        event.currentTarget.value = '';
                      }}
                    />
                  </Dropzone>
                  {document.note ? <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5 }}>{document.note}</div> : null}
                </div>
              );
            })}
          </div>
          <Message variant="info">
            첨부 원본은 계약 검토 관리자만 확인할 수 있으며 공개 계약정보에는 노출되지 않습니다.
          </Message>
        </>
      ) : null}

      {step?.kind === 'section' && step.page ? (
        <>
          <div
            ref={readRef}
            onScroll={onRead}
            style={{ maxHeight: 420, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: R }}
          >
            <ListGroup>
              {(step.page.rows || []).map((row, index) => (
                <ConditionRow key={`${row.label}-${index}`} label={row.label || '항목'} value={row.value || '—'} article={row.article} />
              ))}
            </ListGroup>
          </div>
          {step.page.requireReadThrough && !readThrough[step.key] ? <Message variant="warning">아래까지 모두 확인하면 다음으로 갈 수 있습니다.</Message> : null}
        </>
      ) : null}

      {step?.kind === 'agreement' ? (
        <>
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
          {!readThrough.agreement ? <Message variant="warning">약관을 끝까지 내려 읽어 주세요.</Message> : null}
          <div style={{ marginTop: 10 }}>
            <ConsentChoice
              consentKey="rental_terms"
              label={consentLabel('rental_terms')}
              checked={consents.has('rental_terms')}
              onToggle={() => toggleConsent('rental_terms')}
            />
          </div>
        </>
      ) : null}

      {step?.kind === 'signature' ? (
        <>
          <div style={{ fontSize: FS.title, fontWeight: FW.head }}>무엇에 서명하나</div>
          <Message variant="info">아래 서명은 위 계약서·확인한 모든 조건·약관에 대한 전자서명입니다.</Message>
          <ListGroup>
            <DetailRow label="계약서" value={S(snapshot.contractKind?.title) || S(snapshot.template?.label) || '자동차 대여 계약서'} />
            <DetailRow label="약관" value={`${S(snapshot.agreement?.title) || '자동차 대여 약관'} · ${S(snapshot.agreement?.version) || '—'}`} stacked />
            <DetailRow label="계약 조건 확인" value={`${Object.keys(confirmations).length} / ${pages.length} 섹션`} />
            <DetailRow label="필수 동의" value={`${requiredConsents.filter((key) => consents.has(key)).length} / ${requiredConsents.length}건`} />
            <DetailRow label="본인확인 자료" value={idCard && selfie ? '운전면허증·셀카 첨부' : '누락'} />
            {requiredDocuments.length ? (
              <DetailRow
                label="추가 제출서류"
                value={`${requiredDocuments.filter((document) => uploadedSupportingDocumentKeys.has(document.key)).length} / ${requiredDocuments.length}건 제출`}
              />
            ) : null}
            {additionalDrivers.length ? <DetailRow label="추가 운전자" value={`${additionalDrivers.length}명 · ${additionalDriverCost}`} stacked /> : null}
          </ListGroup>
          <div style={{ fontSize: FS.title, fontWeight: FW.head, margin: '24px 0 10px', display: 'flex', alignItems: 'center' }}>
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
          <Message variant="info">서명시각과 단계별 확인시각이 기록되며, 관리자 확정 후에는 내용을 바꿀 수 없습니다.</Message>
        </>
      ) : null}
      </section>

      <div className={styles.navigation}>
        <div className={styles.navPrev}>
        <Btn full title="이전" variant="ghost" disabled={stepIndex <= 0 || busy} onClick={() => setStepIndex((index) => Math.max(0, index - 1))}>
          <ButtonLabel icon={<ArrowLeft size={ICON.md} aria-hidden />}>이전</ButtonLabel>
        </Btn>
        </div>
        <div className={styles.navNext}>
        {step?.kind === 'signature' ? (
          <Btn full title="본인확인 자료와 전자서명 제출" disabled={busy || preparingImage} onClick={() => void submit()}>
            <ButtonLabel icon={<Send size={ICON.md} aria-hidden />}>{busy ? '안전하게 제출 중…' : '확인하고 전자서명 제출'}</ButtonLabel>
          </Btn>
        ) : (
          <Btn full title="다음" disabled={busy || preparingImage} onClick={() => void next()}>
            {busy ? '확인 기록 중…' : step?.kind === 'summary' ? '개인정보 입력 단계로 이동' : step?.kind === 'section' ? (step.page?.confirmLabel || '확인하고 다음') : step?.kind === 'agreement' ? (snapshot.agreement?.confirmLabel || '동의하고 서명으로') : '다음'}
          </Btn>
        )}
        </div>
      </div>
      </div>
    </main>
  );
}
