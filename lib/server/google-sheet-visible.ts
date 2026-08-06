import 'server-only';

import { readFile } from 'node:fs/promises';
import {
  visibleRowsFromGridResponse,
  type SheetsGridResponse,
  type VisibleSheetTable,
} from '@/lib/domain/sheet-visible-grid';

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

/**
 * Google CSV export는 필터·숨김 행을 모두 포함한다. 공급사가 화면에서 내린 매물이
 * 다시 유입되지 않도록 Sheets Grid 메타데이터의 hiddenByFilter/hiddenByUser를 적용한다.
 * 행·열 번호나 마지막 행을 고정하지 않고, 지정 gid의 실제 사용 셀 전체를 읽는다.
 */
export async function fetchVisibleGoogleSheetTable(
  spreadsheetId: string,
  gid: string,
): Promise<VisibleSheetTable> {
  if (!/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) throw new Error('Google Sheet ID 형식 오류');
  if (!/^\d+$/.test(gid)) throw new Error('Google Sheet gid 형식 오류');

  const accessToken = await sheetsAccessToken();
  const requestJson = async (url: string): Promise<SheetsGridResponse & { error?: { message?: string; status?: string } }> => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => ({})) as SheetsGridResponse & {
      error?: { message?: string; status?: string };
    };
    if (!response.ok) {
      const message = body.error?.message || `Google Sheets API ${response.status}`;
      if (/has not been used|disabled/i.test(message)) {
        throw new Error('Google Sheets API 사용 설정 필요 — 숨김 행 제외 연동을 안전하게 실행할 수 없습니다');
      }
      throw new Error(message);
    }
    return body;
  };

  // getByDataFilter는 읽기 작업인데도 일부 Google 프로젝트에서 쓰기 scope를 요구한다.
  // 공급사 시트 쓰기 권한을 넓히지 않고, readonly가 허용되는 metadata → A1 Grid GET 두 단계로 읽는다.
  const metadataFields = 'sheets(properties(sheetId,title,hidden))';
  const metadata = await requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=${encodeURIComponent(metadataFields)}`,
  );
  const target = metadata.sheets?.find((item) => item.properties?.sheetId === Number(gid));
  if (!target?.properties) throw new Error(`Google Sheet 탭 없음(gid ${gid})`);
  if (target.properties.hidden) throw new Error(`숨김 탭은 연동할 수 없습니다(${target.properties.title || gid})`);
  const a1Title = `'${String(target.properties.title || '').replace(/'/g, "''")}'`;
  // hyperlink·chipRuns 를 함께 받는다 — 공급사는 사진을 «열»이 아니라 차번 셀 링크로 준다
  // (아이카=상세페이지 하이퍼링크, 오플=드라이브 폴더 스마트칩). 호출 수는 그대로다.
  const fields = [
    'sheets(properties(sheetId,title,hidden)',
    'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
  ].join(',');
  const body = await requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true&ranges=${encodeURIComponent(a1Title)}&fields=${encodeURIComponent(fields)}`,
  );
  return visibleRowsFromGridResponse(body, gid);
}
