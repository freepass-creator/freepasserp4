/**
 * 규격채택 → 운영 차종마스터 승격 계획(쓰기 없음).
 *
 * 기본 apply 범위 = 이름 4축(제조사·모델·세부모델·세부트림).
 * 원자축 불일치는 semantic_drift 로만 모아 Claude/사람 게이트에 올린다.
 * 트림행키·마스터ID·파워트레인순번·트림순번은 절대 패치하지 않는다.
 */

import { VEHICLE_MASTER_REVIEW_ADOPTION_TAB } from './vehicle-master-review-promotion';

const S = (value: unknown) => String(value ?? '').trim();
const C = (value: unknown) => S(value).normalize('NFC').replace(/\s+/g, ' ');

export const VEHICLE_MASTER_ADOPTION_INTO_MASTER_CONTRACT_VERSION = 'vehicle_master_adoption_into_master_v1';

/** 라이브 A:AF (파워트레인 열 포함). */
export const VEHICLE_MASTER_HEADERS_WITH_POWERTRAIN = [
  '관리상태', '검증상태', '신차/중고차', '원산지', '제조사', '모델', '세부모델', '파워트레인', '세부트림',
  '트림행키', '마스터ID', '파워트레인순번', '트림순번', '세대명', '개발코드', '생산시작', '생산종료',
  '연식시작', '연식종료', '연료', '정확배기량(cc)', '표시배기량(L)', '터보', '구동방식', '인승',
  '배터리(kWh)', '트림별칭', '근거URL', '근거메모', '데이터기준일', '차체구성', '원문별칭',
] as const;

/** 파워트레인 합침열 제거 후 (31열). */
export const VEHICLE_MASTER_HEADERS_WITHOUT_POWERTRAIN = VEHICLE_MASTER_HEADERS_WITH_POWERTRAIN
  .filter((header) => header !== '파워트레인');

export const ADOPTION_NAME_FIELD_MAP = [
  { master: '제조사', adoption: '규격_제조사', kind: 'name' as const },
  { master: '모델', adoption: '규격_모델', kind: 'name' as const },
  { master: '세부모델', adoption: '규격_세부모델', kind: 'name' as const },
  { master: '세부트림', adoption: '규격_세부트림', kind: 'name' as const },
] as const;

export const ADOPTION_ORIGIN_FIELD = { master: '원산지', adoption: '규격_제조국', kind: 'origin' as const };

export const ADOPTION_ATOMIC_FIELD_MAP = [
  { master: '연료', adoption: '규격_연료', kind: 'atomic' as const },
  { master: '정확배기량(cc)', adoption: '규격_배기량cc', kind: 'atomic' as const },
  { master: '터보', adoption: '규격_과급', kind: 'atomic' as const, normalize: 'turbo' as const },
  { master: '구동방식', adoption: '규격_구동', kind: 'atomic' as const },
  { master: '배터리(kWh)', adoption: '규격_배터리kWh', kind: 'atomic' as const },
  { master: '인승', adoption: '규격_인승', kind: 'atomic' as const },
  { master: '생산시작', adoption: '규격_생산시작', kind: 'atomic' as const },
  { master: '생산종료', adoption: '규격_생산종료', kind: 'atomic' as const },
  { master: '연식시작', adoption: '규격_연식시작', kind: 'atomic' as const },
  { master: '연식종료', adoption: '규격_연식종료', kind: 'atomic' as const },
] as const;

export type AdoptionIntoMasterCellPatch = {
  trimRowKey: string;
  sheetRow: number;
  column: string;
  columnIndex: number;
  from: string;
  to: string;
  kind: 'name' | 'origin' | 'atomic';
};

export type AdoptionIntoMasterPlan = {
  contractVersion: string;
  adoptionTab: typeof VEHICLE_MASTER_REVIEW_ADOPTION_TAB;
  eligibleStatusesPrefix: string;
  namePatches: AdoptionIntoMasterCellPatch[];
  originFlags: AdoptionIntoMasterCellPatch[];
  semanticDrift: AdoptionIntoMasterCellPatch[];
  skippedReviewOnly: number;
  skippedMissingKey: number;
  eligibleKeys: number;
  nameChangeKeys: number;
  structuralGuarantees: {
    trimRowKeyChanges: 0;
    masterIdChanges: 0;
    powertrainSeqChanges: 0;
    trimSeqChanges: 0;
  };
  dropPowertrainColumn: {
    fromHeaders: readonly string[];
    toHeaders: readonly string[];
    removedHeader: '파워트레인';
    fromColumnCount: number;
    toColumnCount: number;
  };
};

