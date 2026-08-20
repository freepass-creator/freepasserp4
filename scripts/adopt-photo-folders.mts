/**
 * **남의 계정에 있는 차량 사진을 우리 드라이브(freepasspics)로 가져온다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 — 사장님 2026-08-20 「tbag4783@·freepasslhm@ 여기 거는 우리 거로 다 복사해 오자」.
 *   시트 사진링크가 가리키는 폴더의 임자가 직원·공급사 **개인 지메일**이면, 그 사람이 지우거나
 *   공유를 끊는 순간 매물 사진이 통째로 사라진다. 실측 2026-08-20 — 그런 차가 193대였다.
 *
 * ★**차번이 맞는 것만 가져온다.** 폴더 이름 맨 앞 차번이 그 줄 차번과 같아야 한다
 *   (`publish-plate-links` 문지기와 같은 기준). 아니면 건너뛰고 이유를 적는다 — 남의 차 사진을
 *   우리 드라이브에 박아 넣으면 되돌리기가 더 어렵다.
 * ★**서버끼리 복사한다**(`files/copy`) — 내려받았다 올리지 않는다. 원본은 건드리지 않는다.
 * ★같은 이름 파일이 이미 있으면 건너뛴다 — 두 번 돌려도 사본이 안 생긴다.
 * ★가져온 뒤 시트의 사진링크와 차량번호 셀 링크를 **새 폴더로 바꾼다**(둘이 같아진다).
 *
 *   npx tsx scripts/adopt-photo-folders.mts --owner=tbag4783@gmail.com,freepasslhm@gmail.com
 *   npx tsx scripts/adopt-photo-folders.mts --owner=… --apply
 *   npx tsx scripts/adopt-photo-folders.mts --owner=… --who=스타 --apply   (한 공급사만)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const APPLY = process.argv.includes('--apply');
const WHO = arg('who');
const LIMIT = Number(arg('limit') || '0');
const OWNERS = new Set(arg('owner').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
/** 사람이 사진을 보고 «이 차가 아니다»라고 가른 차번은 가져오지 않는다. */
const SKIP = new Set(arg('skip').split(',').map((s) => s.trim()).filter(Boolean));
const PICS = arg('pics') || '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';
if (!OWNERS.size) { console.log('■ --owner=someone@gmail.com[,other@gmail.com] 가 필요하다\n'); process.exit(1); }

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(Math.min(60_000, 3_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const EXTRA = 'includeItemsFromAllDrives=true&supportsAllDrives=true';
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const isUrl = (v: string) => /^https?:\/\//i.test(S(v));
const driveIdOf = (u: string) => (/drive\.google\.com|docs\.google\.com/i.test(S(u)) ? (S(u).match(/\/(?:folders|d)\/([\w-]{15,})/) || S(u).match(/[?&]id=([\w-]{15,})/) || [])[1] || '' : '');
const PLATE_IN = /(\d{2,3}[가-힣]\d{4})/;
const linkOf = (c: Rec | undefined): string => {
  if (!c) return '';
  if (S(c.hyperlink)) return S(c.hyperlink);
  for (const r of (c.textFormatRuns || []) as Rec[]) { const u = S(r.format?.link?.uri); if (u) return u; }
  const u2 = S(c.userEnteredFormat?.textFormat?.link?.uri); if (u2) return u2;
  for (const r of (c.chipRuns || []) as Rec[]) { const u = S(r.chip?.richLinkProperties?.uri); if (u) return u; }
  return '';
};
const ls = async (parent: string) => {
  const out: Rec[] = []; let page = '';
  do {
    const r = await call(`${DRIVE}?q=${encodeURIComponent(`'${parent}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&${EXTRA}${page ? `&pageToken=${page}` : ''}`);
    out.push(...((r.files || []) as Rec[])); page = S(r.nextPageToken);
  } while (page);
  return out;
};
/** 폴더 아래 사진을 모은다(하위 폴더 두 겹까지). */
const shotsIn = async (id: string, depth = 0): Promise<Rec[]> => {
  const kids = await ls(id); const out: Rec[] = [];
  for (const k of kids) {
    if (S(k.mimeType).includes('folder')) { if (depth < 2) out.push(...(await shotsIn(S(k.id), depth + 1))); }
    else if (/^image\//i.test(S(k.mimeType))) out.push(k);
  }
  return out;
};

// ── 프리패스픽스 공급사 폴더 ─────────────────────────────────────────────────
const picFolders = (await ls(PICS)).filter((f) => S(f.mimeType).includes('folder'));
const folderByName = new Map<string, string>();
for (const f of picFolders) folderByName.set(norm(f.name), S(f.id));
/** 시트 이름 → 프리패스픽스 폴더. 같지 않아 «품고 있나»로 맞춘다(에스에이→SA 처럼 다른 것은 별칭). */
const ALIAS: Record<string, string> = { 에스에이: 'SA', 손오공: '손오공렌터카', 우리캐피탈: '우리캐피탈렌터카', 제이앤제이렌트카: 'J&J렌트카' };
const pickSupplierFolder = (label: string) => {
  const c = norm(ALIAS[norm(label)] || label);
  if (folderByName.has(c)) return { name: ALIAS[norm(label)] || label, id: folderByName.get(c)! };
  for (const [key, id] of folderByName) if (key.length >= 2 && (c.includes(key) || key.includes(c))) return { name: key, id };
  return { name: label, id: '' };   // 없으면 만든다
};
const ensureFolder = async (name: string, parent: string) => {
  const q = `'${parent}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = await call(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)&${EXTRA}`);
  if ((found.files || []).length) return S(found.files[0].id);
  const made = await call(`${DRIVE}?${EXTRA}`, { method: 'POST', body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
  return S(made.id);
};

// ── 시트에서 «남의 계정 폴더를 가리키는 줄» 찾기 ─────────────────────────────
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
let books = (((await call(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&${EXTRA}`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));

type Job = { book: string; bookId: string; label: string; tab: string; gid: number; rn: number; pi: number; li: number; plate: string; model: string; srcId: string; srcName: string; owner: string };
const jobs: Job[] = []; const skipped: string[] = [];
const metaCache = new Map<string, Rec>();
const askDrive = async (id: string) => {
  if (metaCache.has(id)) return metaCache.get(id)!;
  let m: Rec = {};
  try { m = await call(`${DRIVE}/${id}?fields=id,name,mimeType,trashed,owners(emailAddress)&${EXTRA}`); } catch { m = {}; }
  metaCache.set(id, m); return m;
};

for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((p) => p.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
  for (const p of tabs) {
    const title = S(p.title); const gid = Number(p.sheetId);
    const grid = await call(`${SH}/${b.id}?ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}&includeGridData=true&fields=${encodeURIComponent('sheets(data(rowData(values(formattedValue,hyperlink,textFormatRuns(format(link)),userEnteredFormat(textFormat(link)),chipRuns(chip(richLinkProperties(uri)))))))')}`);
    const rows = ((((grid.sheets || []) as Rec[])[0]?.data || [])[0]?.rowData || []).map((r: Rec) => ((r.values || []) as Rec[]));
    const hi = rows.findIndex((r: Rec[]) => r.some((c) => norm(c.formattedValue) === '차량번호')); if (hi < 0) continue;
    const hdr = rows[hi].map((c: Rec) => norm(c.formattedValue));
    const pi = hdr.indexOf('차량번호'); const li = hdr.indexOf('사진링크'); const mi = hdr.indexOf('모델명'); const ci = hdr.findIndex((h) => h.startsWith('차명'));
    if (pi < 0 || li < 0) continue;
    for (let k = hi + 1; k < rows.length; k++) {
      const r = rows[k]; const plate = S(r[pi]?.formattedValue); if (!plate) continue;
      const url = isUrl(S(r[li]?.formattedValue)) ? S(r[li]?.formattedValue) : linkOf(r[pi]);
      const id = driveIdOf(url); if (!id) continue;
      const m = await askDrive(id);
      const owner = S((m.owners || [])[0]?.emailAddress).toLowerCase();
      if (!OWNERS.has(owner)) continue;
      const name = S(m.name);
      if (SKIP.has(plate)) { skipped.push(`${b.label} ${plate} 사람이 뺀 차(사진이 그 차가 아님)`); continue; }
      if (!S(m.mimeType).includes('folder')) { skipped.push(`${b.label} ${plate} 폴더가 아님`); continue; }
      const inName = (name.match(PLATE_IN) || [])[1] || '';
      if (norm(inName) !== norm(plate)) { skipped.push(`${b.label} ${plate} 폴더 차번이 다름(${name})`); continue; }
      const model = S(r[mi]?.formattedValue) || S(r[ci]?.formattedValue).split(/\s+/)[0] || name.replace(PLATE_IN, '').trim();
      jobs.push({ book: b.label, bookId: b.id, label: b.label, tab: title, gid, rn: k, pi, li, plate, model, srcId: id, srcName: name, owner });
    }
  }
}

console.log(`\n■ 우리 드라이브로 가져올 차 ${jobs.length}대 ${APPLY ? '(반영)' : '(dry-run)'}`);
const bySup = new Map<string, Job[]>();
for (const j of jobs) (bySup.get(j.label) || bySup.set(j.label, []).get(j.label)!).push(j);
for (const [sup, list] of [...bySup].sort((a, b) => b[1].length - a[1].length)) console.log(`   ${sup.padEnd(10)} ${String(list.length).padStart(3)}대  ${list.slice(0, 6).map((j) => j.plate).join(' · ')}${list.length > 6 ? ' …' : ''}`);
if (skipped.length) { console.log(`\n  ⚠ 건너뛴 줄 ${skipped.length}`); for (const s of skipped.slice(0, 10)) console.log(`     ${s}`); }
writeFileSync('tmp/adopt-jobs.json', JSON.stringify(jobs, null, 2));
if (!APPLY) { console.log('\n※ dry-run. 실제 복사는 --apply · 대상 목록 tmp/adopt-jobs.json\n'); process.exit(0); }

// ── 복사 ────────────────────────────────────────────────────────────────────
const done: Rec[] = [];
let copied = 0, already = 0, failed = 0, cars = 0;
const writesByBook = new Map<string, { vals: { range: string; values: string[][] }[]; reqs: Rec[] }>();
for (const j of (LIMIT ? jobs.slice(0, LIMIT) : jobs)) {
  const sup = pickSupplierFolder(j.label);
  const supId = sup.id || (await ensureFolder(sup.name, PICS));
  if (!sup.id) folderByName.set(norm(sup.name), supId);
  // 이미 그 차번 폴더가 있으면 거기에 넣는다 — 이름이 조금 달라도 차번이 열쇠다.
  const kids = (await ls(supId)).filter((f) => S(f.mimeType).includes('folder'));
  const hit = kids.find((f) => norm((S(f.name).match(PLATE_IN) || [])[1] || '') === norm(j.plate));
  const carName = `${j.plate} ${j.model}`.trim();
  const carId = hit ? S(hit.id) : await ensureFolder(carName, supId);
  const have = new Set((await ls(carId)).map((f) => S(f.name)));
  const shots = await shotsIn(j.srcId);
  cars++;
  for (const f of shots) {
    if (have.has(S(f.name))) { already++; continue; }
    try { await call(`${DRIVE}/${S(f.id)}/copy?${EXTRA}`, { method: 'POST', body: JSON.stringify({ name: S(f.name), parents: [carId] }) }); copied++; }
    catch (e) { failed++; console.log(`   ⚠ ${j.plate}/${S(f.name)} — ${(e as Error).message.slice(0, 100)}`); }
  }
  const url = `https://drive.google.com/drive/folders/${carId}`;
  const w = writesByBook.get(j.bookId) || { vals: [], reqs: [] };
  /**
   * ★탭 «이름»이 아니라 **탭 id(gid)** 로 쓴다 — 실측 2026-08-20: 사진을 다 옮겨 놓고 마지막 쓰기에서
   *   `Unable to parse range: '재고'!AC33` 로 죽었다. 그 사이 시트 탭 이름이 바뀌어 있었다
   *   (빌린카 「재고」 → 「빌린카재고」). id 는 이름이 바뀌어도 그대로다.
   */
  w.reqs.push({ updateCells: { range: { sheetId: j.gid, startRowIndex: j.rn, endRowIndex: j.rn + 1, startColumnIndex: j.li, endColumnIndex: j.li + 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: url } }] }], fields: 'userEnteredValue' } });
  w.reqs.push({ updateCells: { range: { sheetId: j.gid, startRowIndex: j.rn, endRowIndex: j.rn + 1, startColumnIndex: j.pi, endColumnIndex: j.pi + 1 }, rows: [{ values: [{ userEnteredFormat: { textFormat: { link: { uri: url } } } }] }], fields: 'userEnteredFormat.textFormat.link' } });
  writesByBook.set(j.bookId, w);
  done.push({ 공급사: j.label, 차번: j.plate, 원본: j.srcName, 임자: j.owner, 새폴더: carName, 사진: shots.length, 주소: url });
  console.log(`  ${String(cars).padStart(3)}/${jobs.length} ${j.label.padEnd(8)} ${j.plate.padEnd(10)} ${String(shots.length).padStart(3)}장 → freepasspics/${sup.name}/${hit ? S(hit.name) : carName}`);
}

// ── 시트 링크를 새 폴더로 ────────────────────────────────────────────────────
for (const [bookId, w] of writesByBook) {
  await call(`${SH}/${bookId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: w.reqs }) });
}
writeFileSync('tmp/adopted-photo-folders.json', JSON.stringify(done, null, 2));
console.log(`\n■ 끝 — 차 ${cars}대 · 복사 ${copied}장 · 이미 있어 건너뜀 ${already}장${failed ? ` · 실패 ${failed}장` : ''} · 시트 링크 ${done.length}줄 바꿈`);
console.log(`  기록 tmp/adopted-photo-folders.json · https://drive.google.com/drive/folders/${PICS}\n`);
