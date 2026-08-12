/**
 * 공급사 허브 시트 → partner.sheet_url 동기화.
 * 허브 = 주소록(명·코드·URL). 매물 파싱 금지.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';

/** 운영 허브 — 공급사명 | 공급사코드 | 시트주소 */
export const DEFAULT_SUPPLIER_HUB_URL =
  'https://docs.google.com/spreadsheets/d/1cRn_XbuJXQMlVCATtDN4EpQy-KVEi65tCwcvCxdFk8w/edit?gid=0#gid=0';

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
  const firstRowText = (table[0] || []).join(' ');
  if (/<html|<!doctype|sourceMappingURL|show-login-page/i.test(firstRowText)) {
    throw new Error('공급사 허브를 시트로 읽지 못했습니다 — Google 공유 권한 또는 서비스 계정을 확인하세요');
  }
  // 새 허브 「공급사연동」 규격. `시트 열기`는 셀 하이퍼링크라 CSV export에서
  // 표시문구(열기/원본 열기)만 남는다. 따라서 URL 원문이 보존되는 복사용 열을 SSOT로 읽는다.
  const firstHeader = (table[0] || []).map((cell) => String(cell || '').trim());
  const newCodeI = firstHeader.findIndex((header) => header === '코드');
  const newNameI = firstHeader.findIndex((header) => header === '구분');
  const copiedUrlI = firstHeader.findIndex((header) => header === '그 주소(복사용)');
  if (newCodeI >= 0 && copiedUrlI >= 0) {
    const rows: HubPartnerRow[] = [];
    const seen = new Set<string>();
    for (const row of table.slice(1)) {
      const code = normCode(row[newCodeI]);
      const url = String(row[copiedUrlI] || '').trim();
      if (!code || code === '-' || seen.has(code)) continue;
      seen.add(code);
      rows.push({ name: String(row[newNameI] || '').trim() || code, code, url });
    }
    return rows;
  }
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
  if (hubUrl.trim() !== DEFAULT_SUPPLIER_HUB_URL) {
    throw new Error('공급사 허브는 서버에 등록된 정본 주소만 조회할 수 있습니다');
  }
  const { getAuthClient } = await import('@/lib/firebase/client');
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('공급사 허브를 읽으려면 관리자 로그인이 필요합니다');
  const response = await fetch('/api/sheet/hub', {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  const body = await response.json().catch(() => ({})) as { rows?: HubPartnerRow[]; error?: string };
  if (!response.ok || !Array.isArray(body.rows)) throw new Error(body.error || `공급사 허브 조회 실패 ${response.status}`);
  return body.rows;
}

function sheetId(url: unknown): string {
  return (String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || '';
}

/** 허브가 주소 정본이다. 파일이 바뀌면 그 파일에만 유효한 과거 gid는 버린다. */
export function overlayHubSheetUrls<T extends EntityRecord>(partners: T[], hub: HubPartnerRow[]): T[] {
  const byCode = new Map(hub.map((row) => [row.code, row]));
  return partners.map((partner) => {
    const code = normCode(partner.partner_code || partner._key);
    const row = byCode.get(code);
    // RP006은 홈페이지가 단일 정본이다. 허브의 보관용 시트로 되돌리지 않는다.
    if (!row || !looksSheetUrl(row.url) || code === 'RP006') return partner;
    const changedWorkbook = !!sheetId(partner.sheet_url) && sheetId(partner.sheet_url) !== sheetId(row.url);
    return {
      ...partner,
      sheet_url: row.url,
      ...(changedWorkbook ? { sheet_gid: '', sheet_tab: '' } : {}),
    } as T;
  });
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
