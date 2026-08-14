/**
 * **옛 공급사 시트에 있던 「전용계좌」·「비고」를 정책 탭으로 옮겨 담는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-14)
 *   문패를 우리 제공시트로 넘기자 판매시트에서 **전용계좌 71대·비고 70대가 사라졌다.**
 *   옛 공급사 시트에는 재고탭 «열»로 있었는데 우리 제공시트는 그 열을 안 받기 때문이다
 *   (「비고」는 일부러 안 받는다 — 공급사 시트는 제조사스펙과 대여조건만 받는다).
 *   값 자체는 살아 있어야 한다. 영업자가 «어느 계좌로 받는지»를 모르면 계약을 못 넣는다.
 *
 * ★**정책마다 하나인 값이다.** 실측하니 열다섯 곳 중 열넷이 계좌가 한 종이었다.
 *   빌린카만 셋인데 그건 그 집 정책이 여럿이기 때문이다.
 * ⚠ **한 종일 때만 옮긴다.** 여러 종인 곳은 «어느 계좌가 어느 정책인지»를 우리가 모른다.
 *   짐작해서 붙이면 **영업자가 엉뚱한 계좌로 입금을 안내한다** — 돈이 잘못 가는 사고다.
 *   그런 곳은 목록으로 남겨 사람이 정한다.
 * ⚠ 이미 값이 있는 칸은 안 덮는다.
 *
 *   npx tsx scripts/prefill-policy-account.mts
 *   npx tsx scripts/prefill-policy-account.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SRC = arg('src', 'tmp/old-account-note.json');
const DOC_NAME = arg('name', '프리패스 재고');
/** 판매시트 열 이름 → 정책 탭 항목 이름. `supplier-policy-read.POLICY_DIRECT` 와 같아야 한다. */
const FIELD: Record<string, string> = { 전용계좌: '전용계좌', 비고: '특이사항' };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;

const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n)));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/** 옛 값 — `공급사 → {전용계좌|비고: [{값, 대수}]}`. 판매시트 옛 발행분에서 뽑아 둔 것이다. */
const old = JSON.parse(readFileSync(SRC, 'utf8')) as Record<string, Record<string, { 값: string; 대수: number }[]>>;

/** 우리 제공시트 — 이름으로 찾는다. 다른 도구와 같은 방식이다. */
const ours = new Map<string, string>();
{
  const q = `name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) {
    const nm = S(f.name).replace(DOC_NAME, '').trim();
    for (const k of supplierNameKeys(nm)) if (!ours.has(k)) ours.set(k, S(f.id));
  }
}

console.log(`\n■ 옛 전용계좌·비고를 정책 탭으로 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
/** 값이 여러 종이라 사람이 정해야 하는 곳 — 짐작해 붙이면 돈이 잘못 간다. */
const ambiguous: string[] = [];
const noSheet: string[] = [];
let wrote = 0;

for (const who of Object.keys(old).sort()) {
  let id = '';
  for (const k of supplierNameKeys(who)) { const hit = ours.get(k); if (hit) { id = hit; break; } }
  if (!id) { noSheet.push(who); continue; }
  let v: Rec;
  try { v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent("'정책'")}`); }
  catch { noSheet.push(`${who} — 정책 탭을 못 읽었다`); continue; }
  const rows = ((v.values || []) as string[][]);
  if (rows.length < 2) { noSheet.push(`${who} — 정책 줄이 없다`); continue; }
  const hdr = (rows[0] || []).map(S);

  const updates: { range: string; values: string[][] }[] = [];
  const said: string[] = [];
  for (const [salesCol, field] of Object.entries(FIELD)) {
    const list = (old[who] || {})[salesCol] || [];
    if (!list.length) continue;
    /**
     * ⚠ **여러 종이면 손대지 않는다.** 어느 값이 어느 정책인지는 그 집만 안다.
     *   빌린카는 계좌가 셋인데 정책도 여럿이라 짝을 우리가 못 짓는다.
     */
    if (list.length > 1) {
      ambiguous.push(`${who} ${salesCol} ${list.length}종 — ${list.map((x) => `「${x.값.slice(0, 28)}」${x.대수}대`).join(' · ')}`);
      continue;
    }
    const ci = hdr.indexOf(field);
    if (ci < 0) { said.push(`${field} 칸 없음`); continue; }
    const val = S(list[0].값);
    if (!val) continue;
    let n = 0;
    for (let r = 1; r < rows.length; r++) {
      if (!(rows[r] || []).some((c) => S(c))) continue;          // 빈 줄
      if (S((rows[r] || [])[ci])) continue;                      // ⚠ 있는 값은 안 덮는다
      updates.push({ range: `'정책'!${colA1(ci)}${r + 1}`, values: [[val]] });
      n++;
    }
    if (n) said.push(`${field} ${n}줄`);
  }

  if (!updates.length) { if (said.length) console.log(`  ${pad(who, 12)}${said.join(' · ')}`); continue; }
  console.log(`  ${pad(who, 12)}${said.join(' · ')}`);
  wrote += updates.length;
  if (APPLY) {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
    });
  }
}

console.log(`\n  ${'─'.repeat(52)}\n  채울 칸 ${wrote}`);
if (ambiguous.length) {
  console.log(`\n  ▲ 값이 여러 종이라 **사람이 정해야** 하는 곳 ${ambiguous.length} — 짐작해 붙이면 돈이 잘못 간다`);
  for (const a of ambiguous) console.log(`     ${a}`);
  console.log('     → 그 집 정책코드마다 어느 계좌인지 정한 뒤 정책 탭에 직접 적는다.');
}
if (noSheet.length) console.log(`\n  ▲ 못 건드린 곳 ${noSheet.length} — ${noSheet.join(' · ')}`);
console.log(APPLY ? '\n  반영 완료.\n' : '\n  미리보기였다. 실제로 쓰려면 --apply\n');
