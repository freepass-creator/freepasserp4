/**
 * **원본 계약현황에서 정산원장의 빈 금액 칸만 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-25) — 월별 요약을 세우다 **2026-05 우리 몫이 −5,925만원**으로 나왔다.
 *   66줄 전부 지급액(출고수수료)만 있고 청구액(판매수수료)이 0이었다.
 *   원본 「프리패스 26/5」 탭의 열 이름이 **「판매 수수료\n(수식X)」** — 띄어쓰기와 줄바꿈이 섞여 있어
 *   「판매수수료」로 찾던 이식 도구가 그 열을 통째로 못 잡았다.
 *
 * ★**이름은 흔들린다 — 공백·줄바꿈을 지우고 견준다.** 다만 괄호는 **안 지운다**:
 *   「수수료율(공급사)」와 「수수료율(에이전시)」는 괄호 하나로 갈린다.
 * ★**구간을 먼저 가른다.** 원본은 머리글 위에 「공급사(렌터카) 구간」·「에이전시 구간」이 적혀 있고
 *   같은 이름의 열이 양쪽에 있다. 경계 왼쪽이 공급사, 오른쪽이 에이전시다.
 * ★**빈 칸만 채운다.** 값이 있는 칸은 안 덮는다 — 원장에서 사람이 고쳤을 수 있다.
 * ★키는 **차량번호 + 접수일**이다. 같은 차가 다시 나가기 때문이다.
 *
 *   npx tsx scripts/backfill-settlement-fees.mts
 *   npx tsx scripts/backfill-settlement-fees.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

/** 원본 「프리패스모빌리티계약현황」 — 개인 gmail 소유. 우리는 읽기만 된다. */
const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const TABS = ['접수', '취소', '분납실적', '완납실적'];

/**
 * 채울 칸 — 원장 열 이름 → 원본 열 이름 후보(공백·줄바꿈 지운 뒤 견준다).
 * `side` 는 구간이다: 공급사 구간에서 찾을지, 에이전시 구간에서 찾을지.
 */
const FIELDS: { name: string; side: '공급사' | '에이전시'; cand: string[] }[] = [
  { name: '판매수수료', side: '공급사', cand: ['판매수수료(수식X)', '판매수수료'] },
  { name: '공급사수수료율', side: '공급사', cand: ['수수료율(공급사)', '수수료율'] },
  { name: '공급사인센티브', side: '공급사', cand: ['추가인센티브', '인센티브'] },
  { name: '공급사부가세', side: '공급사', cand: ['부가세'] },
  { name: '청구금액', side: '공급사', cand: ['청구금액'] },
  { name: '출고수수료', side: '에이전시', cand: ['출고수수료(수식X)', '출고수수료'] },
  { name: '에이전시수수료율', side: '에이전시', cand: ['수수료율(에이전시)', '수수료율'] },
  { name: '에이전시인센티브', side: '에이전시', cand: ['추가인센티브', '인센티브'] },
  { name: '에이전시부가세', side: '에이전시', cand: ['부가세'] },
  { name: '지급액', side: '에이전시', cand: ['지급액'] },
  { name: '계약서대행료', side: '에이전시', cand: ['계약서대행료', '계약서작성비'] },
];

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
/** ★공백·줄바꿈만 지운다. 괄호는 남긴다 — 「수수료율(공급사)」와 「(에이전시)」가 그것으로 갈린다. */
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const p2 = (n: number) => String(n).padStart(2, '0');
const SERIAL0 = Date.UTC(1899, 11, 30);
/** ★구글 날짜는 숫자로 온다. 키를 맞추려면 양쪽을 같은 글자로 만들어야 한다. */
const ymd = (v: string) => {
  const t = S(v);
  if (!t) return '';
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return `${u.getUTCFullYear()}-${p2(u.getUTCMonth() + 1)}-${p2(u.getUTCDate())}`;
  }
  const x = new Date(t);
  return Number.isNaN(+x) ? t : `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
};
const plate = (v: unknown) => S(v).replace(/\s/g, '');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 180)}`);
  }
};

