/**
 * **정책 탭에 「21세+」·「23세+」 열을 만들고 옛 값을 살린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21 「21세 23세 금액이 다른 곳이 꽤 있는데 왜 다 같지 · 예전 시트에 값이 다 있는데 살려줘」.
 *   지금 정책엔 「연령 하향 요금」 **한 칸**뿐이라 두 나이가 같은 값으로 나갔다.
 *   옛 「프리패스 공급사 상품리스트」(1BcHvwid…) 24탭 실측 — 손오공·센트로·리더스 10/7 · 빌린카 12/7 ·
 *   엘씨 20/15 · 에스에이 15/10 · 경진카 불가/10. 그 값을 공급사별로 되살린다.
 *
 * ★정책 탭은 **가로가 항목**이다(재고 탭과 반대). 그래서 «열»을 끼운다 —
 *   `add-policy-rows`(세로 가정)를 쓰면 49개 항목을 통째로 끼우려 든다. 쓰지 마라.
 * ★열은 「연령 하향 요금」 **바로 뒤**에 넣는다. 값은 **빈 칸만** 채운다(사람이 적어 둔 값을 안 덮는다).
 * ⚠ 값 종류가 여러 개인 공급사(정책이 여러 벌)는 **최빈값**을 넣고 목록에 표시한다 — 정책코드별로는 사람이 본다.
 *
 *   npx tsx scripts/add-age-policy-columns.mts
 *   npx tsx scripts/add-age-policy-columns.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel, POLICY_TAB_ALIASES } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** 옛 시트 탭 이름 → 지금 공급사 시트 라벨(+정책 탭 글자). 이름이 갈린 것만 적는다. */
