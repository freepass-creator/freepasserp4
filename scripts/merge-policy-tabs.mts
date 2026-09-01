/**
 * **관계사 시트의 정책 탭 두 벌을 「운영정책」 한 장으로 합친다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21 「정책은 한탭만 있으면 되지 · 견진카정책 이렇게 나누라고 하면 되니까 정책탭은 하나만 두자」
 *   「정책명으로 구분하면 되고 어차피 코드가 들어가니까」.
 *
 * ★왜 안전한가 — 합치기 전에 잰 것(2026-08-21 실측)
 *   ① 여섯 탭이 **전부 같은 71열**이다(열 차이 0). 줄만 이어 붙이면 된다.
 *   ② 세 시트의 팔 수 있는 차가 **정책코드를 하나도 안 비웠다**(빈 차 0).
 *      그래서 «코드가 비어 어느 정책인지 못 정하는» 차가 새로 생기지 않는다.
 *   ③ 조인은 **정책코드**로 한다. 한 탭에 두 회사 줄이 섞여도 차는 제 코드를 찾아간다.
 *
 * ★그래도 이름으로 읽는다 — 열은 **이름으로** 맞춰 옮긴다. 두 탭의 열 차례가 같아 보여도
 *   자리로 옮기면 언젠가 한 칸 밀린 값이 계약서에 찍힌다.
 * ★같은 정책코드는 **한 번만** 싣는다 — 두 탭 다 「(프리패스 기본)」 줄을 갖고 있다.
 * ★빈 줄은 안 옮긴다.
 * ★읽는 쪽은 안 고쳐도 된다 — `readPolicyValues` 가 회사 이름 탭을 못 찾으면
 *   별칭 「운영정책」으로 떨어진다(POLICY_TAB_ALIASES).
 *
 *   npx tsx scripts/merge-policy-tabs.mts
 *   npx tsx scripts/merge-policy-tabs.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel, POLICY_TAB_ALIASES } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const KEEP = POLICY_TAB_ALIASES[0];              // 「운영정책」
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 140)}`);
  }
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) }))
  .filter((b) => !/구버전|폐기/.test(b.label)).sort((a, b) => a.label.localeCompare(b.label));

type Job = {
  label: string; id: string;
  keep: { title: string; sheetId: number; header: string[]; rows: string[][] };
  drop: { title: string; sheetId: number; header: string[]; rows: string[][] }[];
  moved: string[][]; movedCodes: string[]; skipped: string[]; unnamed: string[];
};
const jobs: Job[] = [];

for (const b of books) {
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const pol = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec)
    .filter((p) => !p.hidden && /정책/.test(S(p.title)));
  if (pol.length < 2) continue;                  // 한 장뿐이면 할 일이 없다

  const read = async (title: string) => {
    const rows = ((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:CZ500`)}`)).values || []) as string[][];
    return { header: (rows[0] || []).map(S), rows: rows.slice(1).map((r) => r.map(S)) };
  };

  /**
   * ★남길 탭 — **그 시트의 대표 회사** 것. 시트 이름(라벨)이 든 탭을 고른다.
   *   못 고르면 첫 번째. 어느 쪽을 남기든 줄은 다 옮기므로 값은 안 잃는다.
   */
  const keepProp = pol.find((p) => norm(S(p.title)).includes(norm(b.label))) || pol[0];
  const keepRead = await read(S(keepProp.title));
  const keep = { title: S(keepProp.title), sheetId: Number(keepProp.sheetId), ...keepRead };

  const codeAt = (h: string[]) => h.findIndex((x) => norm(x) === '정책코드');
  const nameAt = (h: string[]) => h.findIndex((x) => norm(x) === '정책명');
  const have = new Set(keep.rows.map((r) => norm(r[codeAt(keep.header)])).filter(Boolean));

  const drop: Job['drop'] = [];
  const moved: string[][] = [];
  const movedCodes: string[] = [];
  const skipped: string[] = [];
  const unnamed: string[] = [];

  for (const p of pol) {
    if (Number(p.sheetId) === keep.sheetId) continue;
    const title = S(p.title);
    const d = await read(title);
    drop.push({ title, sheetId: Number(p.sheetId), ...d });
    const dc = codeAt(d.header), dn = nameAt(d.header);
    for (const r of d.rows) {
      if (!r.some((c) => S(c))) continue;                       // 빈 줄은 안 옮긴다
      const code = S(r[dc]);
      if (!code) { skipped.push(`${title} — 정책코드 없는 줄`); continue; }
      if (have.has(norm(code))) { skipped.push(`${title} 「${code}」 — 이미 있다`); continue; }
      have.add(norm(code));
      // ★열은 **이름으로** 맞춰 옮긴다. 자리로 옮기면 한 칸 밀린 값이 계약서에 찍힌다.
      moved.push(keep.header.map((h) => {
        const i = d.header.findIndex((x) => norm(x) === norm(h));
        return i >= 0 ? S(r[i]) : '';
      }));
      movedCodes.push(code);
      const nm = S(r[dn]);
      // 정책명에 회사가 안 적혀 있으면 사람이 고쳐야 한다 — 우리가 지어내지 않는다.
      if (nm && !/[가-힣A-Za-z]/.test(nm.replace(/[\s\d]/g, '').slice(0, 1)) === false && !norm(nm).includes(norm(title).replace('운영정책', ''))) {
        unnamed.push(`${code} 「${nm}」`);
      }
    }
  }
  if (!drop.length) continue;
  jobs.push({ label: b.label, id: b.id, keep, drop, moved, movedCodes, skipped, unnamed });
}

