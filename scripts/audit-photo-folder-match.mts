/**
 * **차량번호 ↔ 사진 폴더 대조** — 공급사 시트의 「사진링크」가 그 차의 폴더를 가리키는지 본다. 읽기 전용.
 *
 * ★사장님 2026-08-20 「구글드라이브 차량번호 매칭 다시 해야 할 듯하네 — 사진이 다 잘못 매칭된 것 같아 · 35우0775 대표적인 게 이거 하나 걸렸음」.
 *   판정: freepasspics 아래 차량 폴더 이름은 「<차량번호> <모델>」이다. 시트 사진링크의 폴더 id 를 폴더 이름과 맞춰 본다.
 *     맞음      — 폴더 이름의 차량번호 = 그 줄의 차량번호
 *     어긋남    — 폴더 이름이 **다른 차량번호**다(사진이 남의 차)
 *     이름없음  — 폴더 이름에 차량번호가 없다(사람이 만든 폴더 등)
 *     폴더없음  — 링크가 가리키는 폴더를 못 찾는다(삭제·권한)
 *     외부링크  — 드라이브가 아닌 주소(모드렌터카·홈페이지)
 *   결과 tmp/photo-folder-match.json · 어긋난 줄은 --fix --apply 로 그 차의 «제 폴더»가 있으면 링크를 바꾼다.
 *
 *   npx tsx scripts/audit-photo-folder-match.mts
 *   npx tsx scripts/audit-photo-folder-match.mts --fix --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const P = (v: unknown) => S(v).replace(/\s/g, '');
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const FIX = process.argv.includes('--fix');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if (r.status === 404) return { _notFound: true };
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 4_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const PICS_ROOT = '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';
const PLATE = /(\d{2,3}[가-힣]\d{4})/;
const folderId = (url: string) => (S(url).match(/\/folders\/([A-Za-z0-9_-]+)/) || [])[1] || '';

// ── freepasspics 전체 폴더 훑기(공급사 폴더 → 차량 폴더)
const listChildren = async (parent: string): Promise<Rec[]> => {
  const out: Rec[] = [];
  let token = '';
  do {
    const q = encodeURIComponent(`'${parent}' in parents and trashed = false`);
    const res = await call(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&includeItemsFromAllDrives=true&supportsAllDrives=true${token ? `&pageToken=${token}` : ''}`);
    out.push(...((res.files || []) as Rec[]));
    token = S(res.nextPageToken);
  } while (token);
  return out;
};
const providerFolders = (await listChildren(PICS_ROOT)).filter((f) => S(f.mimeType).includes('folder'));
const byFolderId = new Map<string, { name: string; provider: string; plate: string }>();
const byPlate = new Map<string, { id: string; name: string; provider: string }[]>();
for (const pf of providerFolders) {
  for (const car of await listChildren(S(pf.id))) {
    if (!S(car.mimeType).includes('folder')) continue;
    const plate = P((S(car.name).match(PLATE) || [])[1] || '');
    byFolderId.set(S(car.id), { name: S(car.name), provider: S(pf.name), plate });
    if (plate) { const list = byPlate.get(plate) || []; list.push({ id: S(car.id), name: S(car.name), provider: S(pf.name) }); byPlate.set(plate, list); }
  }
}
console.log(`■ freepasspics — 공급사 폴더 ${providerFolders.length} · 차량 폴더 ${byFolderId.size}(차량번호 있는 것 ${byPlate.size})`);

/** freepasspics 밖 폴더 — Drive 에 직접 물어 이름을 본다(한 번 물으면 기억한다). */
const resolved = new Map<string, { name: string; provider: string; plate: string } | null>();
async function resolveFolder(id: string) {
  if (resolved.has(id)) return resolved.get(id) || undefined;
  const res = await call(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,trashed&supportsAllDrives=true`);
  if (res._notFound || !S(res.name)) { resolved.set(id, null); return undefined; }
  const name = S(res.name);
  const rec = { name, provider: '(공급사 드라이브)', plate: P((name.match(PLATE) || [])[1] || '') };
  resolved.set(id, rec);
  return rec;
}

// ── 공급사 시트 사진링크 대조
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));
const rows: Rec[] = []; const tally: Rec = {};
for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
  const fixes: { range: string; values: string[][] }[] = [];
  for (const p of tabs) {
    const title = S(p.title);
    const v = await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const table = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = table.findIndex((r) => r.includes('차량번호') && r.some((c) => norm(c) === '차명(세부모델+트림)')); if (hi < 0) continue;
    const h = table[hi]; const pi = h.findIndex((c) => norm(c) === '차량번호'); const li = h.findIndex((c) => norm(c) === '사진링크');
    if (pi < 0 || li < 0) continue;
    for (const [k, r] of table.slice(hi + 1).entries()) {
      const plate = P(r[pi]); if (!plate) continue;
      const link = S(r[li]);
      let verdict = ''; let detail = '';
      if (!link) verdict = '링크없음';
      else if (!/drive\.google\.com/.test(link)) { verdict = '외부링크'; detail = link.slice(0, 60); }
      else {
        const id = folderId(link);
        if (!id) { verdict = '폴더아님'; detail = link.slice(0, 60); }
        else {
          // freepasspics 밖(공급사 자기 드라이브) 폴더도 이름으로 판정한다 — 리더스는 「125호1238」, 렌트존은 「베뉴」처럼 적는다.
          const folder = byFolderId.get(id) || await resolveFolder(id);
          if (!folder) { verdict = '폴더못봄'; detail = id; }
          else if (!folder.plate) { verdict = folder.provider === '(공급사 드라이브)' ? '공급사폴더(번호없음)' : '이름없음'; detail = folder.name; }
          else if (folder.plate === plate) verdict = '맞음';
          else { verdict = '어긋남'; detail = `폴더 「${folder.name}」(${folder.provider})`; }
        }
      }
      tally[verdict] = (tally[verdict] || 0) + 1;
      if (verdict !== '맞음') {
        const own = byPlate.get(plate) || [];
        rows.push({ sheet: b.label, tab: title, row: hi + 2 + k, plate, verdict, detail, ownFolder: own[0] ? `${own[0].name} (${own[0].id})` : '' });
        if (FIX && verdict === '어긋남' && own.length === 1) {
          fixes.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(li)}${hi + 2 + k}`, values: [[`https://drive.google.com/drive/folders/${own[0].id}`]] });
        }
      }
    }
  }
  if (APPLY && FIX && fixes.length) {
    await call(`${SH}/${b.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: fixes }) });
    console.log(`   ✓ ${b.label} 잘못된 링크 ${fixes.length}칸 고침`);
  }
}
console.log(`■ 판정 ${JSON.stringify(tally)}`);
const wrong = rows.filter((r) => r.verdict === '어긋남');
console.log(`\n■ 남의 차 폴더를 가리키는 줄 ${wrong.length}`);
for (const r of wrong.slice(0, 30)) console.log(`   ${r.plate.padEnd(10)} ${r.sheet}/${r.tab} ${r.row}행 → ${r.detail}${r.ownFolder ? ` · 제 폴더 있음: ${r.ownFolder}` : ' · 제 폴더 없음'}`);
const noFolder = rows.filter((r) => r.verdict === '폴더없음');
if (noFolder.length) console.log(`\n■ 링크가 가리키는 폴더를 못 찾음 ${noFolder.length}: ${noFolder.slice(0, 12).map((r) => `${r.plate}(${r.sheet})`).join(' · ')}`);
const noName = rows.filter((r) => r.verdict === '이름없음');
if (noName.length) console.log(`\n■ 폴더 이름에 차량번호가 없음 ${noName.length}: ${noName.slice(0, 12).map((r) => `${r.plate}→${r.detail}`).join(' · ')}`);
writeFileSync('tmp/photo-folder-match.json', JSON.stringify({ at: new Date().toISOString(), tally, rows }, null, 1));
console.log(`\n보고 tmp/photo-folder-match.json${FIX ? '' : ' · 고치려면 --fix --apply'}`);
