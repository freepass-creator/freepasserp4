import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const CONTRACT_PRETENDARD_FILES = [
  'Pretendard-Regular.woff2',
  'Pretendard-Medium.woff2',
  'Pretendard-SemiBold.woff2',
  'Pretendard-Bold.woff2',
  'Pretendard-ExtraBold.woff2',
] as const;

/**
 * `page.setContent()` has no document URL, so `/fonts/...` cannot be relied on
 * while Chromium creates a PDF. Embed the same local faces used by the HTML
 * preview so draft, signed PDF, and the review sample keep identical metrics.
 */
export async function inlineContractPdfFonts(source: string, root = process.cwd()) {
  const embedded = await Promise.all(CONTRACT_PRETENDARD_FILES.map(async (fontFile) => {
    const fontPath = path.join(root, 'public', 'fonts', fontFile);
    const dataUrl = `data:font/woff2;base64,${(await readFile(fontPath)).toString('base64')}`;
    return [fontFile, dataUrl] as const;
  }));
  return embedded.reduce((html, [fontFile, dataUrl]) => {
    /* `../fonts/` 를 먼저 치환한다. `/fonts/` 를 먼저 바꾸면
       `url("../fonts/…")` 가 `url("..data:…")` 로 깨진다. */
    return html
      .replaceAll(`../fonts/${fontFile}`, dataUrl)
      .replaceAll(`/fonts/${fontFile}`, dataUrl);
  }, source);
}