// ── 원본을 읽어 「차번|접수일 → 금액」 표를 만든다 ─────────────────────
const meta = await api(`${SH}/${SRC}?fields=sheets.properties(title)`);
const srcTabs: string[] = ((meta.sheets || []) as any[]).map((s) => S(s.properties.title)).filter((t) => /프리패스\s*\d+\//.test(t));
console.log(`\n■ 원본 월별 탭 ${srcTabs.length}개\n`);

const found = new Map<string, Record<string, string>>();
let srcRows = 0;
const noCol: string[] = [];
for (const tab of srcTabs) {
  const got = await api(`${SH}/${SRC}/values/${encodeURIComponent(`${a1(tab)}!A1:CZ400`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호'));
  if (hi < 0) continue;
  const head = rows[hi].map(norm);
  /**
   * ★구간 경계 — 머리글 «위» 줄에 「에이전시 구간」이 적혀 있다. 그 자리부터가 에이전시다.
   *   못 찾으면 이 탭은 건너뛴다(짐작해서 가르면 공급사 돈과 영업자 돈이 섞인다).
   */
  let bound = -1;
  for (let r = Math.max(0, hi - 3); r < hi; r++) {
    const i = (rows[r] || []).findIndex((c) => /에이전시\s*구간/.test(S(c)));
    if (i >= 0) { bound = i; break; }
  }
  if (bound < 0) { noCol.push(`${tab} — 「에이전시 구간」 경계를 못 찾았다`); continue; }
  const pick = (f: (typeof FIELDS)[number]) => {
    for (const c of f.cand) {
      for (let i = 0; i < head.length; i++) {
        if (head[i] !== norm(c)) continue;
        if (f.side === '공급사' ? i < bound : i >= bound) return i;
      }
    }
    return -1;
  };
  const at = Object.fromEntries(FIELDS.map((f) => [f.name, pick(f)]));
  const iPlate = head.indexOf('차량번호');
  const iRecv = head.findIndex((h) => h === '접수일');
  const miss = FIELDS.filter((f) => at[f.name] < 0).map((f) => f.name);
  let n = 0;
  for (const r of rows.slice(hi + 1)) {
    const p = plate(r[iPlate]);
    if (!p) continue;
    const key = `${p}|${ymd(S(r[iRecv]))}`;
    const rec: Record<string, string> = found.get(key) || {};
    for (const f of FIELDS) { const i = at[f.name]; if (i >= 0 && S(r[i]) && !rec[f.name]) rec[f.name] = S(r[i]); }
    found.set(key, rec);
    n++; srcRows++;
  }
  console.log(`   ${tab.padEnd(14)} ${String(n).padStart(4)}줄 · 경계 ${bound}${miss.length ? ` · 못 찾은 칸 ${miss.join('·')}` : ''}`);
}
console.log(`\n   원본 ${srcRows}줄 → 열쇠 ${found.size}개`);
for (const t of noCol) console.log(`   ⚠ ${t}`);

// ── 원장의 빈 칸을 채운다 ────────────────────────────────────────────
type Fix = { tab: string; gid: number; row: number; col: number; name: string; to: string };
const fixes: Fix[] = [];
const gidOf = new Map<string, number>();
const perTab: Record<string, number> = {};
const noMatch: string[] = [];
const lmeta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
for (const p of ((lmeta.sheets || []) as any[]).map((s) => s.properties)) gidOf.set(S(p.title), Number(p.sheetId));

for (const tab of TABS) {
  const got = await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = rows.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) { console.log(`   ${tab} — 머리글을 못 찾았다`); continue; }
  const head = rows[hi];
  const iPlate = head.indexOf('차량번호'), iRecv = head.indexOf('접수일');
  let n = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    const p = plate(rows[r][iPlate]);
    if (!p) continue;
    const rec = found.get(`${p}|${ymd(S(rows[r][iRecv]))}`);
    if (!rec) { noMatch.push(`${tab} ${p}`); continue; }
    for (const f of FIELDS) {
      const c = head.indexOf(f.name);
      if (c < 0 || !rec[f.name]) continue;
      if (S(rows[r][c])) continue;                  // ⚠ 있는 값은 안 덮는다
      fixes.push({ tab, gid: gidOf.get(tab)!, row: r, col: c, name: f.name, to: rec[f.name] });
      n++;
    }
  }
  perTab[tab] = n;
}

const byField = new Map<string, number>();
for (const f of fixes) byField.set(f.name, (byField.get(f.name) || 0) + 1);
console.log(`\n■ 채울 칸 ${fixes.length} ${APPLY ? '(반영)' : '(dry-run)'}\n`);
for (const [k, v] of [...byField].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(12)} ${String(v).padStart(4)}칸`);
console.log(`\n   탭별 — ${TABS.map((t) => `${t} ${perTab[t] ?? 0}`).join(' · ')}`);
if (noMatch.length) console.log(`   ⚠ 원본에서 짝을 못 찾은 줄 ${noMatch.length} — ${[...new Set(noMatch)].slice(0, 6).join(' · ')}${noMatch.length > 6 ? ' …' : ''}`);

writeFileSync('tmp/backfill-fees.json', JSON.stringify({ fixes: fixes.length, byField: [...byField], noMatch: noMatch.length }, null, 2));
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }
if (!fixes.length) { console.log('\n※ 채울 것이 없다.\n'); process.exit(0); }

// ★한 탭씩 묶어 보낸다. 칸 하나에 요청 하나면 수천 번이 된다.
const byTab = new Map<string, Fix[]>();
for (const f of fixes) { if (!byTab.has(f.tab)) byTab.set(f.tab, []); byTab.get(f.tab)!.push(f); }
for (const [tab, list] of byTab) {
  const data = list.map((f) => ({ range: `${a1(tab)}!${colA1(f.col)}${f.row + 1}`, values: [[f.to]] }));
  for (let i = 0; i < data.length; i += 400) {
    await api(`${SH}/${LEDGER}/values:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 400) }),
    });
  }
  console.log(`   ✓ ${tab} ${list.length}칸`);
}

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const h0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n';
const entry = `\n## ${when} · 원본에서 빠졌던 금액 ${fixes.length}칸을 채웠다\n\n도구 \`scripts/backfill-settlement-fees.mts --apply\`\n월별 요약을 세우다 **2026-05 우리 몫이 −5,925만원**으로 나왔다. 66줄 전부 지급액만 있고 청구액이 0이었다.\n원본 「프리패스 26/5」 탭의 열 이름이 **「판매 수수료(수식X)」** — 띄어쓰기·줄바꿈이 섞여 있어 이식 도구가 그 열을 통째로 못 잡았다.\n이름을 견줄 때 **공백·줄바꿈만 지운다**(괄호는 남긴다 — 「수수료율(공급사)」와 「(에이전시)」가 그것으로 갈린다).\n채운 칸 — ${[...byField].map(([k, v]) => `${k} ${v}`).join(' · ')}\n`;
const marker = '> 기계가 정산원장 구조를';
const cut = h0.indexOf(marker);
const insertAt = cut >= 0 ? h0.indexOf('\n', cut) + 1 : h0.length;
writeFileSync(LOG, h0.slice(0, insertAt) + entry + h0.slice(insertAt));

console.log(`\n■ 끝 — ${fixes.length}칸\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
