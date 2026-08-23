/**
 * **공급사 시트에서 「차종마스터」 사본 탭을 지운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21 「공급사시트에 차종마스터 탭을 다 지워줘」.
 *
 * ★지우기 전에 확인한 것(실측 2026-08-21) — 탭을 지우는 일은 되돌리기 어렵다.
 *   ① 20곳에 있고 전부 **IMPORTRANGE 한 줄**이다(값을 담고 있지 않다 — 지워도 잃는 데이터가 없다)
 *   ② **다른 탭이 이 탭을 가리키는 칸 0곳** — 수식·드롭다운 전수 확인. 지워도 #REF! 가 안 난다
 *   ③ 자동 순서(run-daily · hourly-sync · Actions)에 만드는 단계가 **없다** — 되살아나지 않는다
 *   ④ `audit-vehicle-spec` 이 보는 「차종마스터」는 **원천대장** 쪽이다. 공급사 사본이 아니다
 *   되살리려면 `npx tsx scripts/publish-vehicle-master-tab.mts --apply`.
 *
 * ★지우기 전에 **탭 하나하나를 다시 확인한다.** 이름이 같아도 값이 들어 있으면 안 지운다 —
 *   누가 IMPORTRANGE 를 걷어내고 손으로 적어 뒀을 수 있다. 그건 지우면 못 되찾는다.
 *
 *   npx tsx scripts/drop-supplier-master-tab.mts
 *   npx tsx scripts/drop-supplier-master-tab.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 120)}`);
  }
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));

type Target = { label: string; id: string; sheetId: number; title: string; formula: string };
const targets: Target[] = [];
const held: string[] = [];
const refBlocked: string[] = [];

console.log(`■ 공급사 시트 ${books.length}곳 — 「차종마스터」 사본 탭 ${APPLY ? '지움' : '(dry-run)'}\n`);

for (const b of books) {
  const doc = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?includeGridData=true&fields=sheets(properties(sheetId,title),data(rowData(values(userEnteredValue(formulaValue,stringValue),dataValidation(condition(values(userEnteredValue)))))))`);
  const sheets = (doc.sheets || []) as Rec[];
  const master = sheets.find((s) => S(s.properties?.title) === '차종마스터');
  if (!master) continue;

  const rows = (master.data?.[0]?.rowData || []) as Rec[];
  const cells = rows.flatMap((r) => (r.values || []) as Rec[]);
  const formula = S(cells.map((c) => S(c?.userEnteredValue?.formulaValue)).find(Boolean));
  /**
   * ★IMPORTRANGE 가 아니면 **안 지운다.** 누가 연결을 끊고 손으로 적어 뒀다는 뜻이고,
   *   그건 여기서만 사는 값이라 지우면 못 되찾는다. 목록에만 남기고 사람이 본다.
   */
  if (!/IMPORTRANGE/i.test(formula)) {
    const typed = cells.filter((c) => S(c?.userEnteredValue?.stringValue)).length;
    held.push(`${b.label} — IMPORTRANGE 가 아니다(글자 든 칸 ${typed}) · 사람이 확인할 것`);
    continue;
  }
  // ★다른 탭이 가리키면 지우지 않는다 — 지우는 순간 그 칸이 #REF! 가 된다.
  const refs = sheets.filter((s) => S(s.properties?.title) !== '차종마스터')
    .flatMap((s) => ((s.data?.[0]?.rowData || []) as Rec[]).flatMap((r) => ((r?.values || []) as Rec[])))
    .filter((c) => /차종마스터/.test(S(c?.userEnteredValue?.formulaValue))
      || ((c?.dataValidation?.condition?.values || []) as Rec[]).some((v) => /차종마스터/.test(S(v?.userEnteredValue)))).length;
  if (refs) { refBlocked.push(`${b.label} — 다른 탭이 ${refs}칸에서 가리킨다`); continue; }

  targets.push({ label: b.label, id: b.id, sheetId: Number(master.properties?.sheetId), title: S(master.properties?.title), formula });
}

for (const t of targets) console.log(`   ${t.label.slice(0, 14).padEnd(16)} gid=${String(t.sheetId).padEnd(11)} ${t.formula.slice(0, 52)}`);
if (held.length) { console.log(`\n  ⚠ 안 지움 — 값이 들어 있다 ${held.length}`); for (const h of held) console.log(`     ${h}`); }
if (refBlocked.length) { console.log(`\n  ⚠ 안 지움 — 가리키는 칸이 있다 ${refBlocked.length}`); for (const h of refBlocked) console.log(`     ${h}`); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/dropped-master-tab-${stamp}.json`;
writeFileSync(backup, JSON.stringify(targets, null, 2));
console.log(`\n  지울 탭 ${targets.length} · 안 지움 ${held.length + refBlocked.length}`);
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 지웠다. 반영은 --apply · 목록 ${backup}\n`); process.exit(0); }
if (!targets.length) { console.log('\n지울 게 없다.\n'); process.exit(0); }

for (const t of targets) {
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: t.sheetId } }] }),
  });
}

// ── 사람이 읽는 이력
const LOG = 'docs/수정이력-공급사시트.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 공급사 시트\n\n> 기계가 공급사 시트 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = [
  ``,
  `## ${when} · 「차종마스터」 사본 탭 삭제`,
  ``,
  `도구 \`scripts/drop-supplier-master-tab.mts --apply\` · 되살리기 \`scripts/publish-vehicle-master-tab.mts --apply\` · 목록 \`${backup}\``,
  `지운 탭 **${targets.length}** — 전부 IMPORTRANGE 한 줄(담긴 값 없음) · 가리키는 칸 0`,
  `안 지움 ${held.length + refBlocked.length}${held.length || refBlocked.length ? ` — ${[...held, ...refBlocked].join(' / ')}` : ''}`,
  ``,
  `| 공급사 | gid | 무엇이 있었나 |`,
  `|---|---|---|`,
  ...targets.map((t) => `| ${t.label} | ${t.sheetId} | \`${t.formula.slice(0, 70)}\` |`),
  ``,
].join('\n');
const marker = '> 기계가 공급사 시트 구조를';
const cut = head.indexOf(marker);
const insertAt = cut >= 0 ? head.indexOf('\n', cut) + 1 : head.length;
writeFileSync(LOG, head.slice(0, insertAt) + body + head.slice(insertAt));

console.log(`\n■ 끝 — 탭 ${targets.length}개를 지웠다.`);
console.log(`   이력 ${LOG} · 되살리기 publish-vehicle-master-tab.mts --apply\n`);
