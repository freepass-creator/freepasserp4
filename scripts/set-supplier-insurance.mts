/**
 * **공급사 운영정책의 보험 칸을 메모대로 박는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님이 카톡으로 넘겨 준 보험 메모를 그대로 옮기는 도구다. 값은 아래 `MEMO` 에만 적는다 —
 *   손으로 시트를 고치면 다음 정제 때 덮인다(「차명 바꾸는 자리는 AI 정제 사전」과 같은 이유).
 *
 * ★**바꾸는 칸만 건드린다.** 같은 값이면 안 쓴다 — 무엇이 달라졌는지 로그에 남기려는 것이다.
 * ★**정책 줄은 이름으로 찾는다.** 자리로 찾으면 줄이 하나 늘어난 날 엉뚱한 정책을 덮는다.
 * ★표기는 `policy-sheet-layout.ts` 규격을 따른다 — 「1억5천만원」처럼 적고 「1.5억원」은 안 쓴다.
 *
 *   npx tsx scripts/set-supplier-insurance.mts
 *   npx tsx scripts/set-supplier-insurance.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

/**
 * 넣을 값. 공급사 → 정책명 → 칸.
 *
 * ★렌트존 (2026-08-25 카톡) — 「아이언 렌트카와 동일합니다 !
 *   대인- 무한/30 , 대물 1억/50 , 자손 1500만/30 , 자차 50~100」
 *   ⚠ 「아이언과 동일」이라 했지만 아이언 「홈페이지 공개조건」은 **대물면책금이 30만원**이다.
 *     공급사 본인이 적어 준 값(50만원)을 넣는다 — 어느 쪽이 맞는지는 아이언에 확인해야 한다.
 */
const MEMO: { supplier: RegExp; policy: string; cells: Record<string, string>; note: string }[] = [
  {
    supplier: /렌트존/,
    policy: '프리패스 표준',
    note: '렌트존 보험 메모(2026-08-25 카톡) — 아이언과 동일하다고 전달받음',
    cells: {
      대인보상한도: '무한',
      대인면책금: '30만원',
      대물보상한도: '1억원',
      대물면책금: '50만원',
      자손보상: '1천5백만원',
      자손면책금: '30만원',
      자차최소면책금: '50만원',
      자차최대면책금: '100만원',
    },
  },
];

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<any> => {
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
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as any[])
  .map((f) => ({ id: S(f.id), name: S(f.name), label: supplierSheetLabel(S(f.name)) }));

type Change = { label: string; id: string; tab: string; row: number; col: number; name: string; from: string; to: string };
const changes: Change[] = [];
const same: string[] = [];

console.log(`\n■ 공급사 보험 칸 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
for (const m of MEMO) {
  const hits = books.filter((b) => m.supplier.test(b.name));
  if (!hits.length) { console.log(`   ⛔ ${m.supplier} 에 맞는 공급사 시트가 없다`); continue; }
  for (const b of hits) {
    const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(title)`);
    const tab = ((meta.sheets || []) as any[]).map((s) => S(s.properties.title)).find((t) => /정책/.test(t));
    if (!tab) { console.log(`   ⛔ ${b.label} — 정책 탭이 없다`); continue; }
    const got = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${a1(tab)}!A1:CZ60`)}?valueRenderOption=FORMATTED_VALUE`);
    const rows = ((got.values || []) as any[][]).map((r) => (r || []).map(S));
    const head = rows[0] || [];
    // ★정책 줄은 이름으로 찾는다.
    const iName = head.indexOf('정책명');
    const at = rows.findIndex((r, i) => i > 0 && S(r[iName]) === m.policy);
    if (iName < 0 || at < 0) { console.log(`   ⛔ ${b.label} — 「${m.policy}」 줄을 못 찾았다`); continue; }
    console.log(`   ${b.label} · 「${tab}」 ${at + 1}행 「${m.policy}」`);
    for (const [name, to] of Object.entries(m.cells)) {
      const col = head.indexOf(name);
      if (col < 0) { console.log(`      ⛔ 「${name}」 열이 없다`); continue; }
      const from = S(rows[at][col]);
      if (from === to) { same.push(`${b.label} ${name}`); continue; }
      changes.push({ label: b.label, id: b.id, tab, row: at, col, name, from, to });
      console.log(`      ${name.padEnd(8)} ${(from || '(빈칸)').padEnd(14)} → ${to}`);
    }
  }
}
console.log(`\n   바꿀 칸 ${changes.length} · 이미 같은 칸 ${same.length}`);
if (!changes.length) { console.log('\n※ 바꿀 것이 없다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }

for (const c of changes) {
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${c.id}/values/${encodeURIComponent(`${a1(c.tab)}!${colA1(c.col)}${c.row + 1}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: [[c.to]] }),
  });
}
console.log(`   ✓ ${changes.length}칸 썼다`);

const LOG = 'docs/수정이력-공급사시트.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const h0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '# 수정이력 — 공급사 시트\n\n> 기계가 공급사 시트를 고칠 때마다 여기에 쌓는다. 새 것이 위.\n';
const lines = changes.map((c) => `- ${c.label} 「${c.tab}」 ${c.name} — ${c.from || '(빈칸)'} → **${c.to}**`).join('\n');
const entry = `\n## ${when} · 보험 칸 ${changes.length}칸\n\n도구 \`scripts/set-supplier-insurance.mts --apply\`\n${MEMO.map((m) => `근거 — ${m.note}`).join('\n')}\n\n${lines}\n`;
const marker = '> 기계가 공급사 시트를';
const cut = h0.indexOf(marker);
const insertAt = cut >= 0 ? h0.indexOf('\n', cut) + 1 : h0.length;
writeFileSync(LOG, h0.slice(0, insertAt) + entry + h0.slice(insertAt));
console.log(`   ✓ ${LOG} 에 남겼다\n`);
