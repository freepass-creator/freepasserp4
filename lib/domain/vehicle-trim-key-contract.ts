/**
 * Permanent identifier contract for `차종마스터.트림행키`.
 *
 * A code may move to another sheet row and its workflow status may change, but it
 * must never start pointing at another vehicle.  Existing codes are therefore
 * compared by code, not by row number or sort order.
 */

const S = (value: unknown) => String(value ?? '').trim();

export const TRIM_KEY_SEMANTIC_HEADERS = [
  '원산지',
  '제조사',
  '모델',
  '세부모델',
  '파워트레인',
  '세부트림',
  '세대명',
  '개발코드',
  '생산시작',
  '생산종료',
  '연식시작',
  '연식종료',
  '연료',
  '정확배기량(cc)',
  '표시배기량(L)',
  '터보',
  '구동방식',
  '인승',
  '배터리(kWh)',
] as const;
export const TRIM_KEY_SEMANTIC_HEADERS_V2 = [...TRIM_KEY_SEMANTIC_HEADERS, '차체구성'] as const;

/** 파워트레인 합침열 제거 후(시트에 라벨 열 없음). 순번·원자축은 유지. */
export const TRIM_KEY_SEMANTIC_HEADERS_V3 = [
  '원산지',
  '제조사',
  '모델',
  '세부모델',
  '세부트림',
  '세대명',
  '개발코드',
  '생산시작',
  '생산종료',
  '연식시작',
  '연식종료',
  '연료',
  '정확배기량(cc)',
  '표시배기량(L)',
  '터보',
  '구동방식',
  '인승',
  '배터리(kWh)',
  '차체구성',
] as const;

export type TrimKeyRecord = {
  code: string;
  masterId: string;
  powertrainSeq: string;
  trimSeq: string;
  semantic: string[];
  /** Diagnostic only. Row movement is explicitly allowed. */
  capturedSheetRow?: number;
};

export type TrimKeyRegistry = {
  schemaVersion: 1 | 2 | 3;
  spreadsheetId: string;
  sheetName: string;
  capturedAt: string;
  semanticHeaders: string[];
  records: TrimKeyRecord[];
};

export type TrimKeyIssueKind =
  | 'REGISTRY_HEADER_DRIFT'
  | 'DUPLICATE_REGISTRY_CODE'
  | 'DUPLICATE_LIVE_CODE'
  | 'BAD_CODE_FORMAT'
  | 'MASTER_ID_MISMATCH'
  | 'POWERTRAIN_SEQ_MISMATCH'
  | 'TRIM_SEQ_MISMATCH'
  | 'REMOVED_CODE'
  | 'UNREGISTERED_CODE'
  | 'REGISTERED_STRUCTURE_DRIFT'
  | 'REGISTERED_SEMANTIC_DRIFT';

export type TrimKeyIssue = {
  kind: TrimKeyIssueKind;
  code?: string;
  message: string;
  changedFields?: string[];
};

export type TrimKeyAudit = {
  ok: boolean;
  registryCount: number;
  liveCount: number;
  issues: TrimKeyIssue[];
};

const indexOf = (headers: string[], name: string) => headers.map(S).indexOf(name);

/** Convert the native sheet value matrix into row-position-independent records. */
export function trimKeyRecordsFromValues(
  values: unknown[][],
  semanticHeaders: readonly string[] = TRIM_KEY_SEMANTIC_HEADERS,
): TrimKeyRecord[] {
  if (!values.length) return [];
  const headers = (values[0] || []).map(S);
  const at = {
    code: indexOf(headers, '트림행키'),
    masterId: indexOf(headers, '마스터ID'),
    powertrainSeq: indexOf(headers, '파워트레인순번'),
    trimSeq: indexOf(headers, '트림순번'),
  };
  if (Object.values(at).some((value) => value < 0)) {
    throw new Error('차종마스터의 트림행키/마스터ID/순번 필수 열을 찾지 못했습니다.');
  }
  const semanticIndexes = semanticHeaders.map((name) => {
    const found = indexOf(headers, name);
    if (found < 0) throw new Error(`차종마스터 필수 의미 열을 찾지 못했습니다: ${name}`);
    return found;
  });

  const records: TrimKeyRecord[] = [];
  for (let index = 1; index < values.length; index++) {
    const row = values[index] || [];
    const code = S(row[at.code]);
    if (!code) continue;
    records.push({
      code,
      masterId: S(row[at.masterId]),
      powertrainSeq: S(row[at.powertrainSeq]),
      trimSeq: S(row[at.trimSeq]),
      semantic: semanticIndexes.map((column) => S(row[column])),
      capturedSheetRow: index + 1,
    });
  }
  return records;
}