const normalizeTurbo = (value: unknown): string => {
  const text = C(value);
  if (!text) return '';
  if (text === '예' || text === '터보' || /^t$/i.test(text)) return '예';
  if (text === '아니오' || text === '없음' || text === 'naturally aspirated' || text === 'NA') return '아니오';
  return text;
};

const normalizeAtomic = (column: string, value: unknown, mode?: 'turbo'): string => {
  if (mode === 'turbo' || column === '터보') return normalizeTurbo(value);
  if (column === '정확배기량(cc)' || column === '인승' || column === '배터리(kWh)') {
    return S(value).replace(/,/g, '');
  }
  return C(value);
};

export function isEligibleAdoptionStatus(status: unknown): boolean {
  return S(status).startsWith('규격구조채택');
}

export function buildAdoptionIntoMasterPlan(input: {
  masterValues: unknown[][];
  adoptionValues: unknown[][];
}): AdoptionIntoMasterPlan {
  if (!input.masterValues.length) throw new Error('차종마스터 값이 비어 있습니다.');
  if (!input.adoptionValues.length) throw new Error('규격채택 값이 비어 있습니다.');

  const masterHeaders = (input.masterValues[0] || []).map(S);
  const adoptionHeaders = (input.adoptionValues[0] || []).map(S);
  const masterAt = (name: string) => {
    const index = masterHeaders.indexOf(name);
    if (index < 0) throw new Error(`차종마스터 필수 열 없음: ${name}`);
    return index;
  };
  const adoptionAt = (name: string) => {
    const index = adoptionHeaders.indexOf(name);
    if (index < 0) throw new Error(`규격채택 필수 열 없음: ${name}`);
    return index;
  };

  for (const need of ['트림행키', '마스터ID', '파워트레인순번', '트림순번', ...ADOPTION_NAME_FIELD_MAP.map((f) => f.master)]) {
    masterAt(need);
  }
  for (const need of ['트림행키', '규격채택상태', ...ADOPTION_NAME_FIELD_MAP.map((f) => f.adoption)]) {
    adoptionAt(need);
  }

  const keyCol = masterAt('트림행키');
  const masterByKey = new Map<string, { row: unknown[]; sheetRow: number }>();
  for (let index = 1; index < input.masterValues.length; index++) {
    const row = input.masterValues[index] || [];
    const key = S(row[keyCol]);
    if (!key) continue;
    if (masterByKey.has(key)) throw new Error(`차종마스터 영구키 중복: ${key}`);
    masterByKey.set(key, { row, sheetRow: index + 1 });
  }

  const namePatches: AdoptionIntoMasterCellPatch[] = [];
  const originFlags: AdoptionIntoMasterCellPatch[] = [];
  const semanticDrift: AdoptionIntoMasterCellPatch[] = [];
  const nameChangeKeySet = new Set<string>();
  let skippedReviewOnly = 0;
  let skippedMissingKey = 0;
  let eligibleKeys = 0;

  const adoptionKeyCol = adoptionAt('트림행키');
  const statusCol = adoptionAt('규격채택상태');

  for (let index = 1; index < input.adoptionValues.length; index++) {
    const adoptionRow = input.adoptionValues[index] || [];
    const key = S(adoptionRow[adoptionKeyCol]);
    const status = S(adoptionRow[statusCol]);
    if (!key) continue;
    if (!isEligibleAdoptionStatus(status)) {
      skippedReviewOnly++;
      continue;
    }
    const master = masterByKey.get(key);
    if (!master) {
      skippedMissingKey++;
      continue;
    }
    eligibleKeys++;

    for (const field of ADOPTION_NAME_FIELD_MAP) {
      const columnIndex = masterAt(field.master);
      const from = C(master.row[columnIndex]);
      const to = C(adoptionRow[adoptionAt(field.adoption)]);
      if (!to || from === to) continue;
      namePatches.push({
        trimRowKey: key,
        sheetRow: master.sheetRow,
        column: field.master,
        columnIndex,
        from,
        to,
        kind: 'name',
      });
      nameChangeKeySet.add(key);
    }

    const originCol = masterHeaders.indexOf(ADOPTION_ORIGIN_FIELD.master);
    const originAdoptionCol = adoptionHeaders.indexOf(ADOPTION_ORIGIN_FIELD.adoption);
    if (originCol >= 0 && originAdoptionCol >= 0) {
      const from = C(master.row[originCol]);
      const to = C(adoptionRow[originAdoptionCol]);
      if (to && from !== to) {
        originFlags.push({
          trimRowKey: key,
          sheetRow: master.sheetRow,
          column: ADOPTION_ORIGIN_FIELD.master,
          columnIndex: originCol,
          from,
          to,
          kind: 'origin',
        });
      }
    }

    for (const field of ADOPTION_ATOMIC_FIELD_MAP) {
      const columnIndex = masterHeaders.indexOf(field.master);
      const adoptionCol = adoptionHeaders.indexOf(field.adoption);
      if (columnIndex < 0 || adoptionCol < 0) continue;
      const from = normalizeAtomic(field.master, master.row[columnIndex], 'normalize' in field ? field.normalize : undefined);
      const to = normalizeAtomic(field.master, adoptionRow[adoptionCol], 'normalize' in field ? field.normalize : undefined);
      if (!to || from === to) continue;
      semanticDrift.push({
        trimRowKey: key,
        sheetRow: master.sheetRow,
        column: field.master,
        columnIndex,
        from,
        to,
        kind: 'atomic',
      });
    }
  }

  const hasPowertrain = masterHeaders.includes('파워트레인');
  return {
    contractVersion: VEHICLE_MASTER_ADOPTION_INTO_MASTER_CONTRACT_VERSION,
    adoptionTab: VEHICLE_MASTER_REVIEW_ADOPTION_TAB,
    eligibleStatusesPrefix: '규격구조채택',
    namePatches,
    originFlags,
    semanticDrift,
    skippedReviewOnly,
    skippedMissingKey,
    eligibleKeys,
    nameChangeKeys: nameChangeKeySet.size,
    structuralGuarantees: {
      trimRowKeyChanges: 0,
      masterIdChanges: 0,
      powertrainSeqChanges: 0,
      trimSeqChanges: 0,
    },
    dropPowertrainColumn: {
      fromHeaders: hasPowertrain ? [...VEHICLE_MASTER_HEADERS_WITH_POWERTRAIN] : [...masterHeaders],
      toHeaders: [...VEHICLE_MASTER_HEADERS_WITHOUT_POWERTRAIN],
      removedHeader: '파워트레인',
      fromColumnCount: hasPowertrain ? VEHICLE_MASTER_HEADERS_WITH_POWERTRAIN.length : masterHeaders.length,
      toColumnCount: VEHICLE_MASTER_HEADERS_WITHOUT_POWERTRAIN.length,
    },
  };
}

/** 이름 패치만 반영한 가상 마스터 표(파워트레인 열은 그대로). */
export function applyNamePatchesToMasterValues(
  masterValues: unknown[][],
  patches: readonly AdoptionIntoMasterCellPatch[],
): unknown[][] {
  const cloned = masterValues.map((row) => [...row]);
  for (const patch of patches) {
    if (patch.kind !== 'name') continue;
    const rowIndex = patch.sheetRow - 1;
    if (!cloned[rowIndex]) continue;
    cloned[rowIndex][patch.columnIndex] = patch.to;
  }
  return cloned;
}

/** 파워트레인 열을 헤더·본문에서 제거. */
export function dropPowertrainColumnFromValues(values: unknown[][]): unknown[][] {
  if (!values.length) return values;
  const headers = (values[0] || []).map(S);
  const pt = headers.indexOf('파워트레인');
  if (pt < 0) return values.map((row) => [...row]);
  return values.map((row) => row.filter((_, index) => index !== pt));
}
