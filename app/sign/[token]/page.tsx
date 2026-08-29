'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
/* 손님 화면 스타일 — 착한거래에서 그대로 옮긴 공용 정본. 모든 규칙이 .sign-root 안에 갇혀 있다. */
import '@/components/sign/sign.css';
/* 손님 화면은 ERP 원자를 쓰지 않는다 — B2C 전용 원자(프리패스ERP·착한거래 공용).
   이름만 바꿔 들여와 아래 41곳을 손대지 않는다. */
import {
  SignPanel as WorkTable, SignRow as WorkRow, SignField, SignConsent,
  SignTitle, SignDesc, SignFootnote,
  SignAccordion, SignProgress,
} from '@/components/sign/atoms';
import { Camera, Eye, FileText, Minus, Plus, RefreshCw, UserRound } from 'lucide-react';
import {
  Badge, Btn, ButtonLabel, C, fmtBizNo, fmtLicense, fmtPhone, fmtRrn, FS, ICON,
  Modal, R_CARD, THUMB_W,
} from '@/components/ui';
import { toast } from '@/components/Toaster';

const CLIENT_IMAGE_BYTES = 1_350_000;
const S = (value: unknown) => String(value ?? '').trim();
/** 서버 `SIGNER_ROLES` 와 글자 그대로 같아야 한다. 다른 값은 제출이 거부된다. */
const SIGNER_ROLES = ['대표이사', '위임받은 임직원'] as const;
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
  kind: 'summary' | 'privacy' | 'identity' | 'sales-proof' | 'signer' | 'tax-invoice' | 'emergency' | 'id-photo' | 'selfie' | 'additional-driver' | 'documents' | 'contract' | 'agreement' | 'signature';
  key: string;
  title: string;
};

type AdditionalDriverForm = {
  name: string;
  relation: string;
  phone: string;
  driverLicenseNo: string;
  licenseRrnMasked: boolean;
  consent: boolean;
};

