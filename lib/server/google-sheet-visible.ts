import 'server-only';

import { readFile } from 'node:fs/promises';
import {
  visibleRowsFromGridResponse,
  type SheetsGridResponse,
  type VisibleSheetTable,
} from '@/lib/domain/sheet-visible-grid';
import { SHEET_GRID_FIELDS } from '@/lib/domain/supplier-sheet-read';

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function serviceAccount(): Promise<ServiceAccount> {
  let raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    const file = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    if (file) raw = await readFile(file, 'utf8');
  }
  if (!raw) throw new Error('Google Sheets 서버 자격증명 미설정');
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Google Sheets 서버 자격증명 형식 오류');
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
    token_uri: parsed.token_uri || 'https://oauth2.googleapis.com/token',
  };
}

async function sheetsAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const account = await serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64UrlJson({ alg: 'RS256', typ: 'JWT' })}.${base64UrlJson({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: account.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const { sign } = await import('node:crypto');
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
  const response = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({})) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || `Google OAuth 실패 ${response.status}`);
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(300, Number(body.expires_in) || 3600) * 1000,
  };
  return body.access_token;
}

/** Sheets 분당 Read quota에 걸리면 잠깐 쉬고 재시도한다. */
async function requestSheetsJson(
  accessToken: string,
  url: string,
): Promise<SheetsGridResponse & { error?: { message?: string; status?: string } }> {
  let lastMessage = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({})) as SheetsGridResponse & {
      error?: { message?: string; status?: string };
    };
    if (response.ok) return body;
    const message = body.error?.message || `Google Sheets API ${response.status}`;
    lastMessage = message;
    if (/has not been used|disabled/i.test(message)) {
      throw new Error('Google Sheets API 사용 설정 필요 — 숨김 행 제외 연동을 안전하게 실행할 수 없습니다');
    }
    const quota = /quota exceeded|rate limit|429/i.test(message) || response.status === 429;
    if (!quota || attempt === 3) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
  }
  throw new Error(lastMessage || 'Google Sheets API 실패');
}

export type GoogleSheetTab = {
  gid: string;
  title: string;
  index: number;
  hidden: boolean;
};

/** 데이터는 받지 않고 탭 이름·gid만 읽는다. 고정 gid가 없는 운영 시트 선택에 사용한다. */
export async function fetchGoogleSheetTabs(spreadsheetId: string): Promise<GoogleSheetTab[]> {
  if (!/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) throw new Error('Google Sheet ID 형식 오류');
  const accessToken = await sheetsAccessToken();
  const body = await requestSheetsJson(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden,index))')}`,
  );
  return (body.sheets || []).flatMap((sheet) => {
    const properties = sheet.properties;
    if (properties?.sheetId == null || !properties.title) return [];
    return [{
      gid: String(properties.sheetId),
      title: properties.title,
      index: Number(properties.index) || 0,
      hidden: properties.hidden === true,
    }];
  }).sort((a, b) => a.index - b.index);
}

/**
 * 한 공급사의 선택 탭(미지정이면 보이는 탭 전부)을 같은 Grid 스냅샷으로 읽는다.
 * 탭별 CSV 호출을 없애 공급사가 탭을 추가하거나 행을 숨겨도 관리자·cron·감사가 같은 표를 본다.
 */
export async function fetchVisibleGoogleSheetGrid(
  spreadsheetId: string,
  gids: string[] = [],
): Promise<SheetsGridResponse> {
  if (!/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) throw new Error('Google Sheet ID 형식 오류');
  if (gids.some((gid) => !/^\d+$/.test(gid))) throw new Error('Google Sheet gid 형식 오류');

  const accessToken = await sheetsAccessToken();
  const metadataFields = 'sheets(properties(sheetId,title,hidden,index))';
  const metadata = await requestSheetsJson(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=${encodeURIComponent(metadataFields)}`,
  );
  const all = metadata.sheets || [];
  const targets = gids.length
    ? gids.map((gid) => {
        const target = all.find((item) => item.properties?.sheetId === Number(gid));
        if (!target?.properties) throw new Error(`Google Sheet 탭 없음(gid ${gid})`);
        if (target.properties.hidden) throw new Error(`숨김 탭은 연동할 수 없습니다(${target.properties.title || gid})`);
        return target;
      })
    : all.filter((item) => item.properties && item.properties.hidden !== true);
  if (!targets.length) throw new Error('연동할 보이는 Google Sheet 탭 없음');

  const params = new URLSearchParams({ includeGridData: 'true', fields: SHEET_GRID_FIELDS });
  for (const target of targets) {
    params.append('ranges', `'${String(target.properties?.title || '').replace(/'/g, "''")}'`);
  }
  return requestSheetsJson(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?${params.toString()}`,
  );
}

/**
 * Google CSV export는 필터·숨김 행을 모두 포함한다. 공급사가 화면에서 내린 매물이
 * 다시 유입되지 않도록 Sheets Grid 메타데이터의 hiddenByFilter/hiddenByUser를 적용한다.
 * 행·열 번호나 마지막 행을 고정하지 않고, 지정 gid의 실제 사용 셀 전체를 읽는다.
 */
export async function fetchVisibleGoogleSheetTable(
  spreadsheetId: string,
  gid: string,
  options: Parameters<typeof visibleRowsFromGridResponse>[2] = {},
): Promise<VisibleSheetTable> {
  const body = await fetchVisibleGoogleSheetGrid(spreadsheetId, [gid]);
  return visibleRowsFromGridResponse(body, gid, options);
}
