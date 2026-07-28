/**
 * 공급사 허브 시트 → partner.sheet_url 동기화.
 * 허브 = 주소록(명·코드·URL). 매물 파싱 금지.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';
import { fetchSheetTable } from '@/lib/domain/sheet-import';

/** 운영 허브 — 공급사명 | 공급사코드 | 시트주소 */
export const DEFAULT_SUPPLIER_HUB_URL =
  'https://docs.google.com/spreadsheets/d/1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY';

export type HubPartnerRow = {
  name: string;
  code: string;
  url: string;
};

export type HubSyncLine = {
  code: string;
  name: string;
  action: 'updated' | 'unchanged' | 'missing_partner' | 'bad_url' | 'skipped';
  message: string;
};

export type HubSyncResult = {
  lines: HubSyncLine[];
  updated: number;
  unchanged: number;
  missingPartner: number;
  hubCount: number;
};

function normCode(v: unknown): string {
  return String(v ?? '').trim();
}

function looksSheetUrl(u: string): boolean {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+/i.test(u);
}

/** 허브 표 → 행. 헤더 별칭: 공급사명·코드·시트주소. */
export function parseHubTable(table: string[][]): HubPartnerRow[] {
  if (!table.length) return [];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, table.length); i++) {
    const row = table[i] || [];
    if (row.some((c) => /공급사|시트|코드/.test(String(c || '')))) {
      headerIdx = i;
      break;
    }
  }
  const header = (table[headerIdx] || []).map((c) => String(c || '').trim());
  const nameI = header.findIndex((h) => /공급사명|상호|회사명|^이름$/.test(h));
  const codeI = header.findIndex((h) => /공급사코드|파트너코드|코드/.test(h) && !/시트/.test(h));
  const urlI = header.findIndex((h) => /시트주소|시트url|구글시트|sheet/i.test(h) || h === 'URL');
  const ni = nameI >= 0 ? nameI : 0;
  const ci = codeI >= 0 ? codeI : 1;
  const ui = urlI >= 0 ? urlI : 2;
  const out: HubPartnerRow[] = [];
  const seen = new Set<string>();
  for (const row of table.slice(headerIdx + 1)) {
    const code = normCode(row[ci]);
    const url = String(row[ui] || '').trim();
    const name = String(row[ni] || '').trim() || code;
    if (!code || seen.has(code)) continue;
    if (/공급사코드|^코드$/.test(code)) continue;
    seen.add(code);
    out.push({ name, code, url });
  }
  return out;
}

export async function fetchHubPartners(hubUrl = DEFAULT_SUPPLIER_HUB_URL): Promise<HubPartnerRow[]> {
  const table = await fetchSheetTable(hubUrl.trim());
  return parseHubTable(table);
}

/**
 * 허브 URL을 partner.sheet_url에 반영(관리자 버튼용).
 * · 코드 일치하는 파트너만 patch
 * · 허브에만 있는 코드 = missing_partner (자동 생성 안 함)
 * · URL 동일하면 unchanged
 */
export async function syncHubSheetUrls(
  companyId: string,
  hubUrl = DEFAULT_SUPPLIER_HUB_URL,
): Promise<HubSyncResult> {
  const hub = await fetchHubPartners(hubUrl);
  const partners = await getStore().list('partner', companyId);
  const byCode = new Map<string, EntityRecord>();
  for (const p of partners) {
    const code = normCode(p.partner_code || p._key);
    if (code) byCode.set(code, p);
  }
  const lines: HubSyncLine[] = [];
  let updated = 0;
  let unchanged = 0;
  let missingPartner = 0;
  const store = getStore();
  for (const row of hub) {
    if (!row.url || !looksSheetUrl(row.url)) {
      lines.push({
        code: row.code, name: row.name, action: 'bad_url',
        message: `✗ ${row.name}(${row.code}) — 시트 URL 없음/형식 오류`,
      });
      continue;
    }
    const p = byCode.get(row.code);
    if (!p) {
      missingPartner++;
      lines.push({
        code: row.code, name: row.name, action: 'missing_partner',
        message: `? ${row.name}(${row.code}) — erp 파트너 없음(생성 안 함)`,
      });
      continue;
    }
    const key = String(p._key || p.partner_code || row.code);
    const prev = String(p.sheet_url || '').trim();
    if (prev === row.url) {
      unchanged++;
      lines.push({
        code: row.code, name: row.name, action: 'unchanged',
        message: `· ${row.name}(${row.code}) — URL 동일`,
      });
      continue;
    }
    await store.update('partner', companyId, key, {
      sheet_url: row.url,
      name: p.name || p.partner_name || row.name,
    } as EntityRecord);
    updated++;
    lines.push({
      code: row.code, name: row.name, action: 'updated',
      message: `✓ ${row.name}(${row.code}) — sheet_url ${prev ? '갱신' : '등록'}`,
    });
  }
  return { lines, updated, unchanged, missingPartner, hubCount: hub.length };
}
