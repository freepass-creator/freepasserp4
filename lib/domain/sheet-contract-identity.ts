/** Read-only identities for the display contract. Does not change publisher/ingest classification. */
import { SHEET_CONTRACT } from './sales-sheet-banner';
export const SALES_PUBLISHED_TAB_PREFIXES = SHEET_CONTRACT.canonicalOrder;
const aliases: Record<string, string[]> = {
  상품리스트: ['상품리스트'],
  손오공상품: ['손오공상품', '손오공구독', '오공구독', '손오공'],
  픽업구독: ['픽업구독', '픽업'],
  오플구독: ['오플구독', '오플'],
};
export function salesTabMatches(title: string, key: string): boolean {
  return (aliases[key] || [key]).some(alias => title === alias ||
    (title.startsWith(`${alias} `) && /^(?:\d+대|\d{2}[.-]\d{2} \d{2}(?::\d{2}(?::\d{2})?)?(?: (?:· )?\d+대)?)$/.test(title.slice(alias.length + 1))));
}
export function pickPublishedSalesTabs(titles: string[]) {
  return SALES_PUBLISHED_TAB_PREFIXES.flatMap(prefix => {
    const matches = titles.filter(title => salesTabMatches(title, prefix));
    if (matches.length > 1) throw new Error(`HOLD: 판매 탭 중복 ${prefix}`);
    return matches.map(title => ({ prefix, title }));
  });
}
export function companyTabMatches(title: string, company: string): boolean {
  return title === company || /^(.+?) (?:· )?\d+대$/.exec(title)?.[1] === company;
}