const OLD_TO_NOW: Record<string, string[]> = {
  리더스렌트카: ['리더스'], 에스에이렌터카: ['에스에이'], 우리캐피탈렌터카: ['우리캐피탈'],
  제이앤제이렌트카: ['제이앤제이렌트카'], 에코렌트카: ['에코렌트카'], 경진렌트카: ['경진카|경진렌트'],
  경진카: ['경진카|경진카운영정책'], 빌린카: ['빌린카|빌린카운영정책'], 엘씨렌트: ['빌린카|엘씨운영정책'],
  빌린카구독: [], 스위치: ['스위치플랜'], 손오공: ['손오공'], 센트로: ['센트로'], 렌트존: ['렌트존'],
  아이카: ['아이카'], 아이언: ['아이언'], 스타: ['스타|스타운영정책'], 연카: ['연카'], KH: ['KH'],
  웰릭스: ['웰릭스'], 에이스: [], 종합: [],
};
/** 「10」·「3만」·「10만원」 → 「10만원」. 「불가」·「협의」는 그대로. */
const money = (v: string): string => {
  const t = S(v);
  if (!t || /불가|협의|없음/.test(t)) return t;
  if (/%/.test(t)) return t;
  const n = t.replace(/[^0-9.]/g, '');
  return n ? `${n}만원` : '';
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 140)}`);
  }
};
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

// ── 옛 시트에서 공급사별 21/23 값 ────────────────────────────────────────────
const OLD = '1BcHvwidHrdJADPUH0M3C5abaxst04fDnfxm7R9FgLDg';
const oldMeta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${OLD}?fields=sheets.properties(title)`);
type Old = { a21: string; a23: string; kinds: string };
const oldVals = new Map<string, Old>();
for (const t of ((oldMeta.sheets || []) as Rec[]).map((s) => S(s.properties?.title))) {
  let rows: string[][]; try { rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${OLD}/values/${encodeURIComponent(`${t}!A1:BZ300`)}`)).values || []) as string[][]); } catch { continue; }
  const hi = rows.findIndex((r) => r.some((c) => /^2[13]세/.test(norm(c)))); if (hi < 0) continue;
  const hdr = rows[hi].map(norm);
  const a1 = hdr.findIndex((c) => /^21세/.test(c)); const a2 = hdr.findIndex((c) => /^23세/.test(c));
  const c1 = new Map<string, number>(); const c2 = new Map<string, number>();
  for (const r of rows.slice(hi + 1)) { const v1 = S(r[a1]); const v2 = S(r[a2]); if (v1) c1.set(v1, (c1.get(v1) || 0) + 1); if (v2) c2.set(v2, (c2.get(v2) || 0) + 1); }
  const top = (m: Map<string, number>) => ([...m].sort((a, b) => b[1] - a[1])[0]?.[0] || '');
  if (c1.size || c2.size) oldVals.set(t, { a21: money(top(c1)), a23: money(top(c2)), kinds: `${c1.size}/${c2.size}` });
}
console.log(`■ 옛 시트에서 거둔 공급사 ${oldVals.size}곳\n`);

// ── 지금 정책 탭에 열 만들고 값 채우기 ───────────────────────────────────────
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));

/** 이 정책 탭에 쓸 옛 값 찾기 — 라벨(+탭 글자)로 잇는다. */
const oldFor = (label: string, tab: string): Old | undefined => {
  for (const [oldTab, keys] of Object.entries(OLD_TO_NOW)) {
    for (const k of keys) {
      const [lab, tabHint] = k.split('|');
      if (!label.includes(lab)) continue;
      if (tabHint && !tab.includes(tabHint.replace('운영정책', ''))) continue;
      return oldVals.get(oldTab);
    }
  }
  return oldVals.get(label) || [...oldVals].find(([k]) => k.includes(label) || label.includes(k))?.[1];
};

let madeCols = 0, filled = 0;
for (const b of books) {
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const p of ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec)) {
    const tab = S(p.title); if (!POLICY_TAB_ALIASES.some((a: string) => tab.includes(a))) continue;
    const gid = Number(p.sheetId);
    let rows: string[][]; try { rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!A1:CZ60`)}`)).values || []) as string[][]); } catch { continue; }
    if (!rows.length) continue;
    let hdr = rows[0].map(S);
    const feeAt = hdr.findIndex((h) => norm(h) === '연령하향요금');
    if (feeAt < 0) { console.log(`  ⚠ ${b.label} 「${tab}」 — 「연령 하향 요금」 열이 없다. 건너뜀`); continue; }
    const need = ['21세+', '23세+'].filter((n) => !hdr.some((h) => norm(h) === norm(n)));
    const old = oldFor(b.label, tab);
    // ① 열 끼우기
    if (need.length && APPLY) {
      await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ insertDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: feeAt + 1, endIndex: feeAt + 1 + need.length }, inheritFromBefore: true } }] }),
      });
      await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!${colA1(feeAt + 1)}1:${colA1(feeAt + need.length)}1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [need] }) });
      rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!A1:CZ60`)}`)).values || []) as string[][]);
      hdr = rows[0].map(S);
    }
    madeCols += need.length;
    // ② 값 채우기(빈 칸만)
    const at21 = hdr.findIndex((h) => norm(h) === '21세+'); const at23 = hdr.findIndex((h) => norm(h) === '23세+');
    const data: { range: string; values: string[][] }[] = [];
    if (old && at21 >= 0 && at23 >= 0) {
      for (let i = 1; i < rows.length; i++) {
        const code = S(rows[i][0]); if (!code) continue;
        if (old.a21 && !S(rows[i][at21])) data.push({ range: `'${tab.replace(/'/g, "''")}'!${colA1(at21)}${i + 1}`, values: [[old.a21]] });
        if (old.a23 && !S(rows[i][at23])) data.push({ range: `'${tab.replace(/'/g, "''")}'!${colA1(at23)}${i + 1}`, values: [[old.a23]] });
      }
    }
    filled += data.length;
    console.log(`  ${b.label.slice(0, 10).padEnd(12)} 「${tab.slice(0, 12).padEnd(13)}」 열 ${need.length ? need.join('·') : '있음'} · 옛값 ${old ? `21세+ ${old.a21 || '-'} / 23세+ ${old.a23 || '-'}${old.kinds !== '1/1' ? ` (값 종류 ${old.kinds} — 사람 확인)` : ''}` : '(못 찾음)'} · 채울 칸 ${data.length}`);
    if (APPLY && data.length) await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  }
}
console.log(`\n■ 만든 열 ${madeCols} · 채운 칸 ${filled} ${APPLY ? '(반영됨)' : '(dry-run — 열은 --apply 때 만들어지고, 그때 채울 칸 수가 잡힌다)'}\n`);
