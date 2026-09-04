/**
 * **정산원장을 「당월실적」·「기존실적」 두 탭으로 가른다.** 기본 미리보기, 반영은 `--apply`.
 *
 * ★사장님 2026-08-24 (강지수 팀장에게 보낸 지시 그대로)
 *   「그냥 계약된 거는 차량번호만 정산서에 기입해 주세요」
 *   「계약금 입금되면 차량번호만 정산서 내가 만들어 준 거에 입력해 주시고」
 *   「계약서 나가고 차량 인도되면 계약완료 체크랑 누가 영업했는지만… 영업채널/영업담당자 이렇게만」
 *   → **팀장이 넣는 것은 넷뿐이다 — 차량번호 · 영업채널 · 영업담당자 · 완료여부**
 *   「일단 이렇게 했으면 좋겠어 당월 거만 하고 누적은 월 표시해서 쭈욱 한 탭으로」
 *   「기존 실적이랑 당월실적 탭 구분해서」 · 「기존 실적을 복사해서 갖고올 거고」
 *
 * ★어떻게 가르나
 *   「당월실적」 = 정산월이 이번 달 **이후**(아직 정산 안 끝난 진행 건). 팀장이 여기에만 적는다.
 *   「기존실적」 = 그 앞 전부. 월을 지우지 않고 «정산월 열»로 표시해 한 탭에 쭈욱 쌓는다.
 *   열은 두 탭이 같다 — 달이 바뀌면 당월 줄을 기존실적 뒤에 붙이기만 하면 된다.
 *
 * ★같이 하는 것
 *   · 열 이름을 사장님 말로 — 「에이전시」→「영업채널」 · 「영업자」→「영업담당자」
 *     (수식은 이 두 칸을 참조하지 않는다. 수수료율은 공급사·상품구분·계약기간으로만 찾는다)
 *   · 팀장이 적는 네 칸에 **연노랑 배경** — 나머지는 손댈 곳이 아니라는 표시
 *   · 상태·영업채널·영업담당자에 **드롭다운** — 「계약완료 체크」를 두 번 클릭으로
 *
 * ⚠ **먼저 백업 탭을 뜬다**(「_백업 MMDD」·숨김). 사장님 시트를 가르는 일이라 되돌릴 길을 남긴다.
 * ⚠ 데이터는 한 벌만 남는다 — 당월 줄은 기존실적에서 **덜어 내고** 당월실적으로 옮긴다.
 *
 *   npx tsx scripts/split-settlement-tabs.mts
 *   npx tsx scripts/split-settlement-tabs.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  SETTLEMENT_LEDGER_ID as ID, SETTLEMENT_LEDGER_TAB as OLD_TAB,
  SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB, SETTLEMENT_INPUT_COLUMNS, LEDGER_CONTRACT_STATES,
} from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;
const now = new Date();
const YM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const MMDD = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

/** 열 이름을 사장님 말로 바꾼다. 수식이 참조하지 않는 칸만 고른 것이다. */
const RENAME: Record<string, string> = { 에이전시: '영업채널', 영업자: '영업담당자' };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const api = async (u: string, init?: RequestInit): Promise<any> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 220)}`);
  return r.json();
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const batch = (requests: Record<string, unknown>[]) => api(`${SH}/${ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });

// ── 지금 상태
const meta = await api(`${SH}/${ID}?fields=sheets.properties(title,sheetId,index,gridProperties)`);
const sheetOf = (t: string) => (meta.sheets || []).find((s: any) => S(s.properties.title) === t)?.properties;
const src = sheetOf(OLD_TAB) || sheetOf(SETTLEMENT_PAST_TAB);
if (!src) throw new Error(`「${OLD_TAB}」·「${SETTLEMENT_PAST_TAB}」 어느 탭도 없다`);
const srcTitle = S(src.title);

