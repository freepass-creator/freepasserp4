/**
 * **정제칸이 «낡았나» — 원문과 어긋난 차를 센다.** 읽기 전용. 아무것도 안 고친다.
 *
 * ★사장님 2026-09-02 「원본에서 정제시트로 갖고 와서, 정제시트 걸 정제칸으로 갖고 오는 것부터
 *   자동화를 해야 **리프레시**가 되는 거 같애.」
 *
 * ── 지금 왜 리프레시가 안 되나 (실측으로 확인한 구조)
 *   `sync-mirror-sheet.mts:92-95` 가 칸을 셋으로 나눈다 —
 *     live : 매번 공급사를 따라간다(상태·요금)
 *     ours : 우리가 정한다(정제칸 11개·정책코드). **공급사가 못 덮는다**
 *     once : 처음 한 번만 옮겨온다(색·연식·차량가격)
 *   정제칸이 `ours` 라 **원본이 바뀌어도 안 따라가고**, 채우는 도구는 「빈 칸만」이라
 *   **이미 찬 칸을 다시 계산하지 않는다.** 그래서 한 번 박히면 그대로 굳는다.
 *
 * ── 그런데 규격은 이미 리프레시를 허용한다
 *   `supplier-template-sheet.ts:271-272` 외장·내장색상 = 「빈 칸은 채우고, **원문과 다르면 다시 맞춘다**」.
 *   즉 «다시 맞추는» 칸이 이미 있다. 넓히는 것은 규격 위반이 아니다.
 *
 * ⚠ **다만 무턱대고 넓히면 2026-08-28 사고가 재발한다** — fill 이 더 나쁜 매칭으로 덮어
 *   픽업 모델 135/341 이 사라졌다. 그래서 **덮기 전에 «얼마나 낡았나»부터 센다.**
 *   이 자는 세기만 한다. 고치는 것은 규모를 보고 사람이 정한다.
 *
 *   npx tsx scripts/report-refresh-gap.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const RETIRED = /구버전|폐기|안\s*씀|백업|복사본|test|샘플/i;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const call = async (u: string): Promise<Rec> => {
  for (let n = 1; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return JSON.parse(x);
    if ((r.status === 429 || r.status >= 500) && n <= 5) { await sleep(15_000 * n); continue; }
    throw new Error(`${r.status} ${x.slice(0, 160)}`);
  }
};

/** 글자를 견주기 좋게 — 공백·괄호·대소문자를 지운다. «포함»으로만 본다(정확일치는 너무 빡빡하다). */
const key = (v: unknown) => S(v).toLowerCase().replace(/[\s()[\]/·,._-]/g, '');

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const files = ((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`)).files || []) as Rec[];
const books = files.map((f) => ({ id: S(f.id), name: S(f.name), label: supplierSheetLabel(S(f.name)) || S(f.name) }))
  .filter((b) => !RETIRED.test(b.name))
  .sort((a, b) => a.label.localeCompare(b.label));

type Gap = { 공급사: string; 탭: string; 차번: string; 칸: string; 정제값: string; 원문: string };
const gaps: Gap[] = [];
let 총차 = 0; let 총칸 = 0;

console.log(`■ 정제칸 ↔ 원문 어긋남 — 시트 ${books.length}곳 (읽기 전용)`);
for (const b of books) {
  let meta: Rec;
  try { meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(title,hidden)`); }
  catch (e) { console.log(`  ✗ ${b.label} — 못 읽음: ${(e as Error).message.slice(0, 60)}`); continue; }
  let 차 = 0; let 어긋남 = 0;
  for (const sh of (meta.sheets || []) as Rec[]) {
    const tab = S(sh.properties?.title);
    if (sh.properties?.hidden || isOurNonInventoryTab(tab)) continue;
    let v: Rec;
    try { v = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(tab)}`); } catch { continue; }
    const rows = ((v.values || []) as string[][]); if (rows.length < 2) continue;
    const hi = rows.findIndex((r) => r.some((c) => /차량?번호|차번/.test(norm(c)))); if (hi < 0) continue;
    const hdr = rows[hi].map(norm);
    const at = (re: RegExp) => hdr.findIndex((h) => re.test(h));
    const pi = at(/차량?번호|차번/);
    /** 원문 차명 — 정제칸의 «근거»가 되는 글자. 시트마다 이름이 조금씩 다르다. */
    const ci = hdr.findIndex((h) => /^차명/.test(h) && !/정제/.test(h));
    const mi = hdr.findIndex((h) => h === '모델');
    const si = hdr.findIndex((h) => h === '세부모델');
    const ti = hdr.findIndex((h) => h === '세부트림');
    if (pi < 0 || ci < 0) continue;
    for (let r = hi + 1; r < rows.length; r++) {
      const plate = norm(rows[r][pi]); if (!/\d{2,3}[가-힣]\d{4}/.test(plate)) continue;
      const raw = S(rows[r][ci]); if (!raw) continue;   // 원문이 없으면 견줄 근거가 없다
      차 += 1;
      const rawKey = key(raw);
      /**
       * ★**「정제칸에 값이 있는데 그 말이 원문에 없다」만 센다.**
       *   빈 칸은 여기서 안 센다 — 그건 「아직 못 채운 것」이고 이미 따로 셌다(report-fill-todo).
       *   여기서 찾는 것은 «낡은 값» — 원문이 바뀌었는데 정제칸이 안 따라간 자리다.
       * ⚠ 세부모델은 세대코드(GN7·DN8)가 원문에 없는 게 정상이라 **모델 토막만** 견준다.
       */
      const 검사: [string, number][] = [['모델', mi], ['세부트림', ti]];
      for (const [name, idx] of 검사) {
        if (idx < 0) continue;
        const val = S(rows[r][idx]); if (!val || val === '-') continue;
        const head = key(val).split(/\s+/)[0];
        if (!head || head.length < 2) continue;
        if (rawKey.includes(head)) continue;                       // 원문에 그 말이 있다 — 정상
        if (si >= 0 && key(S(rows[r][si])).includes(head)) continue; // 세부모델이 품고 있으면 정상
        어긋남 += 1; 총칸 += 1;
        if (gaps.length < 4000) gaps.push({ 공급사: b.label, 탭: tab, 차번: plate, 칸: name, 정제값: val, 원문: raw.slice(0, 44) });
      }
    }
  }
  총차 += 차;
  if (어긋남) console.log(`  ${b.label.padEnd(16)} 차 ${String(차).padStart(4)} · 정제칸이 원문에 없는 자리 ${어긋남}`);
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/refresh-gap.json', JSON.stringify({ at: new Date().toISOString(), 총차, 총칸, gaps }, null, 1));
console.log(`\n■ 합계 — 차 ${총차}대 · 정제값이 원문에 없는 칸 ${총칸}개`);
const by = new Map<string, number>();
for (const g of gaps) by.set(g.칸, (by.get(g.칸) ?? 0) + 1);
for (const [k, n] of [...by.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(10)} ${n}개`);
console.log('\n■ 보기 (정제값 ← 원문)');
for (const g of gaps.slice(0, 12)) console.log(`   ${g.차번.padEnd(10)} ${g.칸.padEnd(7)} 「${g.정제값}」 ← 「${g.원문}」`);
console.log('\n기록 tmp/refresh-gap.json · 여기서 고치지 않는다 — 규모를 보여만 준다');
