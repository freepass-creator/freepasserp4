/**
 * **원본 계약현황의 「차량가액」을 우리 원장(F04)의 빈칸에 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-07 「일단 우리 거에 신차가격이 없잖아」 · 「태윤이 원래 원본시트에 신차가격 같은 게 있을 건데」
 *
 * ★★**빈칸만 채운다 — 있는 값은 안 덮는다.** 우리 원장 값이 이미 있으면 그게 사람이 확인한 것이다.
 * ⚠ **숫자가 아닌 것은 안 옮긴다.** 원본 차량가액 칸에 「무보증 선납 2개월 조건」 같은 «말»이 들어 있다
 *   (실측 333모5593). 그걸 그대로 옮기면 돈 칸이 글자가 된다.
 * ⚠ 차량가액은 «선출고·견적출고»의 수수료 근거다. 장기렌트·구독에는 원래 없다 — 없다고 사고가 아니다.
 *
 *   npx tsx scripts/fill-vehicle-price.mts 2026-08
 *   npx tsx scripts/fill-vehicle-price.mts 2026-08 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const P = (v: unknown) => S(v).replace(/\s/g, '');
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const APPLY = process.argv.includes('--apply');
const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const F04 = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const api = async (id: string, m: string, b?: unknown) => {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${m}`, { method: b ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  if (!r.ok) { console.log(`\n  ✕ ${r.status} — ${(await r.text()).slice(0, 160)}\n`); process.exit(1); }
  return r.json() as Promise<{ values?: unknown[][]; sheets?: { properties: { title: string } }[] }>;
};
const A1 = (n: number) => { let s = ''; for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

/** 원본 탭 이름은 들쭉날쭉하다 — 「연/월」로 찾는다. */
const meta = await api(SRC, '?fields=sheets.properties.title');
const [yy, mm] = MONTH.split('-');
const tab = (meta.sheets || []).map((s) => s.properties.title)
  .find((n) => new RegExp(String.raw`^프리패스\s*` + yy.slice(2) + String.raw`\s*/\s*` + Number(mm) + '$').test(n.replace(/\s+/g, ' ').trim()));
if (!tab) { console.log(`\n  ✕ 원본에서 ${MONTH} 탭을 못 찾았습니다\n`); process.exit(1); }

const g = (await api(SRC, `/values/${encodeURIComponent(`'${tab}'!A1:BZ200`)}?valueRenderOption=UNFORMATTED_VALUE`)).values || [];
const hi = g.findIndex((r) => (r || []).some((c) => /차량번호|차번/.test(S(c))));
const h = (g[hi] || []).map(S);
const cp = h.findIndex((x) => /차량번호|차번/.test(x));
const cv = h.findIndex((x) => /차량가액/.test(x));
if (cv < 0) { console.log('\n  ✕ 원본에 「차량가액」 칸이 없습니다\n'); process.exit(1); }
const src = new Map<string, number>(); const words: string[] = [];
for (const r of g.slice(hi + 1)) {
  const p = P((r || [])[cp]); const raw = S((r || [])[cv]); if (!p || !raw) continue;
  /** ⚠ 「무보증 선납 2개월 조건」 같은 말은 값이 아니다. */
  if (!/^[\d,\s원₩.]+$/.test(raw) || !N(raw)) { words.push(`${p} 「${raw}」`); continue; }
  src.set(p, N(raw));
}
console.log(`\n■ ${MONTH} 차량가액 — 원본 「${tab}」에 ${src.size}대${words.length ? ` (숫자가 아닌 칸 ${words.length}개는 건너뜁니다)` : ''}\n`);
words.forEach((w) => console.log(`   ~ ${w}`));

const puts: { range: string; values: (string | number)[][] }[] = [];
let same = 0; let had = 0;
for (const t of ['접수', '완납실적', '분납실적']) {
  const q = (await api(F04, `/values/${encodeURIComponent(`'${t}'!A1:BB900`)}?valueRenderOption=UNFORMATTED_VALUE`)).values || [];
  const h0 = q.findIndex((r) => (r || []).some((c) => S(c) === '차량번호')); if (h0 < 0) continue;
  const hh = (q[h0] || []).map(S); const ix = (n: string) => hh.indexOf(n);
  if (ix('차량가액') < 0) { console.log(`  ✕ 「${t}」 에 차량가액 칸이 없습니다`); continue; }
  for (let i = h0 + 1; i < q.length; i++) {
    const r = q[i] || []; const p = P(r[ix('차량번호')]); if (!p) continue;
    if (N(r[ix('청구년')]) !== Number(yy) || N(r[ix('청구월')]) !== Number(mm)) continue;
    const v = src.get(p); if (!v) continue;
    const now = N(r[ix('차량가액')]);
    if (now === v) { same++; continue; }
    /** ★있는 값은 안 덮는다 — 사람이 확인한 것이다. */
    if (now) { had++; console.log(`  ~ ${p} ${S(r[ix('고객명')])} — 우리 ${won(now)} · 원본 ${won(v)} (안 덮습니다)`); continue; }
    console.log(`  + ${p} ${S(r[ix('고객명')]).padEnd(8)} ${t}${String(i + 1).padStart(4)}행  (빈칸) → ${won(v)}`);
    puts.push({ range: `'${t}'!${A1(ix('차량가액'))}${i + 1}`, values: [[v]] });
  }
}
console.log(`\n   채울 칸 ${puts.length}개 · 이미 같은 값 ${same}개${had ? ` · 값이 달라 안 덮은 줄 ${had}개` : ''}`);
if (!puts.length) { console.log('\n  채울 것이 없습니다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 채웁니다.\n'); process.exit(0); }
await api(F04, '/values:batchUpdate', { valueInputOption: 'RAW', data: puts });
console.log(`\n  ✓ ${puts.length}칸을 채웠습니다.`);
console.log(`  ※ 이어서 — npx tsx scripts/atomize-settlement-month.mts ${MONTH} --apply\n`);
process.exit(0);