const got = await api(`${SH}/${ID}/values/${encodeURIComponent(`${a1(srcTitle)}!A1:AL2000`)}?valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] };
const raw = ((got?.values || []) as unknown[][]).map((r) => (r || []).map((c) => (c === null || c === undefined ? '' : c)));
const head = (raw[0] || []).map(S);
const iMonth = head.indexOf('정산월');
if (iMonth < 0) throw new Error('「정산월」 칸을 못 찾았다');
const body = raw.slice(1).filter((r) => r.some((c) => S(c)));

/** 당월 = 정산월이 이번 달 이후. 아직 정산이 안 끝난 진행 건이라 팀장이 손댈 자리다. */
const isCurrent = (r: unknown[]) => S(r[iMonth]) >= YM;
const cur = body.filter(isCurrent);
const past = body.filter((r) => !isCurrent(r));

console.log(`■ 정산원장 가르기 — 「${srcTitle}」 ${body.length}줄\n`);
console.log(`   당월실적 (정산월 ${YM} 이후)  ${String(cur.length).padStart(4)}줄`);
console.log(`   기존실적 (그 앞 전부)        ${String(past.length).padStart(4)}줄`);
const months = [...new Set(cur.map((r) => S(r[iMonth])))].sort();
console.log(`   당월실적에 드는 달: ${months.join(' · ') || '(없음)'}`);
console.log(`\n   열 이름 바꿀 것: ${Object.entries(RENAME).map(([a, b]) => `${a}→${b}`).join(' · ')}`);
console.log(`   팀장이 적는 칸(연노랑+드롭다운): ${SETTLEMENT_INPUT_COLUMNS.join(' · ')}`);
const missing = SETTLEMENT_INPUT_COLUMNS.filter((c) => !head.includes(c) && !Object.values(RENAME).includes(c));
if (missing.length) console.log(`   ⚠ 표에 없는 입력 칸: ${missing.join(' · ')}`);

if (!APPLY) { console.log('\n  (미리보기다 — 반영하려면 --apply)'); process.exit(0); }

// ── ① 백업 탭(숨김) — 가르기 전 한 벌을 남긴다
const backupTitle = `_백업 ${MMDD}`;
if (!sheetOf(backupTitle)) {
  const made = await batch([{ duplicateSheet: { sourceSheetId: src.sheetId, newSheetName: backupTitle, insertSheetIndex: 99 } }]);
  const bid = made.replies?.[0]?.duplicateSheet?.properties?.sheetId;
  if (bid !== undefined) await batch([{ updateSheetProperties: { properties: { sheetId: bid, hidden: true }, fields: 'hidden' } }]);
  console.log(`  ✓ 백업 탭 「${backupTitle}」(숨김)`);
}

// ── ② 원본을 「기존실적」으로 — 이름만 바꾼다(데이터는 그대로 앉아 있다)
if (srcTitle !== SETTLEMENT_PAST_TAB) {
  await batch([{ updateSheetProperties: { properties: { sheetId: src.sheetId, title: SETTLEMENT_PAST_TAB }, fields: 'title' } }]);
  console.log(`  ✓ 「${srcTitle}」 → 「${SETTLEMENT_PAST_TAB}」`);
}

// ── ③ 「당월실적」 탭 — 없으면 원본을 복제해 만든다(수식·서식이 딸려 온다)
let curId = sheetOf(SETTLEMENT_CURRENT_TAB)?.sheetId;
if (curId === undefined) {
  const made = await batch([{ duplicateSheet: { sourceSheetId: src.sheetId, newSheetName: SETTLEMENT_CURRENT_TAB, insertSheetIndex: Number(src.index) } }]);
  curId = made.replies?.[0]?.duplicateSheet?.properties?.sheetId;
  console.log(`  ✓ 「${SETTLEMENT_CURRENT_TAB}」 탭`);
}

// ── ④ 줄 나눠 앉히기 — 당월은 당월실적에, 기존실적에는 그 앞만
const put = async (tab: string, rows: unknown[][]) => {
  await api(`${SH}/${ID}/values/${encodeURIComponent(`${a1(tab)}!A2:AL2000`)}?valueInputOption=USER_ENTERED`, { method: 'POST', body: JSON.stringify({}) })
    .catch(() => undefined);
  await api(`${SH}/${ID}/values/${encodeURIComponent(`${a1(tab)}!A2:AL2000`)}:clear`, { method: 'POST', body: JSON.stringify({}) });
  if (rows.length) {
    await api(`${SH}/${ID}/values/${encodeURIComponent(`${a1(tab)}!A2`)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT', body: JSON.stringify({ values: rows }),
    });
  }
};
await put(SETTLEMENT_CURRENT_TAB, cur);
console.log(`  ✓ 당월실적 ${cur.length}줄`);
await put(SETTLEMENT_PAST_TAB, past);
console.log(`  ✓ 기존실적 ${past.length}줄`);

// ── ⑤ 열 이름을 사장님 말로 (두 탭 다)
const newHead = head.map((h) => RENAME[h] || h);
for (const tab of [SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB]) {
  await api(`${SH}/${ID}/values/${encodeURIComponent(`${a1(tab)}!A1:${colA1(newHead.length - 1)}1`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [newHead] }),
  });
}
console.log(`  ✓ 열 이름 — ${Object.entries(RENAME).map(([a, b]) => `${a}→${b}`).join(' · ')}`);

// ── ⑥ 팀장이 적는 네 칸 — 연노랑 + 드롭다운
const idxOf = (name: string) => newHead.indexOf(name);
const yellow = { red: 1, green: 0.98, blue: 0.86 };
const reqs: Record<string, unknown>[] = [];
for (const name of SETTLEMENT_INPUT_COLUMNS) {
  const i = idxOf(name);
  if (i < 0) continue;
  reqs.push({ repeatCell: {
    range: { sheetId: curId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: i, endColumnIndex: i + 1 },
    cell: { userEnteredFormat: { backgroundColor: yellow } }, fields: 'userEnteredFormat.backgroundColor',
  } });
}
/** 「계약완료 체크」를 두 번 클릭으로 — 손으로 적으면 글자가 갈린다. */
const dropdown = (name: string, values: readonly string[]) => {
  const i = idxOf(name);
  if (i < 0 || !values.length) return;
  reqs.push({ setDataValidation: {
    range: { sheetId: curId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: i, endColumnIndex: i + 1 },
    rule: { condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false },
  } });
};
dropdown('상태', LEDGER_CONTRACT_STATES);
const uniq = (name: string) => {
  const i = head.indexOf(name);
  if (i < 0) return [] as string[];
  const m = new Map<string, number>();
  body.forEach((r) => { const v = S(r[i]); if (v) m.set(v, (m.get(v) || 0) + 1); });
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k]) => k);
};
dropdown('영업채널', uniq('에이전시'));
dropdown('영업담당자', uniq('영업자'));
await batch(reqs);
console.log(`  ✓ 팀장 입력 ${SETTLEMENT_INPUT_COLUMNS.length}칸 — 연노랑 + 드롭다운`);

console.log(`\n  https://docs.google.com/spreadsheets/d/${ID}/edit`);
