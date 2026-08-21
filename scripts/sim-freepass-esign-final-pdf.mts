import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { inlineContractPdfFonts } from '../lib/server/contract-pdf-assets';
import { buildFreepassContractHtml } from '../lib/server/freepass-contract-html';
import { isFrozenTemplateState, omitTemplateSemanticStateFields } from '../lib/domain/esign-template-fields';

const root = process.cwd();
const output = path.join(root, 'tmp', 'pdfs', 'freepass-sealed-current-verification.pdf');
const chrome = process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : undefined;

const browser = await chromium.launch({ headless: true, executablePath: chrome });
try {
  const page = await browser.newPage();
  const signature = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 180;
    const context = canvas.getContext('2d')!;
    context.strokeStyle = '#151515';
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(92, 76);
    context.bezierCurveTo(122, 34, 145, 118, 188, 55);
    context.lineTo(228, 89);
    context.stroke();
    return canvas.toDataURL('image/png');
  });
  const templateState = {
    co: 'auto', pd: '구독인수형', ins: '별도', ct: '개인', car: '신차', tax: '개인',
  } as const;
  assert.equal(isFrozenTemplateState(templateState), true);
  const templateFields = {
    // Fields deliberately contain stale semantic values. The frozen state above must win.
    doc_title: '자동차 장기대여 계약서',
    contract_no: 'VERIFY-20260821-01',
    contract_code: 'VERIFY-20260821-01',
    contract_date: '2026. 08. 21.',
    contract_place: '온라인 전자계약',
    company_name: '프리패스 검증 렌터카',
    company_ceo: '검증 대표',
    company_address: '서울특별시 검증구 1',
    customer_name: '테스트 임차인',
    customer_phone: '010-0000-0000',
    customer_address: '서울특별시 테스트구 2',
    car_number: '100신1234',
    vin: 'KMH-VERIFY-VIN-0001',
    vehicle_name: '검증용 구독 차량',
    rent_month: '36개월',
    contract_start: '2026. 08. 21.',
    contract_end: '2029. 08. 20.',
    rent_amount: '420,000',
    deposit_amount: '840,000',
    deposit_installment: '일시납',
    insurance_condition: '개인보험형 (임차인이 본인 명의로 직접 가입)',
    customer_insurance_evidence: '가입증명서 제출 · 관리자 확인 (참조 0123456789ab)',
    esign_consent_status: '필수 동의·계약조건 확인 완료',
    esign_signed_at: '2026.08.21. 13:42',
    co: 'sonogong', pd: '렌트선택형', ins: '포함', ct: '법인', car: '등록완료', tax: '사업자',
  };
  const sealHash = '0123456789abcdef0123456789abcdef';
  const html = await inlineContractPdfFonts(await buildFreepassContractHtml({
    state: templateState,
    fields: {
      ...omitTemplateSemanticStateFields(templateFields),
      esign_seal_hash: `${sealHash.slice(0, 16)}…`,
      esign_verify_path: '프리패스 ERP 봉인 검증',
    },
    signature,
    sealHash,
  }, { includePrintButton: false, root }), root);
  await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    (window as Window & { __rebuildTerms?: () => void }).__rebuildTerms?.();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const rendered = await page.evaluate(() => ({
    title: document.querySelector('[data-field="doc_title"]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    included: (document.querySelector('[data-ins="inc"]') as HTMLElement | null)?.style.display || '',
    separate: (document.querySelector('[data-ins="sep"]') as HTMLElement | null)?.style.display || '',
    plate: document.querySelector('[data-field="car_number"]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    vin: document.querySelector('[data-field="vin"]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    evidence: document.querySelector('[data-field="customer_insurance_evidence"]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    signedAt: document.querySelector('[data-field="esign_signed_at"]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    signature: (document.querySelector('[data-sign="customer"] img') as HTMLImageElement | null)?.src || '',
    signatureCount: document.querySelectorAll('[data-sign="customer"] img').length,
  }));
  assert.equal(rendered.title, '자동차 구독 계약서');
  assert.equal(rendered.included, 'none');
  assert.notEqual(rendered.separate, 'none');
  assert.equal(rendered.plate, '미정 (신차)');
  assert.equal(rendered.vin, 'KMH-VERIFY-VIN-0001');
  assert.match(rendered.evidence, /가입증명서 제출 · 관리자 확인/);
  assert.equal(rendered.signedAt, '2026.08.21. 13:42');
  assert.match(rendered.signature, /^data:image\/png;base64,/);
  assert.equal(rendered.signatureCount, 1);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(250);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
  const standardState = {
    co: 'auto', pd: '렌트선택형', ins: '포함', ct: '개인', car: '등록완료', tax: '개인',
  } as const;
  const standardHtml = await inlineContractPdfFonts(await buildFreepassContractHtml({
    state: standardState,
    fields: {
      ...omitTemplateSemanticStateFields({
        ...templateFields,
        car_number: '00가0001',
        insurance_condition: '보험료 포함 (월 대여료에 포함)',
        insurer_name: '[샘플] 프리패스테스트손해보험',
        customer_insurance_evidence: '',
      }),
    },
    signature,
    sealHash,
  }, { includePrintButton: false, root }), root);
  await page.setContent(standardHtml, { waitUntil: 'load', timeout: 30_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const included = await page.evaluate(() => ({
    title: document.querySelector('[data-field="doc_title"]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    included: (document.querySelector('[data-ins="inc"]') as HTMLElement | null)?.style.display || '',
    separate: (document.querySelector('[data-ins="sep"]') as HTMLElement | null)?.style.display || '',
  }));
  assert.equal(included.title, '자동차 장기대여 계약서');
  assert.notEqual(included.included, 'none');
  assert.equal(included.separate, 'none');
  console.log(`PASS: sealed state · direct insurance evidence · signature rendered: ${output}`);
  console.log('PASS: standard rental · company-included insurance branch rendered');
} finally {
  await browser.close();
}
