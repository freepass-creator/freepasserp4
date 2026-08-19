/**
 * Google Sheets 쓰기 — 서비스계정으로 서버에서만 호출한다.
 *
 * 의존성을 새로 붙이지 않았다. `google-auth-library` 는 firebase-admin 의 «전이» 의존이라
 * 직접 import 하면 그쪽 버전이 바뀔 때 조용히 깨진다. Vercel Node 런타임 호환은
 * `check:b2b-release` 가 이미 한 번 물어본 적 있는 지점이라(Firebase Admin/jose/jwks 버전),
 * 여기서는 node:crypto 로 JWT 를 직접 서명해 의존성을 0으로 둔다.
 *
 * 자격증명은 firebase-admin.ts 와 «같은» 것을 쓴다(FIREBASE_SERVICE_ACCOUNT_JSON).
 * 따라서 운영에서 새로 설정할 환경변수가 없다 — 런시트 2단계에 이미 들어 있는 그 값이다.
 *
 * ⚠ 대상 스프레드시트는 서비스계정 이메일에 «편집자»로 공유돼 있어야 한다.
 *   공유 전에는 읽기만 200 이고 쓰기는 403 PERMISSION_DENIED 가 난다(실측 확인).
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

/** 한글이 섞인 표라 한글 자체가 예쁜 폰트를 쓴다. 없으면 구글시트가 알아서 대체한다. */
const SHEET_FONT = 'Roboto';   // 사장님 2026-08-18 — 모든 구글시트 Roboto 로 통일
const HEADER_BG = { red: 0.17, green: 0.24, blue: 0.31 };
const OK_BG = { red: 0.85, green: 0.94, blue: 0.86 };
const NO_BG = { red: 0.93, green: 0.93, blue: 0.93 };
const BAND_BG = { red: 0.97, green: 0.976, blue: 0.98 };

type Rec = Record<string, unknown>;

function serviceAccountJson(): { client_email: string; private_key: string } {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const text = raw || (() => {
    // 로컬 스크립트는 파일 기반 자격증명을 쓴다(firebase-admin.ts 와 같은 규칙).
    const path = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    if (!path) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 또는 GOOGLE_APPLICATION_CREDENTIALS 미설정');
    return readFileSync(path, 'utf8');
  })();
  const p = JSON.parse(text) as { client_email?: string; private_key?: string };
  if (!p.client_email || !p.private_key) throw new Error('서비스계정 JSON 형식이 올바르지 않습니다.');
  return { client_email: p.client_email, private_key: p.private_key.replace(/\\n/g, '\n') };
}

export function sheetsServiceAccountEmail(): string {
  return serviceAccountJson().client_email;
}

const b64u = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cached: { token: string; expiresAt: number } | null = null;

/** 서비스계정 JWT → 액세스토큰. 만료 60초 전에 재발급한다. */
async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const sa = serviceAccountJson();
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64u(signer.sign(sa.private_key))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const body = await res.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`구글 토큰 발급 실패 ${res.status}: ${body.error || ''} ${body.error_description || ''}`.trim());
  }
  cached = { token: body.access_token, expiresAt: Date.now() + ((body.expires_in || 3600) - 60) * 1000 };
  return cached.token;
}

async function call(path: string, init?: { method?: string; body?: string }): Promise<Rec> {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, {
    method: init?.method,
    body: init?.body,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) {
    const e = (body.error || {}) as { status?: string; message?: string };
    const hint = res.status === 403
      ? ` — 시트를 ${serviceAccountJson().client_email} 에 편집자로 공유했는지 확인하세요.`
      : '';
    throw new Error(`Sheets ${res.status} ${e.status || ''}: ${e.message || ''}${hint}`.trim());
  }
  return body;
}

type TabInfo = { sheetId: number; title: string; rowCount: number; columnCount: number; conditionalFormats: number; bandedRangeIds: number[] };

async function tabInfo(spreadsheetId: string, title: string): Promise<TabInfo | null> {
  const meta = await call(`/${spreadsheetId}?fields=sheets(properties(sheetId,title,gridProperties),conditionalFormats,bandedRanges(bandedRangeId))`);
  for (const s of (meta.sheets || []) as Rec[]) {
    const p = (s.properties || {}) as Rec;
    if (String(p.title) !== title) continue;
    const g = (p.gridProperties || {}) as Rec;
    return {
      sheetId: Number(p.sheetId),
      title: String(p.title),
      rowCount: Number(g.rowCount || 0),
      columnCount: Number(g.columnCount || 0),
      conditionalFormats: ((s.conditionalFormats || []) as unknown[]).length,
      bandedRangeIds: ((s.bandedRanges || []) as Rec[]).map((b) => Number(b.bandedRangeId)),
    };
  }
  return null;
}

export type SheetTableColumn = { label: string; kind: 'text' | 'number' | 'won'; width: number };

export type WriteSheetTableInput = {
  spreadsheetId: string;
  tabTitle: string;
  columns: SheetTableColumn[];
  rows: (string | number)[][];
  /** 「출고가능/출고불가」 색칠 대상 열(0-based). 음수면 색칠하지 않는다. */
  statusColumnIndex?: number;
  /** 표 위에 한 줄 남길 안내문(갱신 시각 등). 비우면 헤더가 1행이 된다. */
  caption?: string;
};

/**
 * 탭 하나를 «통째로 다시 쓴다». 부분 갱신하지 않는다.
 *
 * 이유: 공급사 시트에서 겪은 사고가 전부 «행 위치 기억»에서 났다. 행 순서가 바뀌면
 * 우리가 기억한 행 번호가 다른 차를 가리킨다(`SHEET_IMPORT_STATUS_AND_WRITEBACK.md` §설계권고).
 * 전량 재작성은 느리지만 어긋날 여지가 없고, 두 번 눌러도 결과가 같다.
 */
