'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, CalendarDays, CarFront, CircleDollarSign, Eraser, Eye, FileDown, FileText, ImagePlus, Minus, Plus, Send, Trash2, WalletCards } from 'lucide-react';
import {
  Badge, Btn, ButtonLabel, C, Checkbox, Disclosure, Dropzone, FormCard, fmtPhone, FS, FW, ICON,
  FlowActions, Loading, Message, Modal, NUM, R_CARD, SectionLabel, SummaryStats, THUMB_W, WorkInput, WorkRow, WorkTable,
} from '@/components/ui';
import { toast } from '@/components/Toaster';
import { GUEST_W } from '@/lib/guest-layout';

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
  /* 「필수」는 «오류»가 아니라 «안내»다(사장님 2026-08-21 「손님한테 나가는 건데」).
     빨간 solid 는 뭔가 잘못됐다는 신호라 손님이 겁먹는다. 브랜드 계열 옅은 틴트로 낮춘다.
     진짜 빨강은 미선택으로 «막혔을 때»만 쓴다(아래 경고 문구). */
  return <Badge tone="blue" variant="solid">필수</Badge>;
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
  return <img src={url} alt="" style={{ width: '100%', maxHeight: THUMB_W, objectFit: 'cover', borderRadius: R_CARD, display: 'block' }} />;
}

function conditionValue(value: string, article?: string) {
  return (
    <>
      {value || '—'}
      {article ? <div style={{ fontSize: FS.cap, color: C.mute, marginTop: 3 }}>관련 약관 {article}</div> : null}
    </>
  );
}

