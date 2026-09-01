/**
 * **「정산 진행」 탭 — 직원이 «직접 적는» 진행 상태.** 기본은 «보기만», `--apply` 라야 쓴다.
 *
 * ★사장님 2026-08-27
 *   「일단 구글시트를 직접입력해서 상태값을 관리하고자 하는거야」
 *   「이게 일단은 엑셀처럼 erp연동 안되도 좋아 나중에 매칭하면 되니까」 「기존이랑 연동안되도 돼」
 *
 * ★★★**ERP 와 연동하지 않는다.** 이 탭은 `LEDGER_TABS`(접수·취소·분납실적·완납실적)에 없다 —
 *   ERP 는 이 탭을 읽지도 쓰지도 않는다. 갈라짐 검사에도 안 걸린다. 여기서 뭘 적어도 ERP 는 그대로다.
 *
 * ★★★**「정산코드」 칸이 이 탭의 값어치 전부다.** 「나중에 매칭하면 되니까」가 되려면
 *   맞출 «열쇠»가 있어야 한다. `stl_` 대체키는 **절대 안 바뀐다** — 차번도 이름도 바뀌지만 이건 안 바뀐다.
 *   ⚠ 열쇠 없이 만들어 두면 나중에 맞출 때 차번·이름으로 더듬어야 한다.
 *     이번 판에서 이름으로 맞히다 네 번 어긋난 그 병을 그대로 다시 앓는다.
 *
 * ★★**두 번째 부를 때는 «없는 줄만» 더한다.** 이미 있는 줄은 손도 안 댄다 —
 *   직원이 적어 둔 것을 덮으면 그날로 이 탭을 아무도 안 믿는다.
 *   ⇒ 처음 한 번 씨를 뿌리고, 그다음부터는 새 계약만 아래에 붙는다.
 *
 * ★규격은 이 문서의 「시트 규격」 탭이 정본이다(문서코드 F04). 거기서 시킨 대로 —
 * ```
 * ① 1행에 제목을, «그 옆 칸»에 한 줄 설명      ← A1·B1 두 칸이라야 공지줄로 읽힌다
 * ② 필드헤더는 «한 줄»                        두 줄로 나누면 읽는 도구가 열을 못 찾는다
 * ③ 고정행을 「제목 + 헤더」만큼               ★고정행이 «여기가 표다»를 가리키는 유일한 표시
 * ④ 규격 입히기는 aiops 가 한다               node unyoung/siteu-gyugyeok.mjs --만=... --쓴다
 * ```
 *   ⚠ ③이 없으면 규격 도구가 «표가 아닌 것»으로 보아 읽는 글 규격을 입힌다.
 *
 *   npx tsx scripts/build-progress-tab.mts            무엇을 넣을지 표로만
 *   npx tsx scripts/build-progress-tab.mts --apply    정말로 만든다 / 새 줄을 더한다
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { SETTLEMENT_LEDGER_ID as SHEET } from '../lib/domain/settlement-ledger';
import { normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';
import { billingMonth, type SettlementRow } from '../lib/domain/settlement-stage';
import { BILL_STATES, billStateOf, issuedKey } from '../lib/domain/settlement-billstate';

const APPLY = process.argv.includes('--apply');
const TAB = '정산 진행';
const S = (v: unknown) => String(v ?? '').trim();
const YN = (v: unknown) => (v ? '예' : '아니오');
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
const asRow = (r: SettlementRecord): SettlementRow => ({
  ...r, receivedAt: D(r.receivedAt), deliveredAt: D(r.deliveredAt), clawbackAt: D(r.clawbackAt),
} as unknown as SettlementRow);

/**
 * 칸 짜임 — **왼쪽은 기계가 채우고, 가운데는 사람이 적고, 오른쪽은 자취다.**
 * ★`직접` 이 붙은 칸이 «사람이 적는» 칸이다. 나머지는 씨만 뿌리고 다시 안 건드린다.
 * ⚠ 열 순서를 바꾸지 않는다(「시트 규격」 탭) — 바꾸면 다음 사람이 쓴 것과 어긋난다.
 */
