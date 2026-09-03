/**
 * **라이브 차종마스터의 라틴 트림 표기를 정본으로 되돌린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 — 트림행키 «영구계약»이 깨져 있다. `세부트림` 은 의미 열이라 값이 바뀌면
 *   같은 코드가 다른 차를 가리키는 것이 된다(`docs/VEHICLE_MASTER_KEY_CONTRACT.md`).
 *   실측 2026-09-03 — 「H-PICK」을 「H-픽」으로 한글화한 편집 **18건**.
 *   그 탓에 `generate-vehicle-trim-master --check` 가 **REGISTERED_SEMANTIC_DRIFT 로 발행을 막고** 있다.
 *
 * ★되돌릴 값을 «내가 정하지 않는다» — `LATIN_BRAND_TRIM_CANON`(`vehicle-master-lock.ts:59`)이 정본이다.
 *   H-PICK · N Line · X Line · GT-Line. 한글화는 규격이 금지한다.
 *   그리고 **기준판(`data/vehicle-trim-key-registry.json`)이 기억하는 값과 같을 때만** 되돌린다 —
 *   즉 「원래 그 값이었다」가 증명되는 행만 손댄다. 그 밖의 의미 변경은 **사람이 판단할 일**이라 안 건드린다.
 *
 * ⚠ 이 자는 «표기»만 고친다. 행을 더하거나 지우지 않는다. 다른 열도 안 본다.
 *
 *   npx tsx scripts/fix-latin-trim-canon.mts
 *   npx tsx scripts/fix-latin-trim-canon.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { LATIN_BRAND_TRIM_CANON, applyLatinBrandTokens } from '../lib/domain/vehicle-master-lock';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const MASTER = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';
const TAB = '차종마스터';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 1; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n <= 5) { await sleep(15_000 * n); continue; }
    throw new Error(`${r.status} ${x.slice(0, 200)}`);
  }
};
const col = (i: number) => { let n = i + 1, s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

const v = await call(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER}/values/${encodeURIComponent(TAB)}!A1:AF20000`);
const rows = ((v.values || []) as string[][]);
const hdr = rows[0].map(S);
const cKey = hdr.indexOf('트림행키'), cTrim = hdr.indexOf('세부트림');
const cMaker = hdr.indexOf('제조사'), cModel = hdr.indexOf('모델'), cSub = hdr.indexOf('세부모델');
if (cKey < 0 || cTrim < 0) { console.error('✗ 「트림행키」·「세부트림」 열을 못 찾았다'); process.exit(1); }

/** 기준판이 기억하는 세부트림 — `semantic` 은 배열이고 `semanticHeaders` 와 짝이다. */
const reg = JSON.parse(readFileSync('data/vehicle-trim-key-registry.json', 'utf8')) as Rec;
const at = (reg.semanticHeaders as string[]).indexOf('세부트림');
const 기준 = new Map<string, string>();
for (const r of (reg.records || []) as Rec[]) { const k = S(r.code); if (k) 기준.set(k, S((r.semantic || [])[at])); }

const updates: { range: string; values: string[][] }[] = [];
const 보기: string[] = [];
let 표기밖 = 0;
for (let i = 1; i < rows.length; i++) {
  const key = S(rows[i][cKey]); if (!key) continue;
  const now = S(rows[i][cTrim]);
  const was = 기준.get(key);
  if (was === undefined || was === now) continue;
  if (applyLatinBrandTokens(now) !== was) { 표기밖 += 1; continue; }   // 사람이 판단할 것 — 안 건드린다
  updates.push({ range: `'${TAB}'!${col(cTrim)}${i + 1}`, values: [[was]] });
  if (보기.length < 20) 보기.push(`${col(cTrim)}${i + 1}  ${S(rows[i][cMaker])} ${S(rows[i][cModel])} ${S(rows[i][cSub])}  「${now}」 → 「${was}」`);
}

console.log(`■ 라틴 트림 정본 되돌리기 — 정본: ${LATIN_BRAND_TRIM_CANON.join(' · ')}`);
console.log(`   고칠 행 ${updates.length}개 ${APPLY ? '(반영)' : '(dry-run)'}${표기밖 ? ` · 표기로 설명 안 되는 것 ${표기밖}건은 «안 건드림»(사람이 판단)` : ''}`);
for (const b of 보기) console.log('   ' + b);
if (!updates.length) { console.log('\n고칠 것이 없다 ✓'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); process.exit(0); }

await call(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER}/values:batchUpdate`, {
  method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
});
console.log(`\n■ ${updates.length}칸 되돌렸다 — 행키 계약 검사를 다시 돌려 확인할 것`);
console.log('   npx tsx scripts/audit-vehicle-trim-key-contract.mts');
