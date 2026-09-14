import { createHash } from 'node:crypto';

const OMIT = new Set(['copiedAt', 'createdAt', 'validatedAt', 'activatedAt', 'supersededAt']);

function canonical(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(canonical).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (OMIT.has(key)) continue;
    const nested = canonical(source[key]);
    if (nested !== undefined) output[key] = nested;
  }
  return output;
}

/** 저장 전후 전체 문서가 같은지 확인하는 결정적 SHA-256. 문서 ID와 내용을 함께 묶는다. */
export function ssotContentHash(rows: Array<{ id: string; data: Record<string, unknown> }>): string {
  const ordered = [...rows]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => [row.id, canonical(row.data)]);
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}