const emptyAdditionalDriver = (): AdditionalDriverForm => ({
  name: '', relation: '', phone: '', driverLicenseNo: '', licenseRrnMasked: false, consent: false,
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

/**
 * 진행 바 — 착한거래 LabEsignFlow MACROS 와 동일.
 * compact 헤더는 막대만 그린다(라벨은 머리 오른쪽 단계명).
 */
const MACROS = [
  { key: 'summary', label: '계약 확인' },
  { key: 'consent', label: '동의' },
  { key: 'identity', label: '본인확인' },
  { key: 'contract', label: '계약서' },
  { key: 'terms', label: '약관' },
  { key: 'cautions', label: '주의사항' },
  { key: 'docs', label: '첨부서류' },
  { key: 'sign', label: '서명' },
] as const;

function macroOf(kind: JourneyStep['kind']): (typeof MACROS)[number]['key'] {
  if (kind === 'summary') return 'summary';
  if (kind === 'privacy') return 'consent';
  if (kind === 'identity' || kind === 'sales-proof' || kind === 'signer' || kind === 'tax-invoice' || kind === 'emergency'
    || kind === 'id-photo' || kind === 'selfie' || kind === 'additional-driver') return 'identity';
  if (kind === 'contract') return 'contract';
  if (kind === 'agreement') return 'terms';
  if (kind === 'documents') return 'docs';
  return 'sign';
}

function identitySubLabel(kind: JourneyStep['kind'], corporate: boolean): string {
  if (kind === 'identity') return '계약자 정보';
  if (kind === 'sales-proof') return '매출증빙';
  if (kind === 'signer') return '서명자 정보';
  if (kind === 'tax-invoice') return '세금계산서';
  if (kind === 'emergency') return corporate ? '담당자 연락처' : '비상 연락처';
  if (kind === 'id-photo') return '신분증 촬영';
  if (kind === 'selfie') return '얼굴 촬영';
  if (kind === 'additional-driver') return '추가 운전자';
  return '';
}

/**
 * 단계 제목 — «명사»가 아니라 «문장»이다(착한거래 .stitle: 「본인확인을 진행해 주세요」).
 * 손님 화면의 제목은 «지금 무엇을 해 달라는 말»이어야 한다. 「계약 확인」처럼 이름만 두면
 * 무엇을 하라는 건지 아래 설명까지 읽어야 안다(사장님 2026-08-21 「누구님 계약이 맞습니까? 로 시작해야지」).
 */
/**
 * 다음 버튼 글 — «다음»이 아니라 «지금 무엇에 답하는가»를 쓴다.
 * 제목이 「○○○님, 계약이 맞습니까?」인데 버튼이 「다음」이면 묻고 답이 없는 꼴이다.
 * 물음과 답을 짝지어 두면 손님이 무엇을 인정하는지 알고 누른다
 * (사장님 2026-08-21 「맞나요? 이렇게 물어보고 맞습니다. 계속하기 로」).
 */
function nextLabel(step: JourneyStep | undefined, done = false, extra = ''): string {
  if (!step) return '계속하기';
  if (extra) return extra;
  if (step.kind === 'summary') return '맞습니다, 계속하기';
  if (step.kind === 'sales-proof') return '입력했습니다. 계속하기';
  if (step.kind === 'contract') return '다음';
  if (step.kind === 'privacy' || step.kind === 'agreement') return '동의하고 계속하기';
  if (step.kind === 'identity' || step.kind === 'signer' || step.kind === 'tax-invoice' || step.kind === 'emergency') return '입력했습니다. 계속하기';
  /* ★촬영 화면은 «상태»가 곧 버튼이다(착한거래 `idReady ? '다음' : '● 촬영'`).
     안 찍었는데 「촬영했습니다」라고 적어 두면 눌러도 토스트로 막히는 헛걸음이 된다. */
  if (step.kind === 'id-photo') return done ? '촬영했습니다. 계속하기' : '운전면허증 촬영하기';
  if (step.kind === 'selfie') return done ? '촬영했습니다. 계속하기' : '얼굴 촬영하기';
  return '계속하기';
}

function stepHeadline(step: JourneyStep | undefined, done = false): string {
  if (!step) return '전자계약';
  if (step.kind === 'summary') return '고객님, 아래 계약이 맞습니까?';
  if (step.kind === 'sales-proof') return '매출증빙 정보를 선택해 주세요';
  if (step.kind === 'privacy') return '개인정보 수집에 동의해 주세요';
  if (step.kind === 'identity') return '계약서에 들어갈 정보를 알려 주세요';
  if (step.kind === 'signer') return '법인을 대표해 서명하실 분을 알려 주세요';
  if (step.kind === 'tax-invoice') return '세금계산서 정보를 알려 주세요';
  if (step.kind === 'emergency') return '연락이 닿을 한 분을 더 알려 주세요';
  if (step.kind === 'id-photo') return done ? '찍은 사진을 확인해 주세요' : '운전면허증을 촬영해 주세요';
  if (step.kind === 'selfie') return done ? '찍은 사진을 확인해 주세요' : '본인 얼굴을 촬영해 주세요';
  if (step.kind === 'additional-driver') return '함께 운전할 사람이 있나요?';
  if (step.kind === 'documents') return '요청 서류를 첨부해 주세요';
  if (step.kind === 'contract') return '계약 내용을 확인해 주세요';
  if (step.kind === 'agreement') return '약관을 확인해 주세요';
  return step.title || '전자계약';
}

function stepGuide(step: JourneyStep | undefined, done = false): string {
  if (!step) return '';
  if (step.kind === 'summary') return '차종·금액·기간이 맞는지 확인합니다.';
  if (step.kind === 'privacy') return '본인확인 자료를 받기 전에 수집 동의를 받습니다.';
  if (step.kind === 'identity') return '아래는 모두 필요합니다. 계약서에 그대로 실리니 신분증과 같게 적어 주세요.';
  if (step.kind === 'sales-proof') return '현금영수증 발행에만 사용하며 계약서에는 표시하지 않습니다.';
  if (step.kind === 'signer') return '아래는 모두 필요합니다. 운전면허번호만 없으면 비워 두셔도 됩니다.';
  if (step.kind === 'tax-invoice') return '아래는 모두 필요합니다. 사업자등록증에 적힌 대로 적어 주세요.';
  if (step.kind === 'emergency') return '아래는 모두 필요합니다. 계약자 본인 말고 다른 분이어야 합니다.';
  if (step.kind === 'id-photo') return done ? '흐리거나 잘렸으면 다시 촬영해 주세요.' : '카메라가 열립니다. 네 귀퉁이가 다 보이게 찍어 주세요.';
  if (step.kind === 'selfie') return done ? '얼굴이 또렷하지 않으면 다시 촬영해 주세요.' : '신분증 사진과 대조합니다. 정면을 보고 찍어 주세요.';
  if (step.kind === 'additional-driver') return '함께 운전할 사람이 있으면 등록합니다. 없으면 다음으로 가면 됩니다.';
  if (step.kind === 'documents') return '렌터카사 요청서류를 첨부합니다.';
  if (step.kind === 'contract') return '계약서 한 장입니다. 항목을 아래로 내려가며 확인해 주세요.';
  if (step.kind === 'agreement') return '약관을 끝까지 읽은 뒤 동의를 선택합니다.';
  return '확인한 계약·약관에 전자서명합니다.';
}

function ReqTag() {
  /* 「필수」는 «오류»가 아니라 «안내»다(사장님 2026-08-21 「손님한테 나가는 건데」).
     빨간 solid 는 뭔가 잘못됐다는 신호라 손님이 겁먹는다. 브랜드 계열 옅은 틴트로 낮춘다.
     진짜 빨강은 미선택으로 «막혔을 때»만 쓴다(아래 경고 문구). */
  return <Badge tone="blue" variant="solid">필수</Badge>;
}

function BrandMarkCompact() {
  return (
    <span className="brand-mark brand-mark-compact" aria-hidden>
      <svg viewBox="0 0 512 512" fill="none">
        <path d="M128 264 l80 80 L384 168" stroke="currentColor" strokeWidth="52" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** S09 — 머리 · 진행 · 본문 · 하단. 만료·완료도 같은 껍데기다. */
function SignShell({
  sub, stepCount = 0, step = 0, children, footer,
}: {
  sub: string;
  stepCount?: number;
  step?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="sign-root">
      <div className="sign-frame">
        <div className="c-head compact">
          <div className="c-head-row">
            <span className="c-head-brand">
              <BrandMarkCompact />
              <b>freepass</b>
            </span>
            <span className="c-head-div" aria-hidden />
            <div className="c-head-now">
              <span className="c-head-title">전자계약</span>
              <span className="c-head-sub">{sub}</span>
            </div>
            {stepCount > 0 ? <span className="c-head-count">{step} / {stepCount}</span> : null}
          </div>
        </div>
        {stepCount > 0 ? (
          <nav className="steps" aria-label="진행 단계">
            {Array.from({ length: stepCount }, (_, index) => {
              const n = index + 1;
              return (
                <div key={n} className="s-wrap" aria-current={step === n ? 'step' : undefined}>
                  <div className={`s${step >= n ? ' on' : ''}${step === n ? ' cur' : ''}`} />
                </div>
              );
            })}
          </nav>
        ) : null}
        {children}
        {footer}
      </div>
    </main>
  );
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
  /* fill — 촬영 화면에서는 «틀»이 곧 규격이라 사진이 틀을 꽉 채워야 한다.
     첨부 목록에서는 지금처럼 THUMB_W 로 눕힌다. */
  if (fill) return <img src={url} alt="" />;
  return <img src={url} alt="" style={{ width: '100%', maxHeight: THUMB_W, objectFit: 'cover', borderRadius: R_CARD, display: 'block' }} />;
}

function conditionValue(value: string, article?: string) {
  return (
    <>
      {value || '—'}
      {article ? <div className="sfact-art">관련 약관 {article}</div> : null}
    </>
  );
}

function hhmm(ms: number) {
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function Fact({ label, children, keep = false }: { label: string; children?: ReactNode; keep?: boolean }) {
  if (!keep && (children == null || children === '')) return null;
  const text = typeof children === 'string' ? children : '';
  return (
    <div className="sfact">
      <span className="sfact-k">{label}</span>
      <div className={`sfact-v${text.length > 34 ? ' long' : ''}`}>{children == null || children === '' ? '—' : children}</div>
    </div>
  );
}

function Seen({ onSeen, className, children }: { onSeen: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onSeen);
  cb.current = onSeen;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        cb.current();
        io.disconnect();
      }
    }, { rootMargin: '0px 0px -25% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}

const PAIR_SUFFIXES = ['보상한도', '면책금'];

function splitInsurance(rows: Array<{ label?: string; value?: string; article?: string }>) {
  const groups = new Map<string, Record<string, string>>();
  const cols: string[] = [];
  const used = new Set<number>();
  (rows || []).forEach((row, i) => {
    const label = S(row.label);
    const value = S(row.value);
    if (!value) return;
    const suffix = PAIR_SUFFIXES.find((sfx) => label.endsWith(sfx));
    if (!suffix) return;
    const prefix = label.slice(0, label.length - suffix.length).trim();
    if (!prefix || /\s/.test(prefix)) return;
    if (!groups.has(prefix)) groups.set(prefix, {});
    groups.get(prefix)![suffix] = value;
    if (!cols.includes(suffix)) cols.push(suffix);
    used.add(i);
  });
  if (groups.size < 2 || cols.length < 2) return { matrix: null as null | { cols: string[]; rows: Array<{ name: string; cells: Record<string, string> }> }, rest: rows || [] };
  return {
    matrix: { cols, rows: [...groups.entries()].map(([name, cells]) => ({ name, cells })) },
    rest: (rows || []).filter((_, i) => !used.has(i)),
  };
}

function ContractSection({
  page, open, at, onSeen, onToggle,
}: {
  page: ConsentPage;
  open: boolean;
  at?: number;
  onSeen: () => void;
  onToggle: (on: boolean) => void;
}) {
  const done = !!at;
  const { matrix, rest } = splitInsurance(page.key === 'insurance' ? (page.rows || []) : []);
  const rows = page.key === 'insurance' ? rest : (page.rows || []);
  return (
    <Seen
      onSeen={onSeen}
      className={`scard${done ? ' is-done' : ''}${!open ? ' is-locked' : ''}`}
    >
      <div className="scard-head">
        <span className="scard-title">{S(page.title) || '계약 조건'}</span>
        <span className={`scard-badge ${done ? 'done' : open ? 'ready' : 'wait'}`}>
          {done ? `확인 ${hhmm(at!)}` : open ? '확인 필요' : '내려서 확인'}
        </span>
      </div>
      {page.note ? <p className="scard-note">{page.note}</p> : null}
      <div className="scard-body">
        {matrix ? (
          <div className="smatrix-wrap">
            <table className="smatrix">
              <thead>
                <tr>
                  <th />
                  {matrix.cols.map((col) => <th key={col}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    {matrix.cols.map((col) => (
                      <td key={col} className={row.cells[col] ? undefined : 'smatrix-empty'}>{row.cells[col] || ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {rows.map((row, index) => (
          <Fact key={`${row.label}-${index}`} label={row.label || '항목'} keep>
            {conditionValue(row.value || '—', row.article)}
          </Fact>
        ))}
      </div>
      <div className={`scard-foot${done ? ' is-done' : ''}`}>
        <label className={`cc${done ? ' on' : ''}${!open ? ' cc-disabled' : ''}`} style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={done}
            disabled={!open}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span>{S(page.confirmLabel) || '위 내용을 확인했습니다'}</span>
        </label>
      </div>
    </Seen>
  );
}

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicResponse | null | undefined>(undefined);
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_id: '', customer_address: '',
    driver_license_no: '',
    signer_name: '', signer_role: '',
    tax_biz_name: '', tax_biz_no: '', tax_ceo: '', tax_biz_type_item: '', tax_email: '', tax_biz_address: '',
    emergency_relation: '', emergency_name: '', emergency_phone: '',
  });
  /** 개인 계약에서 손님이 「개인사업자」를 직접 고른 경우. 발행 때 이미 사업자면 단계가 처음부터 열린다. */
  const [wantBiz, setWantBiz] = useState(false);
  /** 개인 현금영수증 식별수단. 주민번호 선택 때만 서버 전용 암호문으로 보관한다. */
  const [salesProofMethod, setSalesProofMethod] = useState<'phone' | 'rrn'>('phone');
  const [salesProofValue, setSalesProofValue] = useState('');
  const [salesProofRrnConsent, setSalesProofRrnConsent] = useState(false);
  const [consents, setConsents] = useState<Set<string>>(new Set());
  /*
   * ★작성 중 창을 닫으면 그때까지 쓴 게 사라진다 — 중간 저장이 없다(메모리 상태뿐).
   *   전화 한 통 받고 나가면 신분증·얼굴 사진부터 다시 찍어야 한다.
   *   ⚠ localStorage 에 담지 않는다: 주민번호·면허번호가 손님 폰에 평문으로 남고,
   *      공용 기기면 다음 사람이 본다. 제대로 된 답은 «서버 부분 저장»이고 별건이다
   *      (docs/ESIGN-MANUAL.md Q5). 여기서는 실수로 닫는 것만 막는다.
   */
  const hasTyped = Object.values(form).some((value) => S(value) !== '') || S(salesProofValue) !== '';
  useEffect(() => {
    if (!hasTyped) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasTyped]);
  const [confirmations, setConfirmations] = useState<Record<string, number>>({});
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const [readThrough, setReadThrough] = useState<Record<string, boolean>>({});
  /** 펴 본 약관 조문 — 「어느 조문을 봤나」가 「끝까지 내렸다」보다 나은 증거다. */
  const [openedTerms, setOpenedTerms] = useState<Set<string>>(new Set());
  const [summaryConfirmedAt, setSummaryConfirmedAt] = useState(0);
  const [agreementReadAt, setAgreementReadAt] = useState(0);
  const [idCard, setIdCard] = useState<File | null>(null);
  const [idCardRrnMasked, setIdCardRrnMasked] = useState(false);
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
  /* 화면에 세울 동의 판. 고지가 있는 것(atom)이 먼저고,
     ⚠ 고지가 없는 «필수» 키도 반드시 뒤에 붙인다 — 빠뜨리면 체크할 자리가 없어
     `upfrontConsents.every(...)` 가 영영 거짓이 되고 손님이 이 화면에 갇힌다.
     약관(rental_terms)은 「동의」 단계에서 따로 받으므로 여기서 뺀다. */
  const consentBlocks = [
    ...consentAtoms.filter((atom) => S(atom.key) !== 'rental_terms')
      .map((atom) => ({ key: S(atom.key), atom })) as { key: string; atom: (typeof consentAtoms)[number] | null }[],
    ...upfrontConsents.filter((key) => !consentAtoms.some((atom) => S(atom.key) === key))
      .map((key) => ({ key, atom: null })),
  ];
  const consentLabel = (key: string) => key === 'rental_terms'
    ? '계약서 원본 및 자동차 대여약관'
    : S(consentAtoms.find((atom) => S(atom.key) === key)?.label) || '필수 동의';
  const requiredDocuments = snapshot.requiredDocuments || [];
  const uploadedSupportingDocumentKeys = new Set(view?.uploadedSupportingDocumentKeys || []);
  const additionalDriverLimit = Math.max(0, Math.min(3, Number(snapshot.additionalDriverPolicy?.limit || 0)));
  const additionalDriverCost = S(snapshot.additionalDriverPolicy?.cost) || '—';
  /* 법인·개인사업자 여부는 «단계 구성»까지 바꾸므로 렌더 안이 아니라 여기서 한 번만 읽는다. */
  const corporate = view?.snapshot?.templateState?.ct === '법인';
  const soleProprietor = view?.snapshot?.templateState?.tax === '사업자';
  const needTaxInvoice = corporate || soleProprietor || wantBiz;
  const needsPersonalSalesProof = !corporate && !needTaxInvoice;
  const pages = useMemo(
    () => snapshot.consentPages || snapshot.consentGroups || [],
    [snapshot.consentGroups, snapshot.consentPages],
  );
  const steps = useMemo<JourneyStep[]>(() => [
    { kind: 'summary', key: 'summary', title: '계약 확인' },
    { kind: 'privacy', key: 'privacy', title: '수집 동의' },
    { kind: 'identity', key: 'identity', title: '계약자 정보' },
    ...(needsPersonalSalesProof ? [{ kind: 'sales-proof' as const, key: 'sales_proof', title: '매출증빙' }] : []),
    ...(corporate ? [{ kind: 'signer' as const, key: 'signer', title: '서명자 정보' }] : []),
    ...(needTaxInvoice ? [{ kind: 'tax-invoice' as const, key: 'tax_invoice', title: '세금계산서' }] : []),
    { kind: 'emergency', key: 'emergency', title: corporate ? '담당자 연락처' : '비상 연락처' },
    // 법인은 법인등기·인감과 서명권한 서류로 확인한다. 대표자/위임 서명자의
    // 주민번호·면허증·얼굴 사진을 일괄 수집하지 않는다.
    ...(!corporate ? [
      { kind: 'id-photo' as const, key: 'id_photo', title: '신분증 촬영' },
      { kind: 'selfie' as const, key: 'selfie', title: '얼굴 촬영' },
    ] : []),
    ...(additionalDriverLimit > 0
      ? [{ kind: 'additional-driver' as const, key: 'additional_driver', title: '추가 운전자' }]
      : []),
    { kind: 'contract', key: 'contract', title: '계약서' },
    { kind: 'agreement', key: 'agreement', title: '약관' },
    { kind: 'documents', key: 'documents', title: '추가서류' },
    { kind: 'signature', key: 'signature', title: '서명' },
  ], [additionalDriverLimit, corporate, needTaxInvoice, needsPersonalSalesProof]);
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
      if (!form.customer_name.trim() || !form.customer_phone.trim()) return toast('성명과 연락처를 입력해 주세요.', 'error');
      if (corporate ? form.customer_id.replace(/\D/g, '').length !== 13 : !/^\d{4}-\d{2}-\d{2}$/.test(form.customer_id)) return toast(corporate ? '법인등록번호 13자리를 입력해 주세요.' : '생년월일을 입력해 주세요.', 'error');
      if (corporate ? form.driver_license_no.replace(/\D/g, '').length !== 10 : !form.driver_license_no.trim()) return toast(corporate ? '사업자등록번호 10자리를 입력해 주세요.' : '운전면허번호를 입력해 주세요.', 'error');
      if (!form.customer_address.trim()) return toast('계약서에 기재할 주소를 입력해 주세요.', 'error');
    }
    if (step.kind === 'sales-proof') {
      if (salesProofMethod === 'phone' && !/^\d{10,11}$/.test(salesProofValue.replace(/\D/g, ''))) {
        return toast('현금영수증을 받을 휴대전화번호를 정확히 입력해 주세요.', 'error');
      }
      if (salesProofMethod === 'rrn' && !/^\d{6}-?\d{7}$/.test(salesProofValue)) {
        return toast('주민등록번호 13자리를 정확히 입력해 주세요.', 'error');
      }
      if (salesProofMethod === 'rrn' && !salesProofRrnConsent) {
        return toast('현금영수증 발행용 주민번호 암호화 처리 동의가 필요합니다.', 'error');
      }
    }
    if (step.kind === 'signer') {
      if (!form.signer_name.trim()) return toast('서명하시는 분의 성명을 입력해 주세요.', 'error');
      if (!(SIGNER_ROLES as readonly string[]).includes(form.signer_role)) return toast('법인과의 관계를 선택해 주세요.', 'error');
    }
    if (step.kind === 'tax-invoice') {
      if (!form.tax_biz_name.trim() || form.tax_biz_no.replace(/[^0-9]/g, '').length !== 10 || !form.tax_ceo.trim()
        || !form.tax_biz_type_item.trim() || !form.tax_email.trim() || !form.tax_biz_address.trim()) {
        return toast('세금계산서 발행 정보를 모두 입력해 주세요.', 'error');
      }
    }
    if (step.kind === 'emergency') {
      if (!form.emergency_relation.trim() || !form.emergency_name.trim()) {
        return toast(corporate ? '담당자 직책과 성명을 입력해 주세요.' : '비상연락 관계와 성명을 입력해 주세요.', 'error');
      }
      if (!/^[0-9]{10,11}$/.test(form.emergency_phone.replace(/[^0-9]/g, ''))) return toast('연락처를 정확히 입력해 주세요.', 'error');
    }
    if (step.kind === 'id-photo' && !idCard) return toast('주민번호를 가린 운전면허증을 촬영해 주세요.', 'error');
    if (step.kind === 'id-photo' && !idCardRrnMasked) return toast('면허증의 주민번호를 가렸는지 확인해 주세요.', 'error');
    if (step.kind === 'selfie' && !selfie) return toast('본인 얼굴을 촬영해 주세요.', 'error');
    if (step.kind === 'additional-driver') {
      const incomplete = additionalDrivers.findIndex((driver, index) => (
        !driver.name.trim()
        || !driver.relation.trim()
        || !/^\d{10,11}$/.test(driver.phone.replace(/\D/g, ''))
        || !driver.driverLicenseNo.trim()
        || !additionalDriverLicenses[index]
        || !driver.licenseRrnMasked
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
    if (step.kind === 'contract') {
      const missing = pages.find((page) => !confirmations[S(page.key)]);
      if (missing) return toast(`${S(missing.title) || '계약 조건'}을(를) 확인해 주세요.`, 'error');
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
    if (!corporate && (!idCard || !idCardRrnMasked || !selfie)) return toast('주민번호를 가린 운전면허증과 본인 얼굴 사진을 모두 첨부해 주세요.', 'error');
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
          license_rrn_masked_confirmed: driver.licenseRrnMasked,
          consentAt: driver.consent ? Date.now() : 0,
        })),
        signature: canvasRef.current!.toDataURL('image/png'),
        consents: [...consents],
        sectionConfirmations: confirmations,
        summaryConfirmedAt,
        agreementReadAt,
        documentPreviewedAt,
        id_card_rrn_masked_confirmed: idCardRrnMasked,
        sales_proof_method: needsPersonalSalesProof ? salesProofMethod : '',
        sales_proof_value: needsPersonalSalesProof ? salesProofValue : '',
        sales_proof_rrn_consent: needsPersonalSalesProof && salesProofMethod === 'rrn' && salesProofRrnConsent,
      }));
      if (!corporate && idCard && selfie) {
        payload.set('idCard', idCard);
        payload.set('selfie', selfie);
      }
      additionalDriverLicenses.forEach((file, index) => {
        if (file) payload.set(`additionalDriverLicense${index + 1}`, file);
      });
      const response = await fetch(`/api/freepass-esign/public/${encodeURIComponent(String(token))}`, {
        method: 'POST', body: payload, cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as PublicResponse;
      if (!response.ok) throw new Error(body.error || '전자계약 제출에 실패했습니다.');
      setView((prev) => ({ ...(prev || {}), status: '검토대기' }));
      toast(corporate ? '법인 서류와 전자서명을 제출했습니다.' : '본인확인 자료와 전자서명을 제출했습니다.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '전자계약 제출에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (view === undefined) {
    return (
      <SignShell sub="불러오는 중">
        <div className="c-body"><div className="skel" /><div className="skel" /></div>
      </SignShell>
    );
  }
  if (!view || view.error) {
    return (
      <SignShell sub="링크">
        <section className="c-body">
          <SignTitle>지금은 열 수 없는 링크입니다</SignTitle>
          <p className="auth-err">{view?.error || '이미 제출을 마쳤거나 링크가 만료되었습니다.'}</p>
        </section>
      </SignShell>
    );
  }
  if (view.status === '검토대기' || view.status === '서명완료') {
    const done = view.status === '서명완료';
    return (
      <SignShell sub={done ? '서명 완료' : '제출 접수'}>
        <section className="c-body">
          <SignTitle>{done ? '전자계약이 완료되었습니다' : '제출이 접수되었습니다'}</SignTitle>
          <SignDesc>
            {done ? '관리자 확인과 문서 봉인이 완료되었습니다.' : '담당자가 본인확인 자료·추가서류·서명을 확인한 뒤 계약을 확정합니다.'}
          </SignDesc>
          {done && view.documentUrl ? (
            <>
              <button type="button" className="btn btn-block" onClick={() => window.open(view.documentUrl, '_blank', 'noreferrer')}>완료 계약서 보기</button>
              <button type="button" className="btn btn-primary btn-block" onClick={() => window.open(view.downloadUrl || `${view.documentUrl}?download=1`, '_blank', 'noreferrer')}>PDF 다운로드</button>
              <SignFootnote>관리자 확인과 문서 봉인이 끝난 확정본입니다. 보관용으로 내려받아 주세요.</SignFootnote>
            </>
          ) : null}
        </section>
      </SignShell>
    );
  }

  const contract = snapshot.contract || {};
  // 신차·임시번호는 A4 완료본과 같은 값으로 보여 실제 번호처럼 오인되지 않게 한다.
  const vehicleNumber = snapshot.templateState?.car === '신차'
    ? '미정 (신차)'
    : S(contract.car_number_snapshot) || '—';
  const vehicleModel = compactVehicleModel(contract, snapshot.templateFields);
  const upfrontDone = upfrontConsents.every((key) => consents.has(key));
  const contractLeft = pages.filter((page) => !confirmations[S(page.key)]).length;
  const macroKey = macroOf(step?.kind || 'summary');
  const macroIdx = MACROS.findIndex((item) => item.key === macroKey);
  const started = step?.kind !== 'summary';
  const headerSteps = started ? MACROS.length : 0;
  const headerStep = Math.min(Math.max(macroIdx + 1, 1), MACROS.length);
  const identityBit = identitySubLabel(step?.kind || 'summary', corporate);
  const currentHeaderLabel = identityBit
    ? `본인확인 · ${identityBit}`
    : (MACROS[macroIdx]?.label || '계약 확인');
  /* 촬영 화면의 «찍었나» 하나 — 제목·설명·버튼 셋이 같은 값을 봐야 말이 어긋나지 않는다. */
  const shotDone = step?.kind === 'id-photo' ? !!idCard : step?.kind === 'selfie' ? !!selfie : false;
  const rentWon = formatWon(contract.rent_amount_snapshot);
  const depositWon = formatDeposit(contract.deposit_amount_snapshot);
  const rentMonth = S(contract.rent_month_snapshot);
  const periodText = rentMonth ? (rentMonth.endsWith('개월') ? rentMonth : `${rentMonth}개월`) : '—';
  const isSonogongSubscription = /손오공/.test(S(snapshot.landlord?.companyName) || S(snapshot.templateFields?.company_name))
    && /구독/.test(S(snapshot.contractKind?.title) || S(snapshot.template?.label));
  const feeLabel = isSonogongSubscription ? '월 구독료' : '월 대여료';
  const periodLabel = isSonogongSubscription ? '구독기간' : '대여기간';
  const blockLabel = preview ? ''
    : step?.kind === 'contract' && contractLeft > 0 ? `${contractLeft}개 더 확인`
    : step?.kind === 'privacy' && !upfrontDone ? '동의가 필요합니다'
    : step?.kind === 'agreement' && !documentPreviewedAt ? '계약서를 먼저 열어 주세요'
    : step?.kind === 'agreement' && !readThrough.agreement ? '약관을 끝까지 읽어 주세요'
    : step?.kind === 'agreement' && !consents.has('rental_terms') ? '동의가 필요합니다'
    : '';

  return (
    <SignShell
      sub={currentHeaderLabel}
      stepCount={headerSteps}
      step={headerStep}
      footer={(
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
            title={nextLabel(step, shotDone, blockLabel)}
            disabled={busy || preparingImage || (!preview && !!blockLabel)}
            onClick={() => {
              if (step?.kind === 'id-photo' && !idCard) { idRef.current?.click(); return; }
              if (step?.kind === 'selfie' && !selfie) { selfieRef.current?.click(); return; }
              void next();
            }}
          >{busy ? '확인 기록 중…' : nextLabel(step, shotDone, blockLabel)}</button>
        )}
      </div>
      )}
    >
      <section
        ref={stepBodyRef}
        className={`c-body anim-in${step?.kind === 'id-photo' || step?.kind === 'selfie' ? ' shoot-body' : ''}`}
        key={step?.key}
      >
      <SignTitle>{stepHeadline(step, shotDone)}</SignTitle>
      {stepGuide(step, shotDone) ? <SignDesc>{stepGuide(step, shotDone)}</SignDesc> : null}
      {view.rejectReason ? (
        <p className="auth-err">
          보완 요청: {view.rejectReason}
          {(view.supplementItems || []).length ? ` · ${(view.supplementItems || []).join(' · ')}` : ''}
        </p>
      ) : null}

      {step?.kind === 'summary' ? (
        <>
          {/*
            ★요지 4칸(SummaryStats)을 걷어냈다(사장님 2026-08-21 「굳이 박스로 할 필요가 있나」).
              차량·대여료·보증금·기간이 «박스 4개»와 «아래 표»에 그대로 두 번 나왔다.
              같은 값을 두 번 보여 주면 손님은 «둘이 다른 것인가» 하고 한 번 더 읽는다.
              착한거래 손님 화면은 값을 panel 한 곳에만 둔다 — 표 하나로 합친다.
            돈은 위에, 딸린 것은 아래 — 읽는 차례대로 세운다.
          */}
          <div className="scard">
            <div className="scard-head">
              <span className="scard-title">{S(snapshot.contractKind?.title) || S(snapshot.template?.label) || '자동차 대여 계약서'}</span>
              <span className="scard-badge ready">계약 요지</span>
            </div>
            <div className="scard-body">
              <Fact label="임대인 회사명" keep>{S(snapshot.landlord?.companyName) || S(snapshot.templateFields?.company_name)}</Fact>
              <Fact label="차종" keep>{vehicleModel}</Fact>
              <Fact label="차량번호" keep>{vehicleNumber}</Fact>
              <Fact label={periodLabel} keep>{periodText}</Fact>
              <Fact label={feeLabel} keep>{rentWon}</Fact>
              <Fact label="보증금" keep>{depositWon}</Fact>
              <Fact label="계약번호" keep>{S(contract.contract_code)}</Fact>
            </div>
          </div>
          {/* 한 줄짜리를 표로 세우지 않는다(사장님 2026-08-21) — 「확인 항목」이라는 라벨도 빈말이다.
              위 계약서 요약에 딸린 부가 설명이므로 표 밑 한 줄로 둔다. */}
          {isSonogongSubscription ? (
            <SignFootnote>구독료·구독기간, 만기 반납/인수, 보험료 포함 여부, 정비서비스, 중도해지·반납 조건을 함께 확인해 주세요.</SignFootnote>
          ) : null}
          {/* 계약서 원본 보기는 약관 단계에 있다 — 여기서 A4 문서를 열면 «맞나요?»에 답하기 전에
              흐름이 끊긴다. 이 화면은 조건이 맞는지만 묻는다. */}
          {/*
            ★「모바일 계약서 전체보기」를 걷어냈다(사장님 2026-08-21 「모바일 버전은 볼 필요 없을 것 같고」).
              계약서를 폰용으로 «다시 조판»해 보여 주던 자리다. 두 가지가 문제였다:
                ① 손님이 서명하는 문서는 A4 계약서인데, 화면에는 다른 모양이 보인다 —
                   「내가 본 것과 서명한 것이 같은가」를 흔든다
                ② 같은 내용을 두 벌로 만들어 두면 서식이 바뀔 때마다 둘 다 고쳐야 한다
              손님에게는 «실제 서명할 문서 그대로»를 보여 준다 — 위 「계약서 미리보기」 하나로 간다.
          */}
        </>
      ) : null}

      {step?.kind === 'privacy' ? (
        <>
          {/* ★한 동의 = 한 판. 고지 네 줄 바로 밑에 그 동의의 체크가 붙는다.
              갈라 놓으면 「위 표랑 아래 표가 뭐지」가 된다(사장님 2026-08-28). */}
          {consentBlocks.map(({ key, atom }) => (
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
          {consentProfile.cmsRequiredBeforeHandover ? (
            <SignFootnote>
              자동이체(CMS) 출금 동의와 예금주 인증은 본계약과 별도로 진행됩니다. 완료 전에는 차량 인도일을 확정할 수 없습니다.
            </SignFootnote>
          ) : null}
        </>
      ) : null}

      {/* ★정보 입력도 «한 화면에 한 갈래»다 — 계약자 / 서명자(법인) / 세금계산서 / 비상연락처.
          예전엔 셋이 한 화면이라 폰에서 365px 을 스크롤해야 끝이 보였다.
          칸은 ERP 표(라벨 왼쪽)가 아니라 착한거래 .field(라벨 위·전폭)를 쓴다 — atoms.tsx SignField 주석 참조.
          「필수」 뱃지는 안 붙인다: 이 화면들은 «전부» 필수라, 칸마다 붙이면 다섯 번 같은 말이 된다.
          대신 설명 한 줄로 한 번만 말한다(사장님 2026-08-21 「뱃지 촌스럽다, 손님한테 나가는 건데」). */}
      {step?.kind === 'identity' ? (
        <>
          <SignField label={corporate ? '법인명' : '성명'}>
            <input value={form.customer_name} onChange={(event) => set('customer_name', event.target.value)} placeholder={corporate ? '주식회사 홍길동' : '홍길동'} />
          </SignField>
          <SignField label={'연락처'}>
            <input value={form.customer_phone} onChange={(event) => set('customer_phone', fmtPhone(event.target.value))} inputMode="tel" autoComplete="tel" placeholder="010-0000-0000" />
          </SignField>
          <SignField label={corporate ? '법인등록번호' : '생년월일'}>
            <input value={form.customer_id} onChange={(event) => set('customer_id', corporate ? fmtRrn(event.target.value) : event.target.value)} type={corporate ? 'text' : 'date'} inputMode={corporate ? 'numeric' : undefined} placeholder={corporate ? '110111-0000000' : undefined} />
          </SignField>
          <SignField label={corporate ? '사업자등록번호' : '운전면허번호'}>
            <input
              value={form.driver_license_no}
              onChange={(event) => set('driver_license_no', corporate ? fmtBizNo(event.target.value) : fmtLicense(event.target.value))}
              inputMode={corporate ? 'numeric' : undefined}
              placeholder={corporate ? '000-00-00000' : '11-02-123456-01'}
            />
          </SignField>
          <SignField label={'주소'}>
            <input value={form.customer_address} onChange={(event) => set('customer_address', event.target.value)} placeholder="계약서에 실릴 주소" />
          </SignField>
          {!corporate ? (
            <label className={`cc${needTaxInvoice ? ' on' : ''}${soleProprietor ? ' cc-disabled' : ''}`}>
              <input
                type="checkbox"
                checked={needTaxInvoice}
                disabled={soleProprietor}
                onChange={(event) => {
                  const on = event.target.checked;
                  setWantBiz(on);
                  if (!on) {
                    setForm((prev) => ({
                      ...prev,
                      tax_biz_name: '', tax_biz_no: '', tax_ceo: '', tax_biz_type_item: '', tax_email: '', tax_biz_address: '',
                    }));
                  }
                }}
              />
              <span>개인사업자입니다
                <small>세금계산서에 쓸 상호·사업자등록번호를 추가로 적습니다.</small>
              </span>
            </label>
          ) : null}
          <SignFootnote>{corporate
            ? '법인 식별정보와 세금계산서 정보는 계약·매출증빙에만 씁니다. 서명권한은 아래 법인 서류로 확인합니다.'
            : '생년월일은 운전자격 확인에만 씁니다. 주민등록번호는 받지 않습니다.'}</SignFootnote>
        </>
      ) : null}

      {step?.kind === 'sales-proof' ? (
        <>
          <SignField label="현금영수증 발행 수단">
            <select value={salesProofMethod} onChange={(event) => {
              const method = event.target.value === 'rrn' ? 'rrn' : 'phone';
              setSalesProofMethod(method);
              setSalesProofValue(method === 'phone' ? form.customer_phone : '');
              setSalesProofRrnConsent(false);
            }}>
              <option value="phone">휴대전화번호</option>
              <option value="rrn">주민등록번호</option>
            </select>
          </SignField>
          <SignField label={salesProofMethod === 'phone' ? '현금영수증 휴대전화번호' : '현금영수증 주민등록번호'}>
            <input
              value={salesProofValue}
              onChange={(event) => setSalesProofValue(salesProofMethod === 'phone' ? fmtPhone(event.target.value) : fmtRrn(event.target.value))}
              inputMode="numeric"
              autoComplete="off"
              placeholder={salesProofMethod === 'phone' ? '010-0000-0000' : '000000-0000000'}
            />
          </SignField>
          {salesProofMethod === 'rrn' ? (
            <label className={`cc${salesProofRrnConsent ? ' on' : ''}`}>
              <input type="checkbox" checked={salesProofRrnConsent} onChange={(event) => setSalesProofRrnConsent(event.target.checked)} />
              <span>현금영수증 발행을 위해 주민등록번호를 암호화하여 처리하는 데 동의합니다</span>
            </label>
          ) : null}
          <SignFootnote>{salesProofMethod === 'phone'
            ? '입력한 번호로 소득공제용 현금영수증을 발행합니다.'
            : '주민등록번호는 현금영수증 발행에만 쓰며, 계약서·PDF·일반 계약정보에는 저장하지 않습니다.'}</SignFootnote>
        </>
      ) : null}

      {step?.kind === 'signer' ? (
        <>
          <SignField label="성명">
            <input value={form.signer_name} onChange={(event) => set('signer_name', event.target.value)} placeholder="홍길동" />
          </SignField>
          <SignField label="법인과의 관계">
            <select value={form.signer_role} onChange={(event) => set('signer_role', event.target.value)}>
              <option value="">선택해 주세요</option>
              {SIGNER_ROLES.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </SignField>
          <SignFootnote>대표이사는 법인등기부등본·법인인감증명서로, 위임받은 임직원은 위임장·재직증명서로 서명권한을 확인합니다. 주민등록번호와 운전면허번호는 받지 않습니다.</SignFootnote>
        </>
      ) : null}

      {step?.kind === 'tax-invoice' ? (
        <>
          <SignField label={'상호'}>
            <input value={form.tax_biz_name} onChange={(event) => set('tax_biz_name', event.target.value)} />
          </SignField>
          <SignField label={'사업자등록번호'}>
            <input value={form.tax_biz_no} onChange={(event) => set('tax_biz_no', fmtBizNo(event.target.value))} inputMode="numeric" placeholder="000-00-00000" />
          </SignField>
          <SignField label={'대표자'}>
            <input value={form.tax_ceo} onChange={(event) => set('tax_ceo', event.target.value)} />
          </SignField>
          <SignField label={'업태·종목'}>
            <input value={form.tax_biz_type_item} onChange={(event) => set('tax_biz_type_item', event.target.value)} placeholder="예: 서비스업 · 운수" />
          </SignField>
          <SignField label={'세금계산서 이메일'}>
            <input value={form.tax_email} onChange={(event) => set('tax_email', event.target.value)} inputMode="email" placeholder="tax@example.com" />
          </SignField>
          <SignField label={'사업장 주소'}>
            <input value={form.tax_biz_address} onChange={(event) => set('tax_biz_address', event.target.value)} />
          </SignField>
        </>
      ) : null}

      {step?.kind === 'emergency' ? (
        <>
          <SignField label={corporate ? '직책·관계' : '관계'}>
            <input value={form.emergency_relation} onChange={(event) => set('emergency_relation', event.target.value)} placeholder={corporate ? '예: 관리부장' : '예: 모, 배우자, 형제자매'} />
          </SignField>
          <SignField label={'성명'}>
            <input value={form.emergency_name} onChange={(event) => set('emergency_name', event.target.value)} placeholder="홍길순" />
          </SignField>
          <SignField label={'연락처'}>
            <input value={form.emergency_phone} onChange={(event) => set('emergency_phone', fmtPhone(event.target.value))} inputMode="tel" autoComplete="tel" placeholder="010-0000-0000" />
          </SignField>
          <SignFootnote>{corporate ? '계약자와 연락이 닿지 않을 때만 씁니다.' : '사고·정비 때 계약자와 연락이 닿지 않으면 이 번호로 겁니다.'}</SignFootnote>
        </>
      ) : null}

      {/* ★촬영은 한 화면에 한 장 — 착한거래 idcam/facecam 과 같은 자리다.
          우리는 라이브 미리보기 대신 기기 카메라를 연다(sign.css 「촬영 화면」 주석 참조). */}
      {step?.kind === 'id-photo' ? (
        <div className="shoot-wrap">
          <button
            type="button"
            className={`shoot id${idCard ? ' done' : ''}`}
            onClick={() => idRef.current?.click()}
            aria-label={idCard ? '운전면허증 다시 촬영' : '운전면허증 촬영'}
          >
            {idCard ? <FileThumb file={idCard} fill /> : (
              <>
                <span className="shoot-ic"><Camera size={26} /></span>
                <span className="shoot-t">눌러서 촬영</span>
                <span className="shoot-d">주민번호는 가리고,<br />면허번호·성명은 보이게 찍어 주세요.</span>
              </>
            )}
            {idCard ? <span className="shoot-again"><RefreshCw size={13} /> 다시 촬영</span> : null}
          </button>
          <label className={`cc${idCardRrnMasked ? ' on' : ''}`}>
            <input type="checkbox" checked={idCardRrnMasked} onChange={(event) => setIdCardRrnMasked(event.target.checked)} />
            <span>면허증의 주민번호 전체를 가렸습니다</span>
          </label>
          <input ref={idRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onClick={(event) => event.stopPropagation()} onChange={(event) => { void chooseImage(event.target.files?.[0] || null, '운전면허증', setIdCard); event.currentTarget.value = ''; }} />
        </div>
      ) : null}

      {step?.kind === 'selfie' ? (
        <div className="shoot-wrap">
          <button
            type="button"
            className={`shoot face${selfie ? ' done' : ''}`}
            onClick={() => selfieRef.current?.click()}
            aria-label={selfie ? '본인 얼굴 다시 촬영' : '본인 얼굴 촬영'}
          >
            {selfie ? <FileThumb file={selfie} fill /> : (
              <>
                <span className="shoot-ic"><UserRound size={26} /></span>
                <span className="shoot-t">눌러서 촬영</span>
                <span className="shoot-d">모자·마스크·선글라스는 벗고,<br />밝은 곳에서 정면을 봐 주세요.</span>
              </>
            )}
            {selfie ? <span className="shoot-again"><RefreshCw size={13} /> 다시 촬영</span> : null}
          </button>
          <input ref={selfieRef} type="file" accept="image/*" capture="user" style={{ display: 'none' }} onClick={(event) => event.stopPropagation()} onChange={(event) => { void chooseImage(event.target.files?.[0] || null, '본인 얼굴 사진', setSelfie); event.currentTarget.value = ''; }} />
        </div>
      ) : null}

      {step?.kind === 'additional-driver' ? (
        <>
          <div className="scard">
            <div className="scard-body">
              <Fact label="운전 가능 범위" keep>{S(snapshot.additionalDriverPolicy?.driverScope) || '계약서 기재 운전자'}</Fact>
              <Fact label="추가운전자 비용" keep>{additionalDriverCost}</Fact>
            </div>
          </div>

          {additionalDrivers.map((driver, index) => (
            <div key={index}>
              <div className="slabel">추가 운전자 {index + 1}</div>
              <SignField label="성명">
                <input value={driver.name} onChange={(event) => updateAdditionalDriver(index, 'name', event.target.value)} />
              </SignField>
              <SignField label="관계">
                <input value={driver.relation} onChange={(event) => updateAdditionalDriver(index, 'relation', event.target.value)} placeholder="예: 배우자, 가족" />
              </SignField>
              <SignField label="연락처">
                <input value={driver.phone} onChange={(event) => updateAdditionalDriver(index, 'phone', fmtPhone(event.target.value))} inputMode="tel" autoComplete="tel" placeholder="010-0000-0000" />
              </SignField>
              <SignField label="운전면허번호">
                <input value={driver.driverLicenseNo} onChange={(event) => updateAdditionalDriver(index, 'driverLicenseNo', fmtLicense(event.target.value))} placeholder="11-02-123456-01" />
              </SignField>
              <div className="shoot-wrap">
                <button
                  type="button"
                  className={`shoot id${additionalDriverLicenses[index] ? ' done' : ''}`}
                  onClick={() => additionalDriverLicenseRefs.current[index]?.click()}
                  aria-label={`추가 운전자 ${index + 1} 운전면허증 촬영`}
                >
                  {additionalDriverLicenses[index] ? <FileThumb file={additionalDriverLicenses[index]} fill /> : (
                    <>
                      <span className="shoot-ic"><Camera size={26} /></span>
                      <span className="shoot-t">면허증 촬영</span>
                      <span className="shoot-d">주민번호는 가리고,<br />면허번호·성명은 보이게 찍어 주세요.</span>
                    </>
                  )}
                  {additionalDriverLicenses[index] ? <span className="shoot-again"><RefreshCw size={13} /> 다시 촬영</span> : null}
                </button>
                <input
                  ref={(element) => { additionalDriverLicenseRefs.current[index] = element; }}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    void chooseImage(event.target.files?.[0] || null, `추가 운전자 ${index + 1} 운전면허증`, (file) => setAdditionalDriverLicense(index, file));
                    event.currentTarget.value = '';
                  }}
                />
              </div>
              <label className={`cc${driver.licenseRrnMasked ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={driver.licenseRrnMasked}
                  onChange={(event) => updateAdditionalDriver(index, 'licenseRrnMasked', event.target.checked)}
                />
                <span>면허증의 주민번호 전체를 가렸습니다</span>
              </label>
              <label className={`cc${driver.consent ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={!!driver.consent}
                  aria-label="추가 운전자 개인정보 제공·면허증 제출 동의"
                  onChange={(event) => updateAdditionalDriver(index, 'consent', event.target.checked)}
                />
                <span>개인정보 제공·면허증 제출에 동의합니다</span>
              </label>
              <button type="button" className="btn btn-sm" onClick={() => removeAdditionalDriver(index)}>추가 운전자 {index + 1} 삭제</button>
            </div>
          ))}

          <button
            type="button"
            className="btn btn-block"
            disabled={additionalDrivers.length >= additionalDriverLimit}
            onClick={addAdditionalDriver}
          >
            {additionalDrivers.length >= additionalDriverLimit
              ? `최대 ${additionalDriverLimit}명 등록 가능`
              : '추가 운전자 등록'}
          </button>
          <SignFootnote>
            회사의 운전자격·보험 적용 확인이 완료되기 전에는 추가 운전자가 차량을 운전할 수 없습니다.
          </SignFootnote>
        </>
      ) : null}

      {step?.kind === 'documents' ? (
        <>
          {requiredDocuments.length === 0 ? (
            <p className="hint">이번 계약에 요청 서류가 없습니다.</p>
          ) : requiredDocuments.map((document) => {
            const file = supportingFiles[document.key];
            const uploaded = uploadedSupportingDocumentKeys.has(document.key);
            return (
              <div key={document.key}>
                <button
                  type="button"
                  className={`auth-opt${file || uploaded ? ' rec' : ''}`}
                  onClick={() => supportingFileRefs.current[document.key]?.click()}
                >
                  <span className="ic id" aria-hidden><FileText size={18} /></span>
                  <span className="tx">{file?.name || (uploaded ? `${document.label} 제출 완료` : document.label)}
                    <small>{document.required ? '필수' : '선택'} · 사진 또는 PDF · 파일당 5MB 이하{file || uploaded ? '' : ' · 눌러서 첨부'}</small>
                  </span>
                  <span className="arr" aria-hidden>›</span>
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
                {document.required ? <ReqTag /> : null}
                {document.note ? <p className="hint">{document.note}</p> : null}
              </div>
            );
          })}
          {requiredDocuments.length ? (
          <SignFootnote>
            첨부 원본은 계약 검토 관리자만 확인할 수 있으며 공개 계약정보에는 노출되지 않습니다.
          </SignFootnote>
          ) : null}
        </>
      ) : null}

      {step?.kind === 'contract' ? (
        <>
          {pages.map((page, index) => {
            const key = S(page.key);
            return (
              <ContractSection
                key={key || page.title}
                page={page}
                open={!!seen[key] || index === 0}
                at={confirmations[key]}
                onSeen={() => setSeen((prev) => (prev[key] ? prev : { ...prev, [key]: true }))}
                onToggle={(on) => {
                  const at = Date.now();
                  setConfirmations((prev) => {
                    const next = { ...prev };
                    if (on) next[key] = at; else delete next[key];
                    return next;
                  });
                  if (on && !preview) void markProgress(key).catch(() => {});
                }}
              />
            );
          })}
        </>
      ) : null}

      {step?.kind === 'agreement' ? (
        <>
          {/* 계약서 원본은 «서명 직전»에 본다(사장님 2026-08-21 「서명 전에만 보면 되잖아」).
              여기는 약관을 읽는 자리다 — 문서까지 같이 띄우면 무엇을 읽어야 하는지 흐려진다. */}
          {/*
            ★조문을 카드로 죽 펼치지 않는다(사장님 2026-08-21 「모바일에서 약관 보는 게 비효율적」).
              28개 조문 × 카드면 한 화면에 한두 개만 보이고, 손님은 «무엇이 들어 있는지» 모른 채
              손가락으로만 끝까지 민다. 접어 두면 제목 여덟아홉 개가 목차처럼 서고, 볼 것만 편다.
              펴 본 조문을 기록해 둔다 — 「끝까지 스크롤했다」보다 나은 증거다.
          */}
          <SignProgress
            done={openedTerms.size}
            total={(snapshot.agreement?.sections || []).length}
            label="펴 본 조문"
          />
          <div style={{ minWidth: 0 }}>
            {(snapshot.agreement?.sections || []).map((section, index) => (
              <SignAccordion
                key={`${section.t}-${index}`}
                title={section.t}
                onOpen={() => { const key = S(section.t) || String(index); setOpenedTerms((prev) => (prev.has(key) ? prev : new Set(prev).add(key))); }}
              >{section.b}</SignAccordion>
            ))}
            <div ref={agreementEndRef} style={{ height: 1 }} />
          </div>
          {!readThrough.agreement ? <p className="hint">약관을 끝까지 내려 읽어 주세요.</p> : null}
          <WorkTable title="필수 동의">
            <SignConsent
              label={consentLabel('rental_terms')}
              required
              checked={consents.has('rental_terms')}
              onChange={() => { if (documentPreviewedAt) toggleConsent('rental_terms'); }}
              disabled={!documentPreviewedAt}
            />
          </WorkTable>
          {!documentPreviewedAt ? <p className="hint">계약서 원본을 먼저 열람해 주세요.</p> : null}
        </>
      ) : null}

      {step?.kind === 'signature' ? (
        <>
          {/* 서명 직전 — 여기서 원본을 한 번 열어 본다. 손님이 «서명한 것»과 «본 것»이 같아야 한다.
              .auth-opt 는 착한거래의 «선택 행» 규격이다(아이콘 · 제목 · 작은 설명 · ›). */}
          {view.previewDocumentUrl ? (
            <button type="button" className="auth-opt rec" onClick={() => setDocumentPreviewOpen(true)} aria-haspopup="dialog">
              <span className="ic id" aria-hidden><Eye size={ICON.md} /></span>
              <span className="tx">서명할 계약서 보기
                <small>{documentPreviewedAt ? '열람함 · 다시 볼 수 있습니다' : '서명 전에 한 번 열어 확인해 주세요'}</small>
              </span>
              <span className="arr" aria-hidden>›</span>
            </button>
          ) : null}
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
          <div className="sig">
            <canvas
              ref={canvasRef}
              className="sig-canvas"
              width={600}
              height={180}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={() => { drawing.current = false; }}
              onPointerLeave={() => { drawing.current = false; }}
              aria-label="전자서명 입력 영역"
            />
            <div className="sig-bar">
              <p className="hint">아래 서명은 위 계약서·확인한 모든 조건·약관에 대한 전자서명입니다.</p>
              <button type="button" className="btn btn-sm" onClick={clearSignature}>지우기</button>
            </div>
          </div>
          <SignFootnote>서명시각과 단계별 확인시각이 기록되며, 관리자 확정 후에는 내용을 바꿀 수 없습니다.</SignFootnote>
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
            <p className="hint">실제 서명 대상 계약서 원본입니다. 확대해서 읽고, 닫으면 작성하던 단계로 돌아갑니다.</p>
          </div>
        </Modal>
      ) : null}
    </SignShell>
  );
}
