import 'server-only';

import {
  freepassStorageBucket,
  sha256,
  uploadPrivateEsignFile,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { inlineContractPdfFonts } from '@/lib/server/contract-pdf-assets';
import { buildFreepassContractHtml } from '@/lib/server/freepass-contract-html';

export async function buildFrozenFreepassHtml(
  snapshot: EsignRecord,
  signature: string,
  sealHash: string,
) {
  const sealed = {
    state: snapshot.templateState || {},
    fields: snapshot.templateFields || {},
    signature,
    sealHash,
  };
  return buildFreepassContractHtml(sealed);
}

function chromeExecutable() {
  const configured = String(process.env.CHROME_EXECUTABLE_PATH || '').trim();
  if (configured) return configured;
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  return undefined;
}

export async function renderFreepassPdf(html: string): Promise<Uint8Array> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable() });
  try {
    const page = await browser.newPage();
    const printableHtml = await inlineContractPdfFonts(html);
    await page.setContent(printableHtml, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      (window as Window & { __rebuildTerms?: () => void }).__rebuildTerms?.();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(250);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}

export async function createAndStoreFreepassPdf(args: {
  contractCode: string;
  hash: string;
  snapshot: EsignRecord;
  signature: string;
  sealHash: string;
}) {
  const html = await buildFrozenFreepassHtml(args.snapshot, args.signature, args.sealHash);
  const pdf = await renderFreepassPdf(html);
  const documentSha256 = sha256(pdf);
  const asset = await uploadPrivateEsignFile(
    `esign-private/${args.contractCode}/${args.hash}/signed-contract.pdf`,
    pdf,
    'application/pdf',
  );
  return { pdf, html, documentSha256, pdfPath: asset.path };
}

export async function readStoredFreepassPdf(pathValue: unknown, expectedSha256: unknown) {
  const storagePath = String(pathValue || '').trim();
  const expected = String(expectedSha256 || '').trim();
  if (!storagePath || !expected) return null;
  const [stored] = await freepassStorageBucket().file(storagePath).download();
  const bytes = new Uint8Array(stored);
  return sha256(bytes) === expected ? bytes : null;
}
