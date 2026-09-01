/**
 * **공급사 시트 탭 규격 통일** — 규격 밖 탭을 지우고, 기계용 열을 숨긴다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21
 *   「각 공급사들 탭 규격이 같아야 하는데 재고탭이랑 운영정책 공지사항 회사정보 이거만 있을거야」
 *   「아 니가 보는 탭은 남겨야지 당연히」 → 숨김 탭(AI 인계·작성 안내·AI 운영 매뉴얼)은 남긴다.
 *   「정책uid랑 정책코드는 숨기는게 낫지 공급사가 혼선오것다」 → 열을 숨긴다(지우지 않는다).
 *
 * ★공급사가 보는 탭 = **재고 · 운영정책 · 공지사항 · 회사정보** 넷.
 *   관계사(경진·빌린카·스타)는 회사별로 재고·정책이 두 벌인 것이 정상이고, 손오공은 렌트+구독 두 벌이 정상이다.
 *   그래서 «이름이 정확히 넷»이 아니라 **«재고/정책/공지/회사정보 갈래에 속하는가»**로 판정한다.
 *
 * ★지우는 것은 「상품시트」뿐이다. 그 밖에 규격 밖 탭이 보이면 **목록에만 남긴다** —
 *   실측 2026-08-21 「아이카종합의 사본」은 1,878줄짜리 옛 재고다. 지우면 못 되찾는다.
 *   한 줄 수식이던 「차종마스터」와 다르다.
 * ⚠ 「상품시트」는 `run-daily` ⓪·④ 에서 **발행 단계를 먼저 뺐다**(2026-08-21).
 *   그걸 안 빼고 탭만 지우면 다음 날 되살아난다.
 *
 * ★숨기는 열 — 「정책UID」·「정책코드」. **지우지 않는다.** 기계가 조인에 쓰는 열이라
 *   지우면 정책이 통째로 끊긴다. 공급사 눈에서만 치운다.
 *
 *   npx tsx scripts/unify-supplier-tabs.mts
 *   npx tsx scripts/unify-supplier-tabs.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel, SUPPLIER_PREVIEW_TAB } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** 공급사가 보는 갈래 — 이름이 아니라 갈래로 본다(관계사·구독은 두 벌이 정상). */
const VISIBLE_KIND = [/재고/, /정책/, /공지사항/, /회사정보/];
/** 지워도 되는 탭 — 기계가 다시 만들 수 있고, 담긴 값이 사본이다. */
const DROP = [SUPPLIER_PREVIEW_TAB];
/** 공급사 눈에서 치울 열(지우지 않는다). */
const HIDE_COLUMNS = ['정책UID', '정책코드'];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 140)}`);
  }
};
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));

type Drop = { label: string; id: string; tab: string; sheetId: number };
type Hide = { label: string; id: string; tab: string; sheetId: number; col: number; name: string };
const drops: Drop[] = [];
const hides: Hide[] = [];
const strays: string[] = [];
const retired: string[] = [];

for (const b of books) {
  if (/구버전|폐기/.test(b.label)) { retired.push(b.label); continue; }
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const p of ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec)) {
    const tab = S(p.title);
    const sheetId = Number(p.sheetId);
    if (DROP.includes(tab)) { drops.push({ label: b.label, id: b.id, tab, sheetId }); continue; }
    // 숨김 탭은 우리 것 — 규격 판정에서 뺀다(사장님 「니가 보는 탭은 남겨야지」).
    if (p.hidden) continue;
    if (!VISIBLE_KIND.some((re) => re.test(tab))) { strays.push(`${b.label} 「${tab}」`); continue; }

    // ── 정책 탭이면 기계용 열을 숨긴다
    if (!/정책/.test(tab)) continue;
    let head: string[];
    try { head = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!1:1`)}`)).values || [[]]) as string[][])[0].map(S); } catch { continue; }
    head.forEach((h, i) => {
      if (HIDE_COLUMNS.some((w) => norm(w) === norm(h))) hides.push({ label: b.label, id: b.id, tab, sheetId, col: i, name: h });
    });
  }
}

console.log(`\n■ 공급사 시트 탭 규격 통일 — ${APPLY ? '반영' : 'dry-run'}`);
console.log(`  지울 탭 ${drops.length} · 숨길 열 ${hides.length} · 규격 밖(안 건드림) ${strays.length} · 폐기 시트 건너뜀 ${retired.length}\n`);
if (drops.length) { console.log('  ── 지울 탭'); for (const d of drops) console.log(`   ${d.label.slice(0, 12).padEnd(14)} 「${d.tab}」 gid=${d.sheetId}`); }
if (hides.length) {
  console.log('\n  ── 숨길 열 (지우지 않는다 — 기계가 조인에 쓴다)');
  for (const h of hides) console.log(`   ${h.label.slice(0, 12).padEnd(14)} 「${h.tab.slice(0, 12).padEnd(13)}」 ${colA1(h.col)}열 「${h.name}」`);
}
if (strays.length) {
  console.log(`\n  ⚠ 규격 밖인데 **안 지웠다** ${strays.length} — 값이 들어 있을 수 있다. 사람이 보고 정한다.`);
  for (const s of strays) console.log(`     ${s}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/unify-tabs-${stamp}.json`;
writeFileSync(backup, JSON.stringify({ drops, hides, strays }, null, 2));
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 했다. 반영은 --apply · 목록 ${backup}\n`); process.exit(0); }

for (const d of drops) {
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${d.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: d.sheetId } }] }) });
}
const byBook = new Map<string, Rec[]>();
for (const h of hides) {
  const list = byBook.get(h.id) || [];
  list.push({ updateDimensionProperties: { range: { sheetId: h.sheetId, dimension: 'COLUMNS', startIndex: h.col, endIndex: h.col + 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
  byBook.set(h.id, list);
}
for (const [id, requests] of byBook) await call(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });

const LOG = 'docs/수정이력-공급사시트.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 공급사 시트\n\n> 기계가 공급사 시트 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = [
  ``,
  `## ${when} · 탭 규격 통일 — 「상품시트」 삭제 · 정책UID·정책코드 숨김`,
  ``,
  `도구 \`scripts/unify-supplier-tabs.mts --apply\` · 목록 \`${backup}\``,
  `공급사가 보는 탭 = **재고 · 운영정책 · 공지사항 · 회사정보**. 숨김 탭(AI 인계·작성 안내·AI 운영 매뉴얼)은 남겼다.`,
  `지운 탭 **${drops.length}**(상품시트) · 숨긴 열 **${hides.length}**(정책UID·정책코드 — 지우지 않았다, 기계가 조인에 쓴다)`,
  `⚠ 「상품시트」는 run-daily ⓪·④ 에서 발행 단계를 먼저 뺐다 — 안 빼면 다음 날 되살아난다.`,
  strays.length ? `\n안 건드린 규격 밖 탭 ${strays.length}: ${strays.join(' · ')}` : '',
  ``,
].join('\n');
const marker = '> 기계가 공급사 시트 구조를';
const cut = head.indexOf(marker);
const insertAt = cut >= 0 ? head.indexOf('\n', cut) + 1 : head.length;
writeFileSync(LOG, head.slice(0, insertAt) + body + head.slice(insertAt));

console.log(`\n■ 끝 — 탭 ${drops.length}개 지움 · 열 ${hides.length}개 숨김. 이력 ${LOG}\n`);