export async function writeSheetTable(input: WriteSheetTableInput): Promise<{ rows: number; tabTitle: string }> {
  const { spreadsheetId, tabTitle, columns, rows, statusColumnIndex = -1, caption = '' } = input;

  let tab = await tabInfo(spreadsheetId, tabTitle);
  if (!tab) {
    await call(`/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabTitle } } }] }),
    });
    tab = await tabInfo(spreadsheetId, tabTitle);
    if (!tab) throw new Error(`탭 생성 실패: ${tabTitle}`);
  }

  const headerRow = caption ? 2 : 1;              // 1-based
  const needRows = headerRow + rows.length + 20;  // 여유 20행
  const needCols = columns.length;

  // 격자 크기 확보 — 모자라면 values.update 가 범위 밖이라며 거절한다.
  const grow: Rec[] = [];
  if (tab.rowCount < needRows || tab.columnCount < needCols) {
    grow.push({
      updateSheetProperties: {
        properties: { sheetId: tab.sheetId, gridProperties: { rowCount: Math.max(tab.rowCount, needRows), columnCount: Math.max(tab.columnCount, needCols) } },
        fields: 'gridProperties.rowCount,gridProperties.columnCount',
      },
    });
    await call(`/${spreadsheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: grow }) });
    tab = (await tabInfo(spreadsheetId, tabTitle)) || tab;
  }

  // 값 — 옛 내용을 먼저 비운다(행이 줄었을 때 찌꺼기가 남지 않도록).
  await call(`/${spreadsheetId}/values/${encodeURIComponent(tabTitle)}:clear`, { method: 'POST', body: '{}' });
  const values = [
    ...(caption ? [[caption]] : []),
    columns.map((c) => c.label),
    ...rows,
  ];
  await call(
    `/${spreadsheetId}/values/${encodeURIComponent(`${tabTitle}!A1`)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values }) },
  );

  const sheetId = tab.sheetId;
  const lastRow = headerRow + rows.length;
  const requests: Rec[] = [];

  // 여러 번 눌러도 같은 결과가 되도록, 누적되는 것들(조건부서식·밴딩)은 먼저 지운다.
  for (let i = tab.conditionalFormats - 1; i >= 0; i -= 1) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }
  for (const id of tab.bandedRangeIds) requests.push({ deleteBanding: { bandedRangeId: id } });

  const all = { sheetId, startRowIndex: 0, endRowIndex: Math.max(lastRow, headerRow), startColumnIndex: 0, endColumnIndex: columns.length };
  const body = { sheetId, startRowIndex: headerRow, endRowIndex: Math.max(lastRow, headerRow), startColumnIndex: 0, endColumnIndex: columns.length };

  requests.push({
    repeatCell: {
      range: all,
      cell: { userEnteredFormat: { textFormat: { fontFamily: SHEET_FONT, fontSize: 10 }, verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize,userEnteredFormat.verticalAlignment',
    },
  });

  if (caption) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columns.length },
        cell: { userEnteredFormat: { textFormat: { fontFamily: SHEET_FONT, fontSize: 10, italic: true, foregroundColor: { red: 0.45, green: 0.45, blue: 0.45 } } } },
        fields: 'userEnteredFormat.textFormat',
      },
    });
  }

  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: headerRow - 1, endRowIndex: headerRow, startColumnIndex: 0, endColumnIndex: columns.length },
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_BG,
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          textFormat: { fontFamily: SHEET_FONT, fontSize: 10, bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)',
    },
  });

  // 숫자 열 — 천단위 구분. 금액과 주행거리가 자릿수로 읽혀야 비교가 된다.
  columns.forEach((c, i) => {
    if (c.kind === 'text' || !rows.length) return;
    requests.push({
      repeatCell: {
        range: { ...body, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT' } },
        fields: 'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment',
      },
    });
  });

  // 헤더 고정 + 필터 — 「필터도 걸리고」의 그 필터다.
  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: headerRow, frozenColumnCount: 1 } },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
    },
  });
  requests.push({
    setBasicFilter: {
      filter: { range: { sheetId, startRowIndex: headerRow - 1, endRowIndex: Math.max(lastRow, headerRow), startColumnIndex: 0, endColumnIndex: columns.length } },
    },
  });

  if (rows.length) {
    requests.push({
      addBanding: {
        bandedRange: {
          range: body,
          rowProperties: { firstBandColor: { red: 1, green: 1, blue: 1 }, secondBandColor: BAND_BG },
        },
      },
    });
  }

  // 상태 색칠 — 눈으로 훑을 때 「팔 수 있는 차」가 먼저 보여야 한다.
  if (statusColumnIndex >= 0 && rows.length) {
    const statusRange = { ...body, startColumnIndex: statusColumnIndex, endColumnIndex: statusColumnIndex + 1 };
    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [statusRange],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '출고가능' }] },
            format: { backgroundColor: OK_BG, textFormat: { bold: true } },
          },
        },
      },
    });
    requests.push({
      addConditionalFormatRule: {
        index: 1,
        rule: {
          ranges: [statusRange],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '출고불가' }] },
            format: { backgroundColor: NO_BG, textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } } },
          },
        },
      },
    });
  }

  columns.forEach((c, i) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: c.width },
        fields: 'pixelSize',
      },
    });
  });

  await call(`/${spreadsheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
  return { rows: rows.length, tabTitle };
}
