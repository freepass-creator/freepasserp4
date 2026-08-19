import { createHash } from 'node:crypto';

/** 상품 차종 커버리지 감사 결과의 신뢰 소스·출력 경로 계약. */
export const TRUSTED_PRODUCT_COVERAGE_SOURCE_MODES = [
  'live_sheet',
  'workspace_connector_snapshot',
] as const;

export function isTrustedProductCoverageSourceMode(mode: string): boolean {
  return (TRUSTED_PRODUCT_COVERAGE_SOURCE_MODES as readonly string[]).includes(mode);
}

export function productCoverageReportPath(outputPath: string, sourceMode: string): string {
  return isTrustedProductCoverageSourceMode(sourceMode)
    ? outputPath
    : outputPath.replace(/\.json$/i, '.cached-diagnostic.json');
}

/** CLI --rows parser. Empty input must mean no row restriction, never row zero. */
export function parseProductCoverageRowSelection(value: unknown): Set<number> {
  return new Set(String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(Number)
    .filter((item) => Number.isInteger(item) && item > 0));
}

/**
 * 감사 보고서 생성 뒤 공급사 원문·가격·옵션·상태가 바뀐 채 반영되는 것을 막는
 * 행 전체 지문. 셀 원문을 NFC 문자열로만 바꾸고 공백/표기를 보정하지 않는다.
 */
export function productCoverageRowFingerprint(row: readonly unknown[], width: number): string {
  const cells = Array.from({ length: width }, (_, index) => String(row[index] ?? '').normalize('NFC'));
  return `sha256:${createHash('sha256').update(JSON.stringify(cells)).digest('hex')}`;
}

export function productCoverageSheetFingerprint(
  rows: readonly (readonly unknown[])[],
  width: number,
): string {
  const normalized = rows.map((row) => Array.from(
    { length: width }, (_, index) => String(row[index] ?? '').normalize('NFC'),
  ));
  return `sha256:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
}

export const PRODUCT_COVERAGE_REPORT_MAX_AGE_MS = 10 * 60 * 1000;

export function assertFreshProductCoverageReport(
  generatedAt: unknown,
  now = Date.now(),
  maxAgeMs = PRODUCT_COVERAGE_REPORT_MAX_AGE_MS,
): void {
  const timestamp = Date.parse(String(generatedAt ?? ''));
  if (!Number.isFinite(timestamp)) throw new Error('상품 차종 감사 보고서 생성시각이 없거나 잘못됨');
  const age = now - timestamp;
  if (age < -60_000 || age > maxAgeMs) {
    throw new Error(`상품 차종 감사 보고서가 유효시간을 벗어남: age_ms=${age}`);
  }
}

export function productCoveragePostWriteIssues(input: {
  beforeRows: readonly (readonly unknown[])[];
  afterRows: readonly (readonly unknown[])[];
  width: number;
  identityColumn: number;
  patchesByIdentity: ReadonlyMap<string, ReadonlyMap<number, string>>;
}): string[] {
  const normalizeIdentity = (value: unknown) => String(value ?? '').replace(/\s/g, '');
  const indexRows = (rows: readonly (readonly unknown[])[], side: string) => {
    const map = new Map<string, readonly unknown[]>();
    const duplicate = new Set<string>();
    for (const row of rows) {
      const identity = normalizeIdentity(row[input.identityColumn]);
      if (!identity) continue;
      if (map.has(identity)) duplicate.add(identity);
      else map.set(identity, row);
    }
    return { map, duplicate: [...duplicate].map((value) => `${side}:${productCoverageIdentityDigest(value)}`) };
  };
  const before = indexRows(input.beforeRows, 'before_duplicate');
  const after = indexRows(input.afterRows, 'after_duplicate');
  const issues = [...before.duplicate, ...after.duplicate];
  const beforeKeys = [...before.map.keys()].sort();
  const afterKeys = [...after.map.keys()].sort();
  if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) issues.push('identity_set_changed');
  for (const [identity, beforeRow] of before.map) {
    const afterRow = after.map.get(identity);
    if (!afterRow) continue;
    const expected = Array.from({ length: input.width }, (_, index) => String(beforeRow[index] ?? '').normalize('NFC'));
    for (const [column, value] of input.patchesByIdentity.get(identity) || []) expected[column] = value.normalize('NFC');
    const actual = Array.from({ length: input.width }, (_, index) => String(afterRow[index] ?? '').normalize('NFC'));
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      issues.push(`row_changed:${productCoverageIdentityDigest(identity)}`);
    }
  }
  return issues;
}

export function productCoverageIdentityDigest(identity: unknown): string {
  return createHash('sha256').update(String(identity ?? '').replace(/\s/g, '')).digest('hex').slice(0, 12);
}