const COLS = [
  { key: '접수일', pick: (r: SettlementRecord) => S(r.receivedAt) },
  { key: '차량번호', pick: (r: SettlementRecord) => S(r.plate) },
  { key: '고객명', pick: (r: SettlementRecord) => S(r.customer) },
  { key: '공급사', pick: (r: SettlementRecord) => S(r.supplier) },
  { key: '영업채널', pick: (r: SettlementRecord) => S(r.channel) },
  { key: '영업담당자', pick: (r: SettlementRecord) => S(r.agent) },
  { key: '상품구분', pick: (r: SettlementRecord) => S(r.product) },
  { key: '계약서', 직접: ['예', '아니오'], pick: (r: SettlementRecord) => YN(r.paper) },
  { key: '인도완료', 직접: ['예', '아니오'], pick: (r: SettlementRecord) => YN(r.delivered) },
  { key: '인도일', 직접: true, pick: (r: SettlementRecord) => S(r.deliveredAt) },
  { key: '계약취소', 직접: ['예', '아니오'], pick: (r: SettlementRecord) => YN(r.cancelled) },
  { key: '청구상태', 직접: BILL_STATES as unknown as string[], pick: (r: SettlementRecord, st: string) => st },
  { key: '청구월', 직접: true, pick: (r: SettlementRecord) => S(billingMonth(asRow(r))) },
  // ★ERP 에 «없는» 칸이다. 여기서만 관리한다 — 이 탭을 만드는 까닭 중 하나다.
  { key: '입금일', 직접: true, pick: () => '' },
  { key: '환수', 직접: ['예', '아니오'], pick: (r: SettlementRecord) => YN(r.clawback) },
  { key: '비고', 직접: true, pick: (r: SettlementRecord) => S(r.note) },
  { key: '고친날', 직접: true, pick: () => '' },
  { key: '고친사람', 직접: true, pick: () => '' },
  // ★★맨 오른쪽. 나중에 ERP 와 맞출 «열쇠». 지우면 맞출 길이 없어진다.
  { key: '정산코드', pick: (r: SettlementRecord) => S(r.code) },
] as const;

// ── 원장 읽기 ─────────────────────────────────────────────
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({
    credential: cert(sa),
    databaseURL: S(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL)
      || 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
  });
}
const db = getDatabase();
const recs = Object.values(((await db.ref('v4/settlement_rows').get()).val() || {}) as Record<string, SettlementRecord>)
  .map(normalizeRecord);
const invoices = ((await db.ref('v4/settlement_invoices').get().catch(() => null))?.val() || {}) as Record<string, { month?: string; axis?: string; party?: string }>;
const issued = new Set(Object.values(invoices).filter((v) => S(v?.axis) === '공급사').map((v) => issuedKey(S(v?.month), S(v?.party))));

/** 최근 것이 위로 — 매일 보는 것은 «지금 벌어지는 일»이다. */
const sorted = recs.slice().sort((a, b) => S(b.receivedAt).localeCompare(S(a.receivedAt)));
const lineOf = (r: SettlementRecord) => COLS.map((c) => c.pick(r, billStateOf(asRow(r), issued)));

