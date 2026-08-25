/**
 * **정산원장 열 차례 — 사람이 넣는 칸을 맨 앞으로.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「강팀장이 입력해야할 항목을 앞으로 빼고」.
 *   지금은 팀장이 넣을 칸이 1·3·8·28·29열에 흩어져 있다 — 한 줄 넣으려고 38열을 가로지른다.
 *
 * ★**값을 다시 쓰지 않는다.** `moveDimension` 으로 열을 통째로 민다 —
 *   서식·메모·데이터가 열에 붙어 그대로 따라간다. 값을 읽어 다시 쓰면 1,664줄에서
 *   한 칸만 어긋나도 돈이 어긋나고, 어디서 어긋났는지 못 찾는다.
 *
 * ★코드는 열을 **이름으로** 찾는다(`head.indexOf('차량번호')`) — 차례를 바꿔도 안 깨진다.
 *   실측 2026-08-25: 이 문서에 수식·이름있는범위·조건부서식·보호범위가 **전부 0**이다.
 *   그래서 열을 옮겨도 참조가 깨질 자리가 없다. (하나라도 있으면 이 도구를 쓰지 마라.)
 *
 * ★맨 앞으로 오는 것 — 사람이 손으로 넣는 칸.
 *   차량번호·상태·영업채널·영업담당자·고객명. 나머지는 지금 차례 그대로 뒤에 붙는다.
 *
 *   npx tsx scripts/reorder-ledger-columns.mts
 *   npx tsx scripts/reorder-ledger-columns.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as ID, SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB } from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** 맨 앞으로 — 사람이 넣는 칸. 고객명은 계약서 링크를 거는 자리라 같이 앞에 둔다. */
const FRONT = ['차량번호', '상태', '영업채널', '영업담당자', '고객명'] as const;
const TABS = [SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
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

// ── 안전 확인 — 참조가 하나라도 있으면 멈춘다
const guard = await api(`${SH}/${ID}?fields=namedRanges,sheets(properties(title,sheetId),conditionalFormats,protectedRanges)`);
const named = (guard.namedRanges || []).length;
const risky = (guard.sheets || []).filter((s: any) => (s.conditionalFormats || []).length || (s.protectedRanges || []).length)
  .map((s: any) => S(s.properties.title));
if (named || risky.length) {
  console.log(`⛔ 멈춘다 — 이름있는범위 ${named} · 조건부서식/보호범위 있는 탭 ${risky.join(' · ')}`);
  console.log('   열을 옮기면 그 참조가 어디를 가리키는지 알 수 없어진다. 사람이 먼저 확인해라.');
  process.exit(1);
}
const gidOf = (t: string) => (guard.sheets || []).find((s: any) => S(s.properties.title) === t)?.properties?.sheetId;

type Plan = { tab: string; sheetId: number; before: string[]; after: string[]; moves: { name: string; from: number; to: number }[] };
const plans: Plan[] = [];

for (const tab of TABS) {
  const sheetId = gidOf(tab);
  if (sheetId === undefined) { console.log(`  · 「${tab}」 탭이 없다 — 건너뜀`); continue; }
  const hv = await api(`${SH}/${ID}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:BZ1`)}`);
  const head = ((hv?.values || [[]])[0] || []).map(S);
  if (!head.length) { console.log(`  · 「${tab}」 머리행이 비었다 — 건너뜀`); continue; }

  /**
   * ★차례를 «지금 순서 배열»에서 시뮬레이션한 뒤, 그 결과를 moveDimension 으로 낸다.
   *   한 번 옮길 때마다 뒤 index 가 밀리므로 실제 시트를 다시 읽지 않고 배열로 따라간다.
   */
  const order = [...head];
  const moves: { name: string; from: number; to: number }[] = [];
  FRONT.forEach((name, want) => {
    const from = order.indexOf(name);
    if (from < 0) return;                 // 없는 칸은 건너뛴다(지어내지 않는다)
    if (from === want) return;
    order.splice(want, 0, order.splice(from, 1)[0]);
    moves.push({ name, from, to: want });
  });
  plans.push({ tab, sheetId: Number(sheetId), before: head, after: order, moves });
}

console.log(`\n■ 정산원장 열 차례 — ${APPLY ? '반영' : 'dry-run'}\n`);
for (const p of plans) {
  console.log(`   「${p.tab}」 ${p.before.length}열 · 옮길 열 ${p.moves.length}`);
  for (const m of p.moves) console.log(`      ${m.name} : ${m.from + 1}번째 → ${m.to + 1}번째`);
  console.log(`      뒤 ▸ ${p.after.slice(0, 10).join(' · ')} …`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/ledger-order-${stamp}.json`;
writeFileSync(backup, JSON.stringify(plans, null, 2));
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 옮겼다. 반영은 --apply · 되돌림 원본 ${backup}\n`); process.exit(0); }
if (!plans.some((p) => p.moves.length)) { console.log('\n옮길 게 없다.\n'); process.exit(0); }

for (const p of plans) {
  for (const m of p.moves) {
    await api(`${SH}/${ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{
      moveDimension: {
        source: { sheetId: p.sheetId, dimension: 'COLUMNS', startIndex: m.from, endIndex: m.from + 1 },
        // ⚠ 뒤로 옮길 때와 앞으로 옮길 때 destinationIndex 뜻이 다르다. 여기는 늘 앞으로(to < from)라 그대로 쓴다.
        destinationIndex: m.to,
      },
    }] }) });
  }
}

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = [
  ``,
  `## ${when} · 사람이 넣는 칸을 맨 앞으로`,
  ``,
  `도구 \`scripts/reorder-ledger-columns.mts --apply\` · 되돌림 원본 \`${backup}\``,
  `\`moveDimension\` 으로 열을 통째로 밀었다 — 값·서식·메모가 열에 붙어 따라간다(값을 다시 쓰지 않았다).`,
  `옮기기 전 확인: 수식·이름있는범위·조건부서식·보호범위 **전부 0** — 깨질 참조가 없다.`,
  ``,
  ...plans.flatMap((p) => [
    `**${p.tab}** — 옮긴 열 ${p.moves.length}`,
    ``,
    '```',
    `전 ▸ ${p.before.slice(0, 12).join(' · ')} …`,
    `후 ▸ ${p.after.slice(0, 12).join(' · ')} …`,
    '```',
    ``,
  ]),
].join('\n');
const marker = '> 기계가 정산원장 구조를';
const cut = head0.indexOf(marker);
const insertAt = cut >= 0 ? head0.indexOf('\n', cut) + 1 : head0.length;
writeFileSync(LOG, head0.slice(0, insertAt) + body + head0.slice(insertAt));

console.log(`\n■ 끝 — ${plans.reduce((n, p) => n + p.moves.length, 0)}개 열을 앞으로 옮겼다. 이력 ${LOG}\n`);
