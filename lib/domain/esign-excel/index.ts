import * as XLSX from 'xlsx';
import { sonogongRentV1Adapter } from '@/lib/domain/esign-excel/adapters/sonogong';
import type { EsignExcelImport } from '@/lib/domain/esign-excel/types';

const ADAPTERS = [sonogongRentV1Adapter];

export function importEsignExcel(bytes: ArrayBuffer | Uint8Array): EsignExcelImport {
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: false, cellFormula: true });
  const adapter = ADAPTERS.find((candidate) => candidate.detect(workbook));
  if (!adapter) {
    throw new Error('지원하지 않는 계약서 형식입니다. 렌터카사·계약형태를 선택하거나 직접 작성해 주세요.');
  }
  return adapter.parse(workbook);
}

export type { EsignExcelImport } from '@/lib/domain/esign-excel/types';