// ── 시트 ─────────────────────────────────────────────────
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const { token } = await jwt.getAccessToken();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}${path}`, { ...init, headers: H });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};

const meta = await api('?fields=sheets.properties') as { sheets: { properties: { title: string; sheetId: number } }[] };
const found = meta.sheets.find((s) => s.properties.title === TAB);

/** 이미 있는 줄의 «정산코드» — 이것으로 새 줄만 가른다. */
let have = new Set<string>();
if (found) {
  const col = String.fromCharCode(65 + COLS.length - 1);
  const got = await api(`/values/${encodeURIComponent(`'${TAB}'!${col}3:${col}5000`)}`) as { values?: string[][] };
  have = new Set((got.values || []).map((r) => S(r?.[0])).filter(Boolean));
}
const fresh = sorted.filter((r) => !have.has(S(r.code)));

console.log(`\n■ 「${TAB}」 — 원장 ${recs.length}줄${APPLY ? '' : '   ★보기만 합니다'}\n`);
console.log(`   탭          ${found ? '있습니다' : '★새로 만듭니다'}`);
console.log(`   이미 있는 줄  ${have.size}`);
console.log(`   더할 줄      ${fresh.length}`);
console.log(`   칸          ${COLS.length} — 직접 적는 칸 ${COLS.filter((c) => '직접' in c).length}`);
console.log(`\n   ${COLS.map((c) => (('직접' in c) ? `★${c.key}` : c.key)).join(' · ')}`);
console.log('\n   (★ = 직원이 직접 적는 칸)');
if (fresh.length) {
  console.log('\n   맨 위 두 줄 미리보기');
  for (const r of fresh.slice(0, 2)) console.log('     ' + lineOf(r).map((v) => S(v) || '—').join(' | '));
}
if (!APPLY) { console.log('\n   ★아직 «안 썼습니다». --apply 를 붙이세요.\n'); process.exit(0); }
if (found && !fresh.length) { console.log('\n   ○ 더할 줄이 없습니다 — 아무것도 안 건드렸습니다.\n'); process.exit(0); }

const NOTICE = [TAB, [
  '직원이 «직접» 적는 진행 상태입니다. ERP 와 연동하지 않습니다 — 여기서 고쳐도 ERP 는 안 바뀝니다.',
  '맨 오른쪽 「정산코드」는 나중에 ERP 와 맞출 열쇠입니다. ★지우지 마세요.',
].join('\n')];

if (!found) {
  await api(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        addSheet: {
          properties: {
            title: TAB,
            gridProperties: { rowCount: Math.max(1000, sorted.length + 100), columnCount: COLS.length, frozenRowCount: 2 },
          },
        },
      }],
    }),
  });
  await api(`/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [NOTICE, COLS.map((c) => c.key)] }),
  });
  console.log('\n   ○ 탭을 만들었습니다 — 공지줄 · 필드헤더 · 고정행 2');
}

/** ★맨 아래에 «붙인다». 있는 줄 위에 덮어쓰지 않는다. */
await api(`/values/${encodeURIComponent(`'${TAB}'!A3`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
  method: 'POST',
  body: JSON.stringify({ values: fresh.map(lineOf) }),
});
console.log(`   ○ ${fresh.length}줄 붙였습니다`);

/**
 * 드롭다운 — **적는 칸만.** 손으로 치게 두면 「청구완료」「청구 완료」「완료」가 섞인다.
 * ⚠ `showCustomUi` 를 켜서 «화살표»가 보이게 한다. 안 보이면 직원이 그냥 친다.
 * ⚠ `strict: false` — 막지는 않는다. 막으면 급할 때 아무것도 못 적고 멈춘다. 빨간 표만 뜬다.
 */
const gid = (found?.properties.sheetId)
  ?? ((await api('?fields=sheets.properties') as typeof meta).sheets.find((s) => s.properties.title === TAB)!.properties.sheetId);
const rules = COLS.map((c, i) => (Array.isArray((c as { 직접?: unknown }).직접) ? {
  setDataValidation: {
    range: { sheetId: gid, startRowIndex: 2, endRowIndex: 5000, startColumnIndex: i, endColumnIndex: i + 1 },
    rule: {
      condition: { type: 'ONE_OF_LIST', values: ((c as unknown as { 직접: string[] }).직접).map((v) => ({ userEnteredValue: v })) },
      showCustomUi: true, strict: false,
    },
  },
} : null)).filter(Boolean);
await api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: rules }) });
console.log(`   ○ 드롭다운 ${rules.length}칸`);

console.log(`\n   https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${gid}`);
console.log('\n   다음  cd C:\\dev\\aiops  ·  node unyoung/siteu-gyugyeok.mjs --만=프리패스_정산원장 --쓴다');
console.log('         ★규격(글꼴·색·행높이)은 aiops 가 입힙니다. 여기서 손대지 않습니다.\n');
process.exit(0);
