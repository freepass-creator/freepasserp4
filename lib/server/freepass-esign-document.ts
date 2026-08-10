import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  freepassStorageBucket,
  sha256,
  uploadPrivateEsignFile,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { stripDetachedEsignAppendices } from '@/lib/domain/esign-document-boundary';

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}

export async function buildFrozenFreepassHtml(
  snapshot: EsignRecord,
  signature: string,
  sealHash: string,
) {
  const templatePath = path.join(process.cwd(), 'public', 'contract-template', 'rental-contract.html');
  let html = stripDetachedEsignAppendices(await readFile(templatePath, 'utf8'));
  const sealed = {
    state: snapshot.templateState || {},
    fields: snapshot.templateFields || {},
    signature,
    sealHash,
  };
  html = html.replace('</head>', `<script>window.__SEALED__=${safeJson(sealed)};</script></head>`);
  html = html.replace(/<body([^>]*)>/i, `<body$1><button class="fp-pdf-button" type="button" onclick="window.print()">A4 PDF 저장</button>`);
  html = html.replace('</style>', `
    [data-main-exclude]{display:none!important}
    .fp-pdf-button{position:fixed;right:18px;top:18px;z-index:9999;border:0;border-radius:var(--radius);padding:10px 14px;background:var(--accent);color:var(--card);font:700 13px system-ui;cursor:pointer}
    @media print{.fp-pdf-button{display:none!important}}
  </style>`);
  return html;
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
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(500);
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