const pushDuplicateIssues = (
  records: TrimKeyRecord[],
  kind: 'DUPLICATE_REGISTRY_CODE' | 'DUPLICATE_LIVE_CODE',
  issues: TrimKeyIssue[],
) => {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.code, (counts.get(record.code) || 0) + 1);
  for (const [code, count] of counts) {
    if (count > 1) issues.push({ kind, code, message: `${code}가 ${count}번 존재합니다.` });
  }
};

/**
 * Fail closed: a new code must be registered deliberately, while removal,
 * re-numbering, or semantic reassignment is never accepted automatically.
 */
export function auditTrimKeyContract(registry: TrimKeyRegistry, live: TrimKeyRecord[]): TrimKeyAudit {
  const issues: TrimKeyIssue[] = [];
  const supportedHeaders = [
    [...TRIM_KEY_SEMANTIC_HEADERS],
    [...TRIM_KEY_SEMANTIC_HEADERS_V2],
    [...TRIM_KEY_SEMANTIC_HEADERS_V3],
  ];
  const expectedHeaders = supportedHeaders.find((headers) => JSON.stringify(registry.semanticHeaders) === JSON.stringify(headers));
  if (!expectedHeaders) {
    issues.push({
      kind: 'REGISTRY_HEADER_DRIFT',
      message: '기준판의 의미 열 목록이 현재 계약과 다릅니다.',
      changedFields: [...TRIM_KEY_SEMANTIC_HEADERS_V3],
    });
  }

  pushDuplicateIssues(registry.records, 'DUPLICATE_REGISTRY_CODE', issues);
  pushDuplicateIssues(live, 'DUPLICATE_LIVE_CODE', issues);

  const parsed = new Map<string, { masterId: string; powertrainSeq: number; trimSeq: number }>();
  for (const record of live) {
    const match = /^(.*)::v(\d{2,})::t(\d{2,})$/.exec(record.code);
    if (!match) {
      issues.push({ kind: 'BAD_CODE_FORMAT', code: record.code, message: `${record.code} 형식이 마스터ID::v##::t##가 아닙니다.` });
      continue;
    }
    const fromCode = { masterId: match[1], powertrainSeq: Number(match[2]), trimSeq: Number(match[3]) };
    parsed.set(record.code, fromCode);
    if (fromCode.masterId !== record.masterId) {
      issues.push({ kind: 'MASTER_ID_MISMATCH', code: record.code, message: `코드의 마스터ID와 열 값(${record.masterId})이 다릅니다.` });
    }
    if (fromCode.powertrainSeq !== Number(record.powertrainSeq)) {
      issues.push({ kind: 'POWERTRAIN_SEQ_MISMATCH', code: record.code, message: `코드의 파워트레인순번과 열 값(${record.powertrainSeq})이 다릅니다.` });
    }
    if (fromCode.trimSeq !== Number(record.trimSeq)) {
      issues.push({ kind: 'TRIM_SEQ_MISMATCH', code: record.code, message: `코드의 트림순번과 열 값(${record.trimSeq})이 다릅니다.` });
    }
  }

  const baseline = new Map(registry.records.map((record) => [record.code, record]));
  const current = new Map(live.map((record) => [record.code, record]));
  for (const registered of registry.records) {
    const now = current.get(registered.code);
    if (!now) {
      issues.push({ kind: 'REMOVED_CODE', code: registered.code, message: '등록된 영구키가 라이브 시트에서 사라졌습니다. 행 삭제 대신 제외 상태로 남겨야 합니다.' });
      continue;
    }
    const structuralFields: string[] = [];
    if (registered.masterId !== now.masterId) structuralFields.push('마스터ID');
    if (registered.powertrainSeq !== now.powertrainSeq) structuralFields.push('파워트레인순번');
    if (registered.trimSeq !== now.trimSeq) structuralFields.push('트림순번');
    if (structuralFields.length) {
      issues.push({
        kind: 'REGISTERED_STRUCTURE_DRIFT',
        code: registered.code,
        message: `등록된 키 구조가 바뀌었습니다: ${structuralFields.join(', ')}`,
        changedFields: structuralFields,
      });
    }
    const semanticFields = (expectedHeaders || [...TRIM_KEY_SEMANTIC_HEADERS_V3]).filter((_, index) => S(registered.semantic[index]) !== S(now.semantic[index]));
    if (semanticFields.length) {
      issues.push({
        kind: 'REGISTERED_SEMANTIC_DRIFT',
        code: registered.code,
        message: `같은 코드가 가리키는 차량 의미가 바뀌었습니다: ${semanticFields.join(', ')}`,
        changedFields: semanticFields,
      });
    }
  }
  for (const record of live) {
    if (!baseline.has(record.code)) {
      issues.push({ kind: 'UNREGISTERED_CODE', code: record.code, message: '새 키입니다. 검토 후 --register-new로 기준판에 추가해야 합니다.' });
    }
  }

  return {
    ok: issues.length === 0,
    registryCount: registry.records.length,
    liveCount: live.length,
    issues,
  };
}
