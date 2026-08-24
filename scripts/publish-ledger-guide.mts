/**
 * **정산원장 「이 시트는」 탭에 입력 안내를 적는다** — 팀장이 여기만 읽으면 되게.
 * 기본 미리보기, 반영은 `--apply`.
 *
 * ★사장님 2026-08-24 「정산시트 만들어 주고 강지수 팀장이 계약중으로 접수된 거 반영하라고 할 거야」
 *   「정산시트 입력을 계약금 들어온 거 차량번호만 올리면 알아서 계약중으로 바뀌는 거지」
 *
 * ★**팀장이 넣는 것은 차량번호 하나다.** 그 한 칸에서 나머지가 두 갈래로 찬다 —
 *   ① 시트 수식 — 모델명·차량가액·렌탈료·공급사·수수료율·청구금액·지급액·수익
 *   ② `sync-contract-from-ledger` — 상태 「계약중」·접수일·정산월 + **공급사 시트 상태**
 *
 * ⚠ 이 시트는 사장님 «개인 내 드라이브»에 있고 만든 뒤 아무에게도 안 열려 있었다(2026-08-24 실측).
 *   「이 시트는」 탭은 「직원이 입력」이라 적어 놓았는데 정작 직원이 못 봤다.
 *   **보는 권한은 사장님이 직접 주신다** — 여기서는 안내 글만 적는다.
 *
 *   npx tsx scripts/publish-ledger-guide.mts
 *   npx tsx scripts/publish-ledger-guide.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER_ID } from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

/** 「이 시트는」 탭에 적을 입력 안내 — 팀장이 여기만 읽으면 된다. */
const GUIDE: [string, string][] = [
  ['입력하는 사람', '강지수 팀장 — 계약금이 들어온 차를 올린다'],
  ['★넣는 것', '차량번호 하나(H열). 맨 아래 빈 줄에 적는다. 상태 칸은 비워 둔다'],
  ['같이 넣으면 좋은 것', '고객명 · 계약기간(개월) · 보증금 — 있으면 적고 없으면 비워 둬도 된다'],
  ['저절로 차는 것 ①', '모델명 · 차량가액 · 렌탈료 · 공급사 · 수수료율 · 청구금액 · 지급액 · 수익 — 시트 수식이 「_상품」·「수수료표」에서 끌어온다'],
  ['저절로 차는 것 ②', '상태 「계약중」 · 접수일 · 정산월 — AI 가 채운다'],
  ['그리고 같이 바뀐다', '공급사 시트의 그 차 상태도 「계약중」이 된다 → 영업자 표(상품리스트)와 ERP 에 뜬다'],
  ['상태를 손으로 적을 때', '계약 완료 · 환수 · 계약 불가(취소) · 연장 — 이렇게 적힌 줄은 AI 가 손대지 않는다'],
  ['⚠ 하지 말 것', '상태 칸에 미리 「계약중」을 적지 말 것 — 비워 둬야 AI 가 새 줄로 알아본다'],
  ['AI 가 도는 명령', 'sync-contract-from-ledger --apply → publish-origin-tab --apply → run-sheet-daily-sync-local --apply'],
  ['고치는 곳', 'C:\\dev\\freepasserp4 · scripts/sync-contract-from-ledger.mts'],
];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com',
});
const api = async (u: string, init?: RequestInit): Promise<any> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

const meta = await api(`${SH}/${LEDGER_ID}?fields=sheets.properties(title,sheetId)`);
if (!(meta.sheets || []).some((s: any) => S(s.properties.title) === '이 시트는')) throw new Error('「이 시트는」 탭이 없다');
const cur = await api(`${SH}/${LEDGER_ID}/values/${encodeURIComponent("'이 시트는'!A1:D40")}`) as { values?: string[][] };
const rows = ((cur.values || []) as string[][]).map((r) => (r || []).map(S));

/** 두 번 돌려도 안내가 두 벌이 안 되게 — 첫 줄 표식을 찾아 그 자리에 갈아 끼운다. */
const at = rows.findIndex((r) => r[0] === GUIDE[0][0]);
const startRow = at >= 0 ? at : rows.filter((r) => r.some((c) => c)).length + 1;

console.log(`■ 정산원장 「이 시트는」 — 입력 안내 ${GUIDE.length}줄을 ${startRow + 1}행부터 ${at >= 0 ? '갈아 끼운다' : '붙인다'}\n`);
for (const [k, v] of GUIDE) console.log(`   ${k.padEnd(18)} ${v.slice(0, 76)}`);

if (!APPLY) { console.log('\n  (미리보기다 — 반영하려면 --apply)'); process.exit(0); }
await api(`${SH}/${LEDGER_ID}/values/${encodeURIComponent(`'이 시트는'!A${startRow + 1}:B${startRow + GUIDE.length}`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: GUIDE.map(([k, v]) => [k, v]) }),
});
console.log(`\n  ✓ 입력 안내 ${GUIDE.length}줄`);
console.log(`  https://docs.google.com/spreadsheets/d/${LEDGER_ID}/edit`);
