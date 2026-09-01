'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Eraser, Eye, FileDown, FileText, ImagePlus, Plus, Send, Trash2 } from 'lucide-react';
import {
  Badge, Btn, ButtonLabel, C, Checkbox, Dropzone, fmtPhone, FS, FW, ICON,
  Loading, NUM, R_CARD, THUMB_W,
} from '@/components/ui';
/* ★손님 화면의 판·줄·입력칸은 «착한거래 원자»다(사장님 2026-08-29 「착한거래 한쪽으로 맞춰, 그쪽에 디자인 고도화를 할 거야」).
   ERP 이름으로 별칭을 달아 호출부 100여 곳을 그대로 둔다 — 이름만 바꿔 달아도 규격은 통째로 갈린다.
   ⚠ 새로 쓸 때는 별칭 말고 본이름(SignPanel·SignRow·SignInput)을 쓴다. 별칭은 «옮기는 중»이라는 표시다. */
import {
  SignPanel as WorkTable, SignPanel as FormCard, SignRow as WorkRow, SignInput as WorkInput, SignInput,
  SignFootnote, SignConsent, SignAccordion, SignProgress, SignField, SignNote,
} from '@/components/sign/atoms';
import { toast } from '@/components/Toaster';
import '@/components/sign/sign.css';
import { GUEST_W } from '@/lib/guest-layout';

const CLIENT_IMAGE_BYTES = 1_350_000;

const S = (value: unknown) => String(value ?? '').trim();

/** 주민등록번호 입력 도우미 — 숫자만 남기고 6자리 뒤에 하이픈을 넣는다. 손님이 직접 안 치게. */
const rrnMask = (value: string) => {
  const digits = String(value ?? '').replace(/[^0-9]/g, '').slice(0, 13);
  return digits.length > 6 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : digits;
};
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
  kind: 'summary' | 'information' | 'id-card' | 'selfie' | 'section' | 'agreement' | 'documents' | 'signature';
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
  if (kind === 'summary') return 0;
  if (kind === 'information' || kind === 'id-card' || kind === 'selfie') return 1;
  return 2;
}

/**
 * 단계 제목 — «명사»가 아니라 «문장»이다(착한거래 .stitle).
 * 손님 화면의 제목은 «지금 무엇을 해 달라는 말»이어야 한다.
 * 하단 버튼 글과 짝을 이룬다 — 「맞습니까?」 ↔ 「맞습니다. 계속하기」.
 */
function stepHeadline(step: JourneyStep | undefined): string {
  if (!step) return '전자계약';
  if (step.kind === 'summary') return '고객님, 아래 계약이 맞습니까?';
  if (step.kind === 'information') return '계약서에 들어갈 정보를 알려 주세요';
  if (step.kind === 'id-card') return '운전면허증을 촬영해 주세요';
  if (step.kind === 'selfie') return '본인 얼굴을 촬영해 주세요';
  if (step.kind === 'agreement') return '세부 계약과 약관을 확인해 주세요';
  if (step.kind === 'documents') return '필요한 부속서류를 제출해 주세요';
  if (step.kind === 'signature') return '마지막으로 서명해 주세요';
  return step.title || '전자계약';
}

function stepGuide(step: JourneyStep | undefined): string {
  if (!step) return '';
  if (step.kind === 'summary') return '차종·금액·기간과 꼭 알아야 할 조건을 먼저 확인합니다.';
  if (step.kind === 'information') return '개인정보 동의, 계약자 정보와 매출증빙을 입력합니다.';
  if (step.kind === 'id-card') return '주민등록번호 뒷자리를 가린 운전면허증 사진을 첨부합니다.';
  if (step.kind === 'selfie') return '계약자 본인 확인을 위한 얼굴 사진을 첨부합니다.';
  if (step.kind === 'section') return step.page?.note || '이 조건이 계약 내용입니다. 확인하고 다음으로 갑니다.';
  if (step.kind === 'agreement') return '세부 계약조건과 약관 전문을 끝까지 확인한 뒤 전체 내용에 동의합니다.';
  if (step.kind === 'documents') return '계약에 필요한 증빙서류만 제출합니다. 없는 계약은 바로 다음으로 넘어갑니다.';
  return '확인한 계약·약관에 전자서명합니다.';
}

function ReqTag() {
  /* 「필수」는 «오류»가 아니라 «안내»다(사장님 2026-08-21 「손님한테 나가는 건데」).
     빨간 solid 는 뭔가 잘못됐다는 신호라 손님이 겁먹는다. 브랜드 계열 옅은 틴트로 낮춘다.
     진짜 빨강은 미선택으로 «막혔을 때»만 쓴다(아래 경고 문구). */
  /* ★상자 뱃지가 아니라 «별표» 한 자다(.field .req).
     라벨마다 상자를 붙이면 폼이 뱃지밭이 되고, 진짜 알릴 것과 무게가 같아진다
     (사장님 2026-08-21 「필수라고 되어 있는 거 뱃지 왜 이렇게 촌스럽냐, 손님한테 나가는 건데」). */
  return <span className="req" aria-label="필수">*</span>;
}

