import type { SupplierAdapter } from '../domain/supplier-adapter';
import { autoplusAdapter } from './autoplus';
import { providedSheetAdapter } from './provided';
import { sonogongAdapter } from './sonogong';
import {
  SUPPLIER_SOURCES,
  findSupplierSourceSpec,
  type SupplierAdapterId,
  type SupplierSourceSpec,
} from './source-registry';

/**
 * 운영용 공급사 어댑터.
 *
 * ERP4 시트 규칙과 같다: 기본 = 제공시트·정제시트 표준 열(ProvidedSheetAdapter).
 * 전용은 열이 표준이 아닌 곳만 — 오토플러스 기간×주행, 손오공 구독재고 반납형.
 * 원천 위치는 source-registry.ts. 미등록 코드는 통과시키지 않는다.
 */
const BY_ID: Record<SupplierAdapterId, SupplierAdapter> = {
  provided: providedSheetAdapter,
  autoplus: autoplusAdapter,
  sonogong: sonogongAdapter,
};

function normalizeSourceCode(value: string): string {
  return String(value || '').trim().toUpperCase();
}

export function adapterForSpec(spec: SupplierSourceSpec): SupplierAdapter {
  return BY_ID[spec.adapter];
}

export function hasSupplierAdapter(sourceCode: string): boolean {
  return !!findSupplierSourceSpec(sourceCode);
}

export function getSupplierAdapter(sourceCode: string): SupplierAdapter {
  const spec = findSupplierSourceSpec(sourceCode);
  if (!spec) {
    throw new Error(`SSOT: 원천이 등록되지 않았습니다: ${normalizeSourceCode(sourceCode) || '(blank)'}`);
  }
  return adapterForSpec(spec);
}

export function listSupplierAdapters(): SupplierAdapter[] {
  const seen = new Set<SupplierAdapter>();
  const out: SupplierAdapter[] = [];
  for (const spec of SUPPLIER_SOURCES) {
    const adapter = adapterForSpec(spec);
    if (seen.has(adapter)) continue;
    seen.add(adapter);
    out.push(adapter);
  }
  return out;
}

export { autoplusAdapter } from './autoplus';
export { iankaAdapter } from './ianka';
export { ironAdapter } from './iron';
export { providedSheetAdapter } from './provided';
export { sonogongAdapter } from './sonogong';
