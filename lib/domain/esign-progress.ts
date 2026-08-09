/**
 * 전자계약 진행 판정 — 「손님이 어디까지 왔나」의 SSOT.
 *
 * ★`/contract` 의 5단계와 축이 다르다.
 *   저기(`contractStage`)는 **우리 일**이 어디까지인지(출고문의·서류·약정·입금·출고),
 *   여기는 **손님**이 서명 링크에서 어디까지 갔는지다. 둘을 한 축에 섞으면 둘 다 못 읽는다.
 *
 * ★단계는 `ESIGN…INTEGRATION.md` §3.1 의 손님 여정 그대로다.
 *   착한거래가 그 순서로 화면을 그리고, 단계 통과 시각을 `sign_consents` 에 남긴다.
 */
import type { EntityRecord } from '@/lib/intake/entities';

type Rec = Record<string, unknown>;
const S = (v: unknown): string => String(v ?? '').trim();
const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** 손님 여정 8단계. `key` 는 착한거래가 돌려주는 `consents` 키와 같다. */
export const ESIGN_STEPS = [
  { key: 'identity_verified', label: '본인확인' },
  { key: 'identity', label: '본인정보' },
  { key: 'vehicle', label: '차량정보' },
  { key: 'rental', label: '대여조건' },
  { key: 'insurance', label: '보험' },
  { key: 'documents', label: '서류제출' },
  { key: 'agreement', label: '약관동의' },
  { key: 'signed', label: '서명' },
] as const;

export type EsignState =
  | '미발송' | '발행' | '열람' | '진행중' | '서명완료' | '반려' | '만료';

export type EsignStage = {
  state: EsignState;
  /** 통과한 단계 수(0~8). 목록의 «4/8» 이 이 값이다. */
  done: number;
  total: number;
  /** 지금 손님이 서 있는 칸. 완료·미발송이면 null. */
  current: string | null;
  label: string;
  tone: 'gray' | 'blue' | 'amber' | 'green' | 'red';
};

/**
 * 저장 형태가 둘이다 — 레거시 자체서명은 `'a,b,c'` 문자열, 착한거래는 `{키: 시각}` 객체.
 * 둘 다 «통과한 키 집합»으로 읽는다.
 */
export function consentKeys(raw: unknown): Set<string> {
  if (!raw) return new Set();
  if (typeof raw === 'string') return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  if (typeof raw === 'object') {
    return new Set(
      Object.entries(raw as Rec)
        // 값이 0·false·빈문자면 «아직»이다. 키가 있다고 통과로 세면 안 된다.
        .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== 0 && v !== '')
        .map(([k]) => k),
    );
  }
  return new Set();
}

/**
 * 계약 한 건 → 전자계약 진행 상태.
 *
 * 우선순위가 중요하다 — **끝난 것·막힌 것을 먼저** 판정한다.
 * 서명완료된 계약이 만료일을 넘겼다고 «만료»로 보이면 안 된다.
 */
export function esignStage(contract: EntityRecord | null | undefined, now = Date.now()): EsignStage {
  const total = ESIGN_STEPS.length;
  const base = { total, current: null as string | null };
  if (!contract) return { ...base, state: '미발송', done: 0, label: '미발송', tone: 'gray' };
  const c = contract as Rec;

  // 서명이 끝났으면 그 뒤의 만료·상태값은 보지 않는다.
  if (N(c.sign_signed_at) > 0 || S(c.sign_status) === '서명완료') {
    return { ...base, state: '서명완료', done: total, label: '서명완료', tone: 'green' };
  }
  if (N(c.sign_rejected_at) > 0 || S(c.sign_reject_reason)) {
    return { ...base, state: '반려', done: 0, label: '반려', tone: 'red' };
  }

  const issued = !!S(c.esign_id) || !!S(c.sign_token) || N(c.sign_sent_at) > 0;
  if (!issued) return { ...base, state: '미발송', done: 0, label: '미발송', tone: 'gray' };

  // 폐기된 링크는 만료와 같이 취급한다 — 손님이 열어도 못 쓴다.
  const expiresAt = N(c.sign_expires_at);
  if (N(c.sign_revoked_at) > 0 || (expiresAt > 0 && expiresAt < now)) {
    return { ...base, state: '만료', done: 0, label: '만료', tone: 'red' };
  }

  const passed = consentKeys(c.sign_consents);
  // 착한거래가 `esign_progress`(0~8)를 직접 주면 그걸 믿는다 — 우리가 모르는 단계까지 센다.
  const reported = N(c.esign_progress);
  let done = 0;
  for (const step of ESIGN_STEPS) {
    if (!passed.has(step.key)) break;
    done += 1;
  }
  if (reported > done) done = Math.min(reported, total);

  if (done <= 0) {
    const opened = N(c.esign_opened_at) > 0 || S(c.sign_status) === '열람';
    return opened
      ? { ...base, state: '열람', done: 0, label: '열람', tone: 'blue' }
      : { ...base, state: '발행', done: 0, label: '발행', tone: 'blue' };
  }
  const current = done < total ? ESIGN_STEPS[done].label : null;
  return {
    ...base,
    state: '진행중',
    done,
    current,
    label: current ? `${current} 중` : '진행중',
    tone: 'amber',
  };
}

/** 단계별 통과 시각 — `{키: 시각}` 으로 저장된 경우만 나온다(레거시 콤마 문자열엔 시각이 없다). */
export function consentAt(raw: unknown, key: string): number {
  if (!raw || typeof raw !== 'object') return 0;
  return N((raw as Rec)[key]);
}

/**
 * 손님이 낸 서류 — 착한거래가 웹훅/조회로 돌려주는 것을 그대로 읽는다.
 * **원본 파일은 우리에게 오지 않는다.** 제출 여부와 시각·해시만 온다(`ESIGN…INTEGRATION.md` §3.1).
 */