function FileThumb({ file, fill }: { file: File | null; fill?: boolean }) {
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
  /* fill — 촬영 틀에서는 «틀»이 곧 규격이라 사진이 틀을 꽉 채워야 한다.
     첨부 목록에서는 지금처럼 THUMB_W 로 눕힌다. */
  if (fill) return <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
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


export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicResponse | null | undefined>(undefined);
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_id: '', customer_birth: '', customer_address: '',
    driver_license_no: '',
    tax_biz_name: '', tax_biz_no: '', tax_ceo: '', tax_biz_type_item: '', tax_email: '', tax_biz_address: '',
    emergency_relation: '', emergency_name: '', emergency_phone: '', signer_name: '', signer_role: '',
    cms_holder_name: '', cms_holder_relation: '', cms_holder_phone: '', cms_bank: '', cms_account_no: '', cms_holder_identifier: '',
  });
  const [salesProofMethod, setSalesProofMethod] = useState<'phone' | 'rrn'>('phone');
  const [salesProofValue, setSalesProofValue] = useState('');
  const [salesProofRrnConsent, setSalesProofRrnConsent] = useState(false);
  const [idCardRrnMasked, setIdCardRrnMasked] = useState(false);
  const [consents, setConsents] = useState<Set<string>>(new Set());
  /*
   * ★작성 중 창을 닫으면 그때까지 쓴 게 사라진다 — 중간 저장이 없다(메모리 상태뿐).
   *   전화 한 통 받고 나가면 신분증·얼굴 사진부터 다시 찍어야 한다.
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
  // 개별 조건마다 같은 확인을 반복시키지 않는다. 이 값은 한 화면의
  // 「중요 계약조건 확인」 체크이며, 저장 시에는 실제로 제시한 각 조건의
  // 확인 시각을 같은 시각으로 남긴다.
  const [conditionsConfirmed, setConditionsConfirmed] = useState(false);
  const [readThrough, setReadThrough] = useState<Record<string, boolean>>({});
  const [summaryConfirmedAt, setSummaryConfirmedAt] = useState(0);
  const [agreementReadAt, setAgreementReadAt] = useState(0);
  const [idCard, setIdCard] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [additionalDrivers, setAdditionalDrivers] = useState<AdditionalDriverForm[]>([]);
  const [additionalDriverLicenses, setAdditionalDriverLicenses] = useState<Array<File | null>>([]);
  const [supportingFiles, setSupportingFiles] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState(false);
  /* 서명 직전에 «작성본»을 봤는가 — 안 봤으면 서명 버튼을 잠근다. */
  const [filledContract, setFilledContract] = useState('');
  const [contractSeenAt, setContractSeenAt] = useState(0);
  const [previewingDoc, setPreviewingDoc] = useState(false);
  const [contractConfirmed, setContractConfirmed] = useState(false);
  const [preparingImage, setPreparingImage] = useState(false);
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
    ? '세부 계약과 자동차 대여약관의 전체 내용을 확인했습니다. 전자서명으로 최종 동의합니다.'
    : S(consentAtoms.find((atom) => S(atom.key) === key)?.label) || '필수 동의';
  const requiredDocuments = snapshot.requiredDocuments || [];
  const uploadedSupportingDocumentKeys = new Set(view?.uploadedSupportingDocumentKeys || []);
  const additionalDriverLimit = Math.max(0, Math.min(3, Number(snapshot.additionalDriverPolicy?.limit || 0)));
  const additionalDriverCost = S(snapshot.additionalDriverPolicy?.cost) || '—';
  const corporate = snapshot.templateState?.ct === '법인';
  const soleProprietor = snapshot.templateState?.tax === '사업자';
  const displayedDocuments = corporate && form.signer_role === '위임받은 임직원'
    ? requiredDocuments.map((document) => ({
      ...document,
      required: document.required || document.key === 'delegation_letter' || document.key === 'employment_certificate',
    }))
    : requiredDocuments;
  const pages = useMemo(
    () => snapshot.consentPages || snapshot.consentGroups || [],
    [snapshot.consentGroups, snapshot.consentPages],
  );
  const conditionGroups = [
    { key: 'vehicle-rental', title: '차량 · 기간 · 금액', pageKeys: ['vehicle', 'rental'] },
    { key: 'payment-service', title: '결제 · 만기 · 서비스', pageKeys: ['payment', 'service'] },
    { key: 'driver-insurance', title: '운전자 · 보험', pageKeys: ['driver', 'insurance'] },
    { key: 'accident', title: '사고 · 중도해지', pageKeys: ['accident'] },
  ].map((group) => ({
    ...group,
    pages: pages.filter((page) => group.pageKeys.includes(S(page.key))),
  })).filter((group) => group.pages.length);
  const groupedConditionKeys = new Set(conditionGroups.flatMap((group) => group.pageKeys));
  const otherConditionPages = pages.filter((page) => !groupedConditionKeys.has(S(page.key)));
  const steps = useMemo<JourneyStep[]>(() => [
    { kind: 'summary', key: 'summary', title: '요약 확인' },
    { kind: 'information', key: 'information', title: '개인정보 입력' },
    ...(!corporate ? [
      { kind: 'id-card' as const, key: 'id_card', title: '신분증 촬영' },
      { kind: 'selfie' as const, key: 'selfie', title: '본인 얼굴 촬영' },
    ] : []),
    { kind: 'agreement', key: 'agreement', title: '세부계약 · 약관' },
    { kind: 'documents', key: 'documents', title: '부속서류' },
    { kind: 'signature', key: 'signature', title: '전자서명' },
  ], [corporate]);
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
    if (step.kind === 'information' && !upfrontConsents.every((key) => consents.has(key))) {
      return toast('필수 개인정보 동의를 각각 선택해 주세요.', 'error');
    }
    if (step.kind === 'information') {
      const corporate = view?.snapshot?.templateState?.ct === '법인';
      const soleProprietor = view?.snapshot?.templateState?.tax === '사업자';
      if (!form.customer_name.trim() || !form.customer_phone.trim()) return toast('성명과 연락처를 입력해 주세요.', 'error');
      if (corporate && form.customer_id.replace(/\D/g, '').length !== 13) return toast('법인등록번호 13자리를 입력해 주세요.', 'error');
      /* 주민등록번호 13자리. 생년월일은 여기서 파생하므로 따로 받지 않는다. */
      if (!corporate && form.customer_id.replace(/[^0-9]/g, '').length !== 13) return toast('주민등록번호 13자리를 입력해 주세요.', 'error');
      if (corporate ? form.driver_license_no.replace(/\D/g, '').length !== 10 : !form.driver_license_no.trim()) return toast(corporate ? '사업자등록번호 10자리를 입력해 주세요.' : '운전면허번호를 입력해 주세요.', 'error');
      if (soleProprietor && (!form.tax_biz_name.trim() || form.tax_biz_no.replace(/\D/g, '').length !== 10 || !form.tax_ceo.trim() || !form.tax_biz_type_item.trim() || !/^\S+@\S+\.\S+$/.test(form.tax_email) || !form.tax_biz_address.trim())) return toast('세금계산서 사업자 정보를 모두 정확히 입력해 주세요.', 'error');
      if (!form.customer_address.trim()) return toast('계약서에 기재할 주소를 입력해 주세요.', 'error');
      if (!form.emergency_relation.trim() || !form.emergency_name.trim()) return toast('비상연락 관계와 성명을 입력해 주세요.', 'error');
      if (!/^\d{10,11}$/.test(form.emergency_phone.replace(/\D/g, ''))) return toast('비상연락처를 정확히 입력해 주세요.', 'error');
      if (corporate && (!form.signer_name.trim() || !['대표이사', '위임받은 임직원'].includes(form.signer_role))) return toast('서명자 성명과 법인과의 관계를 입력해 주세요.', 'error');
      if (consentProfile.cmsRequiredBeforeHandover) {
        if (!form.cms_holder_name.trim() || !form.cms_holder_relation.trim() || !form.cms_bank.trim() || !form.cms_account_no.replace(/\D/g, '') || !/^\d{10,11}$/.test(form.cms_holder_phone.replace(/\D/g, '')) || !/^\d{6}(\d{4})?$/.test(form.cms_holder_identifier.replace(/\D/g, ''))) {
          return toast('자동이체 예금주·관계·연락처·은행·계좌번호·생년월일 또는 사업자번호를 입력해 주세요.', 'error');
        }
      }
    }
    if (step.kind === 'information' && !corporate && !soleProprietor) {
      const digits = salesProofValue.replace(/\D/g, '');
      if (salesProofMethod === 'phone' && !/^\d{10,11}$/.test(digits)) return toast('매출증빙용 휴대전화번호를 입력해 주세요.', 'error');
      if (salesProofMethod === 'rrn' && (digits.length !== 13 || !salesProofRrnConsent)) return toast('주민등록번호 13자리와 암호화 보관 동의를 확인해 주세요.', 'error');
    }
    if (step.kind === 'information' && additionalDriverLimit > 0) {
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
      const missing = displayedDocuments.find((document) => (
        document.required
        && !supportingFiles[document.key]
        && !uploadedSupportingDocumentKeys.has(document.key)
      ));
      if (missing) return toast(`${missing.label}을(를) 첨부해 주세요.`, 'error');
    }
    if (step.kind === 'id-card') {
      if (!idCard) return toast('운전면허증 사진을 첨부해 주세요.', 'error');
      if (!idCardRrnMasked) return toast('운전면허증 사본의 주민등록번호 뒷자리를 가렸는지 확인해 주세요.', 'error');
    }
    if (step.kind === 'selfie' && !selfie) return toast('본인 얼굴 사진을 첨부해 주세요.', 'error');
    if (step.kind === 'section') {
      if (step.page?.requireReadThrough && !readThrough[step.key]) return toast('아래까지 모두 확인해 주세요.', 'error');
    }
    if (step.kind === 'agreement') {
      if (!conditionsConfirmed) return toast('세부 계약조건을 확인해 주세요.', 'error');
      if (!readThrough.agreement) return toast('약관을 끝까지 읽어 주세요.', 'error');
      if (!consents.has('rental_terms')) return toast('세부 계약과 약관 전체 내용에 동의해 주세요.', 'error');
    }
    setBusy(true);
    try {
      if (step.kind === 'information') {
        await Promise.all([
          markProgress('privacy'),
          ...(corporate ? [markProgress('identity')] : []),
          ...(!corporate && !soleProprietor ? [markProgress('sales_proof')] : []),
          ...(additionalDriverLimit > 0 ? [markProgress('additional_driver')] : []),
        ]);
      } else if (step.kind === 'summary') {
        await markProgress('summary');
      } else if (step.kind === 'agreement') {
        await Promise.all([markProgress('agreement'), ...pages.map((page) => markProgress(S(page.key)))]);
      } else if (step.kind === 'documents') {
        await uploadSupportingDocuments();
        await markProgress('documents');
      } else if (step.kind === 'id-card') {
        await markProgress('id_card');
      } else if (step.kind === 'selfie') {
        await markProgress('selfie');
      } else await markProgress(step.key);
      const at = Date.now();
      if (step.kind === 'summary') setSummaryConfirmedAt(at);
      if (step.kind === 'section') setConfirmations((prev) => ({ ...prev, [step.key]: at }));
      if (step.kind === 'agreement') setConfirmations((prev) => ({
        ...prev,
        ...Object.fromEntries(pages.map((page) => [S(page.key), at])),
      }));
      if (step.kind === 'agreement') setAgreementReadAt(at);
      setStepIndex((index) => Math.min(index + 1, steps.length - 1));
    } catch (error) {
      toast(error instanceof Error ? error.message : '진행정보를 저장하지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  /* ★미리보기와 제출이 «같은 값»을 쓴다. 두 벌로 만들면 손님이 확인한 종이와 봉인본이 갈린다. */
  const buildPayload = () => ({
    ...form,
    sales_proof_method: !corporate && !soleProprietor ? salesProofMethod : '',
    sales_proof_value: !corporate && !soleProprietor ? salesProofValue : '',
    sales_proof_rrn_consent: salesProofRrnConsent,
    id_card_rrn_masked: idCardRrnMasked,
    additional_drivers: additionalDrivers.map((driver) => ({
      name: driver.name,
      relation: driver.relation,
      phone: driver.phone,
      driver_license_no: driver.driverLicenseNo,
      consentAt: driver.consent ? Date.now() : 0,
    })),
    consents: [...consents],
    sectionConfirmations: confirmations,
    summaryConfirmedAt,
    agreementReadAt,
  });

  /**
   * 작성본 열기 — 내가 쓴 값이 채워진 계약서를 «흐름»으로 그린다.
   *
   * ⚠ 서식은 흐름 모드를 location.search 로도 켜지만, 여기서는 HTML 을 srcdoc 으로 넣으므로
   *   질의가 없다. 그래서 window.__FLOW__ 를 심어 켠다(rental-contract.html 의 CONTRACT_FLOW 주석).
   * ⚠ 저장하지 않는다. 제출은 기존 경로 그대로다.
   */
  const openFilledContract = async () => {
    if (busy || previewingDoc) return;
    setPreviewingDoc(true);
    try {
      const response = await fetch(
        `/api/freepass-esign/public/${encodeURIComponent(String(token))}/document?format=html`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: buildPayload() }), cache: 'no-store' },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; missing?: string[] };
        const missing = (body.missing || []).filter(Boolean);
        // 빈 종이를 그려 주지 않는다 — «무엇이 비었는지»를 말한다
        return toast(missing.length ? `${body.error || '입력이 덜 됐습니다.'} (${missing.join(' · ')})`
          : (body.error || '계약서를 만들지 못했습니다.'), 'error');
      }
      const html = await response.text();
      setFilledContract(html.replace('</head>', '<script>window.__FLOW__=true</script></head>'));
      setContractSeenAt((at) => at || Date.now());
    } catch {
      toast('계약서를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    } finally {
      setPreviewingDoc(false);
    }
  };

  const submit = async () => {
    if (busy || preparingImage) return;
    if (preview) return toast('관리자 미리보기입니다. 제출되지 않습니다.', 'error');
    if (!contractSeenAt) return toast('작성한 계약서를 먼저 확인해 주세요.', 'error');
    if (!contractConfirmed) return toast('계약서 내용이 맞는지 확인에 표시해 주세요.', 'error');
    if (!inked.current) return toast('서명란에 성명을 또렷하게 적어 주세요.', 'error');
    if (!requiredConsents.every((key) => consents.has(key))) return toast('필수 동의가 남았습니다.', 'error');
    if (pages.some((page) => !confirmations[S(page.key)])) return toast('확인하지 않은 계약 조건이 있습니다.', 'error');
    if (!corporate && (!idCard || !selfie)) return toast('운전면허증과 본인 얼굴 사진을 모두 첨부해 주세요.', 'error');
    setBusy(true);
    try {
      const payload = new FormData();
      payload.set('payload', JSON.stringify({
        ...buildPayload(),
        signature: canvasRef.current!.toDataURL('image/png'),
      }));
      if (idCard) payload.set('idCard', idCard);
      if (selfie) payload.set('selfie', selfie);
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

  /* ★손님 화면의 그릇은 «착한거래 규격»이다(components/sign/sign.css).
       ERP 토큰으로 흰 바탕을 직접 그리면 업무화면과 같은 얼굴이 된다 —
       손님은 이 화면에서 주민번호·서명을 낸다. 얼굴이 달라야 한다
       (사장님 2026-08-29 「착한거래와 동일하게 해야지」).
     폭·색·여백·높이를 전부 .sign-root / .sign-frame 이 잡는다 — 인라인 값을 두지 않는다.
     ⚠ 구조가 정해져 있다: .sign-root > .sign-frame > (.c-head, .steps, .c-body, .c-footer)
       중간에 다른 div 를 끼우면 .c-body 의 flex:1 이 끊겨 몸통이 안 스크롤된다. */

  if (view === undefined) return <Loading />;
  if (!view || view.error) return (
    <main className="sign-root sign-page">
      <div className="sign-frame">
        <FormCard title="지금은 열 수 없는 링크입니다">
          <SignNote tone="warn">{view?.error || '이미 제출을 마쳤거나 링크가 만료되었습니다.'}</SignNote>
        </FormCard>
      </div>
    </main>
  );
  if (view.status === '검토대기' || view.status === '서명완료') return (
    <main className="sign-root sign-page">
      <div className="sign-frame">
        <FormCard title={view.status === '서명완료' ? '전자계약이 완료되었습니다' : '제출이 접수되었습니다'}>
          <SignNote tone="ok">
            {view.status === '서명완료' ? '관리자 확인과 문서 봉인이 완료되었습니다.' : '담당자가 본인확인 자료·추가서류·서명을 확인한 뒤 계약을 확정합니다.'}
          </SignNote>
          {view.status === '서명완료' && view.documentUrl ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <button type="button" className="btn" onClick={() => window.open(view.documentUrl, '_blank', 'noreferrer')}>
                <Eye size={ICON.md} aria-hidden /> 완료 계약서 보기
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => window.open(view.downloadUrl || `${view.documentUrl}?download=1`, '_blank', 'noreferrer')}
              >
                <FileDown size={ICON.md} aria-hidden /> PDF 내려받기
              </button>
              <SignFootnote>
                관리자 확인과 문서 봉인이 끝난 확정본입니다. 보관용으로 내려받아 주세요.
              </SignFootnote>
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
    <main className="sign-root sign-page">
      <div className="sign-frame">
      {/* ★머리는 «남색 띠 한 줄»이다(착한거래 FlowHeader compact).
            [체크] freepass | 전자계약  계약 확인                    1 / 4
          마크는 프리패스 CI 정본(public/icon.svg)과 «같은 좌표»다 — 라운드 18.75% · 획 52/512.
          색만 반전한다(흰 네모 + 남색 체크). 네이비 머리 위에서 CI 원본과 같은 대비가 나온다.
          ⚠ 좌표를 고칠 일이 생기면 public/icon.svg 와 같이 고친다. */}
      <div className="c-head compact">
        <div className="c-head-row">
          <span className="c-head-brand">
            <span className="brand-mark brand-mark-compact" aria-hidden>
              <svg viewBox="0 0 512 512" fill="none">
                <path d="M128 264 l80 80 L384 168" stroke="currentColor" strokeWidth="52" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <b>freepass</b>
          </span>
          <span className="c-head-div" aria-hidden />
          <div className="c-head-now">
            <span className="c-head-title">전자계약</span>
            <span className="c-head-sub">{step?.title || ''}</span>
          </div>
          <span className="c-head-count">{stepNo} / {steps.length}{preview ? ' · 미리보기' : ''}</span>
        </div>
      </div>

      {/* 진행은 «막대»다 — 뱃지 셋을 늘어놓으면 «칩»으로 보이지 «어디까지 왔나»로 안 읽힌다.
          지나온 단계는 초록으로 칠한다(착한거래 .steps .on). */}
      <nav className="steps has-labels" aria-label="진행 단계">
        {BUNDLES.map((item) => {
          const passed = bundle >= item.id;
          const here = bundle === item.id;
          return (
            <div key={item.name} className="s-wrap" aria-current={here ? 'step' : undefined}>
              <span className={`s${passed ? ' on' : ''}${here ? ' cur' : ''}`} />
              <span className={`s-label${passed ? ' on' : ''}${here ? ' cur' : ''}`}>{item.name}</span>
            </div>
          );
        })}
      </nav>

      <section ref={stepBodyRef} className="c-body anim-in" key={step?.key}>
      {/* ★손님 화면의 제목은 세 단이다(착한거래 S07): 눈썹(.slabel) → 제목(.stitle) → 설명(.sdesc).
          제목은 «이름»이 아니라 «지금 무엇을 해 달라»는 문장이다 —
          「계약 확인」이라고만 두면 무엇을 하라는 건지 설명까지 읽어야 안다
          (사장님 2026-08-21 「누구님 계약이 맞습니까? 이렇게 시작을 해야할 거 아냐」).
          설명은 파란 박스로 세우지 않는다 — 진짜 알릴 것(보완 요청·오류)과 위계가 같아진다. */}
      <div className="slabel">{step?.title || '전자계약'}</div>
      <h1 className="stitle">{stepHeadline(step)}</h1>
      {stepGuide(step) ? <p className="sdesc">{stepGuide(step)}</p> : null}
      {view.rejectReason ? (
        <SignNote tone="warn">
          보완 요청: {view.rejectReason}
          {(view.supplementItems || []).length ? ` · ${(view.supplementItems || []).join(' · ')}` : ''}
        </SignNote>
      ) : null}

      {step?.kind === 'summary' ? (
        <>
          {/* 파란 안내 박스를 잇달아 쌓지 않는다 — 위 stepGuide 가 이미 같은 말을 한다.
              여기서는 아래 표를 가리키는 제목 한 줄로만 둔다(사장님 2026-08-21).
              marginBottom:-8 은 컨테이너 gap(12)을 4 로 줄이는 보정이다 — 제목은 그 표에 딸린 것이다. */}
          <div style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.ink, marginBottom: -8 }}>
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
            <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5, marginTop: -8 }}>
              ※ 구독료·구독기간, 만기 반납/인수, 보험료 포함 여부, 정비서비스, 중도해지·반납 조건을 함께 확인해 주세요.
            </div>
          ) : null}
        </>
      ) : null}

      {step?.kind === 'information' ? (
        <>
          {/* ★한 동의 = 한 판(ESIGN-UIUX-SPEC §3-9). 고지 네 줄 바로 밑에 그 동의의 체크가 붙는다.
              체크만 따로 판을 만들면 「위 표랑 아래 표가 뭐지」가 된다(사장님 2026-08-28·29).
              ⚠ 고지가 없는 «필수» 키도 반드시 체크가 서야 한다 — 빠지면 손님이 이 화면에 갇힌다. */}
          {[
            ...consentAtoms.map((atom) => ({ key: S(atom.key), atom })),
            ...upfrontConsents
              .filter((key) => !consentAtoms.some((atom) => S(atom.key) === key))
              .map((key) => ({ key, atom: null as (typeof consentAtoms)[number] | null })),
          ].map(({ key, atom }) => (
            <WorkTable key={key} title={atom?.label || consentLabel(key)}>
              {atom ? (
                <>
                  <WorkRow label="수집·이용 항목">{(atom.items || []).join(', ') || '—'}</WorkRow>
                  <WorkRow label="목적">{atom.purpose || '—'}</WorkRow>
                  <WorkRow label="보유기간">{atom.retention || '—'}</WorkRow>
                  <WorkRow label="동의 거부 시">{atom.refusalNote || '—'}</WorkRow>
                </>
              ) : null}
              <SignConsent
                label={atom ? '위 내용에 동의합니다' : consentLabel(key)}
                required={upfrontConsents.includes(key)}
                checked={consents.has(key)}
                onChange={() => toggleConsent(key)}
              />
            </WorkTable>
          ))}
          {!upfrontDone ? <SignNote tone="warn">모든 필수 항목을 선택해야 계속할 수 있습니다.</SignNote> : null}
          {consentProfile.cmsRequiredBeforeHandover ? (
            <SignFootnote>
              자동이체(CMS) 출금 동의와 예금주 인증은 본계약과 별도로 진행됩니다. 완료 전에는 차량 인도일을 확정할 수 없습니다.
            </SignFootnote>
          ) : null}
        </>
      ) : null}

      {step?.kind === 'information' ? (
        <>
          {(() => { const corporate = view?.snapshot?.templateState?.ct === '법인'; const soleProprietor = view?.snapshot?.templateState?.tax === '사업자'; return <>
          <WorkTable accent="main" title="계약자 정보">
            <SignField label={<>{corporate ? '법인명' : '성명'} <ReqTag /></>}><SignInput value={form.customer_name} onChange={(value) => set('customer_name', value)} /></SignField>
            <SignField label={<>연락처 <ReqTag /></>}><SignInput value={form.customer_phone} onChange={(value) => set('customer_phone', fmtPhone(value))} inputMode="tel" /></SignField>
            {corporate ? <SignField label={<>법인등록번호 <ReqTag /></>}><SignInput value={form.customer_id} onChange={(value) => set('customer_id', value)} inputMode="numeric" /></SignField> : (
              /* ★주민등록번호를 받는다(사장님 2026-08-29). 생년월일은 여기서 파생하므로 따로 묻지 않는다.
                 저장은 암호화(rrn-crypto) — 화면·계약정보에는 생년월일만 보인다. */
              <SignField label={<>주민등록번호 <ReqTag /></>}>
                <SignInput
                  value={form.customer_id}
                  onChange={(value) => set('customer_id', rrnMask(value))}
                  inputMode="numeric"
                  placeholder="900101-1234567"
                  maxLength={14}
                />
              </SignField>
            )}
            <SignField label={<>{corporate ? '사업자등록번호' : '운전면허번호'} <ReqTag /></>}><SignInput value={form.driver_license_no} onChange={(value) => set('driver_license_no', value)} placeholder={corporate ? '사업자등록증에 표시된 번호' : '면허증에 표시된 번호'} /></SignField>
            <SignField label={<>주소 <ReqTag /></>}><SignInput value={form.customer_address} onChange={(value) => set('customer_address', value)} /></SignField>
            {corporate ? <>
              <SignField label={<>서명자 성명 <ReqTag /></>}><SignInput value={form.signer_name} onChange={(value) => set('signer_name', value)} /></SignField>
              <WorkRow label={<>법인과의 관계 <ReqTag /></>}><select value={form.signer_role} onChange={(event) => set('signer_role', event.target.value)} style={{ width: '100%' }}><option value="">선택</option><option value="대표이사">대표이사</option><option value="위임받은 임직원">위임받은 임직원</option></select></WorkRow>
            </> : null}
          </WorkTable>
          {soleProprietor ? (
            <WorkTable title="세금계산서 사업자 정보">
              <SignField label={<>상호 <ReqTag /></>}><SignInput value={form.tax_biz_name} onChange={(value) => set('tax_biz_name', value)} /></SignField>
              <SignField label={<>사업자등록번호 <ReqTag /></>}><SignInput value={form.tax_biz_no} onChange={(value) => set('tax_biz_no', value)} inputMode="numeric" /></SignField>
              <SignField label={<>대표자 <ReqTag /></>}><SignInput value={form.tax_ceo} onChange={(value) => set('tax_ceo', value)} /></SignField>
              <SignField label={<>업태·종목 <ReqTag /></>}><SignInput value={form.tax_biz_type_item} onChange={(value) => set('tax_biz_type_item', value)} /></SignField>
              <SignField label={<>세금계산서 이메일 <ReqTag /></>}><SignInput value={form.tax_email} onChange={(value) => set('tax_email', value)} inputMode="email" /></SignField>
              <SignField label={<>사업장 주소 <ReqTag /></>}><SignInput value={form.tax_biz_address} onChange={(value) => set('tax_biz_address', value)} /></SignField>
            </WorkTable>
          ) : null}
          <WorkTable title={corporate ? '담당자 연락처' : '비상 연락처'}>
            <SignField label={<>{corporate ? '직책·관계' : '관계'} <ReqTag /></>}><SignInput value={form.emergency_relation} onChange={(value) => set('emergency_relation', value)} placeholder="예: 모, 배우자, 형제자매" /></SignField>
            <SignField label={<>성명 <ReqTag /></>}><SignInput value={form.emergency_name} onChange={(value) => set('emergency_name', value)} placeholder="예: 홍길순" /></SignField>
            <SignField label={<>비상연락처 <ReqTag /></>}><SignInput value={form.emergency_phone} onChange={(value) => set('emergency_phone', fmtPhone(value))} inputMode="tel" /></SignField>
          </WorkTable>
          {corporate ? <SignFootnote>법인 계약은 서명자 신분증·얼굴 사진을 받지 않습니다. 대표이사 또는 위임받은 임직원 정보와 법인 증빙서류를 확인합니다.</SignFootnote> : null}</>; })()}
        </>
      ) : null}

      {step?.kind === 'id-card' ? (
        <FormCard title="운전면허증 촬영">
          <button
            type="button"
            className={`shoot id${idCard ? ' done' : ''}`}
            onClick={() => idRef.current?.click()}
            aria-label={idCard ? '운전면허증 다시 촬영' : '운전면허증 촬영'}
          >
            {idCard ? <FileThumb file={idCard} fill /> : (
              <>
                <span className="shoot-ic"><ImagePlus size={26} /></span>
                <span className="shoot-t">눌러서 촬영</span>
                <span className="shoot-d">네 귀퉁이가 다 보이게,<br />글씨가 흐리지 않게 찍어 주세요.</span>
              </>
            )}
          </button>
          <input ref={idRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onClick={(event) => event.stopPropagation()} onChange={(event) => { void chooseImage(event.target.files?.[0] || null, '운전면허증', setIdCard); event.currentTarget.value = ''; }} />
          <SignConsent
            required
            checked={idCardRrnMasked}
            onChange={() => setIdCardRrnMasked((checked) => !checked)}
            label="운전면허증 사본의 주민등록번호 뒷자리를 가렸습니다."
          />
        </FormCard>
      ) : null}

      {step?.kind === 'selfie' ? (
        <FormCard title="본인 얼굴 촬영">
          <button
            type="button"
            className={`shoot face${selfie ? ' done' : ''}`}
            onClick={() => selfieRef.current?.click()}
            aria-label={selfie ? '본인 얼굴 다시 촬영' : '본인 얼굴 촬영'}
          >
            {selfie ? <FileThumb file={selfie} fill /> : (
              <>
                <span className="shoot-ic"><ImagePlus size={26} /></span>
                <span className="shoot-t">눌러서 촬영</span>
                <span className="shoot-d">모자·마스크·선글라스는 벗고,<br />밝은 곳에서 정면을 봐 주세요.</span>
              </>
            )}
          </button>
          <input ref={selfieRef} type="file" accept="image/*" capture="user" style={{ display: 'none' }} onClick={(event) => event.stopPropagation()} onChange={(event) => { void chooseImage(event.target.files?.[0] || null, '본인 얼굴 사진', setSelfie); event.currentTarget.value = ''; }} />
        </FormCard>
      ) : null}

      {step?.kind === 'information' && !corporate && !soleProprietor ? (
        <WorkTable accent="main" title="매출증빙">
          <WorkRow label="발행 수단">
            <select value={salesProofMethod} onChange={(event) => { const next = event.target.value as 'phone' | 'rrn'; setSalesProofMethod(next); setSalesProofValue(''); setSalesProofRrnConsent(false); }} style={{ width: '100%' }}>
              <option value="phone">휴대전화번호</option><option value="rrn">주민등록번호</option>
            </select>
          </WorkRow>
          <SignField label={salesProofMethod === 'phone' ? '휴대전화번호' : '주민등록번호'}><SignInput value={salesProofValue} onChange={setSalesProofValue} inputMode="numeric" /></SignField>
          {salesProofMethod === 'rrn' ? (
            <SignConsent
              label="현금영수증 발행을 위해 주민등록번호를 암호화하여 보관하는 데 동의합니다."
              required
              checked={salesProofRrnConsent}
              onChange={() => setSalesProofRrnConsent(!salesProofRrnConsent)}
            />
          ) : null}
        </WorkTable>
      ) : null}

      {step?.kind === 'information' && consentProfile.cmsRequiredBeforeHandover ? (
        <WorkTable accent="main" title="자동이체 출금 정보">
          <SignField label={<>예금주 성명 <ReqTag /></>}><SignInput value={form.cms_holder_name} onChange={(value) => set('cms_holder_name', value)} /></SignField>
          <SignField label={<>계약자와의 관계 <ReqTag /></>}><SignInput value={form.cms_holder_relation} onChange={(value) => set('cms_holder_relation', value)} placeholder="예: 본인, 배우자, 법인" /></SignField>
          <SignField label={<>예금주 연락처 <ReqTag /></>}><SignInput value={form.cms_holder_phone} onChange={(value) => set('cms_holder_phone', fmtPhone(value))} inputMode="tel" /></SignField>
          <SignField label={<>은행 <ReqTag /></>}><SignInput value={form.cms_bank} onChange={(value) => set('cms_bank', value)} /></SignField>
          <SignField label={<>계좌번호 <ReqTag /></>}><SignInput value={form.cms_account_no} onChange={(value) => set('cms_account_no', value)} inputMode="numeric" /></SignField>
          <SignField label={<>예금주 생년월일 또는 사업자번호 <ReqTag /></>}><SignInput value={form.cms_holder_identifier} onChange={(value) => set('cms_holder_identifier', value)} inputMode="numeric" /></SignField>
          <WorkRow label="출금 동의">자동이체 출금 동의는 위 개인정보 동의 항목에서 함께 확인합니다.</WorkRow>
        </WorkTable>
      ) : null}

      {step?.kind === 'information' && additionalDriverLimit > 0 ? (
        <>
          <WorkTable title="추가 운전자">
            <WorkRow label="운전 가능 범위">{S(snapshot.additionalDriverPolicy?.driverScope) || '계약서 기재 운전자'}</WorkRow>
            <WorkRow label="추가운전자 비용">{additionalDriverCost}</WorkRow>
          </WorkTable>

          {additionalDrivers.map((driver, index) => (
            <div key={index} style={{ display: 'grid', gap: 12 }}>
            <WorkTable
              title={`추가 운전자 ${index + 1}`}
              hint={(
                <button type="button" className="btn btn-mini" title={`추가 운전자 ${index + 1} 삭제`} onClick={() => removeAdditionalDriver(index)}>
                  <Trash2 size={ICON.sm} aria-hidden /> 삭제
                </button>
              )}
            >
              <SignField label={<>성명 <ReqTag /></>}><SignInput value={driver.name} onChange={(value) => updateAdditionalDriver(index, 'name', value)} /></SignField>
              <SignField label={<>관계 <ReqTag /></>}><SignInput value={driver.relation} onChange={(value) => updateAdditionalDriver(index, 'relation', value)} placeholder="예: 배우자, 가족" /></SignField>
              <SignField label={<>연락처 <ReqTag /></>}><SignInput value={driver.phone} onChange={(value) => updateAdditionalDriver(index, 'phone', fmtPhone(value))} inputMode="tel" /></SignField>
              <SignField label={<>운전면허번호 <ReqTag /></>}><SignInput value={driver.driverLicenseNo} onChange={(value) => updateAdditionalDriver(index, 'driverLicenseNo', value)} placeholder="면허증에 표시된 번호" /></SignField>
              <SignConsent
                label="개인정보 제공과 운전면허증 제출에 동의합니다."
                required
                checked={!!driver.consent}
                onChange={() => updateAdditionalDriver(index, 'consent', !driver.consent)}
              />
            </WorkTable>
              <FormCard title="운전면허증">
              <button
                type="button"
                className={`shoot id${additionalDriverLicenses[index] ? ' done' : ''}`}
                onClick={() => additionalDriverLicenseRefs.current[index]?.click()}
                aria-label={`추가 운전자 ${index + 1} 운전면허증 촬영`}
              >
                {additionalDriverLicenses[index] ? <FileThumb file={additionalDriverLicenses[index]} fill /> : (
                  <>
                    <span className="shoot-ic"><ImagePlus size={26} /></span>
                    <span className="shoot-t">눌러서 촬영</span>
                    <span className="shoot-d">네 귀퉁이가 다 보이게 찍어 주세요.</span>
                  </>
                )}
              </button>
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
              </FormCard>
            </div>
          ))}

          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn"
              title="추가 운전자 등록"
              disabled={additionalDrivers.length >= additionalDriverLimit}
              onClick={addAdditionalDriver}
            >
              <Plus size={ICON.md} aria-hidden />
              {additionalDrivers.length >= additionalDriverLimit
                ? `최대 ${additionalDriverLimit}명 등록 가능`
                : '추가 운전자 등록'}
            </button>
          </div>
          <SignFootnote>
            회사의 운전자격·보험 적용 확인이 완료되기 전에는 추가 운전자가 차량을 운전할 수 없습니다.
          </SignFootnote>
        </>
      ) : null}

      {step?.kind === 'documents' ? (
        <>
          {requiredDocuments.length ? <FormCard title="요청 서류">
          <div style={{ display: 'grid', gap: 12 }}>
          {displayedDocuments.map((document) => {
              const file = supportingFiles[document.key];
              const uploaded = uploadedSupportingDocumentKeys.has(document.key);
              return (
                <div key={document.key} style={{ display: 'grid', gap: 6 }}>
                  {/* 첨부서류는 «사진 또는 PDF» 라 촬영 틀(.shoot.id)이 아니라 낮은 파일 칸으로 둔다.
                      카드 비율 틀을 씌우면 PDF 를 「찍으라」는 말로 읽힌다. */}
                  <button
                    type="button"
                    className={`shoot doc${file || uploaded ? ' done' : ''}`}
                    onClick={() => supportingFileRefs.current[document.key]?.click()}
                    aria-label={`${document.label} 첨부`}
                  >
                    <span className="shoot-ic"><FileText size={22} /></span>
                    <span className="shoot-t">
                      {file?.name || (uploaded ? `${document.label} 제출 완료` : document.label)}
                    </span>
                    <span className="shoot-d">
                      {document.required ? '필수' : '선택'} · 사진 또는 PDF · 파일당 5MB 이하
                    </span>
                  </button>
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
                  {document.note ? <SignFootnote>{document.note}</SignFootnote> : null}
                </div>
              );
            })}
          </div>
          </FormCard> : <SignFootnote>이 계약에 추가로 제출할 부속서류는 없습니다. 전자서명 단계로 넘어가 주세요.</SignFootnote>}
          {requiredDocuments.length ? <SignFootnote>
            첨부 원본은 계약 검토 관리자만 확인할 수 있으며 공개 계약정보에는 노출되지 않습니다.
          </SignFootnote> : null}
        </>
      ) : null}

      {step?.kind === 'agreement' ? (
        <>
          <SignFootnote>
            실제 계약에 적용되는 세부 조건과 약관입니다. 아래 내용을 모두 확인한 뒤 전체 내용에 동의해 주세요.
          </SignFootnote>
          <div style={{ display: 'grid', gap: 12 }}>
            {conditionGroups.map((group) => (
              <WorkTable key={group.key} title={group.title}>
                {group.pages.flatMap((page) => (page.rows || []).map((row, index) => (
                  <WorkRow key={`${page.key}-${row.label}-${index}`} label={row.label || S(page.title) || '항목'}>
                    {conditionValue(row.value || '—', row.article)}
                  </WorkRow>
                )))}
              </WorkTable>
            ))}
            {otherConditionPages.length ? (
              <WorkTable title="기타 계약조건">
                {otherConditionPages.flatMap((page) => (page.rows || []).map((row, index) => (
                  <WorkRow key={`${page.key}-${row.label}-${index}`} label={row.label || S(page.title) || '항목'}>
                    {conditionValue(row.value || '—', row.article)}
                  </WorkRow>
                )))}
              </WorkTable>
            ) : null}
            {/* ★이건 «위 판 전부»에 대한 확인이라 어느 판에도 속하지 않는다.
                그렇다고 판을 하나 더 만들면 조건 판들과 같은 무게로 서서 «또 하나의 조건»으로 읽힌다
                (사장님 2026-08-29 「마지막에 동의하는 부분을 섹션으로 나누면 안 되지」).
                판 없이 한 줄로 둔다 — .sagree 는 판 밖에서도 선다. */}
            <SignConsent
              label="차량·기간·금액, 결제·만기, 운전자·보험, 사고·중도해지 조건을 확인했습니다."
              required
              checked={conditionsConfirmed}
              onChange={() => setConditionsConfirmed((checked) => !checked)}
            />
          </div>
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
          {step.page.requireReadThrough && !readThrough[step.key] ? <SignNote tone="warn">위 계약조건 영역을 끝까지 스크롤해 전체 내용을 확인하면 다음으로 갈 수 있습니다.</SignNote> : null}
        </>
      ) : null}

      {step?.kind === 'agreement' ? (
        <>
          <SignFootnote>위 세부 계약조건과 아래 자동차 대여약관 전문은 이번 전자계약의 내용입니다.</SignFootnote>
          <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            {(snapshot.agreement?.sections || []).map((section, index) => (
              <FormCard key={`${section.t}-${index}`} title={section.t}>
                <div style={{ overflowWrap: 'anywhere', fontSize: FS.body, color: C.ink }}>{section.b}</div>
              </FormCard>
            ))}
            <div ref={agreementEndRef}>
              <div aria-hidden style={{ textAlign: 'center', fontSize: FS.cap, fontWeight: FW.label, color: C.faint, padding: '14px 0 2px', letterSpacing: '.02em' }}>— 약관 끝 —</div>
            </div>
          </div>
          {!readThrough.agreement ? <SignNote tone="warn">약관 전문의 마지막까지 내려 확인해 주세요.</SignNote> : null}
          <SignConsent
            required
            checked={consents.has('rental_terms')}
            disabled={!readThrough.agreement}
            onChange={() => toggleConsent('rental_terms')}
            label={readThrough.agreement
              ? consentLabel('rental_terms')
              : '세부 계약과 자동차 대여약관을 끝까지 확인하면 전체 확인을 선택할 수 있습니다.'}
          />
        </>
      ) : null}

      {step?.kind === 'signature' ? (
        <>
          {/* ★서명 «직전»에 내가 쓴 값이 채워진 계약서를 본다.
              전에는 이 자리가 없어서, 손님은 빈칸짜리 A4 만 보거나 아예 못 보고 서명했다.
              그러면 「서명 = 이 문서에 동의」가 성립하지 않는다(사장님 2026-08-29).
              ⚠ 서명란보다 «위»에 둔다 — 보고 → 확인하고 → 서명한다. 순서가 뜻이다.
              ⚠ 폰에서는 A4 를 축소해 보지 않는다. 흐름으로 그린다(window.__FLOW__). */}
          {filledContract ? (
            <>
              <iframe
                className="doc-flow"
                title="작성한 계약서"
                srcDoc={filledContract}
                onLoad={() => setContractSeenAt((at) => at || Date.now())}
              />
              <SignConsent
                label="위 계약서 내용이 내가 작성한 것과 같음을 확인합니다."
                required
                checked={contractConfirmed}
                onChange={() => setContractConfirmed((on) => !on)}
              />
              <button type="button" className="btn" onClick={() => void openFilledContract()} disabled={previewingDoc}>
                {previewingDoc ? '다시 만드는 중…' : '계약서 다시 불러오기'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => void openFilledContract()} disabled={previewingDoc}>
                {previewingDoc ? '계약서 만드는 중…' : '작성한 계약서 확인하기'}
              </button>
              <SignFootnote>내가 입력한 값이 그대로 들어간 계약서입니다. 확인해야 서명할 수 있습니다.</SignFootnote>
            </>
          )}
          {view.downloadUrl || view.documentUrl ? null : (
            <SignFootnote>PDF 는 서명이 끝난 뒤 «완료 계약서»로 내려받을 수 있습니다.</SignFootnote>
          )}
          <WorkTable title="무엇에 서명하나">
            <WorkRow label="계약서">{S(snapshot.contractKind?.title) || S(snapshot.template?.label) || '자동차 대여 계약서'}</WorkRow>
            <WorkRow label="약관">{`${S(snapshot.agreement?.title) || '자동차 대여 약관'} · ${S(snapshot.agreement?.version) || '—'}`}</WorkRow>
            <WorkRow label="계약 조건 확인">{`${Object.keys(confirmations).length} / ${pages.length} 섹션`}</WorkRow>
            <WorkRow label="필수 동의">{`${requiredConsents.filter((key) => consents.has(key)).length} / ${requiredConsents.length}건`}</WorkRow>
            <WorkRow label="본인확인 자료">{idCard && selfie ? '운전면허증·얼굴 사진 첨부' : '누락'}</WorkRow>
            {requiredDocuments.length ? (
              <WorkRow label="추가 제출서류">
                {`${requiredDocuments.filter((document) => uploadedSupportingDocumentKeys.has(document.key)).length} / ${requiredDocuments.length}건 제출`}
              </WorkRow>
            ) : null}
            {additionalDrivers.length ? <WorkRow label="추가 운전자">{`${additionalDrivers.length}명 · ${additionalDriverCost}`}</WorkRow> : null}
          </WorkTable>
          <SignFootnote>아래 서명은 위 계약서·확인한 모든 조건·약관에 대한 전자서명입니다.</SignFootnote>
          <FormCard title="전자서명" hint={<button type="button" className="btn btn-mini" title="서명 지우기" onClick={clearSignature}><Eraser size={ICON.sm} aria-hidden /> 지우기</button>}>
          {/* 서명판 — 손가락으로 긋는 자리다. 첨부칸(Dropzone)이 아니라 «판»이다.
              점선 테두리를 두르면 「여기에 파일을 놓아라」로 읽힌다. */}
          <div className="signpad">
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
          </div>
          </FormCard>
          <SignFootnote>서명시각과 단계별 확인시각이 기록됩니다. 제출 뒤 담당자 승인·봉인이 끝나면 이 링크에서 작성 완료 계약서를 열고 PDF로 받을 수 있습니다.</SignFootnote>
        </>
      ) : null}
      </section>

      {/* S09·S10 — 손님 화면의 주 CTA 는 하단 푸터다(착한거래 StepFooter 규격).
          [이전][다음] 둘이면 다음이 넓게, 하나뿐이면 전체폭. 안전영역은 .c-footer 가 잡는다. */}
      <div className={`c-footer${stepIndex > 0 ? ' wiz' : ''}`}>
        {stepIndex > 0 ? (
          <button
            type="button"
            className="btn btn-prev"
            disabled={busy}
            onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
          >이전</button>
        ) : null}
        {step?.kind === 'signature' ? (
          <button
            type="button"
            className={`btn btn-primary${stepIndex > 0 ? ' btn-next' : ' btn-block'}`}
            title="본인확인 자료와 전자서명 제출"
            disabled={busy || preparingImage}
            onClick={() => void submit()}
          >{busy ? '안전하게 제출 중…' : '확인하고 전자서명 제출'}</button>
        ) : (
          <button
            type="button"
            className={`btn btn-primary${stepIndex > 0 ? ' btn-next' : ' btn-block'}`}
            title="다음"
            disabled={busy || preparingImage}
            onClick={() => void next()}
          >{busy ? '확인 기록 중…'
            : step?.kind === 'summary' ? '맞습니다. 계속하기'
            : step?.kind === 'section' ? (step.page?.confirmLabel || '확인하고 다음')
            : step?.kind === 'information' ? (corporate ? '세부계약 확인으로' : '신분증 촬영으로')
            : step?.kind === 'id-card' ? '얼굴 촬영으로'
            : step?.kind === 'selfie' ? '세부계약 확인으로'
            : step?.kind === 'agreement' ? (snapshot.agreement?.confirmLabel || '동의하고 부속서류로')
            : step?.kind === 'documents' ? '전자서명으로'
            : '다음'}</button>
        )}
      </div>
      </div>
    </main>
  );
}
