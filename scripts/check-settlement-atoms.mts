/**
 * **틀에 원본이 다 담기는가.** 읽기만 한다.
 *
 * ★사장님 2026-08-26 「erp에서 틀을 먼저 잡고 기존 원본 정산시트에서 값들을 원자화해서 갖고오면 되거든」.
 *   틀을 먼저 세웠으니, 이제 **원본을 부어 보고 흘러넘치는 것을 센다.**
 *   흘러넘친 열이 곧 「아직 안 정한 것」이다 — 조용히 버리면 나중에 돈이 빈다.
 *
 * 세 가지를 센다 —
 *   ① 원본 열 중 원자에 못 붙은 것 (버리기로 한 것은 빼고)
 *   ② 원자 중 원본에 없던 것 (= ERP 가 새로 만드는 칸)
 *   ③ 원장 49칸과 원자 이름이 어긋나는 것 (이름이 둘이면 집계가 갈린다)
 *
 *   npx tsx scripts/check-settlement-atoms.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { DROPPED_SOURCE_COLUMNS, SETTLEMENT_ATOMS, bySource } from '../lib/domain/settlement-atoms';

const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (u: string): Promise<Record<string, unknown>> => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 160)}`);
  return x ? JSON.parse(x) : {};
};

// ── 원본 열 전부 모으기(탭마다 열이 달라서 union 을 본다)
const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}?fields=sheets.properties.title`);
const tabs = ((meta.sheets || []) as { properties: { title: string } }[]).map((s) => s.properties.title);
const srcCols = new Map<string, number>();
let dataTabs = 0;
for (const tab of tabs) {
  const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ5`)}`)
    .catch(() => ({} as Record<string, unknown>));
  const all = ((got.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const head = all.find((r) => r.some((c) => c.replace(/\s/g, '') === '차량번호'));
  if (!head) continue;
  dataTabs++;
  for (const c of head) if (c) srcCols.set(c, (srcCols.get(c) || 0) + 1);
}

console.log(`\n■ 원본 — 데이터 탭 ${dataTabs}개 · 열 이름 ${srcCols.size}가지`);

// ── ① 원자에 못 붙은 원본 열
const dropped = new Set(DROPPED_SOURCE_COLUMNS.map((d) => d.name.replace(/[\s()（）]/g, '')));
const orphan = [...srcCols]
  .filter(([n]) => !bySource(n) && !dropped.has(n.replace(/[\s()（）]/g, '')))
  .sort((a, b) => b[1] - a[1]);
console.log(`\n■ ① 원자에 못 붙은 원본 열 — ${orphan.length}개`);
if (!orphan.length) console.log('   ✓ 없다. 원본 열이 전부 원자에 붙거나 «버리기로» 적혀 있다.');
for (const [n, c] of orphan) console.log(`   ⛔ ${n}  (${c}탭)  ← 원자를 만들든지 버릴 이유를 적든지 정해야 한다`);

console.log(`\n■ 버리기로 정한 열 — ${DROPPED_SOURCE_COLUMNS.length}개`);
for (const d of DROPPED_SOURCE_COLUMNS) console.log(`   · ${d.name.padEnd(14)} ${d.why}`);

// ── ② 원자 중 원본에 없던 것 = ERP 가 새로 만드는 칸
const srcFlat = new Set([...srcCols.keys()].map((n) => n.replace(/[\s()（）]/g, '')));
const isNew = (a: (typeof SETTLEMENT_ATOMS)[number]) =>
  !srcFlat.has(a.name.replace(/[\s()（）]/g, '')) && !(a.src || []).some((s) => srcFlat.has(s.replace(/[\s()（）]/g, '')));
const fresh = SETTLEMENT_ATOMS.filter(isNew);
console.log(`\n■ ② 원본에 없던 원자 — ${fresh.length}개 (ERP 가 새로 만드는 칸)`);
for (const a of fresh) console.log(`   + ${a.name.padEnd(12)} ${a.group}·${a.fill}·${a.need}  ${a.why.slice(0, 58)}`);

// ── ③ 원장 49칸과 이름이 어긋나는가
const led = await api(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1('접수')}!A1:BZ3`)}`);
const lhead = (((led.values || []) as unknown[][]).map((r) => (r || []).map(S)).find((r) => r.includes('차량번호')) || []) as string[];
const atomNames = new Set(SETTLEMENT_ATOMS.map((a) => a.name));
const onlyLedger = lhead.filter((c) => c && c !== '원본탭' && !atomNames.has(c));
const onlyAtom = SETTLEMENT_ATOMS.filter((a) => !lhead.includes(a.name));
console.log(`\n■ ③ 원장 ${lhead.length}칸 ↔ 원자 ${SETTLEMENT_ATOMS.length}개`);
console.log(`   ${onlyLedger.length ? '⛔ 원장에만 있는 칸 — ' + onlyLedger.join(' · ') : '✓ 원장 칸이 전부 원자에 있다'}`);
console.log(`   ${onlyAtom.length ? '⛔ 원자에만 있는 칸 — ' + onlyAtom.map((a) => a.name).join(' · ') : '✓ 원자가 전부 원장에 있다'}`);

// ── 요약
const g = new Map<string, number>();
for (const a of SETTLEMENT_ATOMS) g.set(a.group, (g.get(a.group) || 0) + 1);
console.log(`\n■ 원자 ${SETTLEMENT_ATOMS.length}개 — ${[...g].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
const must = SETTLEMENT_ATOMS.filter((a) => a.need === '필수');
console.log(`   필수 ${must.length}개 — ${must.map((a) => a.name).join(' · ')}`);

const ok = orphan.length === 0 && onlyLedger.length === 0 && onlyAtom.length === 0;
console.log(`\n${ok ? '■ 초록 — 틀과 원본·원장이 서로 다 맞물린다.' : '⛔ 빨강 — 어긋난 칸을 정하기 전에는 값을 옮기지 마라.'}\n`);
process.exit(ok ? 0 : 1);