console.log(`\n■ 관계사 정책 탭 합치기 — ${APPLY ? '반영' : 'dry-run'} · 대상 ${jobs.length}곳\n`);
for (const j of jobs) {
  console.log(`   ${j.label}`);
  console.log(`      남길 탭 「${j.keep.title}」 ${j.keep.rows.filter((r) => r.some(S)).length}줄 → 「${KEEP}」로 이름 바꿈`);
  for (const d of j.drop) console.log(`      지울 탭 「${d.title}」 ${d.rows.filter((r) => r.some(S)).length}줄`);
  console.log(`      옮길 줄 ${j.moved.length}${j.movedCodes.length ? ` (${j.movedCodes.join(' · ')})` : ''}`);
  if (j.skipped.length) console.log(`      안 옮김 ${j.skipped.length}: ${j.skipped.join(' / ')}`);
  if (j.unnamed.length) console.log(`      ▲ 정책명에 회사가 안 적혀 있다: ${j.unnamed.join(' / ')}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/policy-merge-${stamp}.json`;
writeFileSync(backup, JSON.stringify(jobs, null, 2));
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 했다. 반영은 --apply · 되돌림 원본 ${backup}\n`); process.exit(0); }
if (!jobs.length) { console.log('\n합칠 게 없다.\n'); process.exit(0); }

for (const j of jobs) {
  const firstEmpty = j.keep.rows.findIndex((r) => !r.some((c) => S(c)));
  const at = (firstEmpty >= 0 ? firstEmpty : j.keep.rows.length) + 2;   // 머리행 + 1-based
  const requests: Rec[] = [];
  if (j.moved.length) {
    requests.push({
      updateCells: {
        rows: j.moved.map((r) => ({ values: r.map((v) => ({ userEnteredValue: { stringValue: v } })) })),
        fields: 'userEnteredValue',
        start: { sheetId: j.keep.sheetId, rowIndex: at - 1, columnIndex: 0 },
      },
    });
  }
  if (j.keep.title !== KEEP) requests.push({ updateSheetProperties: { properties: { sheetId: j.keep.sheetId, title: KEEP }, fields: 'title' } });
  for (const d of j.drop) requests.push({ deleteSheet: { sheetId: d.sheetId } });
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${j.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
}

const LOG = 'docs/수정이력-공급사시트.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 공급사 시트\n\n> 기계가 공급사 시트 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = [
  ``,
  `## ${when} · 관계사 정책 탭을 「${KEEP}」 한 장으로`,
  ``,
  `도구 \`scripts/merge-policy-tabs.mts --apply\` · 되돌림 원본 \`${backup}\``,
  `한 문서에 법인이 둘이어도 **정책 탭은 하나**다. 회사는 정책코드·정책명으로 가른다.`,
  `합치기 전 실측 — 여섯 탭 **열 차이 0**(같은 71열) · 팔 수 있는 차의 **정책코드 빈 칸 0**.`,
  `열은 이름으로 맞춰 옮겼고, 같은 정책코드는 한 번만 실었다(두 탭 다 「(프리패스 기본)」을 갖고 있었다).`,
  ``,
  `| 공급사 | 남긴 탭 | 지운 탭 | 옮긴 줄 |`,
  `|---|---|---|---|`,
  ...jobs.map((j) => `| ${j.label} | ${j.keep.title} → ${KEEP} | ${j.drop.map((d) => d.title).join(' · ')} | ${j.moved.length}${j.movedCodes.length ? ` (${j.movedCodes.join(' · ')})` : ''} |`),
  ``,
].join('\n');
const marker = '> 기계가 공급사 시트 구조를';
const cut = head.indexOf(marker);
const insertAt = cut >= 0 ? head.indexOf('\n', cut) + 1 : head.length;
writeFileSync(LOG, head.slice(0, insertAt) + body + head.slice(insertAt));

console.log(`\n■ 끝 — ${jobs.length}곳의 정책 탭을 「${KEEP}」 한 장으로 합쳤다. 이력 ${LOG}\n`);
