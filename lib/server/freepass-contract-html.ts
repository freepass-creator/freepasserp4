import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { stripDetachedEsignAppendices } from '@/lib/domain/esign-document-boundary';

export type FreepassContractSealedData = {
  state: unknown;
  fields: unknown;
  signature?: string;
  sealHash?: string;
};

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}

/**
 * 샘플·관리자 미리보기·고객 서명본이 함께 사용하는 A4 계약서 HTML 원본.
 * 호출부에서는 실제 값과 검토용 주석만 다르게 넣고, 계약서 조판은 여기서만 만든다.
 */
export async function buildFreepassContractHtml(
  sealed: FreepassContractSealedData,
  options: { includePrintButton?: boolean; root?: string } = {},
) {
  const root = options.root || process.cwd();
  const templatePath = path.join(root, 'public', 'contract-template', 'rental-contract.html');
  let html = stripDetachedEsignAppendices(await readFile(templatePath, 'utf8'));
  html = html.replace('</head>', `<script>window.__SEALED__=${safeJson(sealed)};</script></head>`);

  if (options.includePrintButton !== false) {
    html = html.replace(
      /<body([^>]*)>/i,
      '<body$1><button class="fp-pdf-button" type="button" onclick="window.print()">A4 PDF 저장</button>',
    );
    html = html.replace('</style>', `
      [data-main-exclude=""]{display:none!important}
      .fp-pdf-button{position:fixed;right:18px;top:18px;z-index:9999;border:0;border-radius:var(--radius);padding:10px 14px;background:var(--accent);color:var(--card);font:700 13px Pretendard,system-ui,sans-serif;cursor:pointer}
      @media print{.fp-pdf-button{display:none!important}}
    </style>`);
  } else {
    html = html.replace('</style>', `
      [data-main-exclude=""]{display:none!important}
    </style>`);
  }

  return html;
}
