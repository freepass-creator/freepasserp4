'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStore } from '@/lib/store';
import { useAuthReady } from '@/lib/auth-context';
import { getRole, actor } from '@/lib/domain/deal';
import { confirmDialog, toast } from '@/components/Toaster';
import { Btn, C, FS, FW, ICON, Input, Modal, PillTabs, R, SCRIM, SH, Select, SectionLabel, Textarea, NUM, td, th } from '@/components/ui';
import { type EntityRecord } from '@/lib/intake/entities';
import { type MasterEntry } from '@/lib/domain/vehicle-master-match';
import {
  autoMapHeaders,
  buildMappingHeaderSignature,
  fetchSheetTable,
  IMPORT_FIELDS,
  parseDepositRule,
  parseDelimited,
  parseMappingHeaderSignature,
  parseMappingProfile,
  prepareMasterIngress,
  type DepositRule,
  type MappingHeaderSignature,
  type MappingProfile,
  type SheetTableFetchOptions,
} from '@/lib/domain/sheet-import';
import { ExternalLink } from 'lucide-react';
import { commitSupplierProducts, previewSupplierTable } from '@/lib/domain/master-ingress';
/**
 * 아이언 홈페이지 주소 — 화면 표시용 사본.
 * SSOT 는 `lib/server/ironrentcar-source.IRONRENTCAR_SITE_URL` 인데 그 모듈은 스크래퍼(cheerio)를
 * 끌고 와서 클라이언트 번들에 넣지 않는다. 주소가 바뀌면 두 곳을 같이 고쳐야 한다.
 */
const IRONRENTCAR_SITE_URL = 'https://ironrentcar.com';
const SALES_INVENTORY_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs/edit';
/**
 * 관리자 API 호출 상한 — 상한 없는 fetch 는 화면을 «조용히» 영구 고착시킨다.
 * reject 가 아니라 pending 이라 catch 도 finally 도 안 돌아 「검증 중…」이 안 풀린다(실측).
 * 아이언은 홈페이지를 크롤링하므로 따로 길게 준다.
 */
const ADMIN_FETCH_TIMEOUT_MS = 20_000;
const IRON_FETCH_TIMEOUT_MS = 90_000;
/** 재고 스냅샷은 서버가 6천 건을 훑어 투영한다 — 다른 관리자 API 보다 넉넉히 준다. */
const RECONCILE_FETCH_TIMEOUT_MS = 60_000;
import { SyncPreview } from '@/components/SyncPreview';
import { loadVehicleMaster, peekVehicleMaster } from '@/lib/domain/vehicle-master-load';
import { ADAPTER_OPTIONS, resolveAdapter, type SheetAdapterId } from '@/lib/domain/sheet-adapters';
import {
  listSheetPartners,
  listSheetPartnerRecords,
  fetchAllPartnerSheets,
  commitFetchedPartnerSheets,
  commitSafeSupplierFields,
  buildPrevForGuard,
  findSheetSyncExistingConflicts,
  sheetSyncExistingConflictReason,
  sheetSyncCommitBlockReason,
  sheetPartnerRosterRevision,
  sheetSourceRowsRead,
  isWebInventoryPartner,
  partnerSourceReadiness,
  type PartnerSheetRow,
} from '@/lib/domain/sheet-sync-all';
import {
  countAutoplusStock,
  importAutoplusMerged,
  AUTOPLUS_GID_MAIN,
  type AutoplusImportResult,
} from '@/lib/domain/sheet-autoplus';
import {
  formatSheetDiffBanner,
  sheetChangedFieldCounts,
  sheetStatusTransitionCounts,
  summarizeSheetDiff,
  type SheetDiffSummary,
} from '@/lib/domain/sheet-diff';
import {
  listProductsForSheetReconcile,
  listSheetReconcileState,
  sheetReconcileStateRevision,
  shouldReconcileAbsent,
} from '@/lib/domain/sheet-merge';
import { copyText } from '@/lib/clipboard';
import { getAuthClient } from '@/lib/firebase/client';
import {
  fetchSupplierSheet,
  type SupplierSheetRead,
} from '@/lib/domain/supplier-sheet-read';
import {
  buildPriceChangesValue,
  priceChangesValueFromRows,
  buildSheetConflictReportRows,
  sheetConflictReportTsv,
  type SheetConflictReportRow,
} from '@/lib/domain/sheet-conflict-report';
import {
  KEEP_EXISTING_PRICES,
  PRICE_PERIOD_CONFLICT,
  applySheetConflictResolutions,
  isPriceConflictProtected,
  sheetConflictFingerprint,
  type SheetConflictResolution,
  type SheetConflictResolutionInput,
} from '@/lib/domain/sheet-conflict-resolution';
import {
  ASSIGN_SHEET_OWNER,
  DELETED_REAPPEARANCE_CONFLICT,
  KEEP_DELETED,
  KEEP_EXISTING_OWNER,
  OWNERSHIP_CONFLICT,
  RESTORE_DELETED,
  sheetConflictDecisionLabel,
  type SheetConflictDecision,
  type SheetConflictDecisionInput,
  type SheetConflictDecisionValue,
} from '@/lib/domain/sheet-conflict-decision';
import {
  buildSheetConflictDecisionTargets,
  planSheetConflictDecisionDryRun,
  sheetConflictDecisionDryRunTsv,
  sheetConflictDecisionTargetBlockReason,
  type SheetConflictDecisionTarget,
} from '@/lib/domain/sheet-conflict-decision-dry-run';
import {
  planSheetIdentityConflictReview,
  sheetIdentityConflictReviewTsv,
  type SheetIdentityConflictReview,
  type SheetIdentityReviewRow,
} from '@/lib/domain/sheet-identity-conflict-review';
import {
  sheetIdentityDecisionLabel,
  sheetIdentityDecisionOptions,
  type SheetIdentityDecision,
  type SheetIdentityDecisionInput,
  type SheetIdentityDecisionValue,
} from '@/lib/domain/sheet-identity-decision';
import {
  planSheetDecisionApplication,
  sheetDecisionApplicationPlanTsv,
} from '@/lib/domain/sheet-decision-application-plan';
import {
  planSheetDecisionPatchDryRun,
  sheetDecisionPatchDryRunJson,
} from '@/lib/domain/sheet-decision-patch-dry-run';

const DEPOSIT_RULE_OPTIONS = [
  { value: '', label: '시트 보증금만 사용' },
  { value: 'months_per_year', label: '기간 1년당 월대여료 1개월치' },
  { value: 'rent_multiple', label: '국산 2·수입 3개월치' },
] as const;

/**
 * 공급사 매물 취합 — 공급사마다 고유 시트 + 매핑 학습.
 * 관리자: 시트 URL 등록된 공급사 일괄 가져오기+저장. 단일/엑셀도 동일 엔진.
 */
/** 공급사 한 곳의 수정범위 한 줄. 실패한 곳도 남긴다 — 조용히 빠지면 "원래 0대였나" 하고 넘어간다. */
type PartnerDiffRow = {
  code: string; label: string; ok: boolean;
  readiness: 'ready' | 'review' | 'blocked'; readinessReason: string;
  sheet: number;                                  // 시트에서 읽어 올릴 매물(출고불가 제외 후)
  new: number; status: number; content: number;   // 신규 · 상태변경 · 내용수정
  absent: number; guarded: number; unchanged: number; // 재고차단 · 급감가드 보류 · 무변경
  excluded: number;                               // 시트에 출고불가로 적혀 있어 안 올린 것
  noPrice: number;                                // 대여료가 없는 행 — 실차번 재고는 올리되 손님 견적만 막는다
  skipped: number;                                // 중복·무효·신원없는 행
  duplicate: number; invalid: number;
  issues: string;
  statusDetail: string;                           // 실제 상태 전이 상위
  fieldDetail: string;                            // 실제 내용 변경 필드 상위
  note: string;
};

type DailySyncStatus = {
  enabled: boolean;
  schedule: string;
  lastRun: null | {
    run_id?: string;
    status?: 'running' | 'blocked' | 'completed' | 'failed' | 'dry_run';
    started_at?: number;
    finished_at?: number;
    block_reason?: string;
    error?: string;
    counts?: {
      created?: number;
      updated?: number;
      absentBlocked?: number;
      imported?: number;
    };
  };
};

type IronRentcarPreview = {
  source: string;
  authority: string;
  providerCode: string;
  fetchedAt: number;
  revision: string;
  complete: boolean;
  catalog: {
    listings: number;
    active: number;
    sold: number;
    newCount: number;
    usedCount: number;
    errors: string[];
  };
  reconciliation: {
    matched: number;
    patchCandidates: number;
    unchanged: number;
    createCandidates: number;
    ignoredSoldNew: number;
    webAbsentErp: number;
    absentBlockCandidates: number;
    protectedErpOnly: number;
    alreadyUnavailableErpOnly: number;
    duplicatePlateGroups: number;
    blocked: number;
    candidateOperations: number;
    executableOperations: number;
  };
  candidates: {
    patches: Array<{ key: string; fields: string[]; vehicleStatus?: string }>;
    creates: Array<{ key: string; vehicleStatus?: string; sourceUrl?: string }>;
    absentBlocks: Array<{ key: string; fields: string[]; vehicleStatus?: string }>;
  };
};

/**
 * 검증용 재고 스냅샷 — 관리자는 **서버 투영**을, 그 외에는 기존 클라이언트 경로를 쓴다.
 *
 * 브라우저가 `v4/products` 전량(실측 6,128건 · 약 8MB)을 RTDB 로 직접 읽던 게
 * 「검증 중…」 영구 고착의 뿌리였다 — 클라이언트 `get()` 에는 타임아웃이 없다.
 * 서버로 옮기면 평범한 `fetch` 가 되어 상한을 걸 수 있고, 늦으면 «왜»가 화면에 뜬다.
 * erp3 도 이 대조를 브라우저에서 하지 않았다.
 *
 * ★`listSheetReconcileState` 자체는 **건드리지 않는다.** 그 함수는 톰스톤 되살림의
 *   CAS(`expected`)로도 쓰이는데(sheet-merge.ts:315 → :435-459), 투영 레코드를 거기 흘리면
 *   `productPatchPreconditionMatches` 가 필드 누락으로 전건 실패해 되살림이 죽는다.
 *   그래서 «읽고 판정만 하는» 이 자리에서만 갈아탄다.
 *
 * 관리자가 아니면(공급사도 /inventory 에서 이 화면을 쓴다) 기존 경로 그대로다 —
 * 새 API 가 관리자 전용이기 때문이다. 공급사 쪽 8MB 는 남은 숙제로 둔다.
 */
