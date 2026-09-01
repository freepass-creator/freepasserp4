/**
 * **정산원장 상태 용어를 공급사 시트에 맞춘다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「계약진행중을 계약중으로 해야지 공급사시트랑 맞춰야하고」.
 *
 * ★왜 — 실측 2026-08-25 원장 1,706건에 **「계약중」이 한 건도 없고 「계약진행중」이 41건** 있었다.
 *   공급사 시트·영업자 표·ERP 는 전부 **「계약중」**을 쓴다. 같은 뜻을 두 말로 쓰면
 *   상태로 세는 것이 전부 어긋난다 — 「계약중 몇 대」를 물으면 41대가 빠진다.
 *   코드 상수(`SETTLEMENT_STATES`)도 이미 「계약중」이다. 데이터만 옛말이었다.
 *
 * ★값을 바꾸기 전에 **바꿀 줄을 전부 적어 둔다**(차번·행). 되돌리려면 그 목록이 있어야 한다.
 * ★상태 칸에 드롭다운을 세운다 — 손으로 적으면 또 갈린다.
 *
 *   npx tsx scripts/unify-ledger-state.mts
 *   npx tsx scripts/unify-ledger-state.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  SETTLEMENT_LEDGER_ID as ID, SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB,
  SETTLEMENT_STATES, SETTLEMENT_CONTRACT_STATE,
} from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;

/** 옛말 → 지금 말. 뜻이 같은 것만 넣는다 — 「계약서 업로드」와 「계약 완료」는 다른 단계다. */
const RENAME: Record<string, string> = { 계약진행중: SETTLEMENT_CONTRACT_STATE, '계약 진행중': SETTLEMENT_CONTRACT_STATE, 진행중: SETTLEMENT_CONTRACT_STATE };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 200)}`);
  }
};

const meta = await api(`${SH}/${ID}?fields=sheets.properties(title,sheetId)`);
const gidOf = (t: string) => (meta.sheets || []).find((s: any) => S(s.properties.title) === t)?.properties?.sheetId;

type Hit = { tab: string; row: number; plate: string; from: string; to: string };
const hits: Hit[] = [];
const seen = new Map<string, number>();
const reqs: Record<string, unknown>[] = [];
const data: { range: string; values: string[][] }[] = [];

for (const tab of [SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB]) {
  const sheetId = gidOf(tab);
  if (sheetId === undefined) continue;
  // ★담긴 값을 읽는다 — 서식된 글자를 읽으면 숫자 칸이 엉킨다(2026-08-25 실측).
  const v = await api(`${SH}/${ID}/values/${encodeURIComponent(`${a1(tab)}!A1:AL3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = ((v?.values || []) as string[][]).map((r) => (r || []).map(S));
  const h = rows[0] || [];
  const iState = h.indexOf('상태');
  const iPlate = h.indexOf('차량번호');
  if (iState < 0) continue;
  rows.slice(1).forEach((r, k) => {
    const cur = S(r[iState]);
    if (!cur) return;
    seen.set(cur, (seen.get(cur) || 0) + 1);
    const to = RENAME[cur];
    if (!to || to === cur) return;
    const row = k + 2;
    hits.push({ tab, row, plate: S(r[iPlate]), from: cur, to });
    data.push({ range: `${a1(tab)}!${colA1(iState)}${row}`, values: [[to]] });
  });
  // 상태 칸 드롭다운 — 손으로 적으면 또 갈린다.
  reqs.push({ setDataValidation: {
    range: { sheetId: Number(sheetId), startRowIndex: 1, endRowIndex: 3000, startColumnIndex: iState, endColumnIndex: iState + 1 },
    rule: { condition: { type: 'ONE_OF_LIST', values: SETTLEMENT_STATES.map((x) => ({ userEnteredValue: x })) }, showCustomUi: true, strict: false },
  } });
}

console.log(`\n■ 정산원장 상태 — ${APPLY ? '반영' : 'dry-run'}\n`);
console.log('  지금 쓰이는 말');
for (const [k, n] of [...seen].sort((a, b) => b[1] - a[1])) {
  const mark = RENAME[k] ? ` → 「${RENAME[k]}」로 바꾼다` : (SETTLEMENT_STATES.includes(k as never) ? '' : '  ⚠ 규격 밖 — 사람이 봐야 한다');
  console.log(`   ${String(n).padStart(4)}  ${k}${mark}`);
}
console.log(`\n  바꿀 줄 ${hits.length} · 상태 드롭다운 세울 탭 ${reqs.length}`);
for (const x of hits.slice(0, 12)) console.log(`   ${x.tab} ${String(x.row).padStart(4)}행  ${x.plate.padEnd(10)} ${x.from} → ${x.to}`);
if (hits.length > 12) console.log(`   … 외 ${hits.length - 12}줄`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/ledger-state-${stamp}.json`;
writeFileSync(backup, JSON.stringify(hits, null, 2));
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 바꿨다. 반영은 --apply · 되돌림 원본 ${backup}\n`); process.exit(0); }

if (data.length) await api(`${SH}/${ID}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
if (reqs.length) await api(`${SH}/${ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = [
  ``,
  `## ${when} · 상태 용어를 공급사 시트에 맞춤 — 「계약진행중」 → 「계약중」`,
  ``,
  `도구 \`scripts/unify-ledger-state.mts --apply\` · 되돌림 원본 \`${backup}\``,
  `바꾼 줄 **${hits.length}**. 공급사 시트·영업자 표·ERP 가 쓰는 말이 「계약중」이다 —`,
  `같은 뜻을 두 말로 쓰면 «계약중 몇 대»를 물을 때 ${hits.length}대가 빠진다.`,
  `상태 칸에 드롭다운(${SETTLEMENT_STATES.join(' / ')})을 세워 다시 갈리지 않게 했다.`,
  ``,
  ...(hits.length ? [`| 탭 | 행 | 차량번호 | 전 | 후 |`, `|---|---|---|---|---|`,
    ...hits.map((x) => `| ${x.tab} | ${x.row} | ${x.plate} | ${x.from} | ${x.to} |`), ``] : []),
].join('\n');
const marker = '> 기계가 정산원장 구조를';
const cut = head.indexOf(marker);
const insertAt = cut >= 0 ? head.indexOf('\n', cut) + 1 : head.length;
writeFileSync(LOG, head.slice(0, insertAt) + body + head.slice(insertAt));

console.log(`\n■ 끝 — ${hits.length}줄을 「${SETTLEMENT_CONTRACT_STATE}」으로 바꿨다. 이력 ${LOG}\n`);
