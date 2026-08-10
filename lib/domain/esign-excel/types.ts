import type { EsignDraftInput } from '@/lib/domain/esign-center';

export type EsignExcelImport = {
  adapterId: string;
  templateId: string;
  supplierHint: string;
  customerType: '개인' | '개인사업자' | '법인';
  form: Partial<EsignDraftInput>;
  warnings: string[];
  skippedSensitiveFields: string[];
};

export type EsignExcelAdapter = {
  id: string;
  detect: (workbook: import('xlsx').WorkBook) => boolean;
  parse: (workbook: import('xlsx').WorkBook) => EsignExcelImport;
};
