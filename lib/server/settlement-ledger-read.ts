/**
 * **정산원장(구글시트)을 읽어 오는 곳 — 한 군데뿐이다.** 읽기만 한다.
 *
 * ★두 라우트가 같은 원장을 본다. 관리자용(`/api/settlement/ledger`)과 역할용(`/api/settlement/mine`).
 *   ⚠ 읽는 코드를 양쪽에 복사하면 «칸 이름 하나 바뀔 때 한쪽만 고치는» 사고가 난다.
 *   오늘 하루 그 사고를 여섯 번 냈다 — 바꾼 쪽만 고치고 읽는 쪽을 안 고쳤다.
 *   그래서 시트 칸 → 타입 옮겨 담기는 **이 파일에만** 있다.
 *
 * ★판정(자리·청구월·수수료)은 여기서 안 한다. `lib/domain/settlement-stage.ts` 가 정한다.
 */
import { readFile } from 'node:fs/promises';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID } from '@/lib/domain/settlement-ledger';
import type { SettlementRow } from '@/lib/domain/settlement-stage';

export const LEDGER_TABS = ['접수', '취소', '분납실적', '완료실적'] as const;
export const ledgerUrl = () => `https://docs.google.com/spreadsheets/d/${SETTLEMENT_LEDGER_ID}/edit`;

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));

/** ★구글 날짜는 숫자로 온다 — `45301` 을 그냥 `new Date` 에 넣으면 45301년이 된다(실측). */
const SERIAL0 = Date.UTC(1899, 11, 30);
export const toDate = (v: unknown): Date | null => {
  const t = S(v);
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const x = new Date(t);
  return Number.isNaN(+x) ? null : x;
};
const p2 = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date | null) => (d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '');

type ServiceAccount = { client_email: string; private_key: string };
let tokenCache: { value: string; expiresAt: number } | null = null;
let lastError = '';
/** 왜 못 읽었는지 화면에 그대로 보여 준다 — 「안 된다」만 뜨면 고칠 데를 못 찾는다. */
export const ledgerError = () => lastError;

/**
 * 서비스계정으로 시트 토큰을 받는다. **도메인 위임(pyh)**으로 열어야 원장이 보인다.
 * ★토큰 발급을 직접 짜지 않는다 — 직접 짰더니 `unsupported_grant_type` 이 났다(실측 2026-08-26).
 * ⚠ **`readonly` 스코프는 도메인 위임에서 거부된다**(`unauthorized_client`) — 등록된 스코프와
 *   «정확히» 같아야 한다. 읽기만 하는 것은 코드가 지킨다(이 파일에 쓰기 경로가 없다).
 */
export async function sheetsToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  let raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    const file = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json').trim();
    raw = await readFile(file, 'utf8').catch(() => '');
  }
  if (!raw) { lastError = '서비스계정 파일을 못 읽었다 (GOOGLE_APPLICATION_CREDENTIALS)'; return ''; }
  const account = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!account.client_email || !account.private_key) { lastError = '서비스계정에 client_email·private_key 가 없다'; return ''; }
  try {
    const jwt = new JWT({
      email: account.client_email,
      key: account.private_key.replace(/\n/g, String.fromCharCode(10)),
      subject: 'pyh@teamjpk.com',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const got = await jwt.getAccessToken();
    if (!got.token) { lastError = '토큰이 비어 있다'; return ''; }
    tokenCache = { value: got.token, expiresAt: Date.now() + 55 * 60_000 };
    return got.token;
  } catch (e) {
    lastError = `토큰 발급 실패 — ${String((e as Error)?.message || e).slice(0, 200)}`;
    return '';
  }
}

/** 원장에만 있고 판정에 안 쓰는 칸 — 관리자 화면이 그대로 보여 준다. */
export type LedgerExtra = { phone: string; clawbackReason: string; channel: string; contractNo: string; note: string };

/**
 * 네 탭을 읽어 한 줄씩 타입으로 옮겨 담는다.
 * ★머리글은 1행이 아니라 «「차량번호」가 있는 줄»이다 — 1행에는 탭 설명이 붙어 있다.
 */
export async function readLedger(token: string): Promise<{ row: SettlementRow; tab: string; extra: LedgerExtra }[]> {
  const out: { row: SettlementRow; tab: string; extra: LedgerExtra }[] = [];
  for (const tab of LEDGER_TABS) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SETTLEMENT_LEDGER_ID}/values/${encodeURIComponent(`'${tab}'!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) { lastError = `${tab} 탭을 못 읽었다 ${res.status}`; continue; }
    const body = await res.json() as { values?: unknown[][] };
    const all = (body.values || []).map((r) => (r || []).map(S));
    const hi = all.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const head = all[hi];
    const at = (n: string) => head.indexOf(n);
    for (const r of all.slice(hi + 1)) {
      const plate = S(r[at('차량번호')]);
      if (!plate) continue;
      out.push({
        tab,
        row: {
          plate, supplier: S(r[at('공급사')]), agent: S(r[at('영업담당자')]), product: S(r[at('상품구분')]),
          term: N(r[at('계약기간')]), rent: N(r[at('렌탈료')]), price: N(r[at('차량가액')]),
          deposit: N(r[at('보증금')]), model: S(r[at('모델명')]), customer: S(r[at('고객명')]),
          channel: S(r[at('영업채널')]), agentCode: S(r[at('영업자코드')]),
          payKind: S(r[at('분납여부')]),
          receivedAt: toDate(r[at('접수일')]), deliveredAt: toDate(r[at('인도일')]), clawbackAt: toDate(r[at('환수일')]),
          clawbackAmount: N(r[at('환수금액')]),
          paper: ON(r[at('계약서')]), delivered: !!toDate(r[at('인도일')]),
          cancelled: ON(r[at('계약취소')]), clawback: ON(r[at('환수')]),
          claimWritten: N(r[at('판매수수료')]), payWritten: N(r[at('출고수수료')]),
          supplierRate: N(r[at('공급사수수료율')]), agentRate: N(r[at('에이전시수수료율')]),
        },
        extra: {
          phone: S(r[at('고객연락처')]), clawbackReason: S(r[at('환수사유')]),
          channel: S(r[at('영업채널')]), contractNo: S(r[at('계약번호')]), note: S(r[at('비고')]),
        },
      });
    }
  }
  return out;
}
