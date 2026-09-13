import type { SupplierAdapter } from '../domain/supplier-adapter';
import { iankaAdapter } from './ianka';
import { ironAdapter } from './iron';

/**
 * 운영용 공급사 어댑터 레지스트리.
 *
 * 공급사별 의미 차이는 반드시 여기 등록된 전용 어댑터 경계를 통과한다.
 * 미등록 공급사는 generic alias 추정으로 조용히 통과시키지 않는다.
 */
const REGISTRY = new Map<string, SupplierAdapter>([
  [iankaAdapter.sourceCode, iankaAdapter],
  [ironAdapter.sourceCode, ironAdapter],
]);

function normalizeSourceCode(value: string): string {
  return String(value || '').trim().toUpperCase();
}

export function hasSupplierAdapter(sourceCode: string): boolean {
  return REGISTRY.has(normalizeSourceCode(sourceCode));
}

export function getSupplierAdapter(sourceCode: string): SupplierAdapter {
  const code = normalizeSourceCode(sourceCode);
  const adapter = REGISTRY.get(code);
  if (!adapter) {
    throw new Error(`SSOT: 전용 공급사 어댑터가 등록되지 않았습니다: ${code || '(blank)'}`);
  }
  return adapter;
}

export function listSupplierAdapters(): SupplierAdapter[] {
  return [...REGISTRY.values()];
}

export { iankaAdapter } from './ianka';
export { ironAdapter } from './iron';
