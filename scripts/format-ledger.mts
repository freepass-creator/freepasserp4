/**
 * **정산원장 열 서식 — 날짜는 날짜로, 돈은 돈으로, 율은 %로.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「날짜 형식 금액형식 이런거 다 확인하고」.
 *
 * ★실측 2026-08-25 어긋난 자리
 *   · 접수일·인도일 — 서식이 없어 **46171·46189** 로 보인다(구글시트는 날짜를 수로 담는다)
 *   · 공급사수수료율·에이전시수수료율 — 서식이 없어 **0.0325 · 0.025** 로 보인다. 3.25%·2.5% 다
 *   · 계약기간 48 — 「개월」이 없어 금액과 헷갈린다
 *   · 금액 열은 대부분 `#,##0` 이 이미 걸려 있다
 *
 * ★값을 안 바꾼다. **보이는 방식만** 바꾼다 — 서식은 셀 값과 별개다.
 *   그래서 되돌리기도 서식만 되돌리면 된다.
 * ★차량번호·고객연락처는 **글자**로 못 박는다. 수로 두면 앞의 0 이 날아간다(010… → 10…).
 *
 *   npx tsx scripts/format-ledger.mts
 *   npx tsx scripts/format-ledger.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as ID, SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB } from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

type Fmt = { type: string; pattern?: string };
const 돈: Fmt = { type: 'NUMBER', pattern: '#,##0' };
const 날짜: Fmt = { type: 'DATE', pattern: 'yyyy-mm-dd' };
const 달: Fmt = { type: 'DATE', pattern: 'yyyy-mm' };
const 율: Fmt = { type: 'PERCENT', pattern: '0.00%' };
const 글자: Fmt = { type: 'TEXT' };

/** 열 이름 → 서식. 여기 없는 열은 **안 건드린다**(사람이 일부러 준 서식을 지우지 않는다). */
const SPEC: Record<string, { fmt: Fmt; align?: string }> = {
  차량번호: { fmt: 글자, align: 'CENTER' },
  고객연락처: { fmt: 글자 },
  정산월: { fmt: 달, align: 'CENTER' },
  접수일: { fmt: 날짜, align: 'CENTER' },
  인도일: { fmt: 날짜, align: 'CENTER' },
  계약기간: { fmt: { type: 'NUMBER', pattern: '0"개월"' }, align: 'CENTER' },
  연령: { fmt: { type: 'NUMBER', pattern: '0"세"' }, align: 'CENTER' },
  공급사수수료율: { fmt: 율, align: 'CENTER' },
  에이전시수수료율: { fmt: 율, align: 'CENTER' },
  차량가액: { fmt: 돈 }, 보증금: { fmt: 돈 }, 렌탈료: { fmt: 돈 }, 계약대여료: { fmt: 돈 },
  업셀링금액: { fmt: 돈 }, 판매수수료: { fmt: 돈 }, 공급사인센티브: { fmt: 돈 }, 공급사부가세: { fmt: 돈 },
  청구금액: { fmt: 돈 }, 출고수수료: { fmt: 돈 }, 에이전시인센티브: { fmt: 돈 }, 계약서대행료: { fmt: 돈 },
  에이전시부가세: { fmt: 돈 }, 지급액: { fmt: 돈 }, 수익: { fmt: 돈 },
};

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

type Change = { tab: string; col: number; name: string; from: string; to: string };
const changes: Change[] = [];
const reqs: Record<string, unknown>[] = [];

for (const tab of [SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB]) {
  const sheetId = gidOf(tab);
  if (sheetId === undefined) continue;
  // 머리글 + 2행의 지금 서식을 같이 받는다 — 뭘 바꾸는지 보여 주려면 «전»이 있어야 한다.
  const doc = await api(`${SH}/${ID}?includeGridData=true&ranges=${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:BZ2`)}&fields=sheets(data(rowData(values(formattedValue,effectiveFormat(numberFormat)))))`);
  const rows = doc.sheets[0].data[0].rowData || [];
  const head = (rows[0]?.values || []).map((c: any) => S(c.formattedValue));
  head.forEach((name: string, i: number) => {
    const spec = SPEC[name];
    if (!spec) return;
    const cur = (rows[1]?.values || [])[i]?.effectiveFormat?.numberFormat;
    const from = cur ? `${cur.type}${cur.pattern ? ' ' + cur.pattern : ''}` : '서식없음';
    const to = `${spec.fmt.type}${spec.fmt.pattern ? ' ' + spec.fmt.pattern : ''}`;
    if (from === to) return;
    changes.push({ tab, col: i, name, from, to });
    const f: Record<string, unknown> = { numberFormat: spec.fmt };
    const fields = ['numberFormat'];
    if (spec.align) { f.horizontalAlignment = spec.align; fields.push('horizontalAlignment'); }
    reqs.push({ repeatCell: {
      range: { sheetId: Number(sheetId), startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { userEnteredFormat: f },
      fields: fields.map((x) => `userEnteredFormat.${x}`).join(','),
    } });
  });
}

console.log(`\n■ 정산원장 열 서식 — ${APPLY ? '반영' : 'dry-run'} · 고칠 열 ${changes.length}\n`);
for (const c of changes) console.log(`   ${c.tab.padEnd(8)} ${c.name.padEnd(12)} ${c.from.padEnd(22)} → ${c.to}`);
if (!changes.length) { console.log('   서식이 다 맞다.\n'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/ledger-format-${stamp}.json`;
writeFileSync(backup, JSON.stringify(changes, null, 2));
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 바꿨다. 반영은 --apply · 되돌림 원본 ${backup}\n`); process.exit(0); }

await api(`${SH}/${ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = [
  ``,
  `## ${when} · 열 서식 — 날짜는 날짜로, 돈은 돈으로, 율은 %로`,
  ``,
  `도구 \`scripts/format-ledger.mts --apply\` · 되돌림 원본 \`${backup}\``,
  `**값은 안 바꿨다. 보이는 방식만 바꿨다.**`,
  ``,
  `| 탭 | 열 | 전 | 후 |`,
  `|---|---|---|---|`,
  ...changes.map((c) => `| ${c.tab} | ${c.name} | ${c.from} | ${c.to} |`),
  ``,
].join('\n');
const marker = '> 기계가 정산원장 구조를';
const cut = head0.indexOf(marker);
const insertAt = cut >= 0 ? head0.indexOf('\n', cut) + 1 : head0.length;
writeFileSync(LOG, head0.slice(0, insertAt) + body + head0.slice(insertAt));

console.log(`\n■ 끝 — 열 ${changes.length}개 서식을 세웠다. 이력 ${LOG}\n`);
