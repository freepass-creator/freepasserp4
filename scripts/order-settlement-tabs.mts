/**
 * **달 탭을 «최근·앞날이 왼쪽»으로 세운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-08 「정산서 월 있잖아. **우측으로 갈수록 더 멀어지는 1월달 게 맨 우측**에 있고,
 *   **회사정보 다음에 최근 달이나 미래 달**이 있어야 함」
 *
 * ★★**왜 이 차례인가.** 사람이 여는 것은 «이번 달»과 «다음 달»이다.
 *   달마다 오른쪽으로 쌓으면 자주 여는 탭이 자꾸 멀어지고, 한 해가 지나면 열두 칸을 지나가야 한다.
 * ```
 * 지금까지   공지사항 … 회사정보 │ 26년01월 → 26년02월 → … → 26년09월   (새 달이 맨 오른쪽)
 * 이제       공지사항 … 회사정보 │ 26년10월 → 26년09월 → … → 26년01월   (새 달이 «바로 옆»)
 * ```
 *   ⇒ 고정 탭(공지사항·영업안내·수수료·회사정보·재고…) 바로 뒤부터 «내림차순»으로 세운다.
 *
 * ⚠ **고정 탭은 손대지 않는다.** 달 탭(`YY년MM월 정산…`)만 자리를 옮긴다.
 * ⚠ 한 달에 탭이 둘인 곳(지급일이 달라 가른 경우)은 그 달 안에서 이름 차례를 지킨다.
 *
 * ```
 * npx tsx scripts/order-settlement-tabs.mts
 * npx tsx scripts/order-settlement-tabs.mts --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const S = (v: unknown) => String(v ?? '').trim();
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const nap = (ms: number) => new Promise((z) => setTimeout(z, ms));
const APPLY = process.argv.includes('--apply');
/** 「26년08월 정산 (42건)」 · 「26년08월 정산 · 오토플러스」 — 앞머리로 달을 읽는다. */
const MONTH_TAB = /^(\d{2})년(\d{2})월 정산/;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;
const api = async (u: string, m?: string, b?: unknown): Promise<Record<string, unknown> | null> => {
  for (let t = 0; t < 5; t++) {
    const r = await fetch(u, { method: m || 'GET', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    if (r.ok) { await nap(400); return r.json().catch(() => ({})); }
    if (r.status === 429 || r.status >= 500) { await nap(r.status === 429 ? 15_000 : 1500); continue; }
    console.log(`  ✕ ${r.status} — ${(await r.text()).slice(0, 120)}`); return null;
  }
  return null;
};
const drive = async (q: string) => (((await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=80&supportsAllDrives=true&includeItemsFromAllDrives=true`)) as { files?: { id: string; name: string }[] } | null)?.files) || [];

const books = [
  ...(await drive("name contains '프리패스 재고' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")),
  ...(await drive("name contains '프리패스 정산' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")),
].filter((f) => /사용중/.test(f.name));

console.log(`\n■ 달 탭을 «최근이 왼쪽»으로 — 시트 ${books.length}개 ${APPLY ? '(반영)' : '(대조만)'}\n`);
let moved = 0;
for (const b of books) {
  const meta = (await api(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(title,sheetId,index)`)) as {
    sheets?: { properties: { title: string; sheetId: number; index: number } }[] } | null;
  const all = (meta?.sheets || []).map((s) => s.properties).sort((a, c) => a.index - c.index);
  const months = all.filter((s) => MONTH_TAB.test(s.title));
  if (months.length < 2) continue;
  /** ★고정 탭이 끝나는 자리 = 첫 달 탭이 서 있던 자리. 거기서부터 내림차순으로 세운다. */
  const at = Math.min(...months.map((s) => s.index));
  const key = (t: string) => { const m = MONTH_TAB.exec(t)!; return `${m[1]}${m[2]}`; };
  const want = [...months].sort((x, y) => (key(y.title).localeCompare(key(x.title))) || x.title.localeCompare(y.title));
  const now = months.map((s) => s.title).join(' → ');
  const next = want.map((s) => s.title).join(' → ');
  if (now === next) { console.log(`  ○ ${pad(b.name.replace(/^\[[^\]]+\]\s*/, ''), 26)} 이미 제 차례입니다`); continue; }
  moved++;
  console.log(`  ${APPLY ? '-' : '·'} ${pad(b.name.replace(/^\[[^\]]+\]\s*/, ''), 26)}`);
  console.log(`      전 ${now}`);
  console.log(`      후 ${next}`);
  if (!APPLY) continue;
  /** ⚠ 한 번에 하나씩 «제자리»로 옮긴다 — 여러 개를 한 요청에 담으면 자리가 서로 밀린다. */
  for (let k = 0; k < want.length; k++) {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}:batchUpdate`, 'POST', { requests: [{
      updateSheetProperties: { properties: { sheetId: want[k].sheetId, index: at + k }, fields: 'index' } }] });
  }
}
console.log(`\n   차례를 고칠 시트 ${moved}개`);
if (!APPLY && moved) console.log('\n※ dry-run — 아무것도 안 옮겼습니다. --apply 로 세웁니다.\n');
else console.log('');
process.exit(0);
