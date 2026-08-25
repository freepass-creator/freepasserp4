/**
 * **정산원장(구글시트)을 읽어 ERP 로 넘긴다.** 읽기만 한다 — 쓰지 않는다.
 *
 * ★사장님 2026-08-26 「일단 로컬에서 정산관리하는거」.
 *   시트가 아직 정본이고 팀장이 거기서 적는다. ERP 는 **먼저 보여주기부터** 한다 —
 *   쓰기를 같이 열면 입구가 둘이 되고, 그게 오늘 종일 정리한 것을 되돌린다.
 *
 * ★**판정은 여기서 안 한다.** 자리·청구월·수수료는 전부 `lib/domain/settlement-stage.ts` 가 정한다.
 *   이 라우트는 시트 칸을 그 타입으로 옮겨 담기만 한다 — 규칙이 두 군데 있으면 반드시 갈린다.
 * ★관리자만 본다. 고객연락처가 들어 있다.
 */
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID } from '@/lib/domain/settlement-ledger';
import { billingMonth, bucketOf, moneyOf, stageOf, nextInstalment, type SettlementRow } from '@/lib/domain/settlement-stage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TABS = ['접수', '취소', '분납실적', '완료실적'] as const;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));

/** ★구글 날짜는 숫자로 온다 — `45301` 을 그냥 `new Date` 에 넣으면 45301년이 된다. */
const SERIAL0 = Date.UTC(1899, 11, 30);
const toDate = (v: string): Date | null => {
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
const iso = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');

type ServiceAccount = { client_email: string; private_key: string };
let tokenCache: { value: string; expiresAt: number } | null = null;
/** 왜 못 읽었는지 화면에 그대로 보여 준다 — 「안 된다」만 뜨면 고칠 데를 못 찾는다. */
let lastError = '';

/**
 * 서비스계정으로 시트 토큰을 받는다. **도메인 위임(pyh)**으로 열어야 원장이 보인다.
 * ★토큰 발급을 직접 짜지 않는다 — `google-auth-library` 가 이미 있고 스크립트 열댓 개가 그걸로 돈다.
 *   직접 짰더니 `unsupported_grant_type` 이 났다(실측 2026-08-26).
 * ⚠ **`readonly` 스코프는 도메인 위임에서 거부된다**(`unauthorized_client`) — 위임에 등록된
 *   스코프와 «정확히» 같아야 한다. 읽기만 하는 것은 코드가 지킨다(이 라우트에 쓰기 경로가 없다).
 */
async function sheetsToken(): Promise<string> {
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

export async function GET() {
  const token = await sheetsToken();
  if (!token) return NextResponse.json({ ok: false, reason: lastError || '서비스계정을 못 읽었다' }, { status: 503 });

  const rows: (SettlementRow & { stage: string; bucket: string; billingMonth: string | null; money: ReturnType<typeof moneyOf>; nextRound: string })[] = [];
  for (const tab of TABS) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SETTLEMENT_LEDGER_ID}/values/${encodeURIComponent(`'${tab}'!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) continue;
    const body = await res.json() as { values?: unknown[][] };
    const all = (body.values || []).map((r) => (r || []).map(S));
    // ★머리글은 1행이 아니라 «「차량번호」가 있는 줄»이다 — 1행에는 탭 설명이 붙어 있다.
    const hi = all.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const head = all[hi];
    const at = (n: string) => head.indexOf(n);
    for (const r of all.slice(hi + 1)) {
      const plate = S(r[at('차량번호')]);
      if (!plate) continue;
      const row: SettlementRow = {
        plate, supplier: S(r[at('공급사')]), agent: S(r[at('영업담당자')]), product: S(r[at('상품구분')]),
        term: N(r[at('계약기간')]), rent: N(r[at('렌탈료')]), price: N(r[at('차량가액')]), payKind: S(r[at('분납여부')]),
        receivedAt: toDate(r[at('접수일')]), deliveredAt: toDate(r[at('인도일')]), clawbackAt: toDate(r[at('환수일')]),
        clawbackAmount: N(r[at('환수금액')]),
        paper: ON(r[at('계약서')]), delivered: !!toDate(r[at('인도일')]),
        cancelled: ON(r[at('계약취소')]), clawback: ON(r[at('환수')]),
        claimWritten: N(r[at('판매수수료')]), payWritten: N(r[at('출고수수료')]),
        supplierRate: N(r[at('공급사수수료율')]), agentRate: N(r[at('에이전시수수료율')]),
      };
      rows.push({
        ...row,
        customer: S(r[at('고객명')]),
        stage: stageOf(row), bucket: bucketOf(row), billingMonth: billingMonth(row), money: moneyOf(row),
        nextRound: iso(nextInstalment(row)),
      } as never);
    }
  }
  return NextResponse.json({
    ok: true,
    readAt: new Date().toISOString(),
    ledgerUrl: `https://docs.google.com/spreadsheets/d/${SETTLEMENT_LEDGER_ID}/edit`,
    count: rows.length,
    rows: rows.map((r) => ({
      ...r,
      receivedAt: iso(r.receivedAt), deliveredAt: iso(r.deliveredAt), clawbackAt: iso(r.clawbackAt),
    })),
  });
}

/**
 * **계약 접수 — 시트 「접수」 탭에 한 줄 더한다.**
 *
 * ★사장님 2026-08-26 「계약접수(생성) 해서 진행할수 있게끔 하고 목록에 반영되는 형태면 되려나??
 *   사실상 담당자는 접수 계속 만들면서 미완료탭만 보면 되는거지」.
 *
 * ★**시트에 쓴다. ERP 에 따로 저장하지 않는다.** 그래야 정본이 하나로 남는다 —
 *   ERP 에도 저장하면 두 벌이 되고, 어느 쪽이 맞는지 아무도 모르게 된다(오늘 종일 그걸 막았다).
 * ★**빈 줄을 찾아 그 자리에 쓴다.** 접수 탭 아래 빈 줄 60개가 그 자리다.
 * ★접수일은 **오늘**이다. 한 번 박히면 안 바뀐다 — 실적을 세는 축이라 흔들리면 돈이 흔들린다.
 * ⚠ 나머지 칸(청구월·모델명·공급사·수수료)은 **비워 둔다.** 기계가 채운다 —
 *   여기서 지어내면 그게 그대로 청구액이 된다.
 */
export async function POST(req: Request) {
  const token = await sheetsToken();
  if (!token) return NextResponse.json({ ok: false, reason: lastError || '서비스계정을 못 읽었다' }, { status: 503 });

  const form = await req.json().catch(() => ({})) as Record<string, string>;
  const plate = S(form.plate);
  if (!plate) return NextResponse.json({ ok: false, reason: '차량번호가 없다' }, { status: 400 });

  const range = encodeURIComponent(`'접수'!A1:BZ200`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SETTLEMENT_LEDGER_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  if (!res.ok) return NextResponse.json({ ok: false, reason: `접수 탭을 못 읽었다 ${res.status}` }, { status: 502 });
  const body = await res.json() as { values?: unknown[][] };
  const all = (body.values || []).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) return NextResponse.json({ ok: false, reason: '접수 탭 머리글을 못 찾았다' }, { status: 502 });
  const head = all[hi];
  const iPlate = head.indexOf('차량번호');

  // ★같은 차가 아직 진행 중이면 막는다 — 한 줄은 한 계약이고, 재렌트는 앞 건이 끝난 뒤다.
  const open = all.slice(hi + 1).find((r) => S(r[iPlate]) === plate);
  if (open) return NextResponse.json({ ok: false, reason: `${plate} 는 접수에 이미 있다` }, { status: 409 });

  // 빈 줄 찾기 — 차량번호가 빈 첫 줄이 이어 적을 자리다.
  let at = all.slice(hi + 1).findIndex((r) => !S(r[iPlate]));
  if (at < 0) at = all.length - hi - 1;
  const rowIndex = hi + 1 + at;

  const today = new Date();
  const put: Record<string, string> = {
    접수일: iso(today), 차량번호: plate,
    고객명: S(form.customer), 고객연락처: S(form.phone),
    영업채널: S(form.channel), 영업담당자: S(form.agent),
    상품구분: S(form.product), 계약기간: S(form.term),
    보증금: S(form.deposit), 렌탈료: S(form.rent), 차량가액: S(form.price),
    분납여부: S(form.payKind),
    계약서: 'FALSE', 인도완료: 'FALSE', 계약취소: 'FALSE', 환수: 'FALSE',
  };
  const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
  const data = Object.entries(put)
    .map(([k, v]) => ({ col: head.indexOf(k), v }))
    .filter((x) => x.col >= 0 && x.v !== '')
    .map((x) => ({ range: `'접수'!${colA1(x.col)}${rowIndex + 1}`, values: [[x.v]] }));

  const wrote = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SETTLEMENT_LEDGER_ID}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  });
  if (!wrote.ok) return NextResponse.json({ ok: false, reason: `쓰지 못했다 ${wrote.status} ${(await wrote.text()).slice(0, 160)}` }, { status: 502 });
  return NextResponse.json({ ok: true, plate, row: rowIndex + 1, receivedAt: iso(today) });
}
