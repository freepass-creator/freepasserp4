/**
 * **정산원장(구글시트) — 관리자용.** GET 은 읽고, POST 는 「접수」에 한 줄 더한다.
 *
 * ★사장님 2026-08-26 「일단 로컬에서 정산관리하는거」.
 *   시트가 아직 정본이고 팀장이 거기서 적는다. ERP 는 **먼저 보여주기부터** 한다 —
 *   쓰기를 같이 열면 입구가 둘이 되고, 그게 오늘 종일 정리한 것을 되돌린다.
 *
 * ★**판정은 여기서 안 한다.** 자리·청구월·수수료는 전부 `lib/domain/settlement-stage.ts` 가 정한다.
 * ★**시트 칸 → 타입 옮겨 담기도 여기서 안 한다.** `lib/server/settlement-ledger-read.ts` 하나뿐이다 —
 *   영업자·공급사용(`/api/settlement/mine`)이 같은 원장을 읽는다. 읽는 코드가 둘이면 반드시 갈린다.
 * ★관리자만 본다. **고객연락처와 금액이 다 들어 있다** — 역할용은 절대 이 라우트를 부르지 않는다.
 */
import { NextResponse } from 'next/server';
import { SETTLEMENT_LEDGER_ID } from '@/lib/domain/settlement-ledger';
import { billingMonth, bucketOf, moneyOf, stageOf, nextInstalment } from '@/lib/domain/settlement-stage';
import { iso, ledgerError, ledgerUrl, readLedger, sheetsToken } from '@/lib/server/settlement-ledger-read';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { getDatabase } from 'firebase-admin/database';
import { billStateOf, issuedKey } from '@/lib/domain/settlement-billstate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const S = (v: unknown) => String(v ?? '').trim();

/**
 * **관리자인지 서버가 확인한다.**
 * ⚠ 이게 없던 동안 이 라우트는 로그인조차 없이 열려 있었다 — 금액과 고객연락처가 통째로 나갔다.
 *   화면을 관리자에게만 보여 주는 것과 API 를 관리자에게만 여는 것은 다르다. URL 은 누구나 친다.
 */
