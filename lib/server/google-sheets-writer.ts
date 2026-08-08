import 'server-only';

import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';

/**
 * 서비스계정으로 Google Sheets 에 쓰는 최소 클라이언트.
 *
 * RTDB 용 `FIREBASE_SERVICE_ACCOUNT_JSON` 과 같은 계정을 쓴다 — 대상 시트 공유에
 * 그 `client_email` 을 **편집자**로 추가해야 동작한다. 권한이 없으면 403 이 그대로 올라온다.
 */
type ServiceAccountJson = { client_email?: string; private_key?: string; token_uri?: string };
type Rec = Record<string, unknown>;

/**
 * 자격증명 — Vercel 은 `FIREBASE_SERVICE_ACCOUNT_JSON`, 로컬은 `GOOGLE_APPLICATION_CREDENTIALS`
 * 파일 경로를 쓴다(`lib/server/firebase-admin.ts` 와 같은 규칙). 둘 다 없으면 fail-closed.
 */
function serviceAccount(): Required<Pick<ServiceAccountJson, 'client_email' | 'private_key'>> & { token_uri: string } {
  const inline = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const file = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  const raw = inline || (file ? readFileSync(file, 'utf8') : '');
  if (!raw) throw new Error('시트 자격증명 미설정 — FIREBASE_SERVICE_ACCOUNT_JSON 또는 GOOGLE_APPLICATION_CREDENTIALS 가 필요합니다.');
  const parsed = JSON.parse(raw) as ServiceAccountJson;
  if (!parsed.client_email || !parsed.private_key) throw new Error('서비스계정 형식이 올바르지 않습니다.');
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
    token_uri: String(parsed.token_uri || 'https://oauth2.googleapis.com/token'),
  };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

async function sheetsToken(): Promise<string> {
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(body.error_description || `Google OAuth ${res.status}`);
  return body.access_token;
}

export type SheetMeta = {
  title: string;
  sheets: {
    properties: { title: string; sheetId: number };
    bandedRanges?: { bandedRangeId: number }[];
    conditionalFormats?: unknown[];
    merges?: unknown[];
  }[];
};

export class SheetsClient {
  private constructor(private readonly id: string, private readonly token: string) {}

  static async open(spreadsheetId: string): Promise<SheetsClient> {
    return new SheetsClient(spreadsheetId, await sheetsToken());
  }

  private get api() { return `https://sheets.googleapis.com/v4/spreadsheets/${this.id}`; }
  private get head() { return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }; }

  private async call(url: string, init?: RequestInit): Promise<Rec> {
    const res = await fetch(url, { ...init, headers: this.head, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(`시트 쓰기 권한이 없습니다 — 대상 시트 공유에 ${serviceAccount().client_email} 를 «편집자»로 추가하세요.`);
      }
      throw new Error(`Google Sheets ${res.status} ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) as Rec : {};
  }

  async meta(): Promise<SheetMeta> {
    const fields = 'properties.title,sheets(properties,bandedRanges,conditionalFormats,merges)';
    const raw = await this.call(`${this.api}?fields=${encodeURIComponent(fields)}`) as {
      properties: { title: string }; sheets: SheetMeta['sheets'];
    };
    return { title: raw.properties.title, sheets: raw.sheets || [] };
  }

  /** 새 탭을 **맨 왼쪽**에 만든다(최신이 왼쪽). 같은 이름이 있으면 접미를 붙인다. */
  async addLeftmostTab(name: string, existing: string[]): Promise<{ gid: number; title: string }> {
    let title = name;
    for (let i = 2; existing.includes(title); i++) title = `${name} (${i})`;
    const out = await this.call(`${this.api}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title, index: 0 } } }] }),
    }) as { replies: { addSheet: { properties: { sheetId: number } } }[] };
    return { gid: out.replies[0].addSheet.properties.sheetId, title };
  }

  /**
   * **같은 탭을 다시 쓴다.** 없으면 맨 왼쪽에 만든다.
   *
   * 연동을 반영할 때마다 새 탭을 만들면 영업자 시트에 탭이 끝없이 쌓이고, 영업자는
   * 어느 것이 «지금»인지 매번 골라야 한다. 「현재 재고」 한 장이 늘 최신이어야 한다.
   * 값·서식은 쓰기 전에 지운다 — 남아 있으면 옛 행이 새 표 아래 붙어 있는다.
   */
  async openOrCreateTab(name: string): Promise<{ gid: number; title: string; reused: boolean }> {
    const meta = await this.meta();
    const hit = meta.sheets.find((s) => s.properties.title === name);
    if (hit) {
      await this.clear(name);
      await this.batchUpdate([
        {
          repeatCell: {
            range: { sheetId: hit.properties.sheetId, startRowIndex: 0, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 60 },
            cell: {},
            fields: 'userEnteredFormat',
          },
        },
        { updateSheetProperties: { properties: { sheetId: hit.properties.sheetId, index: 0 }, fields: 'index' } },
      ]);
      return { gid: hit.properties.sheetId, title: name, reused: true };
    }
    const out = await this.call(`${this.api}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: name, index: 0 } } }] }),
    }) as { replies: { addSheet: { properties: { sheetId: number } } }[] };
    return { gid: out.replies[0].addSheet.properties.sheetId, title: name, reused: false };
  }

  async clear(tabTitle: string): Promise<void> {
    await this.call(`${this.api}/values/${encodeURIComponent(tabTitle)}!A:BZ:clear`, { method: 'POST', body: '{}' });
  }

  /** 결과 수식이 «수식»으로 들어가야 하므로 USER_ENTERED. RAW 로 쓰면 글자로 박힌다. */
  async write(tabTitle: string, values: (string | number)[][]): Promise<void> {
    await this.call(`${this.api}/values/${encodeURIComponent(tabTitle)}!A1?valueInputOption=USER_ENTERED`, {
      method: 'PUT', body: JSON.stringify({ values }),
    });
  }

  async batchUpdate(requests: Rec[]): Promise<void> {
    if (!requests.length) return;
    await this.call(`${this.api}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
  }
}