/** 긴 동의 문구는 표의 좁은 라벨 칸이 아니라 값 칸 전체에서 읽는다. */
function ConsentRow({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <WorkRow label="동의 항목" valueStyle={{ padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
        <Checkbox
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={label}
          style={{ width: 18, height: 18, margin: 0, flex: '0 0 auto' }}
        />
        <span style={{ minWidth: 0, fontSize: FS.body, fontWeight: FW.label, lineHeight: 1.45 }}>
          {label}
        </span>
      </div>
    </WorkRow>
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
  /*
   * ★작성 중 창을 닫으면 그때까지 쓴 게 사라진다 — 중간 저장이 없다(메모리 상태뿐).
   *   전화 한 통 받고 나가면 신분증·셀카부터 다시 찍어야 한다.
   *   ⚠ localStorage 에 담지 않는다: 주민번호·면허번호가 손님 폰에 평문으로 남고,
   *      공용 기기면 다음 사람이 본다. 제대로 된 답은 «서버 부분 저장»이고 별건이다
   *      (docs/ESIGN-MANUAL.md Q5). 여기서는 실수로 닫는 것만 막는다.
   */
  const hasTyped = Object.values(form).some((value) => S(value) !== '');
  useEffect(() => {
    if (!hasTyped) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasTyped]);
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
  const [documentPreviewOpen, setDocumentPreviewOpen] = useState(false);
  const [documentPreviewedAt, setDocumentPreviewedAt] = useState(0);
  const [documentZoom, setDocumentZoom] = useState(1);
  // 관리자 미리보기(?preview=1) — 서버는 peek 로 읽기만 하고, 화면은 입력 검증·진행 기록·제출을 하지 않는다.
  const [preview, setPreview] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const selfieRef = useRef<HTMLInputElement>(null);
  const additionalDriverLicenseRefs = useRef<Array<HTMLInputElement | null>>([]);
  const supportingFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const readRef = useRef<HTMLDivElement>(null);
  const stepBodyRef = useRef<HTMLDivElement>(null);
  const agreementEndRef = useRef<HTMLDivElement>(null);
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
    ? '계약서 원본 및 자동차 대여약관'
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

  useEffect(() => {
    if (step?.kind !== 'agreement') return undefined;
    const root = stepBodyRef.current;
    const end = agreementEndRef.current;
    if (!root || !end) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setReadThrough((prev) => ({ ...prev, agreement: true }));
      }
    }, { root, threshold: 0 });
    io.observe(end);
    return () => io.disconnect();
  }, [step?.kind]);

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
      if (!documentPreviewedAt) return toast('실제 계약서 원본을 열람한 뒤 동의해 주세요.', 'error');
      if (!readThrough.agreement) return toast('약관을 끝까지 읽어 주세요.', 'error');
      if (!consents.has('rental_terms')) return toast('계약서 원본 및 약관에 동의해 주세요.', 'error');
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
        documentPreviewedAt,
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

  const shell: CSSProperties = {
    height: '100dvh', padding: 16, background: C.bg, color: C.ink,
    display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden',
  };
  const frame: CSSProperties = {
    width: '100%', maxWidth: GUEST_W, margin: '0 auto', minWidth: 0, minHeight: 0, flex: 1,
    display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden',
  };

  if (view === undefined) return <Loading />;
  if (!view || view.error) return (
    <main style={shell}>
      <div style={frame}>
        <FormCard title="지금은 열 수 없는 링크입니다">
          <Message variant="warning">{view?.error || '이미 제출을 마쳤거나 링크가 만료되었습니다.'}</Message>
        </FormCard>
      </div>
    </main>
  );
  if (view.status === '검토대기' || view.status === '서명완료') return (
    <main style={shell}>
      <div style={frame}>
        <FormCard title={view.status === '서명완료' ? '전자계약이 완료되었습니다' : '제출이 접수되었습니다'}>
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
        </FormCard>
      </div>
    </main>
  );

  const contract = snapshot.contract || {};
  // 신차·임시번호는 A4 완료본과 같은 값으로 보여 실제 번호처럼 오인되지 않게 한다.
  const vehicleNumber = snapshot.templateState?.car === '신차'
    ? '미정 (신차)'
    : S(contract.car_number_snapshot) || '—';
  const vehicleModel = compactVehicleModel(contract, snapshot.templateFields);
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
    <main style={shell}>
      <div style={frame}>
      <header style={{ flex: '0 0 auto', background: C.bg, display: 'grid', gap: 8, paddingBottom: 8, minWidth: 0 }}>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} aria-label="진행 묶음">
          {BUNDLES.map((item, index) => (
            <Badge
              key={item.name}
              tone={bundle === item.id ? 'blue' : bundle > item.id ? 'green' : 'gray'}
              variant={bundle === item.id ? 'solid' : bundle > item.id ? 'fill' : 'line'}
            >
              {index + 1}. {item.name}
            </Badge>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}><SectionLabel mt={0} mb={0}>{step?.title || '전자계약'}</SectionLabel></div>
          <div style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.meta, fontFamily: NUM }}>{stepNo} / {steps.length}{preview ? ' · 미리보기' : ''}</div>
        </div>
      </header>

      <section ref={stepBodyRef} style={{ flex: 1, minHeight: 0, minWidth: 0, overflowX: 'hidden', overflowY: 'auto', display: 'grid', gap: 12, alignContent: 'start' }}>
      {/* 단계 안내는 «가이드»지 알림이 아니다 — 파란 박스로 세우면 진짜 알릴 것(보완 요청·오류)과
          위계가 같아진다. 제목 밑 설명 줄로 둔다(사장님 2026-08-21). */}
      {stepGuide(step) ? (
        <div style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.5, marginTop: -4 }}>{stepGuide(step)}</div>
      ) : null}
      {view.rejectReason ? (
        <Message variant="warning">
          보완 요청: {view.rejectReason}
          {(view.supplementItems || []).length ? ` · ${(view.supplementItems || []).join(' · ')}` : ''}
        </Message>
      ) : null}

      {step?.kind === 'summary' ? (
        <>
          <SummaryStats items={[
            { label: '차량', value: vehicleNumber, icon: CarFront },
            { label: feeLabel, value: rentWon, icon: CircleDollarSign },
            { label: '보증금', value: depositWon, icon: WalletCards },
            { label: periodLabel, value: periodText, icon: CalendarDays },
          ]} />
          {/* 파란 안내 박스를 잇달아 쌓지 않는다 — 위 stepGuide 가 이미 같은 말을 한다.
              여기서는 아래 표를 가리키는 제목 한 줄로만 둔다(사장님 2026-08-21). */}
          <div style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.ink, margin: '2px 0 -2px' }}>
            {S(form.customer_name) ? `${S(form.customer_name)}님, 아래 계약이 맞습니까?` : '아래 계약 내용을 확인해 주세요.'}
          </div>
          <WorkTable accent="main" title={S(snapshot.contractKind?.title) || S(snapshot.template?.label) || '자동차 대여 계약서'}>
            <WorkRow label="임대인 회사명">{S(snapshot.landlord?.companyName) || S(snapshot.templateFields?.company_name) || '—'}</WorkRow>
            <WorkRow label="차량">{`${vehicleNumber} · ${vehicleModel}`}</WorkRow>
            <WorkRow label={periodLabel}>{periodText}</WorkRow>
            <WorkRow label={feeLabel}>{rentWon}</WorkRow>
            <WorkRow label="보증금">{depositWon}</WorkRow>
            <WorkRow label="계약번호">{S(contract.contract_code) || '—'}</WorkRow>
          </WorkTable>
          {/* 한 줄짜리를 표로 세우지 않는다(사장님 2026-08-21) — 「확인 항목」이라는 라벨도 빈말이다.
              위 계약서 요약에 딸린 부가 설명이므로 표 밑 한 줄로 둔다. */}
          {isSonogongSubscription ? (
            <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5, marginTop: -4 }}>
              ※ 구독료·구독기간, 만기 반납/인수, 보험료 포함 여부, 정비서비스, 중도해지·반납 조건을 함께 확인해 주세요.
            </div>
          ) : null}
          {/* 미리보기 버튼에 딸린 각주다 — 박스로 세우면 앞의 안내와 위계가 같아진다. */}
          <div style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.5 }}>
            미리보기는 개인정보 입력·동의 없이 볼 수 있고, 보는 것만으로 동의·서명되지 않습니다.
          </div>
          {view.previewDocumentUrl ? (
            <Btn full title="계약서 미리보기" onClick={() => setDocumentPreviewOpen(true)} aria-haspopup="dialog" aria-expanded={documentPreviewOpen}>
              <ButtonLabel icon={<Eye size={ICON.md} aria-hidden />}>계약서 미리보기</ButtonLabel>
            </Btn>
          ) : null}
          <Disclosure title="모바일 계약서 전체보기">
            <div style={{ display: 'grid', gap: 12 }}>
              {pages.map((page) => (
                <WorkTable key={page.key} title={page.title || '계약 조건'}>
                  {(page.rows || []).map((row, index) => (
                    <WorkRow key={`${page.key}-${row.label}-${index}`} label={row.label || '항목'}>{row.value || '—'}</WorkRow>
                  ))}
                </WorkTable>
              ))}
              <Disclosure title="자동차 대여 약관 보기">
                {(snapshot.agreement?.sections || []).map((section, index) => (
                  <FormCard key={`${section.t}-${index}`} title={section.t}>
                    <div style={{ overflowWrap: 'anywhere', fontSize: FS.body, color: C.ink }}>{section.b}</div>
                  </FormCard>
                ))}
              </Disclosure>
            </div>
          </Disclosure>
        </>
      ) : null}

      {step?.kind === 'privacy' ? (
        <>
          {consentAtoms.map((atom) => (
            <WorkTable key={atom.key} title={atom.label}>
              <WorkRow label="수집·이용 항목">{(atom.items || []).join(', ') || '—'}</WorkRow>
              <WorkRow label="목적">{atom.purpose || '—'}</WorkRow>
              <WorkRow label="보유기간">{atom.retention || '—'}</WorkRow>
              <WorkRow label="동의 거부 시">{atom.refusalNote || '—'}</WorkRow>
            </WorkTable>
          ))}
          <WorkTable accent="main" title="필수 동의">
            {upfrontConsents.map((key) => (
              <ConsentRow
                key={key}
                label={consentLabel(key)}
                checked={consents.has(key)}
                onChange={() => toggleConsent(key)}
              />
            ))}
          </WorkTable>
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
          <WorkTable accent="main" title="계약자 정보">
            <WorkRow label={<>{corporate ? '법인명' : '성명'} <ReqTag /></>}><WorkInput value={form.customer_name} onChange={(value) => set('customer_name', value)} full /></WorkRow>
            <WorkRow label={<>연락처 <ReqTag /></>}><WorkInput value={form.customer_phone} onChange={(value) => set('customer_phone', fmtPhone(value))} inputMode="tel" full /></WorkRow>
            <WorkRow label={<>{corporate ? '법인등록번호' : '주민등록번호'} <ReqTag /></>}><WorkInput value={form.customer_id} onChange={(value) => set('customer_id', value)} inputMode="numeric" placeholder="계약·매출증빙용" full /></WorkRow>
            <WorkRow label={<>{corporate ? '사업자등록번호' : '운전면허번호'} <ReqTag /></>}><WorkInput value={form.driver_license_no} onChange={(value) => set('driver_license_no', value)} placeholder={corporate ? '사업자등록증에 표시된 번호' : '면허증에 표시된 번호'} full /></WorkRow>
            <WorkRow label={<>주소 <ReqTag /></>}><WorkInput value={form.customer_address} onChange={(value) => set('customer_address', value)} full /></WorkRow>
          </WorkTable>
          {soleProprietor ? (
            <WorkTable title="세금계산서 사업자 정보">
              <WorkRow label={<>상호 <ReqTag /></>}><WorkInput value={form.tax_biz_name} onChange={(value) => set('tax_biz_name', value)} full /></WorkRow>
              <WorkRow label={<>사업자등록번호 <ReqTag /></>}><WorkInput value={form.tax_biz_no} onChange={(value) => set('tax_biz_no', value)} inputMode="numeric" full /></WorkRow>
              <WorkRow label={<>대표자 <ReqTag /></>}><WorkInput value={form.tax_ceo} onChange={(value) => set('tax_ceo', value)} full /></WorkRow>
              <WorkRow label={<>업태·종목 <ReqTag /></>}><WorkInput value={form.tax_biz_type_item} onChange={(value) => set('tax_biz_type_item', value)} full /></WorkRow>
              <WorkRow label={<>세금계산서 이메일 <ReqTag /></>}><WorkInput value={form.tax_email} onChange={(value) => set('tax_email', value)} inputMode="email" full /></WorkRow>
              <WorkRow label={<>사업장 주소 <ReqTag /></>}><WorkInput value={form.tax_biz_address} onChange={(value) => set('tax_biz_address', value)} full /></WorkRow>
            </WorkTable>
          ) : null}
          <WorkTable title={corporate ? '담당자 연락처' : '비상 연락처'}>
            <WorkRow label={<>{corporate ? '직책·관계' : '관계'} <ReqTag /></>}><WorkInput value={form.emergency_relation} onChange={(value) => set('emergency_relation', value)} placeholder="예: 모, 배우자, 형제자매" full /></WorkRow>
            <WorkRow label={<>성명 <ReqTag /></>}><WorkInput value={form.emergency_name} onChange={(value) => set('emergency_name', value)} placeholder="예: 홍길순" full /></WorkRow>
            <WorkRow label={<>비상연락처 <ReqTag /></>}><WorkInput value={form.emergency_phone} onChange={(value) => set('emergency_phone', fmtPhone(value))} inputMode="tel" full /></WorkRow>
          </WorkTable>
          <FormCard title={corporate ? '담당자 본인확인 자료' : '본인확인 자료'}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            <Dropzone variant="photo" active={!!idCard} onClick={() => idRef.current?.click()} title="운전면허증 사진 첨부">
              <FileThumb file={idCard} />
              <ImagePlus size={ICON.md} color={idCard ? C.ok : C.faint} />
              <span style={{ fontSize: FS.sub, fontWeight: FW.strong }}>{idCard?.name || '운전면허증 사진'}</span>
              <ReqTag />
              <span style={{ fontSize: FS.micro, color: C.faint }}>{preparingImage ? '사진 준비 중' : '큰 파일은 자동 압축'}</span>
              <input ref={idRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onClick={(event) => event.stopPropagation()} onChange={(event) => { void chooseImage(event.target.files?.[0] || null, '운전면허증', setIdCard); event.currentTarget.value = ''; }} />
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
          </FormCard></>; })()}
        </>
      ) : null}

      {step?.kind === 'additional-driver' ? (
        <>
          <WorkTable title="추가 운전자">
            <WorkRow label="운전 가능 범위">{S(snapshot.additionalDriverPolicy?.driverScope) || '계약서 기재 운전자'}</WorkRow>
            <WorkRow label="추가운전자 비용">{additionalDriverCost}</WorkRow>
          </WorkTable>

          {additionalDrivers.map((driver, index) => (
            <div key={index} style={{ display: 'grid', gap: 12 }}>
            <WorkTable
              title={`추가 운전자 ${index + 1}`}
              hint={<Btn title={`추가 운전자 ${index + 1} 삭제`} size="sm" variant="ghost" onClick={() => removeAdditionalDriver(index)}>
                <ButtonLabel icon={<Trash2 size={ICON.sm} aria-hidden />}>삭제</ButtonLabel>
              </Btn>}
            >
              <WorkRow label={<>성명 <ReqTag /></>}><WorkInput value={driver.name} onChange={(value) => updateAdditionalDriver(index, 'name', value)} full /></WorkRow>
              <WorkRow label={<>관계 <ReqTag /></>}><WorkInput value={driver.relation} onChange={(value) => updateAdditionalDriver(index, 'relation', value)} placeholder="예: 배우자, 가족" full /></WorkRow>
              <WorkRow label={<>연락처 <ReqTag /></>}><WorkInput value={driver.phone} onChange={(value) => updateAdditionalDriver(index, 'phone', fmtPhone(value))} inputMode="tel" full /></WorkRow>
              <WorkRow label={<>운전면허번호 <ReqTag /></>}><WorkInput value={driver.driverLicenseNo} onChange={(value) => updateAdditionalDriver(index, 'driverLicenseNo', value)} placeholder="면허증에 표시된 번호" full /></WorkRow>
              <WorkRow label={<>동의 <ReqTag /></>}>
                <Checkbox
                  checked={!!driver.consent}
                  onChange={(checked) => updateAdditionalDriver(index, 'consent', checked)}
                  ariaLabel="추가 운전자 개인정보 제공·면허증 제출 동의"
                />
              </WorkRow>
            </WorkTable>
              <FormCard title="운전면허증">
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
                  capture="environment"
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
              </FormCard>
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
          <FormCard title="요청 서류">
          <div style={{ display: 'grid', gap: 12 }}>
            {requiredDocuments.map((document) => {
              const file = supportingFiles[document.key];
              const uploaded = uploadedSupportingDocumentKeys.has(document.key);
              return (
                <div key={document.key} style={{ display: 'grid', gap: 6 }}>
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
                  {document.note ? <Message variant="info">{document.note}</Message> : null}
                </div>
              );
            })}
          </div>
          </FormCard>
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
            aria-label={`${step.title} 계약조건 전체 내용`}
            style={{ maxHeight: 420, overflow: 'auto' }}
          >
            <WorkTable title={step.title || '계약 조건'}>
              {(step.page.rows || []).map((row, index) => (
                <WorkRow key={`${row.label}-${index}`} label={row.label || '항목'}>
                  {conditionValue(row.value || '—', row.article)}
                </WorkRow>
              ))}
            </WorkTable>
          </div>
          {step.page.requireReadThrough && !readThrough[step.key] ? <Message variant="warning">위 계약조건 영역을 끝까지 스크롤해 전체 내용을 확인하면 다음으로 갈 수 있습니다.</Message> : null}
        </>
      ) : null}

      {step?.kind === 'agreement' ? (
        <>
          <Message variant={documentPreviewedAt ? 'success' : 'info'}>
            {documentPreviewedAt ? '계약서 원본을 열람했습니다. 아래 약관을 끝까지 읽고 동의해 주세요.' : '아래 동의 전에 실제로 서명할 계약서 원본을 열람해 주세요.'}
          </Message>
          {view.previewDocumentUrl ? (
            <div style={{ marginTop: 10 }}>
              <Btn full variant="ghost" onClick={() => setDocumentPreviewOpen(true)}>
                <ButtonLabel icon={<Eye size={ICON.md} aria-hidden />}>계약서 원본 열람 · 확대해서 보기</ButtonLabel>
              </Btn>
            </div>
          ) : null}
          <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            {(snapshot.agreement?.sections || []).map((section, index) => (
              <FormCard key={`${section.t}-${index}`} title={section.t}>
                <div style={{ overflowWrap: 'anywhere', fontSize: FS.body, color: C.ink }}>{section.b}</div>
              </FormCard>
            ))}
            <div ref={agreementEndRef}>
              <Message variant="info">— 약관 끝 —</Message>
            </div>
          </div>
          {!readThrough.agreement ? <Message variant="warning">약관을 끝까지 내려 읽어 주세요.</Message> : null}
          <WorkTable accent="main" title="필수 동의">
            <ConsentRow
              label={consentLabel('rental_terms')}
              checked={consents.has('rental_terms')}
              onChange={() => { if (documentPreviewedAt) toggleConsent('rental_terms'); }}
              disabled={!documentPreviewedAt}
            />
          </WorkTable>
          {!documentPreviewedAt ? <Message variant="warning">계약서 원본을 먼저 열람해 주세요.</Message> : null}
        </>
      ) : null}

      {step?.kind === 'signature' ? (
        <>
          <WorkTable title="무엇에 서명하나">
            <WorkRow label="계약서">{S(snapshot.contractKind?.title) || S(snapshot.template?.label) || '자동차 대여 계약서'}</WorkRow>
            <WorkRow label="약관">{`${S(snapshot.agreement?.title) || '자동차 대여 약관'} · ${S(snapshot.agreement?.version) || '—'}`}</WorkRow>
            <WorkRow label="계약 조건 확인">{`${Object.keys(confirmations).length} / ${pages.length} 섹션`}</WorkRow>
            <WorkRow label="필수 동의">{`${requiredConsents.filter((key) => consents.has(key)).length} / ${requiredConsents.length}건`}</WorkRow>
            <WorkRow label="본인확인 자료">{idCard && selfie ? '운전면허증·셀카 첨부' : '누락'}</WorkRow>
            {requiredDocuments.length ? (
              <WorkRow label="추가 제출서류">
                {`${requiredDocuments.filter((document) => uploadedSupportingDocumentKeys.has(document.key)).length} / ${requiredDocuments.length}건 제출`}
              </WorkRow>
            ) : null}
            {additionalDrivers.length ? <WorkRow label="추가 운전자">{`${additionalDrivers.length}명 · ${additionalDriverCost}`}</WorkRow> : null}
          </WorkTable>
          <Message variant="info">아래 서명은 위 계약서·확인한 모든 조건·약관에 대한 전자서명입니다.</Message>
          <FormCard title="전자서명" hint={<Btn title="서명 지우기" size="sm" variant="ghost" onClick={clearSignature}><ButtonLabel icon={<Eraser size={ICON.md} aria-hidden />}>지우기</ButtonLabel></Btn>}>
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
          </FormCard>
          <Message variant="info">서명시각과 단계별 확인시각이 기록되며, 관리자 확정 후에는 내용을 바꿀 수 없습니다.</Message>
        </>
      ) : null}
      </section>

      {view.previewDocumentUrl ? (
        <Modal
          open={documentPreviewOpen}
          title="계약서 미리보기"
          meta="실제 서명 대상 원본 · 확대·축소 가능"
          onClose={() => setDocumentPreviewOpen(false)}
          width={940}
          footer={<>
            <Btn variant="ghost" onClick={() => window.open(view.previewDocumentUrl, '_blank', 'noreferrer')}>
              <ButtonLabel icon={<FileText size={ICON.md} aria-hidden />}>PDF로 열기</ButtonLabel>
            </Btn>
            <Btn onClick={() => setDocumentPreviewOpen(false)}>계약 작성으로 돌아가기</Btn>
          </>}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} aria-label="계약서 확대 제어">
              <Btn size="sm" variant="ghost" title="축소" disabled={documentZoom <= 0.8} onClick={() => setDocumentZoom((value) => Math.max(0.8, Number((value - 0.2).toFixed(1))))}>
                <ButtonLabel icon={<Minus size={ICON.md} aria-hidden />}>축소</ButtonLabel>
              </Btn>
              <span style={{ minWidth: 48, color: C.mute, fontSize: FS.cap, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }} aria-live="polite">{Math.round(documentZoom * 100)}%</span>
              <Btn size="sm" variant="ghost" title="확대" disabled={documentZoom >= 2} onClick={() => setDocumentZoom((value) => Math.min(2, Number((value + 0.2).toFixed(1))))}>
                <ButtonLabel icon={<Plus size={ICON.md} aria-hidden />}>확대</ButtonLabel>
              </Btn>
              {documentZoom !== 1 ? <Btn size="sm" variant="ghost" title="원본 크기" onClick={() => setDocumentZoom(1)}>원본</Btn> : null}
            </div>
            <iframe
              title="계약서 PDF 미리보기"
              src={view.previewDocumentUrl}
              style={{ width: '100%', height: 'min(72dvh, 860px)', display: 'block', border: `1px solid ${C.line}`, borderRadius: R_CARD, background: C.bg, zoom: documentZoom }}
              onLoad={() => setDocumentPreviewedAt((value) => value || Date.now())}
            />
            <Message variant="info">실제 서명 대상 계약서 원본입니다. 확대해서 읽고, 닫으면 작성하던 단계로 돌아갑니다.</Message>
          </div>
        </Modal>
      ) : null}

      <FlowActions
        secondary={stepIndex > 0 ? {
          label: '이전',
          title: '이전',
          disabled: busy,
          onClick: () => setStepIndex((index) => Math.max(0, index - 1)),
          children: <ButtonLabel icon={<ArrowLeft size={ICON.md} aria-hidden />}>이전</ButtonLabel>,
        } : undefined}
        primary={step?.kind === 'signature'
          ? {
            title: '본인확인 자료와 전자서명 제출',
            disabled: busy || preparingImage,
            onClick: () => void submit(),
            label: <ButtonLabel icon={<Send size={ICON.md} aria-hidden />}>{busy ? '안전하게 제출 중…' : '확인하고 전자서명 제출'}</ButtonLabel>,
          }
          : {
            title: '다음',
            disabled: busy || preparingImage,
            onClick: () => void next(),
            label: busy ? '확인 기록 중…' : step?.kind === 'summary' ? '개인정보 입력 단계로 이동' : step?.kind === 'section' ? (step.page?.confirmLabel || '확인하고 다음') : step?.kind === 'agreement' ? (snapshot.agreement?.confirmLabel || '동의하고 서명으로') : '다음',
          }}
      />
      </div>
    </main>
  );
}