async function admin(req: Request): Promise<Response | null> {
  const who = await verifyActiveBearer(req).catch(() => null);
  if (!who) return NextResponse.json({ ok: false, reason: '로그인이 필요합니다.' }, { status: 401 });
  if (who.role !== 'admin') return NextResponse.json({ ok: false, reason: '관리자만 볼 수 있습니다.' }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const denied = await admin(req);
  if (denied) return denied;
  const token = await sheetsToken();
  if (!token) return NextResponse.json({ ok: false, reason: ledgerError() || '서비스계정을 못 읽었다' }, { status: 503 });

  const read = await readLedger(token);

  /**
   * ★**「청구완료」는 «청구서가 나갔나»로 판정한다.** 날짜가 지났다고 나간 게 아니다 —
   *   날짜로 치면 「청구한 줄 알았는데 아무도 안 보낸」 건이 조용히 완료로 넘어간다.
   *   발행 기록이 없으면 아무것도 청구완료가 아니다(모르는 것을 「됐다」로 치지 않는다).
   */
  const invoiceSnap = await getDatabase(firebaseAdminApp()).ref('v4/settlement_invoices').get().catch(() => null);
  const invoices = (invoiceSnap?.val() || {}) as Record<string, { month?: string; axis?: string; party?: string }>;
  const issued = new Set(
    Object.values(invoices)
      .filter((v) => S(v?.axis) === '공급사')
      .map((v) => issuedKey(S(v?.month), S(v?.party))),
  );

  const rows = read.map(({ row, extra }) => ({
    ...row,
    ...extra,
    receivedAt: iso(row.receivedAt), deliveredAt: iso(row.deliveredAt), clawbackAt: iso(row.clawbackAt),
    stage: stageOf(row), bucket: bucketOf(row), billingMonth: billingMonth(row), money: moneyOf(row),
    nextRound: iso(nextInstalment(row)),
    billState: billStateOf(row, issued),
  }));

  return NextResponse.json({
    ok: true, readAt: new Date().toISOString(), ledgerUrl: ledgerUrl(), count: rows.length, rows,
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
  const denied = await admin(req);
  if (denied) return denied;
  const token = await sheetsToken();
  if (!token) return NextResponse.json({ ok: false, reason: ledgerError() || '서비스계정을 못 읽었다' }, { status: 503 });

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
    // ★영업담당자는 «고른» 값이라 코드가 같이 온다. 코드가 있어야 동명이인이 갈린다.
    //   사람이 이름을 타이핑하면 그 줄은 나중에 누구 실적인지 못 정한다(실측 2026-08-26).
    영업채널: S(form.channel), 영업담당자: S(form.agent), 영업자코드: S(form.agentCode),
    // ★명부에 없는 영업자는 «연락처»가 신원이다(사장님 2026-08-26) —
    //   계정이 없어도 정산이 돌고, 나중에 그 사람이 가입하면 번호로 붙는다.
    영업자연락처: S(form.agentPhone),
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

/**
 * **한 줄의 진행을 고친다 — 계약서·인도완료·취소·환수.**
 *
 * ★사장님 2026-08-26 「급한건 당월거랑 당장 이번달말일로 정산해서 9월초에 청구할거를 챙기는거」.
 *   말일까지 **인도가 켜져야 그 달 청구로 들어온다.** 그걸 시트에서만 켤 수 있으면
 *   담당자가 마감 날 시트를 열어야 한다 — 그래서 ERP 에서 켠다.
 *
 * ★★**고칠 수 있는 칸을 흰 목록으로 못 박는다.** 금액·요율은 여기서 못 고친다 —
 *   수수료는 요율표에서 나오는 것이고, 화면에서 손대기 시작하면 그날로 정본이 둘이 된다.
 * ★★**인도완료를 켜려면 인도일이 있어야 한다.** 날짜 없이 켜면 청구월이 안 서고,
 *   「인도는 됐는데 청구가 없는」 줄이 조용히 생긴다. 그래서 날짜를 같이 받는다.
 * ★줄은 **차량번호+접수일**로 찾는다. 차번만으로 찾으면 재계약 때 옛 줄을 고친다.
 * ⚠ 자리를 세지 않는다 — 머리글에서 칸 이름을 찾아 쓴다. 원장도 칸이 늘 수 있다.
 */
const EDITABLE: Record<string, '체크' | '날짜' | '돈' | '글'> = {
  계약서: '체크', 인도완료: '체크', 계약취소: '체크', 환수: '체크',
  인도일: '날짜', 환수일: '날짜', 환수금액: '돈', 환수사유: '글',
};

export async function PATCH(req: Request) {
  const denied = await admin(req);
  if (denied) return denied;
  const token = await sheetsToken();
  if (!token) return NextResponse.json({ ok: false, reason: ledgerError() || '서비스계정을 못 읽었다' }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { plate?: string; receivedAt?: string; patch?: Record<string, string> };
  const plate = S(body.plate);
  const received = S(body.receivedAt);
  const patch = body.patch || {};
  if (!plate) return NextResponse.json({ ok: false, reason: '차량번호가 없다' }, { status: 400 });

  const bad = Object.keys(patch).filter((k) => !EDITABLE[k]);
  if (bad.length) return NextResponse.json({ ok: false, reason: `여기서 못 고치는 칸이다 — ${bad.join(', ')}` }, { status: 400 });

  // ★인도를 켜는데 날짜가 없으면 막는다. 청구월이 안 서는 줄을 만들지 않는다.
  if (/^(TRUE|true)$/.test(S(patch['인도완료'])) && !S(patch['인도일'])) {
    return NextResponse.json({ ok: false, reason: '인도일을 같이 넣어야 한다 — 날짜가 없으면 청구월이 안 선다' }, { status: 400 });
  }

  const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
  const SERIAL0 = Date.UTC(1899, 11, 30);
  const dateOf = (v: string) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 20000 && n < 80000) {
      const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
      return iso(new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()));
    }
    const d = new Date(v);
    return Number.isNaN(+d) ? '' : iso(d);
  };

  for (const tab of ['접수', '취소', '분납실적', '완납실적']) {
    const range = encodeURIComponent(`'${tab}'!A1:BZ3000`);
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SETTLEMENT_LEDGER_ID}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!res.ok) continue;
    const got = await res.json() as { values?: unknown[][] };
    const all = (got.values || []).map((r) => (r || []).map(S));
    const hi = all.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const head = all[hi];
    const iPlate = head.indexOf('차량번호');
    const iRecv = head.indexOf('접수일');
    const at = all.slice(hi + 1).findIndex((r) => S(r[iPlate]) === plate
      && (!received || dateOf(S(r[iRecv])) === received));
    if (at < 0) continue;

    const data = Object.entries(patch)
      .map(([k, v]) => ({ col: head.indexOf(k), k, v: EDITABLE[k] === '체크' ? (/^(TRUE|true)$/.test(S(v)) ? 'TRUE' : 'FALSE') : S(v) }))
      .filter((x) => x.col >= 0)
      .map((x) => ({ range: `'${tab}'!${colA1(x.col)}${hi + 2 + at}`, values: [[x.v]] }));
    if (!data.length) return NextResponse.json({ ok: false, reason: '고칠 칸을 원장에서 못 찾았다' }, { status: 400 });

    const wrote = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SETTLEMENT_LEDGER_ID}/values:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    });
    if (!wrote.ok) return NextResponse.json({ ok: false, reason: `쓰지 못했다 ${wrote.status} ${(await wrote.text()).slice(0, 160)}` }, { status: 502 });
    return NextResponse.json({ ok: true, plate, tab, row: hi + 2 + at, patch });
  }
  return NextResponse.json({ ok: false, reason: `${plate}${received ? ` (접수 ${received})` : ''} 를 원장에서 못 찾았다` }, { status: 404 });
}
