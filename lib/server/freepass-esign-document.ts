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
  // 출력·다운로드 동작은 통합 A4 미리보기의 PDF 뷰어에서만 제공한다.
  // 원본 HTML 안에 별도 출력 버튼을 중복 삽입하지 않는다.
  return buildFreepassContractHtml(sealed, { includePrintButton: false });
}

function localChromeExecutable() {
  const configured = String(process.env.CHROME_EXECUTABLE_PATH || '').trim();
  if (configured) return configured;
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  return undefined;
}

async function chromeLaunchOptions(): Promise<{ executablePath?: string; args?: string[] }> {
  const local = localChromeExecutable();
  if (local) return { executablePath: local };
  const serverlessLinux = process.platform === 'linux'
    && (process.env.VERCEL === '1' || !!process.env.AWS_LAMBDA_FUNCTION_VERSION);
  if (!serverlessLinux) return {};
  // Vercel 함수에는 Playwright 브라우저 바이너리가 없다. Playwright 1.49의 Chromium 131과
  // 같은 메이저의 서버리스 headless-shell을 풀어 실제 A4 미리보기·완료본을 렌더한다.
  // Vercel Node 24는 AWS 감지 변수를 노출하지 않아 패키지가 AL2023의 libnss3 묶음을
  // 생략한다. 모듈을 불러오기 전에 호환 런타임을 명시해 바이너리와 공유 라이브러리를 함께 푼다.
  process.env.AWS_EXECUTION_ENV ||= 'AWS_Lambda_nodejs20.x';
  const { default: serverlessChromium } = await import('@sparticuz/chromium');
  serverlessChromium.setGraphicsMode = false;
  return {
    executablePath: await serverlessChromium.executablePath(),
    args: serverlessChromium.args,
  };
}

export async function renderFreepassPdf(html: string): Promise<Uint8Array> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, timeout: 30_000, ...(await chromeLaunchOptions()) });
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
