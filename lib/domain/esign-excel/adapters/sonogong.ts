import * as XLSX from 'xlsx';
import type { EsignExcelAdapter, EsignExcelImport } from '@/lib/domain/esign-excel/types';

const S = (value: unknown) => String(value ?? '').trim();

function firstSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet {
  const name = workbook.SheetNames.find((row) => /자동차.*(렌탈|대여).*계약서/.test(row)) || workbook.SheetNames[0];
  const sheet = name ? workbook.Sheets[name] : null;
  if (!sheet) throw new Error('계약서 시트를 찾지 못했습니다.');
  return sheet;
}

function cell(sheet: XLSX.WorkSheet, address: string): unknown {
  return sheet[address]?.v;
}

function text(sheet: XLSX.WorkSheet, address: string): string {
  return S(cell(sheet, address));
}

function numberText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return S(value).replace(/[^\d.-]/g, '');
}

function annualMileage(value: unknown): string {
  const raw = Number(numberText(value));
  if (!raw) return S(value);
  const km = raw <= 20 ? raw * 10_000 : raw;
  return `연 ${km.toLocaleString('ko-KR')}km`;
}

function mileage(value: unknown): string {
  const raw = Number(numberText(value));
  return raw ? `${raw.toLocaleString('ko-KR')}km` : S(value);
}

/** 개인사업자 보조칸은 병합 폭이 판본마다 달라 라벨 오른쪽의 실제 값을 찾는다. */
function labeledInputValue(sheet: XLSX.WorkSheet, label: string): string {
  const minCol = XLSX.utils.decode_col('FY');
  const maxCol = XLSX.utils.decode_col('GZ');
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue;
    const at = XLSX.utils.decode_cell(address);
    if (at.r > 34 || at.c < minCol || at.c > maxCol || text(sheet, address) !== label) continue;
    for (let offset = 1; offset <= 10; offset += 1) {
      const value = text(sheet, XLSX.utils.encode_cell({ r: at.r, c: at.c + offset }));
      if (value) return value;
    }
  }
  return '';
}

function fingerprint(sheet: XLSX.WorkSheet) {
  const title = text(sheet, 'FZ1');
  const customerLabel = text(sheet, 'FZ3');
  return /노란색 칸/.test(title)
    && ['성명', '법인명'].includes(customerLabel)
    && text(sheet, 'FZ10') === '차량번호'
    && text(sheet, 'FZ16') === '대여료'
    && text(sheet, 'FZ17') === '대여기간';
}

function parse(workbook: XLSX.WorkBook): EsignExcelImport {
  const sheet = firstSheet(workbook);
  if (!fingerprint(sheet)) throw new Error('손오공 계약서 입력영역을 확인하지 못했습니다.');
  const corporate = text(sheet, 'FZ3') === '법인명' || /법인/.test(text(sheet, 'GB2'));
  const customerPhone = corporate ? text(sheet, 'GB15') || text(sheet, 'GB6') : text(sheet, 'GB13');
  const businessName = corporate ? text(sheet, 'GB3') : labeledInputValue(sheet, '상호');
  const customerName = corporate ? businessName : text(sheet, 'GB3');
  const customerAddress = text(sheet, 'GB4');
  const form: Partial<import('@/lib/domain/esign-center').EsignDraftInput> = {
    source: 'excel',
    importTemplateId: corporate ? 'SOGONG_CORPORATE_RENT_V1' : 'SOGONG_PERSONAL_RENT_V1',
    customerName,
    customerPhone,
    customerAddress,
    customerIsBusiness: corporate || !!text(sheet, 'GD3') ? '예' : '아니오',
    customerCompanyName: businessName,
    customerBusinessNumber: corporate ? text(sheet, 'GB12') : labeledInputValue(sheet, '사업자번호'),
    vehicleName: text(sheet, corporate ? 'GB7' : 'GB6'),
    options: text(sheet, corporate ? 'GB8' : 'GB7'),
    fuel: text(sheet, corporate ? 'GB9' : 'GB8'),
    colorExterior: corporate ? '' : text(sheet, 'GB9'),
    carNumber: text(sheet, 'GB10'),
    depositAmount: numberText(cell(sheet, corporate ? 'GB16' : 'GB14')) || '0',
    depositInstallment: text(sheet, corporate ? 'GB17' : 'GB15'),
    rentAmount: numberText(cell(sheet, corporate ? 'GB18' : 'GB16')),
    rentMonths: numberText(cell(sheet, corporate ? 'GB19' : 'GB17')),
    currentMileage: mileage(cell(sheet, corporate ? 'GB20' : 'GB18')),
    annualMileage: annualMileage(cell(sheet, corporate ? 'GB21' : 'GB19')),
    buyoutPrice: text(sheet, corporate ? 'GB22' : 'GB20'),
    driverAge: text(sheet, corporate ? 'GB23' : 'GB21'),
    driverScope: text(sheet, corporate ? 'GB26' : 'GB24'),
    maintenanceProduct: text(sheet, corporate ? 'GB25' : 'GB23'),
    emergencyContact: corporate ? '' : text(sheet, 'GB5'),
  };
  const warnings: string[] = [];
  if (!form.customerPhone) warnings.push('연락처를 확인해 주세요.');
  if (!Number(form.rentMonths)) warnings.push('대여기간을 확인해 주세요.');
  if (!form.carNumber) warnings.push('차량번호가 비어 있습니다. 신차·번호미정 여부를 확인해 주세요.');
  return {
    adapterId: 'sonogong-rent-v1',
    templateId: form.importTemplateId || 'SOGONG_RENT_V1',
    supplierHint: '손오공',
    customerType: corporate ? '법인' : form.customerCompanyName ? '개인사업자' : '개인',
    form,
    warnings,
    skippedSensitiveFields: corporate ? ['면허번호'] : ['주민등록번호', '면허번호'],
  };
}

export const sonogongRentV1Adapter: EsignExcelAdapter = {
  id: 'sonogong-rent-v1',
  detect(workbook) {
    try { return fingerprint(firstSheet(workbook)); }
    catch { return false; }
  },
  parse,
};
