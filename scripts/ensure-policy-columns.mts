/**
 * **정책 탭에 규격 열이 빠졌으면 끼운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21 「대여료카드 보증금카드결제 이거 소화되게끔 해주면됨」.
 *   코드에만 만들어 두면 공급사가 적을 자리가 없다. 시트에 칸이 있어야 값이 들어온다.
 *
 * ★정책 탭은 **가로가 항목**이다(재고 탭과 반대). 그래서 «열»을 끼운다 —
 *   `add-policy-rows`(세로 가정)를 쓰면 항목 전체를 통째로 끼우려 든다. 쓰지 마라.
 * ★넣을 자리는 **짝이 되는 열 옆**이다. 「대여료카드결제」는 「보증금카드결제」 앞에 둔다 —
 *   둘이 붙어 있어야 공급사가 «대여료는 되고 보증금은 안 된다»를 한눈에 적는다.
 *   짝을 못 찾으면 맨 뒤에 붙인다(짐작해서 가운데 끼우지 않는다).
 * ★값은 **안 건드린다.** 빈 열만 만든다 — 조건은 공급사가 적는 것이고,
 *   우리가 기본값을 밀어 넣으면 계약서에 «협의한 적 없는 조건»이 찍힌다.
 *
 * ⚠ **열을 하나라도 끼우면 그 탭 읽는 곳을 전부 훑는다.** 실측 2026-08-21 —
 *   「정책UID」를 맨 앞에 넣었더니 자리로 읽던 `sync-mirror-policies` 가 30분마다 죽었다.
 *   `grep -rn "hdr\[0\]" scripts/ lib/`
 *
 *   npx tsx scripts/ensure-policy-columns.mts
 *   npx tsx scripts/ensure-policy-columns.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel, POLICY_TAB_ALIASES } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** 만들 열 — 이름과, 그 옆에 붙일 짝. */
const WANT: { name: string; after?: string; before?: string; note: string }[] = [
  { name: '대여료카드결제', before: '보증금카드결제', note: '불가 / 무료 / 1.5% / 협의 — 대여료를 카드로 낼 수 있나, 수수료는 몇 %' },
];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 140)}`);
  }
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));

const isPolicyTab = (t: string) => POLICY_TAB_ALIASES.some((a) => norm(t).includes(norm(a))) || /정책/.test(t);

type Plan = { label: string; id: string; tab: string; sheetId: number; col: number; name: string; note: string };
const plans: Plan[] = [];
const already: string[] = [];
const noTab: string[] = [];
const retired: string[] = [];

for (const b of books) {
  // ★폐기 시트는 건너뛴다 — 아무도 안 읽는 시트에 칸을 만들면 «어디에 적어야 하나»만 헷갈린다.
  if (/구버전|폐기/.test(b.label)) { retired.push(b.label); continue; }
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec).filter((p) => isPolicyTab(S(p.title)));
  if (!tabs.length) { noTab.push(b.label); continue; }
  for (const p of tabs) {
    const tab = S(p.title);
    let head: string[];
    try { head = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!1:1`)}`)).values || [[]]) as string[][])[0].map(S); } catch { continue; }
    for (const w of WANT) {
      if (head.some((h) => norm(h) === norm(w.name))) { already.push(`${b.label} 「${tab}」`); continue; }
      const pairAt = w.before ? head.findIndex((h) => norm(h) === norm(w.before!)) : (w.after ? head.findIndex((h) => norm(h) === norm(w.after!)) + 1 : -1);
      // ★짝을 못 찾으면 맨 뒤. 짐작해서 가운데 끼우면 사람이 못 찾는다.
      const col = pairAt >= 0 ? pairAt : head.length;
      plans.push({ label: b.label, id: b.id, tab, sheetId: Number(p.sheetId), col, name: w.name, note: w.note });
    }
  }
}

const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
console.log(`\n■ 정책 탭 규격 열 채우기 — ${APPLY ? '반영' : 'dry-run'}`);
console.log(`  만들 열 ${plans.length} · 이미 있음 ${already.length} · 폐기 건너뜀 ${retired.length} · 정책 탭 없음 ${noTab.length}${noTab.length ? ` (${noTab.join(' · ')})` : ''}\n`);
for (const p of plans) console.log(`   ${p.label.slice(0, 12).padEnd(14)} 「${p.tab.slice(0, 12)}」 ${colA1(p.col)}열에 「${p.name}」`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/policy-columns-${stamp}.json`;
writeFileSync(backup, JSON.stringify(plans, null, 2));
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 썼다. 반영은 --apply · 목록 ${backup}\n`); process.exit(0); }
if (!plans.length) { console.log('\n만들 게 없다.\n'); process.exit(0); }

for (const p of plans) {
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${p.id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { insertDimension: { range: { sheetId: p.sheetId, dimension: 'COLUMNS', startIndex: p.col, endIndex: p.col + 1 }, inheritFromBefore: true } },
        // 머리글과 설명 메모. 값 칸은 비워 둔다 — 조건은 공급사가 적는다.
        {
          updateCells: {
            rows: [{ values: [{ userEnteredValue: { stringValue: p.name }, note: p.note }] }],
            fields: 'userEnteredValue,note',
            start: { sheetId: p.sheetId, rowIndex: 0, columnIndex: p.col },
          },
        },
      ],
    }),
  });
}

const LOG = 'docs/수정이력-공급사시트.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 공급사 시트\n\n> 기계가 공급사 시트 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = [
  ``,
  `## ${when} · 정책 탭에 「${WANT.map((w) => w.name).join('」·「')}」 열 신설`,
  ``,
  `도구 \`scripts/ensure-policy-columns.mts --apply\` · 목록 \`${backup}\``,
  `만든 열 **${plans.length}** — 「보증금카드결제」 바로 앞. 값은 비워 뒀다(조건은 공급사가 적는다).`,
  `한 칸에 「불가」 아니면 수수료율(「1.5%」)을 적는다 — 수수료 칸을 따로 두지 않는다.`,
  ``,
  `| 공급사 | 탭 | 자리 |`,
  `|---|---|---|`,
  ...plans.map((p) => `| ${p.label} | ${p.tab} | ${colA1(p.col)}열 |`),
  ``,
].join('\n');
const marker = '> 기계가 공급사 시트 구조를';
const cut = head.indexOf(marker);
const insertAt = cut >= 0 ? head.indexOf('\n', cut) + 1 : head.length;
writeFileSync(LOG, head.slice(0, insertAt) + body + head.slice(insertAt));

console.log(`\n■ 끝 — 열 ${plans.length}개를 만들었다. 이력 ${LOG}`);
console.log(`   ⚠ 열이 하나 늘었다. 정책 탭을 자리로 읽는 곳이 없는지 확인해라: grep -rn "hdr\\[0\\]" scripts/ lib/\n`);
