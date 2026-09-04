/**
 * **원천(계약현황)의 «계약기간 빈칸»을 정산원장에서 가져와 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-04 「완벽하게 마무리해 주세요」 · 「네가 추천대로 좀 해라」
 *
 * ★★**빈칸 하나가 그 달을 통째로 줄인다 — 그런데 «금액» 빈칸이 아니었다.**
 *   2026-08 에 세 줄의 수수료가 0 으로 나갔다. 처음엔 「금액을 안 적었다」고 봤는데,
 *   수식을 열어 보니 **수수료 칸은 수식이고 «계약기간»이 비어서 값을 못 내고 있었다.**
 * ```
 * 15다4180   기간 (빈칸) → 수수료 (빈칸)      기간 60 이면 660,000 / 480,000
 * 227거7842  기간 (빈칸) → 수수료 (빈칸)      기간 24 이면 1,000,000 / 800,000
 * 43나2130   기간 (빈칸) → 수수료 (빈칸)      기간 24 이면 1,000,000 / 800,000
 * 63버0257   기간 24    → 수수료 1,000,000  ← 기간이 있으면 수식이 제 값을 낸다
 * ```
 *   하허호에 339만, 오토플러스에 330만이 덜 잡혀 있었다. **사람 눈으로는 못 잡는다** —
 *   숫자가 «틀린» 게 아니라 «없는» 것이라 표가 조용히 0 으로 선다.
 *
 * ★★★**돈은 «쓰지 않는다». 기간만 채운다.**
 *   수수료 칸은 시트의 수식이 낸다. 거기에 숫자를 박으면 그 줄은 그때부터 안 따라온다 —
 *   대여료가 바뀌어도 수수료가 그대로 남는다. 조용히 틀리는 가장 나쁜 꼴이다.
 *   ⇒ 우리가 넣는 것은 «이미 우리 원장에 있는 사실»(계약기간)뿐이다. 지어내지 않는다.
 *
 * ⚠ **전기차 프로모션은 시트 수식이 모른다.** 43나2130·63버0257 은 기간을 채워도
 *   수식이 100만/80만만 낸다. 프로모션 50만은 사람이 더하거나 시트 수식을 고쳐야 한다.
 *   우리 요율표는 알고 있으니 `check-fee-consistency` 가 계속 잡아 준다.
 *
 * ```
 * npx tsx scripts/fill-source-fee.mts 2026-08            (대조만)
 * npx tsx scripts/fill-source-fee.mts 2026-08 --apply    (채운다)
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원%개월]/g, '')); return Number.isFinite(n) ? n : 0; };
const P = (v: unknown) => S(v).replace(/\s+/g, '');
const MONTH = S(process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)));
const APPLY = process.argv.includes('--apply');
if (!MONTH) { console.log('\n  달을 주세요 — npx tsx scripts/fill-source-fee.mts 2026-08 [--apply]\n'); process.exit(1); }

/** 원자화가 읽는 «그 시트»를 그대로 본다 — 다른 걸 고치면 아무 일도 안 일어난다. */
const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';   // 프리패스모빌리티계약현황
const LEDGER = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4'; // [F04] 프리패스 정산원장
const TAB = `프리패스 ${MONTH.slice(2, 4)}/${Number(MONTH.slice(5))}`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const grid = async (id: string, range: string, how = 'UNFORMATTED_VALUE'): Promise<unknown[][]> =>
  (((await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueRenderOption=${how}`,
    { headers: { Authorization: `Bearer ${await tok()}` } })).json()) as { values?: unknown[][] }).values) || [];

/** ── 정산원장에서 «차번 → 계약기간»을 모은다 (접수·실적 세 탭) ── */
const termOf = new Map<string, number>();
for (const t of ['접수', '완납실적', '분납실적']) {
  const g = await grid(LEDGER, `'${t}'!A1:BB600`);
  const hi = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
  if (hi < 0) continue;
  const h = (g[hi] || []).map(S);
  const [ip, it] = ['차량번호', '계약기간'].map((n) => h.indexOf(n));
  if (ip < 0 || it < 0) continue;
  for (const r of g.slice(hi + 1)) {
    const p = P((r || [])[ip]); const n = N((r || [])[it]);
    if (p && n && !termOf.has(p)) termOf.set(p, n);
  }
}

const g = await grid(SRC, `'${TAB}'!A1:BZ300`);
const gf = await grid(SRC, `'${TAB}'!A1:BZ300`, 'FORMULA');
const hi = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
if (hi < 0) { console.log(`\n  ✕ 「${TAB}」 머리글을 못 찾았습니다\n`); process.exit(1); }
const head = (g[hi] || []).map(S);
const col = (name: string) => { const j = head.indexOf(name); if (j < 0) { console.log(`  ✕ 「${name}」 열이 없습니다 — 멈춥니다`); process.exit(1); } return j; };
const C = { plate: col('차량번호'), state: col('상태 표기'), sup: col('업체명'), model: col('모델명'),
  product: col('상품구분'), term: col('계약기간'), claim: col('판매 수수료'), pay: col('출고수수료') };
const A1 = (n: number) => { let s = ''; for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

console.log(`\n■ ${MONTH} 원천 「${TAB}」 — 계약기간 빈칸 채우기 ${APPLY ? '(반영)' : '(대조만)'}`);
console.log(`   정산원장에서 거둔 «차번 → 기간» ${termOf.size}대\n`);

const puts: { range: string; values: number[][] }[] = []; const stuck: string[] = [];
for (let i = hi + 1; i < g.length; i++) {
  const r = g[i] || [];
  const plate = P(r[C.plate]); if (!plate) continue;
  if (!/계약\s*완료/.test(S(r[C.state]))) continue;
  if (N(r[C.term])) continue;                       // 기간이 이미 있으면 손대지 않는다
  /** ★수수료가 이미 서 있으면 기간이 없어도 그 줄은 멀쩡한 것이다 — 건드리지 않는다. */
  if (N(r[C.claim]) || N(r[C.pay])) continue;
  /** ★기간 칸이 수식이면 손대지 않는다 — 우리가 숫자를 박으면 그 줄은 안 따라온다. */
  if (S((gf[i] || [])[C.term]).startsWith('=')) { stuck.push(`  ? ${plate.padEnd(10)} ${i + 1}행 — 기간 칸이 수식입니다`); continue; }

  const term = termOf.get(plate);
  if (!term) { stuck.push(`  ? ${plate.padEnd(10)} ${S(r[C.sup]).padEnd(7)} ${S(r[C.model]).padEnd(10)} ${i + 1}행 — 원장에도 계약기간이 없습니다`); continue; }
  puts.push({ range: `'${TAB}'!${A1(C.term)}${i + 1}`, values: [[term]] });
  console.log(`  + ${plate.padEnd(10)} ${S(r[C.sup]).padEnd(7)} ${S(r[C.model]).padEnd(10)} ${String(i + 1).padStart(3)}행  계약기간 (빈칸) → ${term}개월   ⇒ 수식이 수수료를 냅니다`);
}

if (stuck.length) { console.log('\n  ★사람이 볼 줄'); stuck.forEach((s) => console.log(s)); }
console.log(`\n   채울 칸 ${puts.length}개${stuck.length ? ` · 사람이 볼 줄 ${stuck.length}개` : ''}`);
if (!puts.length) { console.log('\n  ✓ 채울 빈칸이 없습니다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 채웁니다.\n'); process.exit(0); }

const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}/values:batchUpdate`, {
  method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ valueInputOption: 'RAW', data: puts }),
});
if (!res.ok) { console.log(`\n  ✕ 못 썼습니다 — ${res.status} ${(await res.text()).slice(0, 200)}\n`); process.exit(1); }
console.log(`\n  ✓ ${((await res.json()) as { totalUpdatedCells?: number }).totalUpdatedCells}칸을 채웠습니다 — 수수료는 시트 수식이 냅니다.`);
console.log(`  ※ 이어서 — npx tsx scripts/run-settlement-month.mts ${MONTH} --apply\n`);
process.exit(0);
