/**
 * **자체시트 공급사의 줄별 조건 칸 → 정제시트 「정책」 탭 + 재고 「정책코드」.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-18) — 문패를 정제시트로 넘기면 공급사 원본 재고탭에 붙어 있던 대인·대물·자차·자손·연주행·분납·전용계좌 칸이
 *   판매시트에서 사라진다(정제시트 규격엔 그 칸이 없다 — 정책은 「정책」 탭에서 정책코드로 조인). 그 값을 여기서 정책으로 옮긴다.
 *   해석 규칙은 ERP 정책 생성기(`build-policies-from-sheets`)와 같은 것(`supplier-row-policy`)을 쓴다.
 *
 * ★조건이 같은 줄은 정책 하나로 접힌다(돈이 걸린 칸 기준). 코드는 ERP 에 같은 조건의 정책이 있으면 **그 코드를 그대로** 쓰고,
 *   없으면 「{공급사코드}_S{번호}」. 정책 탭에서 그 공급사 접두(RP0xx_)의 줄만 다시 쓴다 — 사람이 넣은 다른 줄은 안 건드린다.
 * ★재고 「정책코드」는 우리 칸(ours)이지만 여기서 채운다 — 비어 있거나 기계가 넣은 값(RP0xx_S…)일 때만. 사람이 고른 코드는 안 덮는다.
 * ⚠ 조건 칸이 없는 원본(오토플러스)은 할 일이 없다 — 「(프리패스 기본)」이 붙는다.
 * ⚠ 쓴 뒤 `normalize-policy-values --sheet=<정제시트> --apply` 로 드롭다운·메모를 다시 입힌다(여기선 값만 쓴다).
 *
 *   npx tsx scripts/sync-mirror-policies.mts --from=<원본ID> --to=<정제시트ID> --code=RP031
 *   npx tsx scripts/sync-mirror-policies.mts --from=… --to=… --code=… --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { hasPolicyColumns, policyFieldsFrom, policySameKey, policyTabRowFrom, POLICY_SAME_KEYS, wonOf } from '../lib/domain/supplier-row-policy';
import { policySheetHeader } from '../lib/domain/policy-sheet-layout';
import { POLICY_TAB_ALIASES, policyTabTitle } from '../lib/domain/supplier-template-sheet';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const FROM = arg('from'); const TO = arg('to'); const CODE = arg('code');
if (!FROM || !TO || !CODE) throw new Error('--from=<원본ID> --to=<정제시트ID> --code=RP0xx 가 필요하다');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await new Promise((ok) => setTimeout(ok, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let s = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

// ── ① 원본 줄 → 정책 필드(줄마다), 같은 조건끼리 접기
const grid = await call(`${SH}/${FROM}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
const read = readSupplierSheet(grid as never, { partner_code: CODE } as EntityRecord);
type Group = { key: string; fields: Rec; tab: Record<string, string>; plates: string[]; sampleTab: string };
const groups = new Map<string, Group>();
const plateOrder: string[] = [];
let rowsSeen = 0, tabsWithPolicy = 0;
for (const t of read.tabs) {
  const hdr = (t.table[0] || []).map(S);
  if (!hasPolicyColumns(hdr)) continue;
  tabsWithPolicy++;
  const pi = hdr.findIndex((h) => /^차량번호$|^차번$/.test(norm(h)));
  if (pi < 0) continue;
  for (const r of t.table.slice(1)) {
    const plate = norm(r[pi]);
    if (!plate || plateOrder.includes(plate)) continue;
    const fields = policyFieldsFrom(hdr, r.map(S));
    if (!Object.keys(fields).some((k) => (POLICY_SAME_KEYS as readonly string[]).includes(k))) continue;   // 돈 칸이 하나도 없으면 정책 근거 없음
    rowsSeen++;
    plateOrder.push(plate);
    const key = policySameKey(fields);
    if (!groups.has(key)) groups.set(key, { key, fields, tab: policyTabRowFrom(fields), plates: [], sampleTab: t.title });
    groups.get(key)!.plates.push(plate);
  }
}
console.log(`■ ${CODE} 정책 미러 ${APPLY ? '반영' : '미리보기'} — 원본 ${read.tabs.length}탭(조건 칸 있는 탭 ${tabsWithPolicy}) · 조건 읽은 차 ${rowsSeen} · 정책 ${groups.size}벌`);
if (!groups.size) { console.log('  조건 칸이 없다 — 할 일 없음(「(프리패스 기본)」 적용)'); process.exit(0); }

// ── ② ERP 에 같은 조건의 정책이 있으면 그 코드를 쓴다
const existing: { code: string; rec: Rec }[] = [];
for (const path of ['policies', 'v4/policies']) {
  const all = JSON.parse(await (await fetch(`${DB}/${path}.json?access_token=${dbT}`)).text()) || {};
  for (const [k, v] of Object.entries<Rec>(all)) {
    if (!v || typeof v !== 'object' || v._deleted === true || v.deletedAt) continue;
    if (S(v.provider_company_code) !== CODE) continue;
    existing.push({ code: S(v.policy_code) || k, rec: v });
  }
}
const sameAsExisting = (fields: Rec): string => {
  for (const { code, rec } of existing) {
    const same = POLICY_SAME_KEYS.every((k) => {
      const a = fields[k]; const b = rec[k];
      if (a == null || a === '' || b == null || b === '') return true;
      if (k === 'annual_mileage') return policySameKey({ annual_mileage: a }) === policySameKey({ annual_mileage: b });
      const na = wonOf(a); const nb = wonOf(b);
      if (na && nb) return na === nb;
      return S(a).replace(/\s/g, '') === S(b).replace(/\s/g, '');
    });
    if (same) return code;
  }
  return '';
};
const used = new Set<string>(existing.map((e) => e.code));
let seq = 0;
const assigned: { code: string; g: Group; reused: boolean }[] = [];
for (const g of groups.values()) {
  const reuse = sameAsExisting(g.fields);
  let code = reuse;
  if (!code || assigned.some((a) => a.code === code)) { do { seq++; code = `${CODE}_S${seq}`; } while (used.has(code) || assigned.some((a) => a.code === code)); }
  assigned.push({ code, g, reused: !!reuse && code === reuse });
}

// ── ③ 정제시트 정책 탭 — 머리행·기본 줄은 두고, 이 공급사 접두 줄만 다시 쓴다
// ★탭 이름은 시트마다 「운영정책」·「정책」 둘 다 있다(정책 규격 v2 이후 「운영정책」). 실제 탭 이름으로 잡는다 — 이름을 고정하면 400 Unable to parse range 로 죽는다(2026-08-19 실측).
const bookMeta = await call(`${SH}/${TO}?fields=sheets.properties(title)`) as Rec;
const titles = ((bookMeta.sheets || []) as Rec[]).map((x) => S(x.properties?.title));
const POLICY_TAB = policyTabTitle(titles);
if (!POLICY_TAB) throw new Error(`정제시트에 정책 탭이 없다(${POLICY_TAB_ALIASES.join('·')})`);
const pol = await call(`${SH}/${TO}/values/${encodeURIComponent(`'${POLICY_TAB}'`)}`) as { values?: string[][] };
const prow = ((pol.values || []) as string[][]).map((r) => r.map(S));
const hdr = prow[0] || [];
// ★열은 이름으로 찾는다 — 자리로 찾지 않는다(2026-08-21).
//   운영정책 v2 에서 맨 앞이 「정책UID」가 되며 「정책코드」가 둘째 칸으로 밀렸는데, 자리를 박아 둔 옛 검사가
//   아이카·이안카 정책 미러를 매일 죽이고 있었다 — 그 바람에 일일 반영이 ① 에서 멈춰 아무것도 발행되지 않았다.
const codeAt = hdr.findIndex((h) => h === '정책코드');
if (!hdr.length || codeAt < 0) throw new Error(`정제시트 「${POLICY_TAB}」 탭 머리행에 「정책코드」 열이 없다(있는 열: ${hdr.filter(Boolean).slice(0, 12).join('·')}…)`);
const stdHdr = policySheetHeader();
const missingCols = stdHdr.filter((c) => !hdr.includes(c));
if (missingCols.length) console.log(`  ▲ 정책 탭에 없는 규격 열 ${missingCols.length}: ${missingCols.join(' · ')}`);
const keep = prow.slice(1).filter((r) => S(r[codeAt]) && !S(r[codeAt]).startsWith(`${CODE}_`));
const newRows = assigned.map(({ code, g }) => hdr.map((h) => (h === '정책코드' ? code : h === '정책명' ? `${CODE} 시트 조건 ${g.sampleTab}` : (g.tab[h] || ''))));
for (const { code, g, reused } of assigned) {
  console.log(`  ${code}${reused ? '(ERP 기존)' : '(새)'} — ${g.plates.length}대 · ${Object.entries(g.tab).map(([k, v]) => `${k}=${v}`).join(' · ').slice(0, 220)}`);
}
// ── ④ 재고 정책코드
const st = await call(`${SH}/${TO}/values/${encodeURIComponent("'재고'")}`) as { values?: string[][] };
const srows = ((st.values || []) as string[][]).map((r) => r.map(S));
const shi = srows.findIndex((r) => r.some((c) => norm(c) === '차명(세부모델+트림)'));
const shdr = srows[shi] || [];
const spi = shdr.findIndex((h) => norm(h) === '차량번호'); const sci = shdr.findIndex((h) => norm(h) === '정책코드');
if (spi < 0 || sci < 0) throw new Error('재고 탭에 차량번호/정책코드 열이 없다');
const codeOf = new Map<string, string>();
for (const { code, g } of assigned) for (const p of g.plates) codeOf.set(p, code);
const cellWrites: { range: string; values: string[][] }[] = [];
let setN = 0, keptHuman = 0;
srows.slice(shi + 1).forEach((r, k) => {
  const plate = norm(r[spi]); if (!plate) return;
  const want = codeOf.get(plate); if (!want) return;
  const now = S(r[sci]);
  if (now === want) return;
  if (now && !now.startsWith(`${CODE}_`) && now !== '(프리패스 기본)') { keptHuman++; return; }
  cellWrites.push({ range: `'재고'!${colA1(sci)}${shi + 2 + k}`, values: [[want]] }); setN++;
});
console.log(`  재고 정책코드 넣을 줄 ${setN}${keptHuman ? ` · 사람이 고른 코드라 둔 줄 ${keptHuman}` : ''}`);
if (!APPLY) { console.log('※ dry-run. 반영은 --apply'); process.exit(0); }
await call(`${SH}/${TO}/values/${encodeURIComponent(`'${POLICY_TAB}'!A2:${colA1(Math.max(hdr.length, 1) - 1)}${Math.max(prow.length + assigned.length + 5, 60)}`)}:clear`, { method: 'POST', body: '{}' });
await call(`${SH}/${TO}/values/${encodeURIComponent(`'${POLICY_TAB}'!A2`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [...keep, ...newRows] }) });
if (cellWrites.length) await call(`${SH}/${TO}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: cellWrites }) });
console.log(`  ✓ 「${POLICY_TAB}」 탭 ${keep.length + newRows.length}줄(기존 유지 ${keep.length} + ${CODE} ${newRows.length}) · 재고 정책코드 ${setN}줄`);
console.log(`  → 이어서: npx tsx scripts/normalize-policy-values.mts --sheet=${TO} --apply`);
