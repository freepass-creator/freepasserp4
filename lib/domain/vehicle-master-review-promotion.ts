export const VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS = [
  '제조국', '제조사', '모델', '세부모델', '세부트림', '연료', '배기량cc', '과급', '배터리kWh',
  '구동', '구동시스템', '인승', '차종분류', '차체형태', '연식시작', '연식종료', '생산시작', '생산종료',
  '기존 세부모델', '공식근거', '기존 트림행키', '검증상태', '확인필요항목', '확인질문',
] as const;

/**
 * A keyed companion table is intentionally used instead of adding columns to
 * `차종마스터`. Several legacy sort tools still sort only A:AD, so attached
 * columns could silently detach from their permanent key.
 */
export const VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS = [
  '트림행키',
  '규격그룹키',
  '규격채택상태',
  '채택승인기록시각',
  '채택승인근거',
  '운영등급변경',
  ...VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS.map((header) => `규격_${header}`),
] as const;

export const VEHICLE_MASTER_REVIEW_ADOPTION_TAB = '차종마스터_규격채택';
export const VEHICLE_MASTER_REVIEW_ADOPTION_CONTRACT_VERSION = 'vehicle_master_review_adoption_v1';

// Sheets omits default `false` booleans from JSON responses. Accept only the
// explicit true form for hidden sheets and false/omitted for visible sheets.
export const matchesGoogleSheetHiddenProperty = (value: unknown, expectedHidden: boolean) =>
  expectedHidden ? value === true : value === false || value === undefined;

export type VehicleMasterReviewPromotionEntry = {
  trimRowKey: string;
  currentMasterSheetRow: number;
  reviewSheetRow: number;
  groupFingerprint: string;
  reviewStatus: string;
  hasSelectionQuestions: boolean;
  adoptionStatus: 'pending_human_adoption' | 'review_only';
  targetValues: unknown[];
};

type LiveMasterKeyRow = { trimRowKey?: unknown; sheetRow?: unknown };

const text = (value: unknown) => String(value ?? '').trim();
const canonicalText = (value: unknown) => text(value).normalize('NFC').replace(/\s+/g, ' ');

export const splitVehicleMasterLegacyKeys = (value: unknown) => [
  ...new Set(text(value).split(/[|\r\n]+/).map((key) => key.trim()).filter(Boolean)),
];

export function buildVehicleMasterReviewPromotionEntries(args: {
  reviewHeaders: string[];
  reviewRows: unknown[][];
  reviewSheetRows?: number[];
  liveMasterKeyRows: LiveMasterKeyRow[];
  knownArtifactKeys: Set<string>;
  groupFingerprintForRow: (row: unknown[], reviewSheetRow: number) => string;
}): VehicleMasterReviewPromotionEntry[] {
  const { reviewHeaders, reviewRows, reviewSheetRows, liveMasterKeyRows, knownArtifactKeys, groupFingerprintForRow } = args;
  if (reviewHeaders.join('\u0000') !== VEHICLE_MASTER_REVIEW_REQUIRED_HEADERS.join('\u0000')) {
    throw new Error('규격검토 헤더가 승격 계약과 다릅니다.');
  }
  if (reviewSheetRows && reviewSheetRows.length !== reviewRows.length) {
    throw new Error('규격검토 값과 원본 행번호 수가 다릅니다.');
  }

  const liveMasterRows = new Map<string, number>();
  for (const record of liveMasterKeyRows) {
    const key = text(record.trimRowKey);
    const sheetRow = Number(record.sheetRow || 0);
    if (!key || !Number.isInteger(sheetRow) || sheetRow < 2) {
      throw new Error('라이브 차종마스터 키/행 색인에 빈값 또는 잘못된 행이 있습니다.');
    }
    if (liveMasterRows.has(key)) throw new Error(`라이브 차종마스터 영구키가 중복됩니다: ${key}`);
    liveMasterRows.set(key, sheetRow);
  }

  const keyColumn = reviewHeaders.indexOf('기존 트림행키');
  const statusColumn = reviewHeaders.indexOf('검증상태');
  const questionColumn = reviewHeaders.indexOf('확인질문');
  const entries: VehicleMasterReviewPromotionEntry[] = [];
  const seenKeys = new Set<string>();
  const fingerprintRows = new Map<string, string>();

  reviewRows.forEach((row, index) => {
    const reviewSheetRow = reviewSheetRows?.[index] ?? index + 2;
    const keys = splitVehicleMasterLegacyKeys(row[keyColumn]);
    if (!keys.length) throw new Error(`규격검토 ${reviewSheetRow}행에 기존 트림행키가 없습니다.`);
    const reviewStatus = text(row[statusColumn]);
    if (!['구조확인', '중복통합검토', '검토필요'].includes(reviewStatus)) {
      throw new Error(`규격검토 ${reviewSheetRow}행의 상태가 허용 목록에 없습니다: ${reviewStatus}`);
    }
    const groupFingerprint = text(groupFingerprintForRow(row, reviewSheetRow));
    if (!/^sha256:[0-9a-f]{64}$/.test(groupFingerprint)) {
      throw new Error(`규격검토 ${reviewSheetRow}행의 그룹 지문이 올바르지 않습니다.`);
    }
    const semanticSignature = JSON.stringify(row.slice(0, 18).map(canonicalText));
    const priorSignature = fingerprintRows.get(groupFingerprint);
    if (priorSignature && priorSignature !== semanticSignature) {
      throw new Error(`서로 다른 규격 행의 그룹 지문이 충돌합니다: ${groupFingerprint}`);
    }
    if (priorSignature) throw new Error(`규격검토에 중복 규격 행이 남아 있습니다: ${reviewSheetRow}`);
    fingerprintRows.set(groupFingerprint, semanticSignature);
    const hasSelectionQuestions = text(row[questionColumn]) !== '추가 질문 없음';

    for (const trimRowKey of keys) {
      if (seenKeys.has(trimRowKey)) throw new Error(`규격검토에서 영구키가 중복 참조됩니다: ${trimRowKey}`);
      seenKeys.add(trimRowKey);
      if (!knownArtifactKeys.has(trimRowKey)) throw new Error(`현행 artifact에 없는 영구키입니다: ${trimRowKey}`);
      const currentMasterSheetRow = liveMasterRows.get(trimRowKey) || 0;
      if (!currentMasterSheetRow) throw new Error(`라이브 차종마스터에서 영구키를 찾을 수 없습니다: ${trimRowKey}`);
      const adoptionStatus = reviewStatus === '구조확인' ? 'pending_human_adoption' : 'review_only';
      entries.push({
        trimRowKey,
        currentMasterSheetRow,
        reviewSheetRow,
        groupFingerprint,
        reviewStatus,
        hasSelectionQuestions,
        adoptionStatus,
        // `구조확인` is generated from drive/seat completeness. It is not a
        // human approval or an operational 확정, so the dry-run remains pending.
        targetValues: [
          trimRowKey,
          groupFingerprint,
          adoptionStatus === 'pending_human_adoption'
            ? hasSelectionQuestions ? '채택대기(선택질문유지)' : '채택대기'
            : '검토유지',
          '',
          '',
          '없음',
          ...row,
        ],
      });
    }
  });

  const currentRows = new Set(entries.map((entry) => entry.currentMasterSheetRow));
  if (currentRows.size !== entries.length) throw new Error('라이브 차종마스터의 서로 다른 키가 같은 현재 행을 가리킵니다.');
  return entries;
}

