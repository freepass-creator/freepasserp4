/**
 * **정산 원자가 «규격대로»인지 잰다.** — `npm run check:atom`
 *
 * ★★★사장님 2026-09-08 「각 항목을 항목별로 … 어떤 거를 담아 가서 할 건지 뽑아내서
 *   파이어스토어에 담아내야지」
 *
 * 규격 = `lib/domain/settlement-atom.ts`. 여기서는 세 가지를 본다.
 * ```
 * ① 빠진 밭      규격에 있는데 줄에 없다 — 그 줄을 세는 쪽이 «손으로 기본값»을 붙이게 된다
 * ② 모르는 밭    줄에 있는데 규격에 없다 — 누가 몰래 끼워 넣은 것이다
 * ③ 형이 다르다  숫자여야 할 자리에 글자 — 더하면 조용히 틀린다
 * ```
 *
 * ★**빈 값은 흠이 아니다.** 「접수일이 없다」는 사실일 수 있다. 여기서 잡는 것은 «밭이 없는» 것이다.
 *   다만 얼마나 비었는지는 보여 준다 — 어느 칸이 늘 비면 그건 채우는 길이 없다는 뜻이다.
 *
 * ```
 * npm run check:atom
 * npm run check:atom -- 2026-08
 * ```
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SETTLEMENT_FIELDS, ATOM_KEYS, atomGroups } from '../lib/domain/settlement-atom';

const S = (v: unknown) => String(v ?? '').trim();
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const fs = getFirestore();

const all = (await fs.collection('settlement_rows').get()).docs.map((d) => d.data() as Record<string, unknown>);
const rows = MONTH ? all.filter((r) => S(r.billMonth) === MONTH) : all;
console.log(`\n■ 정산 원자 규격 — ${rows.length}줄${MONTH ? ` · ${MONTH}` : ''} · 규격 밭 ${ATOM_KEYS.length}개\n`);

const known = new Set(ATOM_KEYS);
const missing = new Map<string, number>();
const extra = new Map<string, number>();
const wrong = new Map<string, number>();
const filled = new Map<string, number>();

for (const r of rows) {
  for (const f of SETTLEMENT_FIELDS) {
    if (!(f.key in r)) { missing.set(f.key, (missing.get(f.key) || 0) + 1); continue; }
    const v = r[f.key];
    const t = typeof v;
    if (t !== f.type && v !== null) wrong.set(f.key, (wrong.get(f.key) || 0) + 1);
    if (S(v) !== '' && v !== false && v !== 0) filled.set(f.key, (filled.get(f.key) || 0) + 1);
  }
  for (const k of Object.keys(r)) if (!known.has(k)) extra.set(k, (extra.get(k) || 0) + 1);
}

/** 항목별로 «무엇을 담는가»를 보여 준다 — 규격이 눈에 보여야 규격 노릇을 한다. */
for (const g of atomGroups()) {
  console.log(`── ${g}`);
  for (const f of SETTLEMENT_FIELDS.filter((x) => x.group === g)) {
    const miss = missing.get(f.key) || 0;
    const fill = filled.get(f.key) || 0;
    const bad = wrong.get(f.key) || 0;
    const mark = miss ? `✕ ${miss}줄에 밭이 없다` : bad ? `✕ 형이 다른 줄 ${bad}` : '';
    console.log(`   ${pad(f.label, 16)} ${pad(f.key, 16)} ${pad(f.from ? `← ${f.from}` : '(우리가 센다)', 20)}`
      + ` 찬 줄 ${String(fill).padStart(4)}/${rows.length}  ${mark}`);
  }
  console.log('');
}

let bad = 0;
if (missing.size) {
  bad++;
  console.log(`✕ 규격에 있는데 «줄에 없는» 밭 ${missing.size}개`);
  for (const [k, n] of [...missing].sort((a, b) => b[1] - a[1])) console.log(`   ${pad(k, 18)} ${n}줄`);
  console.log('   → 그 달을 다시 원자화하면 규격대로 채워집니다.\n');
}
if (extra.size) {
  bad++;
  console.log(`✕ 줄에 있는데 «규격에 없는» 밭 ${extra.size}개 — 누가 몰래 끼운 것입니다`);
  for (const [k, n] of [...extra].sort((a, b) => b[1] - a[1])) console.log(`   ${pad(k, 18)} ${n}줄`);
  console.log('   → 쓸 것이면 lib/domain/settlement-atom.ts 에 적고, 아니면 걷습니다.\n');
}
if (wrong.size) {
  bad++;
  console.log(`✕ 형이 규격과 다른 밭 ${wrong.size}개`);
  for (const [k, n] of [...wrong].sort((a, b) => b[1] - a[1])) console.log(`   ${pad(k, 18)} ${n}줄`);
  console.log('');
}
if (bad) { console.log('  ⚠ 규격을 고쳐서 통과시키지 마세요 — 담을 것이 바뀐 게 아니면 실물을 고칩니다.\n'); process.exit(1); }
console.log('  ✓ 모든 줄이 규격대로 «모든 밭»을 갖췄습니다.\n');
process.exit(0);
