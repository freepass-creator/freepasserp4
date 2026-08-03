/** Google Sheets 공유/게시 URL을 실제 CSV fetch URL로 정규화한다. */
export function extractGoogleSheetId(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9_-]+)/);
  return match ? match[1] : '';
}

export function extractGoogleSheetGid(url: string): string {
  const match = url.match(/[?#&]gid=([0-9]+)/);
  return match ? match[1] : '';
}

export function isPublishedGoogleCsv(url: string): boolean {
  return /\/pub\b/.test(url) && /(?:[?&])output=csv(?:&|$)/.test(url);
}

/** 호출자가 gid를 명시하면 URL 안의 옛 gid보다 우선한다. */
export function resolveGoogleSheetCsvUrl(url: string, gid = ''): string {
  if (isPublishedGoogleCsv(url)) {
    const target = new URL(url);
    target.searchParams.set('output', 'csv');
    if (gid) target.searchParams.set('gid', gid);
    return target.toString();
  }
  const id = extractGoogleSheetId(url);
  return id
    ? `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${encodeURIComponent(gid)}` : ''}`
    : url;
}