export const summarizeVehicleMasterReviewPromotion = (entries: VehicleMasterReviewPromotionEntry[]) => {
  const groupSizes = new Map<string, number>();
  for (const entry of entries) groupSizes.set(entry.groupFingerprint, (groupSizes.get(entry.groupFingerprint) || 0) + 1);
  return {
    keyRows: entries.length,
    reviewGroups: groupSizes.size,
    singleKeyGroups: [...groupSizes.values()].filter((count) => count === 1).length,
    twoKeyGroups: [...groupSizes.values()].filter((count) => count === 2).length,
    maxKeysPerGroup: Math.max(...groupSizes.values()),
    pendingHumanAdoption: entries.filter((entry) => entry.adoptionStatus === 'pending_human_adoption').length,
    pendingWithoutSelectionQuestions: entries.filter((entry) => entry.adoptionStatus === 'pending_human_adoption' && !entry.hasSelectionQuestions).length,
    pendingWithSelectionQuestions: entries.filter((entry) => entry.adoptionStatus === 'pending_human_adoption' && entry.hasSelectionQuestions).length,
    reviewOnly: entries.filter((entry) => entry.adoptionStatus === 'review_only').length,
    operationalStatusChanges: 0,
    byReviewStatus: Object.fromEntries([...new Set(entries.map((entry) => entry.reviewStatus))]
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .map((status) => [status, entries.filter((entry) => entry.reviewStatus === status).length])),
    minCurrentMasterSheetRow: Math.min(...entries.map((entry) => entry.currentMasterSheetRow)),
    maxCurrentMasterSheetRow: Math.max(...entries.map((entry) => entry.currentMasterSheetRow)),
  };
};

export function finalizeVehicleMasterReviewAdoptionRows(
  entries: VehicleMasterReviewPromotionEntry[],
  approvedAt: string,
  approvalBasis: string,
): unknown[][] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(approvedAt)) {
    throw new Error('규격채택 승인시각은 UTC ISO-8601이어야 합니다.');
  }
  if (!text(approvalBasis)) throw new Error('규격채택 승인근거가 없습니다.');
  return entries.map((entry) => {
    const values = [...entry.targetValues];
    values[2] = entry.adoptionStatus === 'review_only'
      ? '검토유지'
      : entry.hasSelectionQuestions ? '규격구조채택(선택질문유지)' : '규격구조채택';
    values[3] = entry.adoptionStatus === 'review_only' ? '' : approvedAt;
    values[4] = entry.adoptionStatus === 'review_only' ? '' : approvalBasis;
    values[5] = '없음';
    return values;
  });
}