async function loadReconcileState(
  companyId: string,
  isAdmin: boolean,
): Promise<{ active: EntityRecord[]; deleted: EntityRecord[] }> {
  const user = isAdmin ? getAuthClient()?.currentUser : null;
  if (!user) return listSheetReconcileState(companyId, true);
  let response: Response;
  try {
    response = await fetch(`/api/inventory/reconcile-state?company=${encodeURIComponent(companyId)}`, {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(RECONCILE_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as Error)?.name;
    throw new Error(name === 'TimeoutError' || name === 'AbortError'
      ? `ERP 재고 조회 ${RECONCILE_FETCH_TIMEOUT_MS / 1000}초 초과 — 다시 시도하세요`
      : `ERP 재고 조회 실패 — ${String((error as Error)?.message || error)}`);
  }
  const body = await response.json().catch(() => ({})) as {
    active?: EntityRecord[];
    deleted?: EntityRecord[];
    complete?: boolean;
    error?: string;
    detail?: string;
  };
  // 부분 결과를 «완전»으로 받아들이지 않는다 — strict 계약이 여기서도 그대로다.
  if (!response.ok || body.complete !== true || !Array.isArray(body.active) || !Array.isArray(body.deleted)) {
    throw new Error(`ERP 재고·삭제 이력 조회 불완전 — ${body.detail || body.error || `HTTP ${response.status}`}`);
  }
  return { active: body.active, deleted: body.deleted };
}

async function fetchSheetConflictResolutions(): Promise<SheetConflictResolution[]> {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('로그인 확인 필요');
  const response = await fetch('/api/sheet/conflict-resolutions', {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({})) as {
    resolutions?: SheetConflictResolution[];
    error?: string;
  };
  if (!response.ok) throw new Error(body.error || `승인 원장 확인 실패 ${response.status}`);
  return Array.isArray(body.resolutions) ? body.resolutions : [];
}

async function fetchSheetConflictDecisions(): Promise<SheetConflictDecision[]> {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('로그인 확인 필요');
  const response = await fetch('/api/sheet/conflict-decisions', {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({})) as {
    decisions?: SheetConflictDecision[];
    error?: string;
  };
  if (!response.ok) throw new Error(body.error || `소유권·삭제 결정 조회 실패 ${response.status}`);
  return Array.isArray(body.decisions) ? body.decisions : [];
}

async function fetchSheetIdentityDecisions(): Promise<SheetIdentityDecision[]> {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('로그인 확인 필요');
  const response = await fetch('/api/sheet/identity-decisions', {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({})) as {
    decisions?: SheetIdentityDecision[];
    error?: string;
  };
  if (!response.ok) throw new Error(body.error || `신원 결정 조회 실패 ${response.status}`);
  return Array.isArray(body.decisions) ? body.decisions : [];
}

const SHEET_FIELD_LABEL: Record<string, string> = {
  price: '가격', maker: '제조사', model: '모델', sub_model: '세부모델', variant: '파워트레인',
  trim_name: '트림', trim_extra: '추가표기', year: '연식', fuel_type: '연료', engine_cc: '배기량',
  mileage: '주행거리', ext_color: '외장색', int_color: '내장색', options: '옵션', photo_link: '사진',
  product_type: '상품구분', partner_memo: '공급사메모', status_label_raw: '원문상태',
  _snap_confidence: '매칭신뢰', _needs_master_review: '검수필요', _snapped: '마스터변환',
};

function changeDetail(diff: SheetDiffSummary): { statusDetail: string; fieldDetail: string } {
  const statusDetail = sheetStatusTransitionCounts(diff)
    .slice(0, 3)
    .map((x) => `${x.label} ${x.count}`)
    .join(' · ');
  const fieldDetail = sheetChangedFieldCounts(diff)
    .slice(0, 4)
    .map((x) => `${SHEET_FIELD_LABEL[x.field] || x.field} ${x.count}`)
    .join(' · ');
  return { statusDetail, fieldDetail };
}

async function fetchAdminSheetTable(
  url: string,
  gid?: string,
  options: SheetTableFetchOptions = {},
): Promise<string[][]> {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('관리자 로그인 세션이 필요합니다');
  return fetchSheetTable(url, gid, {
    ...options,
    authorization: await user.getIdToken(),
  });
}

async function fetchAdminSupplierSheet(
  url: string,
  partner: EntityRecord,
): Promise<SupplierSheetRead> {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('관리자 로그인 세션이 필요합니다');
  return fetchSupplierSheet(url, partner, { authorization: await user.getIdToken() });
}

type ServerSheetSyncResult = {
  ok?: boolean;
  status?: string;
  blockReason?: string;
  counts?: { created?: number; updated?: number; imported?: number; absentBlocked?: number };
  notes?: string[];
};

async function runCanonicalServerSync(
  providerCodes: string[] = [],
  dryRun = false,
): Promise<ServerSheetSyncResult> {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('관리자 로그인 세션이 필요합니다');
  const response = await fetch(`/api/sheet/sync-daily${dryRun ? '?dry_run=1' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerCodes }),
    cache: 'no-store',
    signal: AbortSignal.timeout(300_000),
  });
  const body = await response.json().catch(() => ({})) as ServerSheetSyncResult & { error?: string };
  if (!response.ok || !body.ok) throw new Error(body.blockReason || body.error || `공급사 연동 실패 (${response.status})`);
  return body;
}

/**
 * 공급사 상품 연동.
 *
 * `compact` — **재고관리에서 쓰는 모드.** 버튼 둘(검증·반영)과 한 줄 요약만 남긴다.
 * 매일 하는 일은 «검증하고 이상 없으면 반영»이 전부라, 공급사별 표·충돌 리포트·TSV 복사까지
 * 재고 화면에 펼치면 정작 눌러야 할 버튼이 스크롤 밖으로 밀린다.
 * 자세히 볼 일(어느 공급사가 왜 막혔는지·충돌 원문)은 개발도구에서 본다 — 같은 컴포넌트다.
 */
export function SheetSync({ co, onImported, compact = false }: {
  co: string;
  onImported: (result?: { salesSheetPublished?: boolean }) => void;
  compact?: boolean;
}) {
  const role = getRole();
  const isAdmin = role === 'admin';
  const authReady = useAuthReady();
  const [tab, setTab] = useState<'sheet' | 'excel'>('sheet');
  const [url, setUrl] = useState('');
  const [gid, setGid] = useState('');
  const [headerRow, setHeaderRow] = useState('0');
  const [adapterId, setAdapterId] = useState<SheetAdapterId>('generic');
  const [prov, setProv] = useState(isAdmin ? '' : (actor('provider').code || ''));
  const [paste, setPaste] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<MappingProfile>({});
  const [mappingHeaders, setMappingHeaders] = useState<MappingHeaderSignature | undefined>();
  const [depositRule, setDepositRule] = useState<DepositRule>('');
  const [mappingReloadRequired, setMappingReloadRequired] = useState(false);
  /** 오토플러스 2탭 병합 유입 — table 미리보기 대신 이 배열 사용 */
  const [mergedProducts, setMergedProducts] = useState<EntityRecord[] | null>(null);
  const [mergedDiagnostics, setMergedDiagnostics] = useState<AutoplusImportResult | null>(null);
  const [diffBanner, setDiffBanner] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * 행별 「검증 중…」표시 — 예전엔 busy 하나만 봐서 손오공 한 곳만 눌러도
   * 표의 모든 「데이터 검증」이 검증 중으로 바뀌었다.
   * null = 검증 안 함 · 'all' = 전체 · string[] = 그 공급사 코드만.
   */
  const [validatingCodes, setValidatingCodes] = useState<string[] | 'all' | null>(null);
  const [sheetAction, setSheetAction] = useState<'validate' | 'sync' | null>(null);
  const [master, setMaster] = useState<MasterEntry[] | null>(() => peekVehicleMaster());
  const [roster, setRoster] = useState<PartnerSheetRow[]>([]);
  const [rosterError, setRosterError] = useState('');
  const [dailyStatus, setDailyStatus] = useState<DailySyncStatus | null>(null);
  const [dailyStatusError, setDailyStatusError] = useState('');
  const [dailyStatusLoading, setDailyStatusLoading] = useState(false);
  const [ironPreview, setIronPreview] = useState<IronRentcarPreview | null>(null);
  const [ironPreviewLoading, setIronPreviewLoading] = useState(false);
  const [ironApplying, setIronApplying] = useState(false);
  const [ironMessage, setIronMessage] = useState('');
  const [decisionQueueOpen, setDecisionQueueOpen] = useState(false);
  const [identityReviewOpen, setIdentityReviewOpen] = useState(false);
  const [bulkLog, setBulkLog] = useState<string>('');
  const [partnerHint, setPartnerHint] = useState('');
  const [pending, setPending] = useState<{
    fetched: Awaited<ReturnType<typeof fetchAllPartnerSheets>>;
    banners: string[];
    totals: {
      new: number; status: number; content: number; absent: number;
      guarded: number; unchanged: number; excludedCount: number; noPriceCount: number;
      skippedCount: number; duplicateCount: number; invalidCount: number; sourceRowCount: number;
    };
    /** 공급사별 수정범위 — 합계만 보면 어느 업체가 문제인지 안 보인다. */
    perPartner: PartnerDiffRow[];
    prevForGuard: Map<string, number>;
    existingRevision: string;
    rosterRevision: string;
    existingConflictReason: string;
    existingConflictDetail: string;
    existingConflictReport: string;
    existingConflictRows: SheetConflictReportRow[];
    priceResolutionCandidates: SheetConflictResolutionInput[];
    approvedPriceFingerprints: string[];
    conflictDecisions: SheetConflictDecision[];
    identityDecisions: SheetIdentityDecision[];
    decisionRecords: EntityRecord[];
    decisionReferences: {
      contracts: EntityRecord[];
      rooms: EntityRecord[];
      quotes: EntityRecord[];
    };
    identityConflictReview: SheetIdentityConflictReview;
    resolvedPriceCount: number;
    protectedPriceCount: number;
    at: number;
  } | null>(null);

  const refreshRoster = useCallback(async () => {
    if (!isAdmin || !authReady) return;
    try {
      // 관리자 검증 대상은 캐시·부분 merge 결과를 정상 roster로 승인하면 안 된다.
      // 특히 부분 read가 []로 축약되면 검증 버튼까지 사라져 재시도할 길이 막힌다.
      setRoster(await listSheetPartners(co, true));
      setRosterError('');
    } catch (error) {
      setRoster([]);
      setRosterError(String((error as Error).message || error));
    }
  }, [authReady, co, isAdmin]);

  const refreshDailyStatus = useCallback(async () => {
    if (!isAdmin || !authReady) return;
    setDailyStatusLoading(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인 확인 필요');
      const response = await fetch('/api/sheet/sync-status', {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => ({})) as DailySyncStatus & { error?: string };
      if (!response.ok) {
        const detail = body.error === 'server auth unavailable'
          ? '서버 인증 설정 필요'
          : (body.error || `HTTP ${response.status}`);
        throw new Error(`Google Sheet 자동연동 상태 조회 실패 · ${detail}`);
      }
      setDailyStatus(body);
      setDailyStatusError('');
    } catch (error) {
      setDailyStatus(null);
      setDailyStatusError(String((error as Error).message || error));
    } finally {
      setDailyStatusLoading(false);
    }
  }, [authReady, isAdmin]);

  // roster 바뀌면 검증 스냅샷 무효
  useEffect(() => { setPending(null); }, [roster]);

  /**
   * 공급사 설정 단건도 일괄 검증과 같은 strict fresh source에서 찾는다.
   * tolerant get()은 live/overlay 일부 read 실패를 "설정 없음"으로 축약할 수 있어,
   * 저장 매핑·보증금 규칙을 잃은 자동매핑으로 실행하거나 다시 저장하게 만들 수 있다.
   */
  const readPartnerConfig = useCallback(async (code: string): Promise<EntityRecord | null> => {
    const target = code.trim();
    if (!target) return null;
    const rows = await listSheetPartnerRecords(co, true);
    return rows.find((row) => String(row.partner_code || row._key || '').trim() === target) || null;
  }, [co]);

  /** 공급사: partner에 저장된 시트 URL·어댑터·헤더·매핑 자동 채움. */
  const hydrateFromPartner = useCallback(async (code: string) => {
    if (!code.trim()) return;
    // 계정/회사 전환 뒤 이전 공급사의 설정이 잠시라도 남지 않게 먼저 비운다.
    setUrl(''); setGid(''); setHeaderRow('0'); setAdapterId('generic'); setDepositRule('');
    setTable(null); setMapping({}); setMappingHeaders(undefined); setMergedProducts(null); setMergedDiagnostics(null);
    setMappingReloadRequired(false); setDiffBanner(''); setBulkLog('');
    try {
      const p = await readPartnerConfig(code);
      if (!p) {
        setPartnerHint(`파트너 ${code} 없음 — URL을 직접 넣고「매핑·URL 저장」하면 다음에 자동 채움`);
        return;
      }
      if (isWebInventoryPartner(p)) {
        setUrl('');
        setPartnerHint(`${String(p.name || code)} 홈페이지 연동 사용 중 — Google Sheet 입고 비활성`);
        return;
      }
      const savedUrl = String(p.sheet_url || '').trim();
      const savedGid = String(p.sheet_tab || '').trim();
      const savedHeader = p.header_row != null && p.header_row !== '' ? String(p.header_row) : '';
      const savedAdapter = resolveAdapter(p).id;
      if (savedUrl && !/^https:\/\/docs\.google\.com\/…/.test(savedUrl)) {
        setUrl(savedUrl);
        setPartnerHint(`${String(p.name || code)} 시트 불러옴`);
      } else {
        // 구글시트 URL은 링크 자체가 접근권한일 수 있다. role 공용 localStorage에 캐시하면
        // 같은 브라우저에서 공급사 A 로그아웃→B 로그인 시 A의 URL이 B에게 노출된다.
        setUrl('');
        setPartnerHint(savedUrl
          ? '시드 placeholder URL — 실제 구글시트 주소를 넣고「매핑·URL 저장」하세요'
          : '등록된 시트 없음 — URL 입력 후「매핑·URL 저장」하면 다음에 자동');
      }
      if (savedGid) setGid(savedGid);
      if (savedHeader) setHeaderRow(savedHeader);
      setAdapterId(savedAdapter);
      setDepositRule(parseDepositRule(p.deposit_rule));
    } catch (error) {
      setPartnerHint(`파트너 시트 설정을 읽지 못했습니다 — ${String((error as Error).message || error)}`);
    }
  }, [readPartnerConfig]);

  useEffect(() => {
    loadVehicleMaster()
      .then((entries) => setMaster(entries))
      .catch(() => {
        setMaster([]);
        toast('차종마스터 로드 실패 — 변환·입고 불가', 'error');
      });
  }, []);
  useEffect(() => { refreshRoster(); }, [refreshRoster]);
  useEffect(() => { void refreshDailyStatus(); }, [refreshDailyStatus]);
  useEffect(() => {
    if (!isAdmin && prov) void hydrateFromPartner(prov);
  }, [isAdmin, prov, hydrateFromPartner]);

  const clear = () => {
    setTable(null); setMapping({}); setMappingHeaders(undefined);
    // 보증금 규칙은 partner 설정이다. URL·gid·붙여넣기 원문을 바꿔 preview를
    // 무효화해도 실제 저장 설정 표시까지 빈값으로 되돌리면 실행 규칙과 화면이 어긋난다.
    setMappingReloadRequired(false);
    setBulkLog(''); setMergedProducts(null); setMergedDiagnostics(null); setDiffBanner('');
  };
  const prepared = (raw: string[][]) => resolveAdapter(adapterId).prepareTable(raw, { headerRow: Math.max(0, Number(headerRow) || 0) });
  const masterReady = !!(master && master.length);

  const loadSheet = async () => {
    if (!url.trim()) { toast('구글시트 URL을 입력하세요', 'error'); return; }
    if (!masterReady && adapterId === 'autoplus') {
      toast('차종마스터 로드 후 오토플러스 2탭을 불러올 수 있습니다', 'error');
      return;
    }
    // 소스 설정을 바꾼 후 fetch가 실패해도 이전 시트를 저장하지 못하게 먼저 무효화한다.
    setBusy(true); setBulkLog(''); setTable(null); setMapping({}); setMappingHeaders(undefined);
    setMappingReloadRequired(false); setMergedProducts(null); setMergedDiagnostics(null); setDiffBanner('');
    try {
      if (adapterId === 'autoplus') {
        let savedProfile: Awaited<ReturnType<typeof loadProfile>>;
        try {
          savedProfile = await loadProfile(prov);
        } catch (error) {
          // 깨진 JSON/enum 때문에 profile 자체를 못 읽어도 원본 본탭은 보여줘야
          // 운영자가 매핑·규칙을 다시 저장해 복구할 수 있다. 이 상태에서는 동기화 금지.
          const recoveryRaw = await fetchAdminSheetTable(url.trim(), AUTOPLUS_GID_MAIN, { visibleRowsOnly: true });
          const recoveryTable = prepared(recoveryRaw);
          if (recoveryTable.length < 2) throw error;
          const recoveryMapping = autoMapHeaders(recoveryTable[0]);
          setTable(recoveryTable);
          setMapping(recoveryMapping);
          setMappingHeaders(buildMappingHeaderSignature(recoveryTable[0], recoveryMapping));
          setDepositRule('');
          setMappingReloadRequired(true);
          setBulkLog(`시트 설정 오류 — 매핑과 보증금 규칙을 확인·저장한 뒤 다시 불러오세요. (${String((error as Error).message || error)})`);
          toast('저장된 시트 설정이 깨져 복구 모드로 열었습니다. 저장 후 다시 불러오세요.', 'info');
          return;
        }
        const activeMapping = Object.keys(mapping).length ? mapping : savedProfile?.mapping;
        const activeHeaders = Object.keys(mapping).length ? mappingHeaders : savedProfile?.headers;
        const activeDepositRule = savedProfile?.depositRule ?? depositRule;
        let res: AutoplusImportResult;
        try {
          res = await importAutoplusMerged({
            url: url.trim(),
            providerCode: prov.trim() || 'preview',
            entries: master!,
            profile: activeMapping,
            profileHeaders: activeHeaders,
            depositRule: activeDepositRule,
            fetchTable: fetchAdminSheetTable,
            headerRow: Math.max(0, Number(headerRow) || 0),
          });
        } catch (error) {
          const message = String((error as Error).message || error);
          if (!/매핑을 다시 저장|헤더 (?:변경|이동|검증)/.test(message)) throw error;
          const driftRaw = await fetchAdminSheetTable(url.trim(), AUTOPLUS_GID_MAIN, { visibleRowsOnly: true });
          const driftTable = prepared(driftRaw);
          if (driftTable.length < 2) throw error;
          const remap = autoMapHeaders(driftTable[0]);
          setTable(driftTable);
          setMapping(remap);
          setMappingHeaders(buildMappingHeaderSignature(driftTable[0], remap));
          setDepositRule(activeDepositRule);
          setMappingReloadRequired(true);
          setBulkLog(`헤더 변경 감지 — 자동 재매핑을 확인·저장한 뒤 2탭을 다시 불러오세요. (${message})`);
          toast('오토플러스 헤더가 바뀌어 저장은 차단했습니다. 재매핑을 확인하세요.', 'info');
          return;
        }
        // 매핑 UI용 = 본탭 prepare 결과(라벨 적용됨)
        const rawMain = await fetchAdminSheetTable(url.trim(), AUTOPLUS_GID_MAIN, { visibleRowsOnly: true });
        const t = prepared(rawMain);
        setTable(t.length >= 2 ? t : [['차량번호'], ...res.products.slice(0, 1).map((p) => [String(p.car_number || '')])]);
        const nextMapping = activeMapping || autoMapHeaders(t[0] || ['차량번호']);
        setMapping(nextMapping);
        setMappingHeaders(activeHeaders || buildMappingHeaderSignature(t[0] || [], nextMapping));
        setDepositRule(activeDepositRule);
        setMergedProducts(res.products);
        setMergedDiagnostics(res);
        setMappingReloadRequired(false);
        setBulkLog(`오토플러스 2탭 — 본 ${res.mainN}+프로모 ${res.promoOnlyN}=${res.imported} · 재고(출고가능+보류) ${res.stock}`);
      } else {
        const gidTokens = gid.trim() ? gid.trim().split(/[,\s|]+/).filter(Boolean) : [];
        if (gidTokens.some((token) => !/^\d+$/.test(token))) {
          throw new Error('gid는 숫자 탭 ID만 입력하세요');
        }
        if (gidTokens.length > 1) {
          throw new Error('다중 탭 시트는 관리자 일괄 검증에서만 동일 기준으로 병합합니다');
        }
        const raw = await fetchSheetTable(url.trim(), gid.trim() || undefined);
        const t = prepared(raw);
        if (t.length < 2) { toast('헤더 + 데이터 행이 필요합니다(헤더 행 번호 확인)', 'error'); return; }
        setTable(t);
        const saved = await loadProfile(prov);
        let nextMapping = saved?.mapping || autoMapHeaders(t[0]);
        if (saved?.mapping) {
          try {
            previewSupplierTable(t, {
              providerCode: prov.trim() || 'preview', master: master!,
              profile: saved.mapping, profileHeaders: saved.headers,
              depositRule: saved.depositRule,
            });
          } catch (error) {
            const message = String((error as Error).message || error);
            if (!/매핑을 다시 저장|헤더 (?:변경|이동|검증)/.test(message)) throw error;
            nextMapping = autoMapHeaders(t[0]);
            setMappingReloadRequired(true);
            setBulkLog(`헤더 변경 감지 — 자동 재매핑을 전체 확인·저장한 뒤 다시 불러오세요. (${message})`);
          }
        }
        setMapping(nextMapping);
        setMappingHeaders(buildMappingHeaderSignature(t[0], nextMapping));
        setDepositRule(saved?.depositRule || '');
        if (!saved?.mapping) setMappingReloadRequired(false);
      }
    } catch (e) { toast('시트 불러오기 실패: ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };
  const loadExcel = async () => {
    if (!paste.trim()) { toast('엑셀 내용을 붙여넣으세요', 'error'); return; }
    setTable(null); setMapping({}); setMappingHeaders(undefined);
    setMappingReloadRequired(false); setBulkLog('');
    setMergedProducts(null); setMergedDiagnostics(null); setDiffBanner('');
    try {
      const t = prepared(parseDelimited(paste, '\t'));
      if (t.length < 2) throw new Error('헤더 + 데이터 행이 필요합니다');
      const saved = await loadProfile(prov);
      let nextMapping = saved?.mapping || autoMapHeaders(t[0]);
      if (saved?.mapping) {
        try {
          previewSupplierTable(t, {
            providerCode: prov.trim() || 'preview', master: master!,
            profile: saved.mapping, profileHeaders: saved.headers,
            depositRule: saved.depositRule,
          });
        } catch (error) {
          const message = String((error as Error).message || error);
          if (!/매핑을 다시 저장|헤더 (?:변경|이동|검증)/.test(message)) throw error;
          // 저장 index가 현재 붙여넣기 헤더와 다르면 옛 index를 새 signature로
          // 재승인하지 않는다. 현재 헤더 자동매핑에서 다시 시작하고 저장→재로드를 강제한다.
          nextMapping = autoMapHeaders(t[0]);
          setMappingReloadRequired(true);
          setBulkLog(`헤더 변경 감지 — 자동 재매핑을 전체 확인·저장한 뒤 엑셀을 다시 불러오세요. (${message})`);
        }
      }
      setTable(t); setMapping(nextMapping);
      setMappingHeaders(buildMappingHeaderSignature(t[0], nextMapping));
      setDepositRule(saved?.depositRule || '');
      if (!saved?.mapping) setMappingReloadRequired(false);
    } catch (error) {
      toast('엑셀 불러오기 실패: ' + String((error as Error).message || error), 'error');
    }
  };
  const loadProfile = async (code: string): Promise<{
    mapping?: MappingProfile;
    headers?: MappingHeaderSignature;
    depositRule?: DepositRule;
  } | null> => {
    if (!code.trim()) return null;
    const p = await readPartnerConfig(code);
    const saved = parseMappingProfile(p?.mapping_profile);
    return p ? {
      mapping: saved,
      headers: parseMappingHeaderSignature(p?.mapping_header_signature),
      depositRule: parseDepositRule(p?.deposit_rule),
    } : null;
  };

  const previewState = useMemo(() => {
    try {
      if (mergedProducts && masterReady) {
        const { products, confirmed, review } = prepareMasterIngress(mergedProducts);
        const snap = { high: 0, medium: 0, low: 0, none: 0 };
        for (const p of mergedProducts) {
          const c = String(p._snap_confidence || '');
          if (c === 'high' || c === 'medium' || c === 'low') snap[c]++;
          else snap.none++;
        }
        return {
          value: {
            products,
            imported: mergedProducts.length,
            confirmed,
            review,
            skipped: mergedDiagnostics?.skipped || 0,
            duplicateCount: mergedDiagnostics?.duplicateCount || 0,
            blockingDuplicateCount: mergedDiagnostics?.blockingDuplicateCount || 0,
            invalidCount: mergedDiagnostics?.invalidCount || 0,
            issueSamples: mergedDiagnostics?.issueSamples || [],
            excludedCount: mergedDiagnostics?.excludedCount || 0,
            noPriceCount: mergedDiagnostics?.noPriceCount || 0,
            snap,
            mapping,
            total: mergedDiagnostics?.total || mergedProducts.length,
          },
          error: '',
        };
      }
      return {
        value: table && masterReady
          ? previewSupplierTable(table, {
              providerCode: prov.trim() || 'preview',
              master: master!,
              profile: Object.keys(mapping).length ? mapping : undefined,
              profileHeaders: mappingHeaders,
              depositRule,
            })
          : null,
        error: '',
      };
    } catch (error) {
      return { value: null, error: String((error as Error).message || error) };
    }
  }, [mergedProducts, mergedDiagnostics, table, mapping, mappingHeaders, depositRule, master, masterReady, prov]);
  const preview = previewState.value;

  /** 저장 전 diff 배너 — 유입 대비 기존 재고 */
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!preview?.products.length || !prov.trim()) {
        if (alive) setDiffBanner('');
        return;
      }
      try {
        const existing = await listProductsForSheetReconcile(co, true);
        const diff: SheetDiffSummary = summarizeSheetDiff({
          incoming: preview.products,
          existing,
          providerCode: prov.trim(),
        });
        const stock = countAutoplusStock(preview.products);
        if (alive) setDiffBanner(formatSheetDiffBanner(diff, stock));
      } catch {
        if (alive) setDiffBanner('');
      }
    };
    void run();
    return () => { alive = false; };
  }, [preview, prov, co]);

  const fieldForCol = (i: number) => Object.keys(mapping).find((f) => mapping[f] === i) || '';
  const setColField = (i: number, field: string) => {
    const next: MappingProfile = { ...mapping };
    for (const f of Object.keys(next)) if (next[f] === i) delete next[f];
    if (field) next[field] = i;
    setMapping(next);
    if (table?.[0]) setMappingHeaders(buildMappingHeaderSignature(table[0], next));
    if (mergedProducts) setMappingReloadRequired(true);
  };

  const saveMapping = async () => {
    if (!prov.trim()) { toast('공급사 코드를 지정해야 매핑을 저장합니다', 'error'); return; }
    setBusy(true);
    try {
      const checkedMapping = parseMappingProfile(mapping) || {};
      await getStore().update('partner', co, prov.trim(), {
        mapping_profile: JSON.stringify(checkedMapping),
        mapping_header_signature: JSON.stringify(buildMappingHeaderSignature(table?.[0] || [], checkedMapping)),
        sheet_url: url.trim() || null,
        sheet_tab: gid.trim() || null,
        header_row: Number(headerRow) || 0,
        adapter_id: adapterId,
        deposit_rule: depositRule || null,
      } as EntityRecord);
      toast(`매핑 저장됨 — ${prov.trim()}`, 'ok');
      await refreshRoster();
    } catch (e) { toast('매핑 저장 실패: ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };

  /** 차종마스터 틀로 변환 후 저장 — master-ingress SSOT. 저장 전 diff 확인. */
  const convertAndSave = async () => {
    if (!masterReady) { toast('차종마스터가 없습니다 — 변환 불가', 'error'); return; }
    if (!preview?.products.length) return;
    if (mappingReloadRequired) {
      toast('저장 중단 — 매핑·보증금 규칙을 저장한 뒤 시트를 다시 불러와 전체를 재검증하세요.', 'error');
      return;
    }
    if (!mergedProducts && !('car_number' in mapping)) { toast('차량번호 컬럼을 지정하세요', 'error'); return; }
    if (preview.products.some((product) => product.is_pending_plate)) {
      toast('저장 중단 — 번호미정 차량은 공급사 일괄 검증 경로에서 영구 임시번호를 부여해야 합니다.', 'error');
      return;
    }
    const providerCode = prov.trim();
    if (!providerCode) { toast('공급사 코드가 없어 저장할 수 없습니다', 'error'); return; }
    const singleFetched = {
      partnerCount: 1,
      rosterRevision: `manual:${providerCode}`,
      products: preview.products,
      lines: [{
        code: providerCode,
        label: providerCode,
        ok: true,
        sourceRowCount: Number(preview.total) || preview.products.length,
        imported: preview.products.length,
        excludedCount: Number(preview.excludedCount) || 0,
        noPriceCount: Number('noPriceCount' in preview ? preview.noPriceCount : 0) || 0,
        skippedCount: Number(preview.skipped) || 0,
        duplicateCount: Number(preview.duplicateCount) || 0,
        blockingDuplicateCount: Number('blockingDuplicateCount' in preview ? preview.blockingDuplicateCount : preview.duplicateCount) || 0,
        invalidCount: Number(preview.invalidCount) || 0,
        issueSamples: preview.issueSamples || [],
        message: '수동 업로드',
        products: preview.products,
      }],
    };
    const sourceBlock = sheetSyncCommitBlockReason(singleFetched);
    if (sourceBlock) {
      toast(`저장 중단 — ${sourceBlock}. 원본 시트를 정리하고 다시 불러오세요.`, 'error');
      return;
    }
    setBusy(true);
    try {
      const beforeState = await listSheetReconcileState(co, true);
      const beforeConflict = sheetSyncExistingConflictReason(
        findSheetSyncExistingConflicts(singleFetched, beforeState.active, beforeState.deleted),
      );
      if (beforeConflict) {
        toast(`저장 중단 — ${beforeConflict}. 관리자 일괄 검증에서 충돌을 먼저 정리하세요.`, 'error');
        return;
      }
      const beforeRevision = sheetReconcileStateRevision(beforeState);
      const ok = await confirmDialog({
        message: (diffBanner || `취합 ${preview.products.length}건`)
          + (preview.excludedCount > 0 ? `\n출고불가 제외 ${preview.excludedCount}` : '')
          + '\n\n차종 변환 후 재고에 저장할까요?\n(신규 soft-merge · 부재→출고불가는 관리자 일괄 연동에서만)',
      });
      if (!ok) return;
      const afterConfirmState = await listSheetReconcileState(co, true);
      if (sheetReconcileStateRevision(afterConfirmState) !== beforeRevision) {
        toast('저장 중단 — 확인 중 ERP 재고가 변경됐습니다. 다시 불러오세요.', 'error');
        return;
      }
      const afterConflict = sheetSyncExistingConflictReason(
        findSheetSyncExistingConflicts(singleFetched, afterConfirmState.active, afterConfirmState.deleted),
      );
      if (afterConflict) {
        toast(`저장 중단 — ${afterConflict}. 관리자 일괄 검증에서 충돌을 먼저 정리하세요.`, 'error');
        return;
      }
      const r = await commitSupplierProducts(co, preview.products, master!);
      toast(
        `변환 저장: 확정 ${r.confirmed} · 검수 ${r.review} · 신규 ${r.created} · 갱신 ${r.updated}`
          + (r.revived ? ` · 되살림 ${r.revived}` : ''),
        r.review ? 'info' : 'ok',
      );
      if (providerCode) {
        try { await getStore().update('partner', co, providerCode, { last_synced_at: Date.now() } as EntityRecord); } catch { /* best-effort */ }
      }
      clear(); await refreshRoster(); onImported();
    } catch (e) { toast('저장 실패: ' + String((e as Error).message || e), 'error'); } finally { setBusy(false); }
  };

  /** 관리자: 전체 시트 fetch+diff만(쓰기 없음). 스냅샷을 pending에 보관. */
  /**
   * 상품 검증 — 전체(인자 없음) 또는 공급사 하나(`onlyCodes`).
   *
   * 단건도 **같은 엔진**을 탄다. 대상만 좁힌다 — `fetchAllPartnerSheets` 안에 따로 filter 를
   * 두면 화면 목록과 어긋난다(주석에 남은 실제 사고: 목록 16곳인데 2곳만 가져갔다).
   * 그래서 여기서 fresh partner 스냅샷을 한 번 뜨고, 좁힌 것을 `deps.partnerRows` 로 넘긴다.
   * 대상 목록과 fetch 레코드가 같은 스냅샷에서 나온다는 원래 계약도 그대로 지켜진다.
   */
  const validateAll = async (onlyCodes?: string[]) => {
    if (busy) return;
    if (isAdmin) {
      setBusy(true);
      setSheetAction('validate');
      setValidatingCodes(onlyCodes?.length ? onlyCodes : 'all');
      setPending(null);
      try {
        const result = await runCanonicalServerSync(onlyCodes || [], true);
        setBulkLog((result.notes || []).join('\n'));
        toast(
          `영업자 시트 검증 완료 · 유입 ${result.counts?.imported || 0}대 · 신규 ${result.counts?.created || 0}대 · 수정 ${result.counts?.updated || 0}대`,
          'ok',
        );
        await refreshDailyStatus();
      } catch (error) {
        toast(`영업자 시트 검증 실패 · ${String((error as Error).message || error)}`, 'error');
      } finally {
        setBusy(false);
        setSheetAction(null);
        setValidatingCodes(null);
      }
      return;
    }
    if (!masterReady) { toast('차종마스터 로드 실패 — 검증 불가', 'error'); return; }
    if (rosterError) { toast(`시트 설정 오류 — ${rosterError}`, 'error'); return; }
    if (!roster.length) { toast('시트 URL이 등록된 공급사가 없습니다 — 회원·파트너에서 공급사 원본을 설정하세요', 'info'); return; }
    setBusy(true);
    setSheetAction('validate');
    setValidatingCodes(onlyCodes?.length ? onlyCodes : 'all');
    setBulkLog('');
    setPending(null);
    try {
      const freshPartners = await listSheetPartnerRecords(co, true);
      const scoped = onlyCodes?.length
        ? freshPartners.filter((r) => onlyCodes.includes(String(r.partner_code || r._key || '')))
        : freshPartners;
      if (onlyCodes?.length && !scoped.length) {
        toast(`${onlyCodes.join(', ')} 공급사 원본을 찾지 못했습니다 — 설정 다시 읽기`, 'error');
        setBusy(false);
        return;
      }
      const fetchedRaw = await fetchAllPartnerSheets(co, master!, {
        fetchTable: fetchAdminSheetTable,
        fetchSupplierSheet: fetchAdminSupplierSheet,
        partnerRows: scoped,
      });
      const [
        reconcileState, partnerRows, contracts, rooms, quotes,
        conflictResolutions, conflictDecisions, identityDecisions,
      ] = await Promise.all([
        listSheetReconcileState(co, true), // TODO 투영 전환은 revision 을 서버에서 받도록 고친 뒤
        Promise.resolve(freshPartners),
        getStore().list('contract', co).catch(() => []),
        getStore().list('room', co).catch(() => []),
        getStore().list('quote', co).catch(() => []),
        fetchSheetConflictResolutions(),
        fetchSheetConflictDecisions(),
        fetchSheetIdentityDecisions(),
      ]);
      const existing = reconcileState.active;
      const deleted = reconcileState.deleted;
      const fetched = {
        ...fetchedRaw,
        reconcileRevision: sheetReconcileStateRevision(reconcileState),
      };
      const prevForGuard = buildPrevForGuard(partnerRows, existing);
      const rawExistingConflicts = findSheetSyncExistingConflicts(fetched, existing, deleted);
      // 충돌 리포트를 «차단 계산보다 먼저» 만든다 — 어느 건이 실제로 가격을 바꾸는지
      // 알아야 무변화 건을 승인 없이 통과시킬 수 있다.
      const existingConflictRows = buildSheetConflictReportRows({
        conflicts: rawExistingConflicts,
        existing,
        deleted,
        incoming: fetched.products,
        contracts,
        providerCodes: fetched.lines.map((line) => line.code),
      });
      const reportByRaw = new Map(existingConflictRows.map((row) => [row.raw, row]));
      /** 반영하면 손님에게 나가는 금액이 바뀌는 건만 승인을 받는다.
       *  ★판정식을 여기 다시 쓰지 않는다 — 네 곳(미리보기·재검증·커밋 경계·일일 자동연동)이
       *   같은 함수를 써야 한 번 고친 게 계속 유지된다. 이미 만든 행은 그대로 재사용한다. */
      const priceChangesValue = priceChangesValueFromRows(existingConflictRows);
      const resolutionResult = applySheetConflictResolutions({
        conflicts: rawExistingConflicts,
        resolutions: conflictResolutions,
        existing,
        contracts,
        priceChangesValue,
      });
      const existingConflicts = resolutionResult.conflicts;
      const existingConflictReason = sheetSyncExistingConflictReason(existingConflicts);
      const existingConflictDetail = [
        existingConflicts.activeTwins.length
          ? `중복차번: ${existingConflicts.activeTwins.slice(0, 4).join(' / ')}` : '',
        existingConflicts.crossProviderPlateConflicts.length
          ? `공급사 간 차번 소유 충돌: ${existingConflicts.crossProviderPlateConflicts.slice(0, 8).join(', ')}` : '',
        existingConflicts.deletedCollisions.length
          ? `삭제 재등장: ${existingConflicts.deletedCollisions.slice(0, 8).join(', ')}` : '',
        existingConflicts.unownedDeletedMatches.length
          ? `공급사 미확정 삭제이력: ${existingConflicts.unownedDeletedMatches.slice(0, 8).join(', ')}` : '',
        existingConflicts.manualReactivations.length
          ? `수기 출고불가: ${existingConflicts.manualReactivations.slice(0, 8).join(', ')}` : '',
        existingConflicts.manualHoldsPreserved.length
          ? `수기 출고불가 유지: ${existingConflicts.manualHoldsPreserved.slice(0, 8).join(', ')}` : '',
        existingConflicts.pendingIdentityTransitions.length
          ? `임시→실차번: ${existingConflicts.pendingIdentityTransitions.slice(0, 8).join(', ')}` : '',
        existingConflicts.pendingIdentityDrifts.length
          ? `번호미정 식별변경: ${existingConflicts.pendingIdentityDrifts.slice(0, 8).join(', ')}` : '',
        existingConflicts.pendingSignatureConflicts.length
          ? `임시번호 신원불일치: ${existingConflicts.pendingSignatureConflicts.slice(0, 8).join(', ')}` : '',
        existingConflicts.missingPricePeriods.length
          ? `가격기간 누락: ${existingConflicts.missingPricePeriods.slice(0, 8).join(', ')}` : '',
        existingConflicts.unownedLegacyMatches.length
          ? `공급사 미확정: ${existingConflicts.unownedLegacyMatches.slice(0, 8).join(', ')}` : '',
      ].filter(Boolean).join('\n');
      const existingConflictReport = sheetConflictReportTsv(existingConflictRows);
      const identityConflictReview = planSheetIdentityConflictReview({
        conflicts: rawExistingConflicts,
        existing,
        deleted,
        incoming: fetched.products,
        contracts,
        providerCodes: fetched.lines.map((line) => line.code),
      });
      // 승인 후보 = 실제로 가격이 바뀌는 것만. 무변화 건은 위 차단 계산에서 이미 통과됐다.
      const priceResolutionCandidates = rawExistingConflicts.missingPricePeriods
        .filter((raw) => !isPriceConflictProtected(raw, existing, contracts))
        .filter((raw) => priceChangesValue(raw))
        .map((raw): SheetConflictResolutionInput => {
          const report = reportByRaw.get(raw);
          return {
            fingerprint: sheetConflictFingerprint(PRICE_PERIOD_CONFLICT, raw),
            category: PRICE_PERIOD_CONFLICT,
            decision: KEEP_EXISTING_PRICES,
            raw,
            provider: report?.provider,
            productKey: report?.productKey,
            storageKey: report?.storageKey,
          };
        });
      const activeApproved = new Set(conflictResolutions
        .filter((item) => item.status === 'approved')
        .map((item) => item.fingerprint));
      const approvedPriceFingerprints = priceResolutionCandidates
        .map((item) => item.fingerprint)
        .filter((fingerprint) => activeApproved.has(fingerprint));
      const protectedPriceCount = rawExistingConflicts.missingPricePeriods
        .filter((raw) => isPriceConflictProtected(raw, existing, contracts)).length;
      const banners: string[] = [];
      const perPartner: PartnerDiffRow[] = [];
      const totals = {
        new: 0, status: 0, content: 0, absent: 0, guarded: 0, unchanged: 0,
        excludedCount: 0, noPriceCount: 0, skippedCount: 0,
        duplicateCount: 0, invalidCount: 0, sourceRowCount: 0,
      };
      for (const line of fetched.lines) {
        const readiness = partnerSourceReadiness(line);
        const re = line.excludedCount || 0;
        const np = line.noPriceCount || 0;
        const sk = line.skippedCount || 0;
        totals.noPriceCount += np;
        totals.excludedCount += re;
        totals.skippedCount += sk;
        totals.duplicateCount += line.duplicateCount || 0;
        totals.invalidCount += line.invalidCount || 0;
        totals.sourceRowCount += sheetSourceRowsRead(line);
        const base = {
          code: line.code, label: line.label, sheet: line.imported, new: 0, status: 0, content: 0,
          readiness: readiness.status, readinessReason: readiness.reasons.join(' · '),
          absent: 0, guarded: 0, unchanged: 0, excluded: re, noPrice: np, skipped: sk,
          duplicate: line.duplicateCount || 0, invalid: line.invalidCount || 0,
          issues: line.issueSamples.slice(0, 4).join(' · '),
          statusDetail: '', fieldDetail: '',
        };
        if (!line.ok) { perPartner.push({ ...base, ok: false, note: line.message }); continue; }
        const diff = summarizeSheetDiff({
          incoming: line.products,
          existing,
          providerCode: line.code,
        });
        const stock = countAutoplusStock(line.products);
        banners.push(`${line.label}: ${formatSheetDiffBanner(diff, stock)}`);
        const detail = changeDetail(diff);
        const rowsRead = line.sourceRowCount || line.imported + re + np + sk;
        const absentGate = shouldReconcileAbsent(rowsRead, prevForGuard.get(line.code) || 0);
        const guarded = absentGate.ok ? 0 : diff.absent;
        const note = [
          line.products.length ? '' : '올림 0대 — 기존 비게시 범위 확인',
          guarded ? `급감가드로 재고차단 ${guarded}대 보류` : '',
        ].filter(Boolean).join(' · ');
        perPartner.push({
          ...base, ok: true, note,
          sheet: line.products.length,
          new: diff.new, status: diff.status, content: diff.content,
          absent: absentGate.ok ? diff.absent : 0, guarded, unchanged: diff.unchanged,
          ...detail,
        });
        totals.new += diff.new;
        totals.status += diff.status;
        totals.content += diff.content;
        totals.absent += absentGate.ok ? diff.absent : 0;
        totals.guarded += guarded;
        totals.unchanged += diff.unchanged;
      }
      // 바뀌는 게 많은 순 — 검수할 곳부터 위로.
      perPartner.sort((a, b) => {
        const risk = (row: PartnerDiffRow) => (
          (row.ok ? 0 : 1_000_000)
          + row.guarded * 10_000
          + row.invalid * 1_000
          + row.noPrice * 100
          + row.absent * 10
          + row.new + row.status + row.content
        );
        return risk(b) - risk(a);
      });
      setPending({
        fetched, banners, totals, perPartner, prevForGuard,
        existingRevision: sheetReconcileStateRevision(reconcileState),
        rosterRevision: fetched.rosterRevision,
        existingConflictReason,
        existingConflictDetail,
        existingConflictReport,
        existingConflictRows,
        priceResolutionCandidates,
        approvedPriceFingerprints,
        conflictDecisions,
        identityDecisions,
        decisionRecords: [...existing, ...deleted],
        decisionReferences: { contracts, rooms, quotes },
        identityConflictReview,
        resolvedPriceCount: resolutionResult.resolvedPricePeriods,
        protectedPriceCount,
        at: Date.now(),
      });
      setBulkLog([...fetched.lines.map((l) => l.message), ...(banners.length ? ['— diff —', ...banners] : [])].join('\n'));
      const okCount = perPartner.filter((x) => x.ok).length;
      const validationBlock = sheetSyncCommitBlockReason(fetched) || existingConflictReason;
      toast(
        validationBlock
          ? `검증 차단 — ${validationBlock}`
          : fetched.products.length
            ? `검증 완료 — 공급사 ${okCount}/${perPartner.length} · 올릴 매물 ${fetched.products.length}대 (출고불가 제외 ${totals.excludedCount})`
            : `검증 완료 — 가져올 매물 없음 (공급사 ${okCount}/${perPartner.length})`,
        validationBlock ? 'error' : fetched.products.length ? 'ok' : 'info',
      );
    } catch (e) {
      setPending(null);
      toast('검증 실패: ' + String((e as Error).message || e), 'error');
    } finally {
      setBusy(false);
      setSheetAction(null);
      setValidatingCodes(null);
    }
  };

  /** 한 번 클릭: fresh 시트 읽기 → 내부 검수 → 전체 또는 충돌 제외 안전 원자 반영. */
  const syncNow = async (onlyCodes?: string[]) => {
    if (busy) return;
    if (isAdmin) {
      setBusy(true);
      setSheetAction('sync');
      setValidatingCodes(onlyCodes?.length ? onlyCodes : 'all');
      try {
        const result = await runCanonicalServerSync(onlyCodes || []);
        toast(
          `영업자 시트 → ERP 반영 완료 · 유입 ${result.counts?.imported || 0}대 · 신규 ${result.counts?.created || 0}대 · 수정 ${result.counts?.updated || 0}대`,
          'ok',
        );
        setPending(null);
        await Promise.all([refreshRoster(), refreshDailyStatus()]);
        onImported();
      } catch (error) {
        toast(`영업자 시트 연동 실패 · ${String((error as Error).message || error)}`, 'error');
      } finally {
        setBusy(false);
        setSheetAction(null);
        setValidatingCodes(null);
      }
      return;
    }
    if (!masterReady || rosterError) {
      toast(rosterError ? `시트 설정 오류 · ${rosterError}` : '차종마스터 로드 실패 · 연동 불가', 'error');
      return;
    }
    setBusy(true);
    setSheetAction('sync');
    setValidatingCodes(onlyCodes?.length ? onlyCodes : 'all');
    try {
      const freshPartners = await listSheetPartnerRecords(co, true);
      const scoped = onlyCodes?.length
        ? freshPartners.filter((row) => onlyCodes.includes(String(row.partner_code || row._key || '')))
        : freshPartners;
      if (!scoped.length) throw new Error('연동할 공급사 시트가 없습니다.');
      const fetched = await fetchAllPartnerSheets(co, master!, {
        fetchTable: fetchAdminSheetTable,
        fetchSupplierSheet: fetchAdminSupplierSheet,
        partnerRows: scoped,
      });
      const state = await listSheetReconcileState(co, true);
      fetched.reconcileRevision = sheetReconcileStateRevision(state);
      const sourceBlock = sheetSyncCommitBlockReason(fetched);
      if (sourceBlock) throw new Error(sourceBlock);
      const conflicts = findSheetSyncExistingConflicts(fetched, state.active, state.deleted);
      const conflictReason = sheetSyncExistingConflictReason(conflicts);
      if (conflictReason) {
        const result = await commitSafeSupplierFields(co, master!, fetched);
        toast(
          result
            ? `연동 완료 · 안전 정보 수정 ${result.updated}대 · 가격·신규·삭제 충돌은 보류`
            : `연동 검수 완료 · ${conflictReason} · 안전하게 반영할 기존 차량 정보 없음`,
          result ? 'ok' : 'info',
        );
      } else {
        const result = await commitFetchedPartnerSheets(co, master!, fetched);
        toast(
          `연동 완료 · 신규 ${result.commit?.created || 0}대 · 수정 ${result.commit?.updated || 0}대`,
          'ok',
        );
      }
      setPending(null);
      await refreshRoster();
      onImported();
    } catch (error) {
      toast(`연동 실패 · ${String((error as Error).message || error)}`, 'error');
    } finally {
      setBusy(false);
      setSheetAction(null);
      setValidatingCodes(null);
    }
  };

  /** 관리자: 공급사 시트 fetch 스냅샷을 커밋. ERP/대상 roster는 직전에 revision 재확인. */
  const commitPending = async () => {
    if (busy || !pending) return;
    if (!masterReady) { toast('차종마스터 로드 실패 — 동기화 불가', 'error'); return; }
    const { totals, banners, fetched } = pending;
    const blockReason = sheetSyncCommitBlockReason(fetched) || pending.existingConflictReason;
    if (blockReason) {
      if (isAdmin) {
        toast(`연동 차단 — ${blockReason}. 원본을 고친 뒤 다시 검증하세요. 관리자는 프리패스 정본을 건너뛰는 안전정보 우회 반영을 하지 않습니다.`, 'error');
        return;
      }
      const ok = await confirmDialog({
        title: '안전한 공급사 정보 연동',
        okLabel: '연동하기',
        message: `${blockReason}\n\n가격·신규·삭제·상태 충돌은 보류하고, 기존 차량과 공급사+차번이 정확히 일치하는 제원·주행거리·색상·옵션·사진만 반영합니다.`,
      });
      if (!ok) return;
      setBusy(true);
      try {
        const result = await commitSafeSupplierFields(co, master!, fetched);
        toast(result ? `안전 정보 연동 완료 · 수정 ${result.updated}대` : '반영할 안전 정보가 없습니다.', result ? 'ok' : 'info');
        setPending(null);
        await refreshRoster();
        onImported({ salesSheetPublished: true });
      } catch (error) {
        toast(`안전 정보 연동 실패 · ${String((error as Error).message || error)}`, 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (Date.now() - pending.at > 10 * 60 * 1000) {
      setPending(null);
      toast('동기화 중단 — 검증 후 10분이 지났습니다. 데이터 검증을 다시 실행하세요.', 'error');
      return;
    }
    // 확인창을 busy 전에 연다. 예전엔 fresh 재고 조회가 끝난 뒤에야 창이 떠
    // 「반영 중…」만 길다가, 공급사 배너 전체가 들어간 창이 화면을 넘어
    // 확인 버튼이 안 보이고 바깥 클릭=취소로 조용히 끝났다.
    const summary = `시트 행: 올림 ${fetched.products.length} · 출고불가 ${totals.excludedCount}`
      + ` · 가격없음 ${totals.noPriceCount} · 중복 ${totals.duplicateCount} · 무효 ${totals.invalidCount}`
      + `\n기존 재고: 신규 ${totals.new} · 상태변경 ${totals.status} · 내용만 수정 ${totals.content}`
      + ` · 재고차단 ${totals.absent} · 가드보류 ${totals.guarded} · 무변경 ${totals.unchanged}`;
    const ok = await confirmDialog({
      title: '재고에 동기화',
      okLabel: '반영',
      message: `${summary}`
        + `\n\n등록 시트 ${roster.length}곳 → Firebase 재고에 저장합니다.`
        + '\n확인 후 ERP 상태를 재확인하고 씁니다. 공급사별 상세는 아래 검증 표에 있습니다.',
    });
    if (!ok) {
      toast('반영 취소됨 — 확인창에서 취소해 Firebase에 저장하지 않았습니다. 다시 반영하려면 「반영」을 누르세요.', 'info');
      return;
    }
    setBusy(true);
    try {
      if (isAdmin) {
        const result = await runCanonicalServerSync(fetched.lines.map((line) => line.code));
        toast(
          `연동 완료 · 프리패스 정본 ${result.counts?.imported || 0}대 왕복검증 · 신규 ${result.counts?.created || 0}대 · 수정 ${result.counts?.updated || 0}대`,
          'ok',
        );
        setPending(null);
        await refreshRoster();
        onImported();
        return;
      }
      const verifyFreshSnapshot = async () => {
        const store = getStore();
        const [currentState, currentRoster, contracts, resolutions] = await Promise.all([
          listSheetReconcileState(co, true),
          listSheetPartners(co, true),
          store.listFresh ? store.listFresh('contract', co) : store.list('contract', co),
          fetchSheetConflictResolutions(),
        ]);
        if (sheetReconcileStateRevision(currentState) !== pending.existingRevision
          || sheetPartnerRosterRevision(currentRoster) !== pending.rosterRevision
          || sheetPartnerRosterRevision(currentRoster) !== fetched.rosterRevision) {
          throw new Error('검증 후 ERP 재고 또는 시트 대상·탭·매핑·급감 기준이 변경됐습니다. 다시 검증하세요.');
        }
        const freshConflicts = findSheetSyncExistingConflicts(fetched, currentState.active, currentState.deleted);
        const freshConflict = sheetSyncExistingConflictReason(applySheetConflictResolutions({
          conflicts: freshConflicts,
          resolutions,
          existing: currentState.active,
          contracts,
          // ★미리보기와 같은 판정을 쓴다. 빠뜨리면 «화면엔 승인할 것이 없는데 반영은 막히는»
          //  데드락이 된다 — 무변화 건은 승인 후보에 뜨지도 않기 때문이다.
          priceChangesValue: buildPriceChangesValue({
            conflicts: freshConflicts,
            existing: currentState.active,
            deleted: currentState.deleted,
            incoming: fetched.products,
            contracts,
            providerCodes: fetched.lines.map((line) => line.code),
          }),
        }).conflicts);
        if (freshConflict) throw new Error(`${freshConflict}. 충돌을 정리하고 다시 검증하세요.`);
        return { currentRoster, contracts, resolutions };
      };

      if (Date.now() - pending.at > 10 * 60 * 1000) {
        setPending(null);
        toast('동기화 중단 — 확인 중 검증 유효시간이 지났습니다. 다시 검증하세요.', 'error');
        return;
      }
      const finalSnapshot = await verifyFreshSnapshot();

      const r = await commitFetchedPartnerSheets(co, master!, fetched, {
        resolutions: finalSnapshot.resolutions,
        contracts: finalSnapshot.contracts,
        loadConflictContext: async () => {
          const store = getStore();
          const [contracts, resolutions] = await Promise.all([
            store.listFresh ? store.listFresh('contract', co) : store.list('contract', co),
            fetchSheetConflictResolutions(),
          ]);
          return { contracts, resolutions };
        },
      });
      const logLines = [
        ...r.lines.map((l) => l.message),
        ...(r.absent.notes.length ? ['— 부재처리 —', ...r.absent.notes] : []),
        ...(banners.length ? ['— diff —', ...banners] : []),
      ];
      setBulkLog(logLines.join('\n'));
      if (!r.commit && !r.absent.blocked) {
        toast(r.failCount ? `연동 실패 ${r.failCount}곳 · 매물 0건` : '가져올 매물 없음', 'error');
      } else {
        toast(
          `동기화 완료 — 공급사 ${r.okCount}/${r.partnerCount}`
          + (r.commit ? ` · 신규 ${r.commit.created} · 갱신 ${r.commit.updated}` : '')
          + (r.commit?.revived ? ` · 되살림 ${r.commit.revived}` : '')
          + (r.commit?.duplicates ? ` · 중복충돌 ${r.commit.duplicates}` : '')
          + (r.absent.blocked ? ` · 재고차단 ${r.absent.blocked}` : '')
          + (r.ingress
            ? ` · 차종확정 ${r.ingress.confirmed}·차종검수 ${r.ingress.review}`
              + (r.ingress.review > 0 ? '(트림미매칭=입고됨·마스터보강 대상)' : '')
            : ''),
          r.failCount || r.commit?.duplicates || r.absent.skipped_guard || (r.ingress && r.ingress.review > 0) ? 'info' : 'ok',
        );
        onImported();
      }
      setPending(null);
      await refreshRoster();
    } catch (e) {
      const msg = String((e as Error).message || e);
      // 층 라벨 = 플랜 「커밋 throw 1–6층」을 토스트에서 바로 고르게 한다.
      // revision 메시지는 재고·설정이 한 문장에 같이 올 수 있어 둘 다 보면 「revision」로 묶는다.
      const layer = /사후검증/.test(msg) ? '사후검증'
        : (/ERP 재고|reconcileRevision/.test(msg) && /시트 대상|탭·매핑|급감|rosterRevision/.test(msg))
          || /검증 후 ERP 재고 또는 시트/.test(msg) ? 'revision'
        : /ERP 재고가 변경|reconcileRevision|검증 revision/.test(msg) ? '재고revision'
        : /시트 대상·탭·매핑·급감|rosterRevision/.test(msg) ? '설정revision'
        : /충돌/.test(msg) ? '충돌'
        : /전체 동기화 중단|조회 실패|올림 0|무효 차번|공급사 간 동일|번호미정|집계 불일치|canonical|provenance/.test(msg)
          ? '커밋차단'
        : '예외';
      toast(`동기화 실패 [${layer}]: ${msg}`, 'error');
    } finally { setBusy(false); }
  };

  const fmtSync = (t: number | null) => {
    if (!t) return '미연동';
    try { return new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
  };

  const fmtPendingAt = (t: number) => {
    try { return new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; }
  };

  /** 검증·반영 중 화면 피드백 — 버튼 글자만 바뀌면 스크롤 밖이라 「멈춘 것처럼」 보인다. */
  const workInProgress = busy || !!validatingCodes || ironPreviewLoading || ironApplying;
  const workLabel = ironApplying
    ? '아이언렌트카 상품 반영 중… Firebase에 쓰는 중입니다.'
    : ironPreviewLoading
      ? '아이언렌트카 홈페이지 검증 중…'
      : sheetAction === 'sync' && validatingCodes === 'all'
        ? `전체 공급사 연동 중… (${roster.length}곳 · ERP 규격 변환·저장·사후검증)`
        : sheetAction === 'sync' && Array.isArray(validatingCodes) && validatingCodes.length
          ? `${validatingCodes.join(', ')} 연동 중… ERP 규격 변환·저장·사후검증`
      : validatingCodes === 'all'
        ? `전체 공급사 시트 검증 중… (${roster.length}곳 · 사진·숨김행 포함 · 1~2분 걸릴 수 있음)`
        : Array.isArray(validatingCodes) && validatingCodes.length
          ? `${validatingCodes.join(', ')} 시트 검증 중…`
          : busy && pending
            ? '검증 결과 Firebase 반영 중… 재고 확인·저장·부재처리까지 진행합니다.'
            : busy
              ? '처리 중…'
              : '';

  const pendingBlockReason = pending
    ? sheetSyncCommitBlockReason(pending.fetched) || pending.existingConflictReason
    : '';
  const pendingPriceApprovalGroups = (() => {
    if (!pending) return [];
    const approved = new Set(pending.approvedPriceFingerprints);
    const reportByRaw = new Map(pending.existingConflictRows.map((row) => [row.raw, row]));
    const groups = new Map<string, {
      key: string;
      label: string;
      periods: string;
      candidates: SheetConflictResolutionInput[];
    }>();
    for (const candidate of pending.priceResolutionCandidates) {
      if (approved.has(candidate.fingerprint)) continue;
      const report = reportByRaw.get(candidate.raw);
      const provider = report?.provider || candidate.provider || '미확정';
      const impact = report?.priceImpact || '가격 구조 확인 필요';
      const key = `${provider}|${impact}`;
      const current = groups.get(key) || {
        key,
        label: `${provider} · ${impact}`,
        periods: '',
        candidates: [],
      };
      current.candidates.push(candidate);
      current.periods = [...new Set([
        ...current.periods.split(',').map((value) => value.trim()).filter(Boolean),
        ...(report?.affectedPricePeriods || '').split(',').map((value) => value.trim()).filter(Boolean),
      ])].join(', ');
      groups.set(key, current);
    }
    return [...groups.values()].sort((a, b) => b.candidates.length - a.candidates.length || a.label.localeCompare(b.label, 'ko'));
  })();
  const decisionQueueRows = (() => {
    if (!pending) return [] as SheetConflictDecisionTarget[];
    return buildSheetConflictDecisionTargets({
      reportRows: pending.existingConflictRows,
      incoming: pending.fetched.products,
      records: pending.decisionRecords,
      providerCodes: pending.fetched.lines.map((line) => line.code),
    });
  })();
  const decisionDryRun = planSheetConflictDecisionDryRun({
    targets: decisionQueueRows,
    decisions: pending?.conflictDecisions || [],
    now: pending?.at,
  });
  const decisionApplicationPlan = pending ? planSheetDecisionApplication({
    conflictPlan: decisionDryRun,
    identityReview: pending.identityConflictReview,
    identityDecisions: pending.identityDecisions,
    incoming: pending.fetched.products,
    records: pending.decisionRecords,
    providerCodes: pending.fetched.lines.map((line) => line.code),
    references: pending.decisionReferences,
    now: pending.at,
  }) : null;
  const decisionPatchDryRun = pending && decisionApplicationPlan ? planSheetDecisionPatchDryRun({
    applicationPlan: decisionApplicationPlan,
    records: pending.decisionRecords,
    incoming: pending.fetched.products,
    companyId: co,
    now: pending.at,
  }) : null;
  const activeDecisionByFingerprint = new Map((pending?.conflictDecisions || [])
    .filter((item) => item.status === 'recorded')
    .map((item) => [item.fingerprint, item]));
  const recordedDecisionCount = decisionQueueRows
    .filter((row) => activeDecisionByFingerprint.has(row.fingerprint)).length;
  const protectedDecisionCount = decisionQueueRows
    .filter((row) => row.contractProtections.length > 0).length;
  const activeIdentityDecisionByFingerprint = new Map((pending?.identityDecisions || [])
    .filter((item) => item.status === 'recorded')
    .map((item) => [item.fingerprint, item]));
  const recordedIdentityDecisionCount = (pending?.identityConflictReview.rows || [])
    .filter((row) => activeIdentityDecisionByFingerprint.has(row.fingerprint)).length;
  const identityDecisionBlockReason = (row: SheetIdentityReviewRow): string => {
    if (row.contractProtection || row.status === 'contract_protected') {
      return row.contractProtection || '계약보호 차량';
    }
    if (row.status === 'unowned_deleted_ambiguous') return '삭제·Sheet 대표 대상이 하나로 특정되지 않음';
    if (!row.provider) return 'Sheet 공급사 미확정';
    if (row.existingKeys.length !== 1) return `기존 상품키 ${row.existingKeys.length}개 · 단일 대상 필요`;
    if (row.incomingKeys.length !== 1) return `현재 Sheet 키 ${row.incomingKeys.length}개 · 단일 대상 필요`;
    return '';
  };
  const lastDailyRun = dailyStatus?.lastRun;
  const dailyRunLabel = dailyStatusError
    ? '자동연동 상태 확인 필요'
    : dailyStatusLoading
      ? '자동연동 상태 확인 중'
      : !dailyStatus?.enabled
        ? '자동연동 비활성'
        : lastDailyRun?.status === 'completed'
          ? '자동연동 정상'
          : lastDailyRun?.status === 'running'
            ? '자동연동 실행 중'
            : lastDailyRun?.status === 'dry_run'
              ? '자동연동 시험 완료'
              : lastDailyRun?.status === 'blocked'
                ? '자동연동 차단'
                : lastDailyRun?.status === 'failed'
                  ? '자동연동 실패'
                  : '자동연동 실행 전';
  const dailyRunColor = dailyStatusError || lastDailyRun?.status === 'failed'
    ? C.danger
    : lastDailyRun?.status === 'blocked' || !dailyStatus?.enabled
      ? C.warn
      : C.brand;

  const copyConflictReport = async () => {
    if (!pending?.existingConflictRows.length) return;
    const copied = await copyText(pending.existingConflictReport);
    toast(copied ? '충돌 목록 TSV가 복사됐습니다.' : '충돌 목록 복사에 실패했습니다.', copied ? 'ok' : 'error');
  };

  const refreshConflictDecisions = async () => {
    const decisions = await fetchSheetConflictDecisions();
    setPending((current) => current ? { ...current, conflictDecisions: decisions } : current);
  };

  const refreshIdentityDecisions = async () => {
    const decisions = await fetchSheetIdentityDecisions();
    setPending((current) => current ? { ...current, identityDecisions: decisions } : current);
  };

  const recordConflictDecision = async (
    row: SheetConflictDecisionTarget,
    decision: SheetConflictDecisionValue,
  ) => {
    if (busy || !pending) return;
    const blockReason = sheetConflictDecisionTargetBlockReason(row)
      || (decision === RESTORE_DELETED && row.mergedAlias ? '병합 별칭 tombstone은 원본 상품으로 복구할 수 없음' : '');
    if (blockReason) {
      toast(`결정 기록 불가 — ${blockReason}`, 'error');
      return;
    }
    const targetProvider = decision === ASSIGN_SHEET_OWNER ? row.sheetProviders[0] : row.providers[0];
    const consequence = decision === KEEP_EXISTING_OWNER
      ? `기존 공급사 ${row.providers[0] || '확인필요'} 귀속을 유지하는 판단입니다.`
      : decision === ASSIGN_SHEET_OWNER
        ? `현재 Sheet 공급사 ${targetProvider || '확인필요'}로 귀속을 변경하는 판단입니다.`
        : decision === KEEP_DELETED
          ? '삭제 상태를 유지하고 현재 Sheet 행을 동기화 대상에서 제외하는 판단입니다.'
          : `삭제 상품키 ${row.productKeys[0]}를 복구하는 판단입니다.`;
    const ok = await confirmDialog({
      message: `${row.carNumber} · ${sheetConflictDecisionLabel(decision)}로 기록할까요?`
        + `\n${consequence}`
        + '\n\n이번 단계는 관리자 판단만 기록합니다. 재고·삭제이력은 바꾸지 않으며 동기화 차단도 그대로 유지됩니다.',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인 확인 필요');
      const input: SheetConflictDecisionInput = {
        fingerprint: row.fingerprint,
        category: row.category,
        decision,
        raw: row.raw,
        provider: targetProvider,
        productKey: row.productKeys[0],
      };
      const response = await fetch('/api/sheet/conflict-decisions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decisions: [input] }),
      });
      const body = await response.json().catch(() => ({})) as { recorded?: number; error?: string };
      if (!response.ok) throw new Error(body.error || `결정 기록 실패 ${response.status}`);
      await refreshConflictDecisions();
      toast(`${row.carNumber} 결정 기록 완료 — 동기화 차단 유지`, 'ok');
    } catch (error) {
      toast(`소유권·삭제 결정 기록 실패: ${String((error as Error).message || error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revokeConflictDecision = async (row: SheetConflictDecisionTarget) => {
    if (busy || !activeDecisionByFingerprint.has(row.fingerprint)) return;
    const ok = await confirmDialog({
      message: `${row.carNumber}의 기록된 결정을 철회할까요?\n재고와 동기화 상태에는 변화가 없습니다.`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인 확인 필요');
      const response = await fetch('/api/sheet/conflict-decisions', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fingerprints: [row.fingerprint] }),
      });
      const body = await response.json().catch(() => ({})) as { revoked?: number; error?: string };
      if (!response.ok) throw new Error(body.error || `결정 철회 실패 ${response.status}`);
      await refreshConflictDecisions();
      toast(`${row.carNumber} 결정 철회 완료`, 'ok');
    } catch (error) {
      toast(`소유권·삭제 결정 철회 실패: ${String((error as Error).message || error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const recordIdentityDecision = async (
    row: SheetIdentityReviewRow,
    decision: SheetIdentityDecisionValue,
  ) => {
    if (busy || !pending) return;
    const blockReason = identityDecisionBlockReason(row);
    if (blockReason) {
      toast(`신원 결정 기록 불가 — ${blockReason}`, 'error');
      return;
    }
    const ok = await confirmDialog({
      message: `${row.carNumbers.join(' ↔ ')} · ${sheetIdentityDecisionLabel(decision)}로 기록할까요?`
        + `\n공급사 ${row.provider} · 기존키 ${row.existingKeys[0]} · Sheet키 ${row.incomingKeys[0]}`
        + '\n\n이번 단계는 관리자 판단만 기록합니다. 재고 복구·신규 생성·번호 변경·Sheet 유입 제외를 실행하지 않으며 동기화 차단도 유지됩니다.',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인 확인 필요');
      const input: SheetIdentityDecisionInput = {
        fingerprint: row.fingerprint,
        category: row.category,
        decision,
        raw: row.raw,
        provider: row.provider,
        existingKey: row.existingKeys[0],
        incomingKey: row.incomingKeys[0],
      };
      const response = await fetch('/api/sheet/identity-decisions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decisions: [input] }),
      });
      const body = await response.json().catch(() => ({})) as { recorded?: number; error?: string };
      if (!response.ok) throw new Error(body.error || `신원 결정 기록 실패 ${response.status}`);
      await refreshIdentityDecisions();
      toast(`${row.carNumbers.join(' ↔ ')} 신원 결정 기록 완료 — 동기화 차단 유지`, 'ok');
    } catch (error) {
      toast(`신원 결정 기록 실패: ${String((error as Error).message || error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revokeIdentityDecision = async (row: SheetIdentityReviewRow) => {
    if (busy || !activeIdentityDecisionByFingerprint.has(row.fingerprint)) return;
    const ok = await confirmDialog({
      message: `${row.carNumbers.join(' ↔ ')}의 기록된 신원 결정을 철회할까요?\n재고와 동기화 상태에는 변화가 없습니다.`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인 확인 필요');
      const response = await fetch('/api/sheet/identity-decisions', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fingerprints: [row.fingerprint] }),
      });
      const body = await response.json().catch(() => ({})) as { revoked?: number; error?: string };
      if (!response.ok) throw new Error(body.error || `신원 결정 철회 실패 ${response.status}`);
      await refreshIdentityDecisions();
      toast(`${row.carNumbers.join(' ↔ ')} 신원 결정 철회 완료`, 'ok');
    } catch (error) {
      toast(`신원 결정 철회 실패: ${String((error as Error).message || error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyConflictDecisionDryRun = async () => {
    if (!pending || !decisionDryRun.rows.length) return;
    const copied = await copyText(sheetConflictDecisionDryRunTsv(decisionDryRun));
    const { summary } = decisionDryRun;
    toast(
      copied
        ? `판단 dry-run 복사 · 현재 ${summary.currentTargets} · 기록 ${summary.recordedCurrent} · 미결정 ${summary.undecided} · 실행작업 0`
        : '판단 dry-run 복사에 실패했습니다.',
      copied ? 'ok' : 'error',
    );
  };

  const copyIdentityConflictReview = async () => {
    if (!pending?.identityConflictReview.rows.length) return;
    const copied = await copyText(sheetIdentityConflictReviewTsv(pending.identityConflictReview));
    const { summary } = pending.identityConflictReview;
    toast(
      copied
        ? `신원·미확정 검토 복사 · 전체 ${summary.total} · 공급사 미확정 삭제 ${summary.unownedDeleted} · 임시번호 ${summary.pendingIdentityDrift + summary.pendingSignature} · 실행작업 0`
        : '신원·미확정 검토 목록 복사에 실패했습니다.',
      copied ? 'ok' : 'error',
    );
  };

  const copyDecisionApplicationPlan = async () => {
    if (!decisionApplicationPlan?.rows.length) return;
    const copied = await copyText(sheetDecisionApplicationPlanTsv(decisionApplicationPlan));
    const { summary } = decisionApplicationPlan;
    toast(
      copied
        ? `적용 계획 복사 · 검토후보 ${summary.candidateReview} · 참조이관 ${summary.referenceMigrations} · 차단 ${summary.blocked} · 실행작업 0`
        : '적용 계획 복사에 실패했습니다.',
      copied ? 'ok' : 'error',
    );
  };

  const copyDecisionPatchDryRun = async () => {
    if (!decisionPatchDryRun?.rows.length) return;
    const copied = await copyText(sheetDecisionPatchDryRunJson(decisionPatchDryRun));
    const { summary } = decisionPatchDryRun;
    toast(
      copied
        ? `patch dry-run 복사 · 검토후보 ${summary.readyReview} · 작업 ${summary.operationCount} · 차단 ${summary.blocked} · 실행작업 0`
        : 'patch dry-run JSON 복사에 실패했습니다.',
      copied ? 'ok' : 'error',
    );
  };

  const approvePricePeriodPreservation = async (group: (typeof pendingPriceApprovalGroups)[number]) => {
    if (busy || !pending) return;
    const candidates = group.candidates;
    if (!candidates.length) {
      toast('새로 승인할 가격기간 누락이 없습니다.', 'info');
      return;
    }
    if (candidates.length > 200) {
      toast('한 번에 승인 가능한 200건을 초과했습니다. 충돌 원인을 먼저 나눠 확인하세요.', 'error');
      return;
    }
    const ok = await confirmDialog({
      message: `${group.label} ${candidates.length}건을 승인할까요?`
        + `${group.periods ? `\n영향 기간: ${group.periods}` : ''}`
        + '\n\n시트 누락기간은 ERP 기존가로 보존하고, 시트에 새 표준가격이 있으면 그 가격이 화면 기본가가 될 수 있습니다.'
        + '\n계약락·진행계약 차량은 승인되지 않으며 시트 원문이 바뀌면 승인은 자동 무효가 됩니다.',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인 확인 필요');
      const response = await fetch('/api/sheet/conflict-resolutions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resolutions: candidates }),
      });
      const body = await response.json().catch(() => ({})) as { approved?: number; error?: string };
      if (!response.ok) throw new Error(body.error || `승인 실패 ${response.status}`);
      toast(`${group.label} ${body.approved || candidates.length}건 승인 완료`, 'ok');
      await validateAll();
    } catch (error) {
      toast(`가격기간 유지 승인 실패: ${String((error as Error).message || error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revokePricePeriodPreservation = async () => {
    if (busy || !pending?.approvedPriceFingerprints.length) return;
    const ok = await confirmDialog({
      message: `현재 검증에 적용된 기존 가격 유지 승인 ${pending.approvedPriceFingerprints.length}건을 철회할까요?`
        + '\n철회 즉시 해당 가격기간 누락은 다시 동기화 차단 사유가 됩니다.',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인 확인 필요');
      const response = await fetch('/api/sheet/conflict-resolutions', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fingerprints: pending.approvedPriceFingerprints }),
      });
      const body = await response.json().catch(() => ({})) as { revoked?: number; error?: string };
      if (!response.ok) throw new Error(body.error || `철회 실패 ${response.status}`);
      toast(`기존 가격기간 유지 승인 ${body.revoked || 0}건 철회`, 'ok');
      await validateAll();
    } catch (error) {
      toast(`가격기간 유지 승인 철회 실패: ${String((error as Error).message || error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 「데이터 검증」(전체) — 시트와 홈페이지를 **둘 다** 돌린다.
   *
   * 원본이 무엇이든 관리자가 하는 일은 «전부 검증하고 이상 없으면 반영»이다. 그런데 시트는
   * 구글시트 fetch → sheet-merge, 홈페이지는 서버 API → ironrentcar-reconcile 로 엔진이
   * 갈려 있어 전체 버튼이 시트만 돌았다. 그래서 아이언은 매번 따로 눌러야 했다.
   *
   * 결과 구조가 서로 달라 «반영»은 한 트랜잭션으로 못 묶는다(각자 반영 버튼을 쓴다).
   * 검증만이라도 한 번에 끝내 관리자가 두 곳을 기억하지 않게 한다.
   *
   * ★둘을 «순서»로 묶지 않는다. 예전엔 `await validateAll()` 뒤에 홈페이지를 불렀는데,
   *   시트 16곳을 읽는 동안 홈페이지 칸은 그대로 멈춰 있었고 — 시트가 오래 걸리거나 한 곳이
   *   응답하지 않으면 홈페이지는 **시작조차 못 했다**(실측: 「검증 중…」인 채로 홈페이지 미검증).
   *   원본이 서로 무관하니 동시에 출발시킨다. 상태(busy · ironPreviewLoading)도 서로 다른 칸이라
   *   겹치지 않는다. `allSettled` 라 한쪽이 실패해도 다른 쪽 결과를 덮지 않는다.
   */
  const validateEverySource = async () => {
    await Promise.allSettled([validateAll(), refreshIronRentcarPreview()]);
  };

  const refreshIronRentcarPreview = async () => {
    if (ironPreviewLoading || ironApplying) return;
    setIronPreviewLoading(true);
    setIronMessage('');
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인 확인 필요');
      const response = await fetch('/api/inventory/ironrentcar/preview', {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(IRON_FETCH_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => ({})) as IronRentcarPreview & {
        error?: string;
        detail?: string;
      };
      if (!response.ok) {
        const detail = body.error === 'server auth unavailable'
          ? '서버 인증 설정 필요'
          : (body.detail || body.error || `HTTP ${response.status}`);
        throw new Error(detail);
      }
      setIronPreview(body);
      setIronMessage(`상품 검증 완료 · 원본 ${body.catalog.listings}대 · 반영후보 ${body.reconciliation.candidateOperations}건`);
    } catch (error) {
      setIronPreview(null);
      setIronMessage(`미리보기 실패 · ${String((error as Error).message || error)}`);
    } finally {
      setIronPreviewLoading(false);
    }
  };

  const applyIronRentcarPreview = async () => {
    if (!ironPreview || ironApplying || ironPreviewLoading) return;
    const expected = {
      patches: ironPreview.reconciliation.patchCandidates,
      creates: ironPreview.reconciliation.createCandidates,
      absentBlocks: ironPreview.reconciliation.absentBlockCandidates,
    };
    const ok = await confirmDialog({
      message: `아이언렌트카 상품을 검증 결과대로 반영할까요?\n\n정보수정 ${expected.patches} · 신규 ${expected.creates} · 원본 부재 상태변경 ${expected.absentBlocks} · 합계 ${ironPreview.reconciliation.candidateOperations}건\n\n판매완료 ${ironPreview.catalog.sold}대는 신규 등록하지 않으며, 기존 계약 스냅샷은 바꾸지 않습니다. 반영 후에는 등록된 전용 연동 원본만 사용합니다.`,
    });
    if (!ok) return;
    setIronApplying(true);
    setIronMessage('아이언렌트카 상품 반영 중…');
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인 확인 필요');
      const response = await fetch('/api/inventory/ironrentcar/apply', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          revision: ironPreview.revision,
          confirmation: '아이언 홈페이지 연동 적용',
          expected,
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        applied?: boolean;
        auditCompleted?: boolean;
        patches?: number;
        creates?: number;
        absentBlocks?: number;
        error?: string;
        revision?: string;
      };
      if (!response.ok || !body.applied) {
        const disabledHint = body.error === 'ironrentcar sync disabled'
          ? 'Preview 환경의 IRONRENTCAR_SYNC_ENABLED 설정을 먼저 확인하세요.'
          : '';
        throw new Error([body.error || `적용 실패 ${response.status}`, disabledHint].filter(Boolean).join(' · '));
      }
      setIronMessage(`상품 반영 완료 · 정보수정 ${body.patches || 0} · 신규 ${body.creates || 0} · 상태변경 ${body.absentBlocks || 0}${body.auditCompleted === false ? ' · 감사 완료표식 확인 필요' : ''}`);
      toast('아이언렌트카 상품 반영 완료', 'ok');
      await refreshRoster();
      onImported();
      setIronPreview(null);
    } catch (error) {
      const message = String((error as Error).message || error);
      setIronMessage(`적용 실패 · ${message}`);
      toast(`아이언렌트카 상품 반영 실패: ${message}`, 'error');
    } finally {
      setIronApplying(false);
    }
  };

  if (isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-busy={busy}>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.selected, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.brand }}>영업자 상품리스트 → ERP</div>
              <div style={{ marginTop: 3, fontSize: FS.cap, color: C.mute, lineHeight: 1.5 }}>
                공급사 시트는 비교용입니다. ERP는 영업자 상품리스트 한 장만 읽으며, 시트 필터·숨김 행은 재고 삭제로 보지 않습니다.
              </div>
            </div>
            <a
              href={SALES_INVENTORY_SHEET_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.brand, fontSize: FS.cap, fontWeight: FW.strong, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              영업자 시트 열기 <ExternalLink size={ICON.sm} aria-hidden />
            </a>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Btn size="md" variant="ghost" onClick={() => validateAll()} disabled={busy}>
              {sheetAction === 'validate' ? '검증 중…' : '데이터 검증'}
            </Btn>
            <Btn size="md" onClick={() => syncNow()} disabled={busy}>
              {sheetAction === 'sync' ? 'ERP 반영 중…' : 'ERP 연동하기'}
            </Btn>
          </div>
          <div style={{ marginTop: 9, fontSize: FS.micro, color: dailyRunColor, lineHeight: 1.45 }}>
            자동연동 {dailyRunLabel} · {dailyStatus?.schedule || '매일 02:00 KST'}
            {lastDailyRun?.finished_at ? ` · 최근 ${fmtSync(lastDailyRun.finished_at)}` : ''}
            {lastDailyRun?.counts ? ` · 유입 ${lastDailyRun.counts.imported || 0} · 신규 ${lastDailyRun.counts.created || 0} · 수정 ${lastDailyRun.counts.updated || 0}` : ''}
          </div>
          {(dailyStatusError || lastDailyRun?.block_reason || lastDailyRun?.error) ? (
            <div style={{ marginTop: 6, fontSize: FS.micro, color: C.danger, lineHeight: 1.45 }}>
              {dailyStatusError || lastDailyRun?.block_reason || lastDailyRun?.error}
            </div>
          ) : null}
          {!compact && bulkLog ? (
            <pre style={{ margin: '10px 0 0', padding: 9, borderRadius: R, background: C.bg, color: C.mute, fontSize: FS.micro, whiteSpace: 'pre-wrap' }}>
              {bulkLog}
            </pre>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy={workInProgress}>
      {workInProgress && workLabel ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'sticky', top: 0, zIndex: 40,
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: R,
            border: `1px solid ${C.line}`, background: C.selected,
            boxShadow: SH.cardRest,
          }}
        >
          <span
            aria-hidden
            style={{
              flex: '0 0 auto', width: 18, height: 18,
              border: `2px solid ${C.line}`, borderTopColor: C.brand,
              borderRadius: '50%', animation: 'fp-spin 0.7s linear infinite',
            }}
          />
          <div style={{ flex: 1, minWidth: 0, fontSize: FS.cap, color: C.ink, lineHeight: 1.45, fontWeight: FW.strong }}>
            {workLabel}
          </div>
        </div>
      ) : null}
      {isAdmin && (
        <>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.selected, padding: 10, position: 'relative' }}>
          {workInProgress ? (
            <div
              aria-hidden
              style={{
                position: 'absolute', inset: 0, borderRadius: R,
                background: SCRIM.light, pointerEvents: 'none', zIndex: 1,
              }}
            />
          ) : null}
          <div style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.brand, marginBottom: 3 }}>전체 공급사 상품 연동</div>
          <div style={{
            display: compact ? 'none' : 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
            marginBottom: 6, padding: '6px 8px', borderRadius: R, background: C.bg,
            border: `1px solid ${C.line}`, fontSize: FS.cap,
          }}>
            <span style={{ color: dailyRunColor, fontWeight: FW.title }}>Google Sheet 자동연동 · {dailyRunLabel}</span>
            <span style={{ color: C.faint }}>· {dailyStatus?.schedule || '매일 02:00 KST'}</span>
            {lastDailyRun?.finished_at ? <span style={{ color: C.mute }}>· 최근 {fmtSync(lastDailyRun.finished_at)}</span> : null}
            {lastDailyRun?.counts ? (
              <span style={{ color: C.ink }}>
                · 유입 {lastDailyRun.counts.imported || 0} · 신규 {lastDailyRun.counts.created || 0}
                {' '}· 수정 {lastDailyRun.counts.updated || 0} · 부재차단 {lastDailyRun.counts.absentBlocked || 0}
              </span>
            ) : null}
            <Btn title="자동연동 상태 다시 읽기" size="sm" variant="ghost" onClick={refreshDailyStatus} disabled={dailyStatusLoading}>
              상태 새로고침
            </Btn>
          </div>
          {(dailyStatusError || lastDailyRun?.block_reason || lastDailyRun?.error) ? (
            <div style={{ fontSize: FS.micro, color: C.danger, lineHeight: 1.45, marginBottom: 6 }}>
              {dailyStatusError || lastDailyRun?.block_reason || lastDailyRun?.error}
            </div>
          ) : null}
          <div style={{ display: compact ? 'none' : 'block', fontSize: FS.cap, color: C.faint, lineHeight: 1.5, marginBottom: 8 }}>
          공급사마다 등록된 전용 원본을 같은 상품 연동 절차로 처리합니다. 먼저 검증해 신규·상태변경·정보수정을 확인한 뒤 반영하며, 원본에 없는 차량은 삭제하지 않고 출고불가로 전환합니다. 조회 실패·급감·소유 충돌은 자동 차단하고 기존 계약 스냅샷은 바꾸지 않습니다.
          </div>
          <div style={{ display: compact ? 'none' : 'block', marginBottom: 5, fontSize: FS.cap, fontWeight: FW.title, color: C.ink }}>
            공급사 상품 연동 · {roster.length + 1}곳
          </div>
          {compact ? null : rosterError ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: FS.cap, color: C.danger, fontWeight: FW.strong, flex: 1, minWidth: 0 }}>
                상품 연동 설정 오류 · {rosterError} — 회원·파트너에서 해당 공급사 설정을 수정하세요.
              </div>
              <Btn title="공급사 시트 설정 다시 읽기" size="sm" variant="ghost" onClick={refreshRoster} disabled={busy}>
                설정 다시 읽기
              </Btn>
            </div>
          ) : roster.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: FS.cap, color: C.mute, flex: 1, minWidth: 0 }}>
                등록된 시트 없음 → 「설정 다시 읽기」 후에도 0개면 `/members`에서 구글시트 URL을 확인하세요.
              </div>
              <Btn title="공급사 시트 설정 다시 읽기" size="sm" variant="ghost" onClick={refreshRoster} disabled={busy}>
                설정 다시 읽기
              </Btn>
            </div>
          ) : (
            // 공급사가 17곳인데 190px 면 네 줄만 보인다 — 어느 곳이 «미연동»인지 확인하려고
            // 매번 안쪽 스크롤을 뒤져야 했다. 화면 높이를 쓰되 상한을 둬 아래 요약이 안 밀리게 한다.
            <div style={{ maxHeight: '58vh', minHeight: 240, overflow: 'auto', marginBottom: 8, border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg }}>
              <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', fontSize: FS.cap }}>
                <thead>
                  <tr>
                    <th style={th}>공급사</th>
                    <th style={th}>연동 방식</th>
                    <th style={th}>신규</th>
                    <th style={th}>상태변경</th>
                    <th style={th}>정보수정</th>
                    <th style={th}>최근 확인·반영</th>
                    <th style={th}>상품 연동</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 연동 방식은 «행의 한 칸»이지 목록을 가르는 기준이 아니다.
                      홈페이지(아이언)를 맨 위에 박아두면 방식이 늘어날 때마다 표 위에 특례가 쌓인다.
                      한 목록에 이름순으로 세우고, 방식별 차이는 「연동 방식」칸과 버튼에서만 낸다.
                      roster 는 isWebInventoryPartner 로 RP006 을 이미 빼므로 여기서 다시 거르지 않는다. */}
                  {(() => {
                    const ironRow = (
                  <tr key="RP006" style={{ borderTop: `1px solid ${C.line2}` }}>
                    <td style={{ ...td, fontWeight: FW.strong, color: C.ink }}>
                      아이언렌트카 <span style={{ color: C.faint, fontWeight: FW.body }}>(RP006)</span>
                    </td>
                    <td style={{ ...td, color: C.mute }}>
                      <a
                        href={IRONRENTCAR_SITE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={IRONRENTCAR_SITE_URL}
                        style={{ color: C.brand, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                      >
                        홈페이지
                        <ExternalLink size={ICON.sm} aria-hidden />
                      </a>
                    </td>
                    <td style={{ ...td, color: ironPreview?.reconciliation.createCandidates ? C.ok : C.faint }}>
                      {ironPreview ? ironPreview.reconciliation.createCandidates : '검증 전'}
                    </td>
                    <td style={{ ...td, color: ironPreview?.reconciliation.absentBlockCandidates ? C.warn : C.faint }}>
                      {ironPreview ? ironPreview.reconciliation.absentBlockCandidates : '—'}
                    </td>
                    <td style={{ ...td, color: ironPreview?.reconciliation.patchCandidates ? C.ink : C.faint }}>
                      {ironPreview ? ironPreview.reconciliation.patchCandidates : '—'}
                    </td>
                    <td style={{ ...td, color: C.mute, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontSize: FS.micro }}>
                      {ironPreview ? new Date(ironPreview.fetchedAt).toLocaleString('ko-KR') : '—'}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Btn
                          title="아이언렌트카 홈페이지 원본과 ERP 상품을 읽기 전용으로 정확 비교"
                          size="sm"
                          variant="ghost"
                          onClick={refreshIronRentcarPreview}
                          disabled={ironPreviewLoading || ironApplying}
                        >
                          {ironPreviewLoading ? '검증 중…' : '데이터 검증'}
                        </Btn>
                        <Btn
                          title={ironPreview ? `검증된 변경 ${ironPreview.reconciliation.candidateOperations}건 반영` : '먼저 홈페이지 검증을 실행하세요'}
                          size="sm"
                          onClick={applyIronRentcarPreview}
                          disabled={!ironPreview || ironPreviewLoading || ironApplying || !ironPreview.complete
                            || Boolean(ironPreview.reconciliation.duplicatePlateGroups)
                            || Boolean(ironPreview.reconciliation.blocked)}
                        >
                          {ironApplying ? '반영 중…' : '검증 결과 반영'}
                        </Btn>
                      </div>
                    </td>
                  </tr>
                    );
                    const sheetRows = roster.map((p) => {
                    const diff = pending?.perPartner.find((row) => row.code === p.code);
                    const rowValidating = validatingCodes === 'all'
                      || (Array.isArray(validatingCodes) && validatingCodes.includes(p.code));
                    // 이 행 공급사가 이번 검증 결과에 있을 때만 반영 — 예전엔 pending 하나면
                    // 모든 행의 「반영」이 살아 손오공 검증 뒤 웰릭스 버튼도 눌리는 것처럼 보였다.
                    const rowPending = !!diff;
                    return { name: p.name, node: (
                      <tr key={p.code} style={{ borderTop: `1px solid ${C.line2}` }}>
                        <td style={{ ...td, fontWeight: FW.strong, color: C.ink }}>{p.name}</td>
                        {/* 연동 방식 = 그 원본으로 가는 문이다. 주소를 툴팁에만 두면 «어디를 읽고
                            있는지» 확인하려고 매번 회원·파트너 설정을 열어야 했다. 눌러서 바로 연다. */}
                        <td style={{ ...td, color: C.mute, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.url ? (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={p.url}
                              style={{ color: C.brand, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            >
                              Google Sheet
                              <ExternalLink size={ICON.sm} aria-hidden />
                            </a>
                          ) : 'Google Sheet'}
                        </td>
                        <td style={{ ...td, color: diff?.new ? C.ok : C.faint }}>{diff ? diff.new : '검증 전'}</td>
                        <td style={{ ...td, color: diff?.status ? C.warn : C.faint }}>{diff ? diff.status : '—'}</td>
                        <td style={{ ...td, color: diff?.content ? C.ink : C.faint }}>{diff ? diff.content : '—'}</td>
                        <td style={{ ...td, color: C.mute, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontSize: FS.micro }}>{fmtSync(p.lastSyncedAt)}</td>
                        {/* 연동 절차는 원본 종류와 무관하게 «검증 → 반영» 한 가지다.
                            홈페이지(아이언)만 행에서 되고 시트는 표 밖 일괄뿐이면, 공급사 하나를
                            고쳐도 전체를 다시 돌려야 한다. 같은 엔진에 대상만 좁혀 넘긴다. */}
                        <td style={td}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <Btn
                              title={`${p.name} 원본만 읽어 신규·상태변경·정보수정을 확인`}
                              size="sm"
                              variant="ghost"
                              onClick={() => validateAll([p.code])}
                              disabled={busy || !masterReady || !!rosterError}
                            >
                              {sheetAction === 'validate' && rowValidating ? '검증 중…' : '데이터 검증'}
                            </Btn>
                            <Btn
                              title={`${p.name} 최신 시트를 읽어 검수 후 바로 연동`}
                              size="sm"
                              onClick={() => syncNow([p.code])}
                              disabled={busy || !masterReady || !!rosterError}
                            >
                              {sheetAction === 'sync' && rowValidating ? '연동 중…' : '연동하기'}
                            </Btn>
                          </div>
                        </td>
                      </tr>
                    ) };
                  });
                    return [{ name: '아이언렌트카', node: ironRow }, ...sheetRows]
                      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
                      .map((r) => r.node);
                  })()}
                </tbody>
              </table>
            </div>
          )}
          {ironMessage ? (
            <div style={{
              marginBottom: 8, padding: '7px 9px', borderRadius: R, border: `1px solid ${C.line}`,
              background: C.bg, color: ironMessage.includes('실패') ? C.danger : C.ink,
              fontSize: FS.cap, lineHeight: 1.45,
            }}>
              {ironMessage}
            </div>
          ) : null}
          {ironPreview ? (
            <div style={{ marginBottom: 8, border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', padding: '7px 9px', fontSize: FS.cap, color: C.ink }}>
                <span style={{ fontWeight: FW.title }}>아이언렌트카 검증 결과</span>
                <span>원본 <b>{ironPreview.catalog.listings}</b></span>
                <span>판매중 <b style={{ color: C.ok }}>{ironPreview.catalog.active}</b></span>
                <span>판매완료 <b>{ironPreview.catalog.sold}</b></span>
                <span>신차 <b>{ironPreview.catalog.newCount}</b></span>
                <span>중고 <b>{ironPreview.catalog.usedCount}</b></span>
                <span>매칭 <b>{ironPreview.reconciliation.matched}</b></span>
                <span>중복 <b style={{ color: ironPreview.reconciliation.duplicatePlateGroups ? C.danger : C.ok }}>{ironPreview.reconciliation.duplicatePlateGroups}</b></span>
              </div>
              <div style={{ borderTop: `1px solid ${C.line}`, padding: '7px 9px', fontSize: FS.cap, color: C.ink, lineHeight: 1.55 }}>
                <div>
                  반영후보 <b>{ironPreview.reconciliation.candidateOperations}</b>건 · 정보수정 <b>{ironPreview.reconciliation.patchCandidates}</b>
                  {' '}· 신규 <b style={{ color: C.ok }}>{ironPreview.reconciliation.createCandidates}</b>
                  {' '}· 원본 부재 상태변경 <b style={{ color: C.warn }}>{ironPreview.reconciliation.absentBlockCandidates}</b>
                  {' '}· 판매완료 신규 제외 <b>{ironPreview.reconciliation.ignoredSoldNew}</b>
                </div>
                {ironPreview.candidates.creates.length ? (
                  <div style={{ color: C.mute }}>신규 · {ironPreview.candidates.creates.map((row) => row.key).join(', ')}</div>
                ) : null}
                {ironPreview.candidates.absentBlocks.length ? (
                  <div style={{ color: C.mute }}>상태변경 · {ironPreview.candidates.absentBlocks.map((row) => row.key).join(', ')}</div>
                ) : null}
                <div style={{ color: C.faint, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontSize: FS.micro }}>
                  revision {ironPreview.revision} · {new Date(ironPreview.fetchedAt).toLocaleString('ko-KR')}
                </div>
              </div>
            </div>
          ) : null}
          {pending && (
            <div style={{
              fontSize: FS.cap, color: C.ink, lineHeight: 1.55, marginBottom: 8,
              padding: '8px 10px', borderRadius: R, background: C.taupeBg, border: `1px solid ${C.line}`,
            }}>
              <div style={{ fontWeight: FW.title, color: C.brand, marginBottom: 2 }}>
                검증 결과 {fmtPendingAt(pending.at) ? `· ${fmtPendingAt(pending.at)}` : ''}
                {/* 「판독 몇 행 중 몇 대를 올리고 몇 대를 걸렀나」 — 빈 서식행은 제외한다. */}
                <span style={{ fontWeight: FW.body, color: C.faint }}>
                  {' '}· 판독 {pending.totals.sourceRowCount}행 → 올림 {pending.fetched.products.length}대
                  {pending.totals.excludedCount ? ` · 출고불가 제외 ${pending.totals.excludedCount}대` : ''}
                  {pending.totals.noPriceCount ? ` · 가격없음 ${pending.totals.noPriceCount}대` : ''}
                  {pending.totals.duplicateCount ? ` · 중복 ${pending.totals.duplicateCount}행` : ''}
                  {pending.totals.invalidCount ? ` · 무효 ${pending.totals.invalidCount}행` : ''}
                </span>
              </div>
              <div>
                시트 행 처리 · 올림 {pending.fetched.products.length} · 출고불가 {pending.totals.excludedCount}
                {' '}· 가격없음 {pending.totals.noPriceCount} · 중복 {pending.totals.duplicateCount} · 무효 {pending.totals.invalidCount}
              </div>
              <div>
                기존 재고 반영 · 신규 {pending.totals.new} · 상태변경 {pending.totals.status} · 내용만 수정 {pending.totals.content}
                {' '}· 재고차단 {pending.totals.absent} · 가드보류 {pending.totals.guarded} · 무변경 {pending.totals.unchanged}
              </div>
              {pendingBlockReason && (
                <div style={{ color: C.danger, fontWeight: FW.strong, marginTop: 4 }}>
                  동기화 중단 · {pendingBlockReason} — 원인을 정리하고 다시 검증해야 저장할 수 있습니다.
                  {pending.existingConflictReason && pending.existingConflictReason !== pendingBlockReason ? (
                    <span style={{ display: 'block', marginTop: 2 }}>
                      기존 ERP 충돌 · {pending.existingConflictReason}
                    </span>
                  ) : null}
                  {pending.existingConflictDetail ? (
                    <span style={{ display: 'block', fontWeight: FW.meta, whiteSpace: 'pre-wrap', marginTop: 2 }}>
                      {pending.existingConflictDetail}
                    </span>
                  ) : null}
                </div>
              )}
              {!pendingBlockReason && pending.existingConflictDetail ? (
                <div style={{ color: C.mute, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                  보호 처리 · {pending.existingConflictDetail}
                </div>
              ) : null}
              {pending.priceResolutionCandidates.length || pending.protectedPriceCount ? (
                <div style={{ color: C.mute, marginTop: 4 }}>
                  가격기간 유지 승인 · 적용 {pending.resolvedPriceCount}건
                  {' '}· 승인대기 {Math.max(0, pending.priceResolutionCandidates.length - pending.approvedPriceFingerprints.length)}건
                  {' '}· 계약보호 {pending.protectedPriceCount}건
                </div>
              ) : null}
              {pending.identityConflictReview.summary.total ? (
                <div style={{ color: C.mute, marginTop: 4 }}>
                  신원·미확정 검토 · 공급사 미확정 삭제 {pending.identityConflictReview.summary.unownedDeleted}건
                  {' '}· 번호미정 식별변경 {pending.identityConflictReview.summary.pendingIdentityDrift}건
                  {' '}· 임시번호 신원불일치 {pending.identityConflictReview.summary.pendingSignature}건
                  {' '}· 결정기록 {recordedIdentityDecisionCount}/{pending.identityConflictReview.summary.total}건
                  {' '}· 실행작업 0건
                </div>
              ) : null}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <Btn
              title={busy ? '검증 중' : `등록된 공급사 상품 검증 ${roster.length + 1}개(홈페이지 포함)`}
              variant="ghost"
              onClick={validateEverySource}
              disabled={busy || !masterReady || !!rosterError}
            >
              {sheetAction === 'validate' && validatingCodes === 'all' ? '검증 중…' : '데이터 검증'}
            </Btn>
            <Btn
              title="전체 공급사 최신 원본을 읽어 검수 후 바로 연동"
              onClick={() => syncNow()}
              disabled={busy || !masterReady || !!rosterError || !roster.length}
            >
              {sheetAction === 'sync' && validatingCodes === 'all' ? '연동 중…' : '전체 연동하기'}
            </Btn>
            {/*
              재고관리에서는 이 한 줄이 «검증 결과의 전부»다.
              어느 공급사가 왜 막혔는지·충돌 원문은 개발도구에서 본다.
            */}
            {compact && pending ? (
              <div style={{ flexBasis: '100%', fontSize: FS.cap, lineHeight: 1.6, color: C.mute, marginTop: 4 }}>
                <b style={{ color: C.ink }}>검증됨</b> · 원본 {pending.fetched.products.length}대
                {' · '}신규 <b style={{ color: C.ink }}>{pending.totals.new}</b>
                {' · '}상태변경 <b style={{ color: C.ink }}>{pending.totals.status}</b>
                {' · '}정보수정 <b style={{ color: C.ink }}>{pending.totals.content}</b>
                {pending.totals.absent ? ` · 원본에 없어 출고불가 ${pending.totals.absent}` : ''}
                {pending.totals.guarded ? ` · 계약보호로 건너뜀 ${pending.totals.guarded}` : ''}
                {pendingBlockReason ? (
                  <div style={{ color: C.danger, fontWeight: FW.strong, marginTop: 2 }}>
                    반영 차단 — {pendingBlockReason} · 자세한 것은 개발도구에서 확인하세요.
                  </div>
                ) : null}
              </div>
            ) : null}
            {compact && !pending ? (
              <div style={{ flexBasis: '100%', fontSize: FS.cap, color: C.faint, marginTop: 4 }}>
                「데이터 검증」을 먼저 누르세요 — 공급사 {roster.length + 1}곳의 원본을 읽어 무엇이 바뀌는지 보여줍니다.
              </div>
            ) : null}
            {pendingPriceApprovalGroups.map((group) => (
              <Btn
                key={group.key}
                title={`${group.label}. 누락기간 기존가 보존·새 표준가격 기본가 적용 가능·계약 차량 제외·원문 변경 시 자동 무효`}
                variant="ghost"
                onClick={() => approvePricePeriodPreservation(group)}
                disabled={busy}
              >
                {group.label} 승인 ({group.candidates.length})
              </Btn>
            ))}
            {pending?.approvedPriceFingerprints.length ? (
              <Btn title="현재 검증에 적용된 기존 가격 유지 승인을 철회" variant="ghost" onClick={revokePricePeriodPreservation} disabled={busy}>
                가격 유지 승인 철회 ({pending.approvedPriceFingerprints.length})
              </Btn>
            ) : null}
            {decisionQueueRows.length ? (
              <Btn
                title="소유권 충돌과 삭제이력 재등장을 차량별로 검토합니다. 결정 기록만 하며 재고는 변경하지 않습니다."
                variant="ghost"
                onClick={() => setDecisionQueueOpen(true)}
                disabled={busy}
              >
                소유권·삭제 결정 ({recordedDecisionCount}/{decisionQueueRows.length})
              </Btn>
            ) : null}
            {decisionQueueRows.length ? (
              <Btn
                title="현재 검증 스냅샷과 기록된 결정을 대조한 무저장 계획입니다. 실행 가능한 patch는 만들지 않습니다."
                variant="ghost"
                onClick={copyConflictDecisionDryRun}
                disabled={busy}
              >
                결정 dry-run TSV
              </Btn>
            ) : null}
            {pending?.identityConflictReview.rows.length ? (
              <Btn
                title="공급사 미확정 삭제와 임시번호 충돌을 변경 원자별로 검토합니다."
                variant="ghost"
                onClick={() => setIdentityReviewOpen(true)}
                disabled={busy}
              >
                신원·미확정 결정 ({recordedIdentityDecisionCount}/{pending.identityConflictReview.summary.total})
              </Btn>
            ) : null}
            {decisionApplicationPlan?.rows.length ? (
              <Btn
                title="기록된 소유권·삭제·신원 판단을 현재 재고와 대조해 유입제외·복구·신규·참조이관 후보를 계산합니다. 실제 저장은 하지 않습니다."
                variant="ghost"
                onClick={copyDecisionApplicationPlan}
                disabled={busy}
              >
                적용 계획 TSV ({decisionApplicationPlan.summary.candidateReview + decisionApplicationPlan.summary.referenceMigrations})
              </Btn>
            ) : null}
            {decisionPatchDryRun?.rows.length ? (
              <Btn
                title="적용 계획의 공개 v4 patch와 CAS 기대값을 JSON으로 계산합니다. private 값과 실제 저장 동작은 포함하지 않습니다."
                variant="ghost"
                onClick={copyDecisionPatchDryRun}
                disabled={busy}
              >
                patch dry-run JSON ({decisionPatchDryRun.summary.readyReview})
              </Btn>
            ) : null}
            {pending?.existingConflictRows.length ? (
              <Btn title="레코드 키·공급사·상태·출처·계약보호·권장조치가 포함된 TSV" variant="ghost" onClick={copyConflictReport} disabled={busy}>
                상세 충돌 TSV 복사
              </Btn>
            ) : null}
          </div>

          {/* 공급사별 수정범위 — 합계 한 줄로 뭉개면 어느 업체가 문제인지 안 보인다.
              동기화를 누르기 전에 "어디가 몇 대 바뀌는지"를 업체 단위로 확인하는 자리다. */}
          {pending && pending.perPartner.length > 0 && (
            <div style={{ marginTop: 10, border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: `1px solid ${C.line}`, fontSize: FS.cap, fontWeight: FW.head, color: C.mute }}>
                <span style={{ flex: 1 }}>업체별 수정범위</span>
                <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', color: C.faint }}>동기화 전 확인</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: FS.cap, fontVariantNumeric: 'tabular-nums' }}>
                  <thead>
                    <tr style={{ color: C.faint, textAlign: 'right' }}>
                      <th style={{ textAlign: 'left', padding: '5px 8px', fontWeight: FW.meta }}>공급사</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }}>판정</th>
                      {/* 올림 = 실제로 등록될 대수 · 제외 = 시트에 출고불가로 적혀 있어 읽지 않은 대수 */}
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }}>올림</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }}>제외</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }}>가격없음</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }}>중복</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }}>무효</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }}>신규</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }}>상태변경</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }}>내용만 수정</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }} title="시트 삭제·출고불가·가격없음으로 기존 재고를 출고불가 처리">재고차단</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }} title="급감가드가 차단한 재고차단 후보">가드보류</th>
                      <th style={{ padding: '5px 8px', fontWeight: FW.meta }}>무변경</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.perPartner.map((p) => (
                      <tr key={p.code} style={{ borderTop: `1px solid ${C.line2}`, textAlign: 'right' }}>
                        <td style={{ textAlign: 'left', padding: '5px 8px', color: p.ok ? C.ink : C.danger, whiteSpace: 'nowrap' }}>
                          {p.label}
                          {p.note ? <span style={{ color: C.faint, fontWeight: FW.meta }}> · {p.note}</span> : null}
                          {(p.statusDetail || p.fieldDetail) ? (
                            <span style={{ display: 'block', color: C.faint, fontWeight: FW.meta, fontSize: FS.micro }}>
                              {p.statusDetail ? `상태 ${p.statusDetail}` : ''}
                              {p.statusDetail && p.fieldDetail ? ' · ' : ''}
                              {p.fieldDetail ? `필드 ${p.fieldDetail}` : ''}
                            </span>
                          ) : null}
                          {p.issues ? (
                            <span style={{ display: 'block', color: C.warn, fontWeight: FW.meta, fontSize: FS.micro }}>
                              원본 확인 · {p.issues}
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', color: p.readiness === 'blocked' ? C.danger : p.readiness === 'review' ? C.warn : C.ok }} title={p.readinessReason}>
                          {p.readiness === 'blocked' ? '차단' : p.readiness === 'review' ? '확인 필요' : '반영 가능'}
                        </td>
                        <td style={{ padding: '5px 8px', color: p.sheet ? C.ink : C.faint }}>{p.sheet || '—'}</td>
                        <td style={{ padding: '5px 8px', color: p.excluded ? C.mute : C.faint }}>{p.excluded || '—'}</td>
                        <td style={{ padding: '5px 8px', color: p.noPrice ? C.warn : C.faint, fontWeight: p.noPrice ? FW.strong : FW.body }}>{p.noPrice || '—'}</td>
                        <td style={{ padding: '5px 8px', color: p.duplicate ? C.warn : C.faint, fontWeight: p.duplicate ? FW.strong : FW.body }}>{p.duplicate || '—'}</td>
                        <td style={{ padding: '5px 8px', color: p.invalid ? C.danger : C.faint, fontWeight: p.invalid ? FW.strong : FW.body }}>{p.invalid || '—'}</td>
                        <td style={{ padding: '5px 8px', color: p.new ? C.ok : C.faint, fontWeight: p.new ? FW.strong : FW.body }}>{p.new || '—'}</td>
                        <td style={{ padding: '5px 8px', color: p.status ? C.ink : C.faint }}>{p.status || '—'}</td>
                        <td style={{ padding: '5px 8px', color: p.content ? C.ink : C.faint }}>{p.content || '—'}</td>
                        {/* 시트에서 빠진 차(행 삭제 + 출고불가 표기) — 지우지 않고 출고불가로 내린다.
                            시트 행수 대비 과하게 크면 시트 사고를 의심해야 한다. */}
                        <td style={{ padding: '5px 8px', color: p.absent ? C.warn : C.faint, fontWeight: p.absent ? FW.strong : FW.body }}>{p.absent || '—'}</td>
                        <td style={{ padding: '5px 8px', color: p.guarded ? C.danger : C.faint, fontWeight: p.guarded ? FW.strong : FW.body }}>{p.guarded || '—'}</td>
                        <td style={{ padding: '5px 8px', color: C.faint }}>{p.unchanged || '—'}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: `1px solid ${C.line}`, textAlign: 'right', fontWeight: FW.head }}>
                      <td style={{ textAlign: 'left', padding: '5px 8px' }}>합계</td>
                      <td style={{ padding: '5px 8px' }}>—</td>
                      <td style={{ padding: '5px 8px' }}>{pending.fetched.products.length}</td>
                      <td style={{ padding: '5px 8px', color: C.mute }}>{pending.totals.excludedCount}</td>
                      <td style={{ padding: '5px 8px', color: C.warn }}>{pending.totals.noPriceCount}</td>
                      <td style={{ padding: '5px 8px', color: C.warn }}>{pending.totals.duplicateCount}</td>
                      <td style={{ padding: '5px 8px', color: C.danger }}>{pending.totals.invalidCount}</td>
                      <td style={{ padding: '5px 8px', color: C.ok }}>{pending.totals.new}</td>
                      <td style={{ padding: '5px 8px' }}>{pending.totals.status}</td>
                      <td style={{ padding: '5px 8px' }}>{pending.totals.content}</td>
                      <td style={{ padding: '5px 8px', color: C.warn }}>{pending.totals.absent}</td>
                      <td style={{ padding: '5px 8px', color: C.danger }}>{pending.totals.guarded}</td>
                      <td style={{ padding: '5px 8px', color: C.mute }}>{pending.totals.unchanged}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 검증된 매물을 «영업자가 볼 화면 그대로» 미리 본다 — 숫자 요약만으로는
              제조사가 비었는지 사진이 안 왔는지 반영 후에야 알게 된다. */}
          {pending && pending.fetched.products.length > 0 && (
            <div style={{ marginTop: 10, border: `1px solid ${C.line}`, borderRadius: R, padding: 10, background: C.bg }}>
              <div style={{ fontSize: FS.cap, fontWeight: FW.head, color: C.mute, marginBottom: 8 }}>
                반영 전 미리보기 · 저장하지 않은 상태
              </div>
              <SyncPreview
                products={pending.fetched.products}
                sources={pending.fetched.lines
                  .filter((line) => line.ok && line.products.length)
                  .map((line) => ({ code: line.code, label: line.label, products: line.products }))}
                masterEntries={master || undefined}
              />
            </div>
          )}

          {bulkLog && (
            <pre style={{ margin: '8px 0 0', fontSize: FS.cap, color: C.mute, whiteSpace: 'pre-wrap', maxHeight: 130, overflowY: 'auto', fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{bulkLog}</pre>
          )}
        </div>
        </>
      )}

      <Modal
        open={decisionQueueOpen}
        title="소유권·삭제 결정 검토"
        meta={`기록 ${recordedDecisionCount}/${decisionQueueRows.length} · 계약보호 ${protectedDecisionCount}`}
        onClose={() => setDecisionQueueOpen(false)}
        width={1080}
        footer={<Btn variant="ghost" onClick={() => setDecisionQueueOpen(false)}>닫기</Btn>}
      >
        <div style={{
          padding: '9px 10px', marginBottom: 10, border: `1px solid ${C.line}`, borderRadius: R,
          background: C.selected, color: C.mute, fontSize: FS.cap, lineHeight: 1.5,
        }}>
          이 화면은 차량별 관리자 판단을 기록하는 검토함입니다. 기록만으로 재고·삭제이력·공급사 귀속은 바뀌지 않으며,
          동기화 차단도 해제되지 않습니다. 계약보호 또는 관련 상품이 하나로 특정되지 않는 건은 선택할 수 없습니다.
        </div>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 10,
          color: C.mute, fontSize: FS.cap, lineHeight: 1.5,
        }}>
          <span>미결정 {decisionDryRun.summary.undecided}</span>
          <span>계약보호 {decisionDryRun.summary.protected}</span>
          <span>대상모호 {decisionDryRun.summary.ambiguous}</span>
          <span>기존귀속 유지 {decisionDryRun.summary.keepExistingReady}</span>
          <span>참조이관 필요 {decisionDryRun.summary.assignOwnerMigration}</span>
          <span>삭제유지 {decisionDryRun.summary.keepDeletedReady}</span>
          <span>복구후보 {decisionDryRun.summary.restoreCandidates}</span>
          <span style={{ color: C.danger, fontWeight: FW.strong }}>실행작업 0</span>
        </div>
        {decisionQueueRows.length ? (
          <div style={{ maxHeight: '62vh', overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: R }}>
            <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', background: C.taupeBg }}>
              <thead>
                <tr>
                  <th style={th}>구분</th>
                  <th style={th}>차량</th>
                  <th style={th}>현재 ERP</th>
                  <th style={th}>현재 Sheet</th>
                  <th style={th}>관련 상품</th>
                  <th style={th}>보호·확인</th>
                  <th style={{ ...th, minWidth: 210 }}>관리자 결정</th>
                </tr>
              </thead>
              <tbody>
                {decisionQueueRows.map((row) => {
                  const active = activeDecisionByFingerprint.get(row.fingerprint);
                  const blockReason = sheetConflictDecisionTargetBlockReason(row);
                  const displayReason = blockReason
                    || (row.mergedAlias ? '병합 별칭 · 삭제 유지 결정만 가능' : '');
                  const options = row.category === OWNERSHIP_CONFLICT
                    ? [
                      { value: KEEP_EXISTING_OWNER, label: sheetConflictDecisionLabel(KEEP_EXISTING_OWNER) },
                      { value: ASSIGN_SHEET_OWNER, label: sheetConflictDecisionLabel(ASSIGN_SHEET_OWNER) },
                    ]
                    : [
                      { value: KEEP_DELETED, label: sheetConflictDecisionLabel(KEEP_DELETED) },
                      ...(row.mergedAlias ? [] : [
                        { value: RESTORE_DELETED, label: sheetConflictDecisionLabel(RESTORE_DELETED) },
                      ]),
                    ];
                  return (
                    <tr key={row.fingerprint} style={{ borderTop: `1px solid ${C.line2}` }}>
                      <td style={td}>{row.category === OWNERSHIP_CONFLICT ? '소유권' : '삭제이력'}</td>
                      <td style={{ ...td, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong }}>{row.carNumber || '확인 필요'}</td>
                      <td style={td}>{row.providers.join(', ') || '미확정'}</td>
                      <td style={td}>{row.sheetProviders.join(', ') || '미확정'}</td>
                      <td style={{ ...td, color: C.mute }}>
                        {row.productKeys.length === 1 ? row.productKeys[0] : `${row.productKeys.length}개`}
                      </td>
                      <td style={{ ...td, whiteSpace: 'normal', minWidth: 180, color: displayReason ? C.danger : C.ok }}>
                        {displayReason || '건별 결정 가능'}
                      </td>
                      <td style={{ ...td, minWidth: 210 }}>
                        {active ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ color: C.brand, fontWeight: FW.strong }}>
                              {sheetConflictDecisionLabel(active.decision)}
                            </span>
                            <Btn
                              size="sm"
                              variant="ghost"
                              title="기록된 판단 철회"
                              onClick={() => revokeConflictDecision(row)}
                              disabled={busy}
                            >
                              철회
                            </Btn>
                          </div>
                        ) : (
                          <Select
                            value=""
                            placeholder="결정 선택"
                            ariaLabel={`${row.carNumber} 관리자 결정`}
                            options={options}
                            onChange={(value) => value && recordConflictDecision(row, value as SheetConflictDecisionValue)}
                            disabled={busy || Boolean(blockReason)}
                            size="sm"
                            full
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 20, textAlign: 'center', color: C.faint, fontSize: FS.sub }}>
            현재 검증 스냅샷에 소유권·삭제 결정 대상이 없습니다.
          </div>
        )}
      </Modal>

      <Modal
        open={identityReviewOpen}
        title="신원·미확정 충돌 검토"
        meta={`기록 ${recordedIdentityDecisionCount}/${pending?.identityConflictReview.summary.total || 0} · 계약보호 ${pending?.identityConflictReview.summary.protected || 0} · 실행작업 0`}
        onClose={() => setIdentityReviewOpen(false)}
        width={1120}
        footer={(
          <>
            <Btn
              variant="ghost"
              onClick={copyIdentityConflictReview}
              disabled={!pending?.identityConflictReview.rows.length}
            >
              dry-run TSV 복사
            </Btn>
            <Btn variant="ghost" onClick={() => setIdentityReviewOpen(false)}>닫기</Btn>
          </>
        )}
      >
        <div style={{
          padding: '9px 10px', marginBottom: 10, border: `1px solid ${C.line}`, borderRadius: R,
          background: C.selected, color: C.mute, fontSize: FS.cap, lineHeight: 1.5,
        }}>
          공급사 없는 삭제이력과 임시번호의 신원 원자를 현재 Sheet와 대조해 차량별 관리자 판단을 기록합니다.
          동일 차량 수정인지 다른 실물 교체인지는 자동 판단하지 않습니다. 결정은 별도 원장에만 남고 재고·번호·삭제이력·동기화 차단은 바뀌지 않습니다.
        </div>
        {pending?.identityConflictReview.rows.length ? (
          <div style={{ maxHeight: '62vh', overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: R }}>
            <table style={{ width: '100%', minWidth: 1280, borderCollapse: 'collapse', background: C.taupeBg }}>
              <thead>
                <tr>
                  <th style={th}>구분</th>
                  <th style={th}>차량</th>
                  <th style={th}>현재 Sheet 공급사</th>
                  <th style={th}>기존 상품키</th>
                  <th style={th}>현재 Sheet 키</th>
                  <th style={th}>변경 원자</th>
                  <th style={th}>보호·판정</th>
                  <th style={{ ...th, minWidth: 230 }}>다음 확인</th>
                  <th style={{ ...th, minWidth: 250 }}>관리자 결정</th>
                </tr>
              </thead>
              <tbody>
                {pending.identityConflictReview.rows.map((row, index) => {
                  const active = activeIdentityDecisionByFingerprint.get(row.fingerprint);
                  const blockReason = identityDecisionBlockReason(row);
                  const targetMismatch = active && (
                    active.provider !== row.provider
                    || active.existing_key !== row.existingKeys[0]
                    || active.incoming_key !== row.incomingKeys[0]
                  );
                  const options = sheetIdentityDecisionOptions(row.category)
                    .map((value) => ({ value, label: sheetIdentityDecisionLabel(value) }));
                  return (
                    <tr key={`${row.category}|${row.fingerprint}|${index}`} style={{ borderTop: `1px solid ${C.line2}` }}>
                      <td style={td}>{row.category}</td>
                      <td style={{ ...td, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong }}>{row.carNumbers.join(' ↔ ') || '확인 필요'}</td>
                      <td style={td}>{row.provider || '미확정'}</td>
                      <td style={{ ...td, whiteSpace: 'normal', maxWidth: 180 }}>{row.existingKeys.join(', ') || '없음'}</td>
                      <td style={{ ...td, whiteSpace: 'normal', maxWidth: 180 }}>{row.incomingKeys.join(', ') || '없음'}</td>
                      <td style={{ ...td, whiteSpace: 'normal', color: row.changedAtoms.length ? C.warn : C.mute }}>
                        {row.changedAtoms.join(', ') || '변경 없음'}
                      </td>
                      <td style={{
                        ...td, whiteSpace: 'normal', minWidth: 180,
                        color: blockReason || targetMismatch ? C.danger : C.mute,
                      }}>
                        {blockReason || (targetMismatch ? '기록 대상키 불일치 · 철회 후 재검토' : row.reason)}
                      </td>
                      <td style={{ ...td, whiteSpace: 'normal', minWidth: 230 }}>{row.nextAction}</td>
                      <td style={{ ...td, minWidth: 250 }}>
                        {active ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ color: targetMismatch ? C.danger : C.brand, fontWeight: FW.strong }}>
                              {sheetIdentityDecisionLabel(active.decision)}
                            </span>
                            <Btn
                              size="sm"
                              variant="ghost"
                              title="기록된 신원 판단 철회"
                              onClick={() => revokeIdentityDecision(row)}
                              disabled={busy}
                            >
                              철회
                            </Btn>
                          </div>
                        ) : (
                          <Select
                            value=""
                            placeholder="결정 선택"
                            ariaLabel={`${row.carNumbers.join(' ↔ ')} 신원 관리자 결정`}
                            options={options}
                            onChange={(value) => value && recordIdentityDecision(row, value as SheetIdentityDecisionValue)}
                            disabled={busy || Boolean(blockReason)}
                            size="sm"
                            full
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 20, textAlign: 'center', color: C.faint, fontSize: FS.sub }}>
            현재 검증 스냅샷에 신원·미확정 검토 대상이 없습니다.
          </div>
        )}
      </Modal>

      {/* 단일 시트·엑셀 업로드는 **공급사 본인 수동 업로드**다. 관리자 화면에서는 감춘다 —
          운영 유입은 「등록된 공급사 일괄」 한 경로로만 간다. 손으로 올린 건이 섞이면
          어느 매물이 어느 시트에서 왔는지 추적이 끊기고, 같은 차가 두 코드로 앉는다. */}
      {!isAdmin && (
      <>
      <PillTabs tabs={[{ key: 'sheet', label: '단일 시트' }, { key: 'excel', label: '엑셀 업로드' }]} value={tab} onChange={(k) => { setTab(k); clear(); }} size="sm" />
      {!isAdmin && (
        <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.45, padding: '6px 8px', background: C.head, borderRadius: R }}>
          <b style={{ color: C.ink }}>수동 업로드</b> — 구글시트/엑셀 → 불러오기 → 차량번호 매핑 → 차종 변환 후 저장. 삭제·중복 충돌과 저장 직전 재고 변경은 자동 차단합니다.
          {partnerHint ? <span style={{ display: 'block', marginTop: 4, color: C.faint }}>{partnerHint}</span> : null}
        </div>
      )}
      {isAdmin && <Input value={prov} onChange={(v) => setProv(v)} placeholder="공급사 코드(단일·매핑학습용)" full />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Select value={adapterId} onChange={(v) => { clear(); setAdapterId((v as SheetAdapterId) || 'generic'); }} options={ADAPTER_OPTIONS} full placeholder="어댑터" />
        <Input value={headerRow} onChange={(v) => { clear(); setHeaderRow(v); }} placeholder="헤더 행(0=첫줄)" full />
      </div>
      <Select
        value={depositRule}
        onChange={(v) => {
          setDepositRule(parseDepositRule(v));
          if (mergedProducts) setMappingReloadRequired(true);
        }}
        options={[...DEPOSIT_RULE_OPTIONS]}
        full
        placeholder="보증금 규칙"
      />
      {tab === 'sheet' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <Input value={url} onChange={(v) => { clear(); setUrl(v); }} placeholder="구글시트 URL" full style={{ flex: 1, minWidth: 0 }} />
            <Btn title="구글시트 불러오기" variant="ghost" onClick={loadSheet} disabled={busy}>불러오기</Btn>
          </div>
          <Input value={gid} onChange={(v) => { clear(); setGid(v); }} placeholder="gid(선택·탭)" full />
        </div>
      ) : (
        <>
          {/* 엑셀 붙여넣기 = 열 정렬이 보여야 하므로 고정폭 폰트가 의도적(원자 규격 위에 mono만 덮음) */}
          <Textarea full rows={4} value={paste} onChange={(v) => { clear(); setPaste(v); }}
            placeholder={'엑셀 복사→붙여넣기 (첫 줄=헤더, 탭)\n차량번호\t제조사\t모델\t연식'}
            style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }} />
          <Btn title="엑셀 붙여넣기 불러오기" size="sm" variant="ghost" onClick={loadExcel} disabled={busy}>불러오기</Btn>
        </>
      )}

      {table && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SectionLabel>컬럼 매핑 <span style={{ fontSize: FS.cap, fontWeight: FW.body, color: C.faint }}>· 틀린 칸만 바꾸면 학습됩니다</span></SectionLabel>
          <div style={{ maxHeight: 210, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(table[0] || []).map((h, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 6, alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: FS.sub, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(h || `(빈 헤더 ${i})`)}</div>
                  <div style={{ fontSize: FS.micro, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>예: {String(table[1]?.[i] ?? '')}</div>
                </div>
                <Select value={fieldForCol(i)} onChange={(v) => setColField(i, v)} placeholder="(무시)" size="sm" full
                  options={IMPORT_FIELDS.map((f) => ({ value: f.key, label: f.label }))} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: FS.cap, color: C.mute, borderTop: `1px solid ${C.line2}`, paddingTop: 6, lineHeight: 1.55 }}>
            {previewState.error ? (
              <span style={{ color: C.danger }}>미리보기 중단 — {previewState.error}</span>
            ) : !masterReady ? (
              <span style={{ color: C.danger }}>차종마스터 없음 — 변환 저장 불가</span>
            ) : (
              <>
                취합 <b>{preview?.imported ?? 0}</b> · 마스터 확정 <b style={{ color: C.brand }}>{preview?.confirmed ?? 0}</b>
                · 검수 <b style={{ color: preview && preview.review > 0 ? C.warn : C.mute }}>{preview?.review ?? 0}</b>
                <span style={{ color: C.faint }}> (high {preview?.snap.high ?? 0}·중 {preview?.snap.medium ?? 0}·검토 {preview?.snap.low ?? 0}{preview?.snap.none ? `·미매칭 ${preview.snap.none}` : ''})</span>
                {preview?.skipped ? ` · 건너뜀 ${preview.skipped}` : ''}
                {preview && preview.excludedCount > 0 ? (
                  <span style={{ color: C.faint }}> · 출고불가 제외 {preview.excludedCount}</span>
                ) : null}
              </>
            )}
            {!mergedProducts && !('car_number' in mapping) && <span style={{ color: C.danger }}> · ⚠ 차량번호 컬럼 지정 필요</span>}
          </div>
          {diffBanner && (
            <div style={{
              fontSize: FS.cap, color: C.ink, lineHeight: 1.55,
              padding: '8px 10px', borderRadius: R, background: C.selected, border: `1px solid ${C.line}`,
            }}>
              <div style={{ fontWeight: FW.title, color: C.brand, marginBottom: 2 }}>저장 전 변경 요약</div>
              {diffBanner}
            </div>
          )}
          {/* 한 장짜리 원본도 저장 전에 실제 화면으로 본다 — 매핑이 틀리면 여기서 바로 드러난다. */}
          {preview && preview.products.length > 0 && (
            <SyncPreview products={preview.products} masterEntries={master || undefined} />
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn title="매핑과 URL 저장" size="sm" variant="ghost" onClick={saveMapping} disabled={busy}>매핑·URL 저장</Btn>
            <Btn
              title={`동기화 ${preview?.products.length ?? 0}건`}
              size="sm"
              onClick={convertAndSave}
              disabled={busy || mappingReloadRequired || !masterReady || !preview?.products.length || (!mergedProducts && !('car_number' in mapping))}
            >
              {`동기화 (${preview?.products.length ?? 0})`}
            </Btn>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
