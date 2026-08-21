/**
 * **재고 탭 「정책코드」 빈 칸을 «확실할 때만» 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21 「정책코드에 확인된 건 니가 다 채워넣어」.
 *   정책코드가 비면 그 차는 **정책 칸이 통째로 빈다**(심사조건·연령·보험·21세+…).
 *   실측 2026-08-21: 그런 차 67대(빌린카 45·손오공 14·스타 5·경진 3).
 *
 * ★채우는 기준 — «후보가 하나로 좁혀질 때만». 짐작하면 남의 조건을 달게 된다.
 *   ① 그 시트(그 탭이 속한 회사)의 정책이 **한 벌**이면 그것
 *   ② 여러 벌이면 **분류(중고구독/중고렌트/신차렌트)와 정책명**이 맞는 것이 하나일 때만
 *      (「빌린카구독」은 구독 줄에만 · 「…렌트」는 렌트 줄에만)
 *   그래도 둘 이상이면 **안 채운다.** 목록으로 남겨 사람이 고른다.
 * ★「(프리패스 기본)」은 후보에서 뺀다 — 그건 우리 표준값이지 그 집 조건이 아니다.
 *
 *   npx tsx scripts/fill-policy-code.mts
 *   npx tsx scripts/fill-policy-code.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel, POLICY_TAB_ALIASES, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 120)}`);
  }
};
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
/** 정책 탭 이름 ↔ 재고 탭 이름을 잇는 말(관계사 문서는 「빌린카…」·「엘씨…」로 갈린다). */
const brandOf = (tab: string) => norm(tab).replace(/운영정책|정책|재고/g, '');

type Left = { 공급사: string; 탭: string; 차번: string; 분류: string; 후보: string };
const left: Left[] = [];
let filled = 0;

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));

for (const b of books) {
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(title,hidden)`);
  const props = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec);
  // ── 이 문서의 정책들: 브랜드 글자 → [{코드, 이름}]
  const byBrand = new Map<string, { code: string; name: string }[]>();
  for (const p of props) {
    const tab = S(p.title); if (!POLICY_TAB_ALIASES.some((a: string) => tab.includes(a))) continue;
    const rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!A1:B60`)}`)).values || []) as string[][]);
    const list = rows.slice(1).map((r) => ({ code: S(r[0]), name: S(r[1]) })).filter((x) => x.code && !/프리패스 기본/.test(x.code));
    if (list.length) byBrand.set(brandOf(tab), list);
  }
  if (!byBrand.size) continue;

  for (const p of props) {
    const tab = S(p.title); if (p.hidden || isOurNonInventoryTab(tab) || !/재고/.test(tab) || /상품시트/.test(tab)) continue;
    const rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!A1:BZ700`)}`)).values || []) as string[][]);
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호')); if (hi < 0) continue;
    const h = rows[hi].map(norm);
    const pi = h.indexOf('차량번호'); const ci = h.indexOf('정책코드'); const gi = h.indexOf('분류');
    if (pi < 0 || ci < 0) continue;
    // 이 재고 탭과 짝인 정책 목록 — 브랜드 글자가 같은 것, 없으면 이 문서의 유일한 정책 묶음
    const brand = brandOf(tab);
    const pool = byBrand.get(brand) || (byBrand.size === 1 ? [...byBrand.values()][0] : []);
    const data: { range: string; values: string[][] }[] = [];
    rows.slice(hi + 1).forEach((r, k) => {
      const plate = norm(r[pi]); if (!plate || S(r[ci])) return;
      const kind = gi >= 0 ? S(r[gi]) : '';
      let cands = pool;
      if (cands.length > 1 && kind) {
        const wantSub = /구독/.test(kind);
        const narrowed = cands.filter((c) => (/구독/.test(c.name) ? wantSub : !wantSub));
        if (narrowed.length) cands = narrowed;
      }
      if (cands.length !== 1) { left.push({ 공급사: b.label, 탭: tab, 차번: plate, 분류: kind, 후보: cands.map((c) => `${c.code}(${c.name})`).join(' · ') || '(정책 없음)' }); return; }
      data.push({ range: `'${tab.replace(/'/g, "''")}'!${colA1(ci)}${hi + 2 + k}`, values: [[cands[0].code]] });
    });
    if (!data.length && !left.length) continue;
    if (data.length) {
      filled += data.length;
      console.log(`  ${b.label.slice(0, 10).padEnd(12)} 「${tab.slice(0, 10).padEnd(11)}」 채울 ${data.length}칸 → ${S(data[0].values[0][0])}`);
      if (APPLY) await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
    }
  }
}
writeFileSync('tmp/policy-code-left.json', JSON.stringify(left, null, 2));
const byWho = new Map<string, number>();
for (const l of left) byWho.set(`${l.공급사} 「${l.탭}」`, (byWho.get(`${l.공급사} 「${l.탭}」`) || 0) + 1);
console.log(`\n■ 채운 칸 ${filled} ${APPLY ? '(반영됨)' : '(dry-run)'} · 못 정한 차 ${left.length}`);
for (const [k, n] of [...byWho].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`   ${String(n).padStart(3)}대  ${k}`);
if (left.length) console.log('   예:', left.slice(0, 3).map((l) => `${l.차번}[${l.분류}] 후보 ${l.후보.slice(0, 60)}`).join(' / '));