export type EsignDocument = { key: string; label: string; submittedAt: number; sha256: string };

export function esignDocuments(contract: EntityRecord | null | undefined): EsignDocument[] {
  const raw = (contract as Rec | null)?.esign_documents;
  if (!raw) return [];
  const rows = Array.isArray(raw) ? raw : Object.values(raw as Rec);
  return rows
    .filter((r): r is Rec => !!r && typeof r === 'object')
    .map((r) => ({
      key: S(r.key),
      label: S(r.label) || S(r.key),
      submittedAt: N(r.submittedAt),
      sha256: S(r.sha256),
    }))
    .filter((d) => !!d.key);
}

/** 본인확인 산출물(신분증·셀피) 제출 여부. 원본은 착한거래가 갖는다. */
export function esignIdentityShots(contract: EntityRecord | null | undefined): { idCard: boolean; selfie: boolean; verifiedAt: number } {
  const raw = (contract as Rec | null)?.esign_identity as Rec | undefined;
  return {
    idCard: !!raw && (!!S(raw.idCardPath) || !!S(raw.idCardSha256)),
    selfie: !!raw && (!!S(raw.selfiePath) || !!S(raw.selfieSha256)),
    verifiedAt: N(raw?.verifiedAt),
  };
}

/**
 * 봉인·감사추적 — 서명이 끝나면 착한거래가 웹훅으로 돌려주는 것.
 *
 * ★**PDF 원본과 PII 는 여기 없다**(2026-08-09 결정).
 *   착한거래가 서버에서 PDF 를 만들고 해시·타임스탬프로 봉인한다 — 서명을 가진 쪽이 만들어야 한다.
 *   우리는 **해시·검증링크·본문 사본**만 받는다. 서명이미지·신분증·셀피·서류는 안 받는다.
 *
 * ★`consents` 의 시각이 핵심이다
 *   「강조했다」만으로는 손님의 «못 봤는데요»를 못 막는다.
 *   **「몇 시 몇 분에 그 섹션을 확인했다」**가 설명의무를 다한 증거다.
 */
export type EsignSeal = {
  sealHash: string;
  verifyUrl: string;
  signedAt: number;
  /** 계약서 본문 PDF(서명·신분증 이미지 제외). 착한거래가 사라져도 계약서는 남아야 한다. */
  documentUrl: string;
  /** 어느 판으로 서명했나 — 문구가 바뀌면 되짚을 수 있는 유일한 근거. */
  templateVersion: string;
  agreementVersion: string;
};

export function esignSeal(contract: EntityRecord | null | undefined): EsignSeal | null {
  const c = contract as Rec | null;
  if (!c) return null;
  const hash = S(c.esign_seal_hash);
  const signedAt = N(c.sign_signed_at);
  // 봉인은 «서명 + 해시»가 다 있어야 성립한다. 하나만 있으면 반쪽이라 봉인으로 치지 않는다.
  if (!hash || !signedAt) return null;
  return {
    sealHash: hash,
    verifyUrl: S(c.esign_verify_url),
    signedAt,
    documentUrl: S(c.esign_document_url),
    templateVersion: S(c.esign_template_version),
    agreementVersion: S(c.sign_consent_version),
  };
}

/** 봉인은 됐는데 검증링크·사본이 안 왔다 — 조용히 넘기면 나중에 계약서를 못 연다. */
export function sealGaps(contract: EntityRecord | null | undefined): string[] {
  const seal = esignSeal(contract);
  if (!seal) return [];
  const out: string[] = [];
  if (!seal.verifyUrl) out.push('검증링크 없음');
  if (!seal.documentUrl) out.push('계약서 사본 없음');
  if (!seal.agreementVersion) out.push('약관 판 기록 없음');
  return out;
}

/** 관리자가 손봐야 하는 건 — 목록 기본 필터가 이걸 쓴다. */
export function esignNeedsAttention(contract: EntityRecord): boolean {
  const { state } = esignStage(contract);
  return state === '반려' || state === '만료';
}

/** 발행된 계약서가 이 노드에 들어왔는지 — 목록에 올릴지 말지의 기준. */
export function isEsignIssued(contract: EntityRecord | null | undefined): boolean {
  if (!contract) return false;
  const c = contract as Rec;
  return !!S(c.esign_id) || N(c.sign_sent_at) > 0;
}

// 목록에는 «발송한 것»만 올라온다(2026-08-08 결정) — 계약완료 여부와 다른 축이다.
// 그래서 «미발송» 필터가 없다. 아직 안 보낸 건은 작업 패널의 «새 계약서 발송»에서 고른다.
export const ESIGN_FILTERS = ['전체', '진행중', '서명완료', '확인 필요'] as const;
export type EsignFilter = typeof ESIGN_FILTERS[number];

export function matchesEsignFilter(contract: EntityRecord, filter: EsignFilter): boolean {
  if (filter === '전체') return true;
  const { state } = esignStage(contract);
  if (filter === '확인 필요') return state === '반려' || state === '만료';
  if (filter === '진행중') return state === '발행' || state === '열람' || state === '진행중';
  return state === filter;
}

/** 목록 정렬 — 손봐야 할 것 위로, 그다음 최근 발송순. */
const ORDER: EsignState[] = ['반려', '만료', '진행중', '열람', '발행', '미발송', '서명완료'];
export function compareEsign(a: EntityRecord, b: EntityRecord): number {
  const ai = ORDER.indexOf(esignStage(a).state);
  const bi = ORDER.indexOf(esignStage(b).state);
  if (ai !== bi) return ai - bi;
  return N((b as Rec).sign_sent_at) - N((a as Rec).sign_sent_at);
}
