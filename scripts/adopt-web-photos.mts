/**
 * **홈페이지에 있는 차량 사진을 우리 드라이브(freepasspics)로 가져온다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-20 「구글드라이브면 누구 거든 상관없어 · 아이언이랑 모드렌트카 쓰는 거는 우리 쪽으로
 *   갖고 와야지 · 구글드라이브 거로 다 통일하자는 거니까」.
 *   드라이브 링크는 그대로 두고, **드라이브가 아닌 주소**(모드렌터카 상세페이지 등)만 가져온다.
 *   홈페이지는 매물이 팔리면 페이지째 사라진다 — 그때 우리 매물 사진도 같이 사라진다.
 *
 * ★긁는 규칙은 앱과 **같은 것**을 쓴다(`app/api/extract-photos` 의 scrapePage) — 화면에 뜨는 사진과
 *   우리가 받아 두는 사진이 달라지면 안 된다. 모드렌터카는 moren-images S3 의 `/data/files/` 원본만
 *   받는다(썸네일 `/thumb/` 제외).
 * ★**문지기를 거친다** — 한 주소를 서로 다른 차가 나눠 쓰면 그건 그 차 사진이 아니다(같은 모델 매물이
 *   상세페이지 하나를 같이 쓰는 경우가 실제로 있다). 그런 줄은 받지 않고 이유를 적는다.
 * ★올린 뒤 사진링크와 차량번호 셀 링크를 **새 폴더로 바꾼다**. 파일 이름은 `web_01.jpg` 꼴.
 *
 *   npx tsx scripts/adopt-web-photos.mts
 *   npx tsx scripts/adopt-web-photos.mts --apply
 *   npx tsx scripts/adopt-web-photos.mts --who=아이카 --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { countPlatesByUrl, driveIdOf, isPhotoUrl, judgePhotoLink } from '../lib/domain/photo-link-guard';
/** ★긁는 규칙은 화면(`app/api/extract-photos`)과 **같은 한 벌**을 쓴다 — 2026-09-01 에 복사본을 지우고 합쳤다. */
import { scrapePage } from '../lib/domain/scrape-photos';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim(); const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const APPLY = process.argv.includes('--apply');
const WHO = arg('who'); const LIMIT = Number(arg('limit') || '0');
const PICS = arg('pics') || '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';
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
const ensureFolder = async (name: string, parent: string) => {
  const q = `'${parent}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = await call(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)&${EXTRA}`);
  if ((found.files || []).length) return S(found.files[0].id);
  const made = await call(`${DRIVE}?${EXTRA}`, { method: 'POST', body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
  return S(made.id);
};

const uploadImage = async (name: string, buf: Buffer, mime: string, parent: string) => {
  const boundary = '-----fp4web-----';
  const meta = JSON.stringify({ name, parents: [parent] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    buf, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return call(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: body as unknown as BodyInit,
  });
};

// ── 홈페이지 주소를 쓰는 줄 찾기 ─────────────────────────────────────────────
const picFolders = (await ls(PICS)).filter((f) => S(f.mimeType).includes('folder'));
const folderByName = new Map<string, string>();
for (const f of picFolders) folderByName.set(norm(f.name), S(f.id));
const ALIAS: Record<string, string> = { 에스에이: 'SA', 손오공: '손오공렌터카', 우리캐피탈: '우리캐피탈렌터카', 제이앤제이렌트카: 'J&J렌트카' };
const pickSupplierFolder = (label: string) => {
  const c = norm(ALIAS[norm(label)] || label);
  if (folderByName.has(c)) return { name: ALIAS[norm(label)] || label, id: folderByName.get(c)! };
  for (const [key, id] of folderByName) if (key.length >= 2 && (c.includes(key) || key.includes(c))) return { name: key, id };
  return { name: label, id: '' };
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
let books = (((await call(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&${EXTRA}`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));

type Job = { bookId: string; label: string; tab: string; gid: number; rn: number; pi: number; li: number; plate: string; model: string; url: string };
const jobs: Job[] = []; const skipped: string[] = [];
for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const tabs = ((meta.sheets || []) as Rec[]).map((p) => p.properties as Rec).filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)));
  type Cand = Job & { cur: string };
  const cands: Cand[] = [];
  for (const p of tabs) {
    const title = S(p.title); const gid = Number(p.sheetId);
    const grid = await call(`${SH}/${b.id}?ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}&includeGridData=true&fields=${encodeURIComponent('sheets(data(rowData(values(formattedValue,hyperlink,textFormatRuns(format(link)),userEnteredFormat(textFormat(link)),chipRuns(chip(richLinkProperties(uri)))))))')}`);
    const rows = ((((grid.sheets || []) as Rec[])[0]?.data || [])[0]?.rowData || []).map((r: Rec) => ((r.values || []) as Rec[]));
    const hi = rows.findIndex((r: Rec[]) => r.some((c) => norm(c.formattedValue) === '차량번호')); if (hi < 0) continue;
    const hdr = rows[hi].map((c: Rec) => norm(c.formattedValue));
    const pi = hdr.indexOf('차량번호'); const li = hdr.indexOf('사진링크'); const gi = hdr.indexOf('모델명'); const ci = hdr.findIndex((h) => h.startsWith('차명'));
    if (pi < 0 || li < 0) continue;
    for (let k = hi + 1; k < rows.length; k++) {
      const r = rows[k]; const plate = S(r[pi]?.formattedValue); if (!plate) continue;
      const val = S(r[li]?.formattedValue); const cur = linkOf(r[pi]);
      const url = isPhotoUrl(val) ? val : cur;
      if (!isPhotoUrl(url) || driveIdOf(url)) continue;           // 드라이브면 그대로 둔다
      const model = S(r[gi]?.formattedValue) || S(r[ci]?.formattedValue).split(/\s+/)[0];
      cands.push({ bookId: b.id, label: b.label, tab: title, gid, rn: k, pi, li, plate, model, url, cur });
    }
  }
  if (!cands.length) continue;
  const shared = countPlatesByUrl(cands.map((c) => ({ plate: c.plate, urls: [c.url] })));
  for (const c of cands) {
    const v = judgePhotoLink(c.plate, c.url, { name: '', ok: true }, shared.get(c.url) || 1);
    if (!v.fit) { skipped.push(`${c.label} ${c.plate} ${v.why}`); continue; }
    jobs.push(c);
  }
}

console.log(`\n■ 홈페이지 사진을 가져올 차 ${jobs.length}대 ${APPLY ? '(반영)' : '(dry-run)'}`);
const bySup = new Map<string, Job[]>();
for (const j of jobs) (bySup.get(j.label) || bySup.set(j.label, []).get(j.label)!).push(j);
for (const [sup, list] of bySup) console.log(`   ${sup.padEnd(10)} ${String(list.length).padStart(3)}대  ${[...new Set(list.map((j) => new URL(j.url).hostname))].join(' ')}`);
if (skipped.length) { console.log(`\n  ⚠ 건너뛴 줄 ${skipped.length}`); for (const s of skipped.slice(0, 10)) console.log(`     ${s}`); }
if (!APPLY) { console.log('\n※ dry-run. 실제로 받아 오는 것은 --apply\n'); process.exit(0); }

// ── 받아서 올리기 ───────────────────────────────────────────────────────────
const done: Rec[] = []; const writesByBook = new Map<string, Rec[]>();
let cars = 0, up = 0, already = 0, failed = 0;
for (const j of (LIMIT ? jobs.slice(0, LIMIT) : jobs)) {
  cars++;
  let shots: string[] = [];
  try { shots = await scrapePage(j.url, 15_000); } catch (e) { console.log(`   ⚠ ${j.plate} 페이지 못 읽음 — ${(e as Error).message.slice(0, 80)}`); failed++; continue; }
  if (!shots.length) { console.log(`   ⚠ ${j.plate} 사진을 못 찾음 — ${j.url.slice(0, 60)}`); failed++; continue; }
  const sup = pickSupplierFolder(j.label);
  const supId = sup.id || (await ensureFolder(sup.name, PICS));
  if (!sup.id) folderByName.set(norm(sup.name), supId);
  const kids = (await ls(supId)).filter((f) => S(f.mimeType).includes('folder'));
  const hit = kids.find((f) => norm((S(f.name).match(PLATE_IN) || [])[1] || '') === norm(j.plate));
  const carName = `${j.plate} ${j.model}`.trim();
  const carId = hit ? S(hit.id) : await ensureFolder(carName, supId);
  const have = new Set((await ls(carId)).map((f) => S(f.name)));
  let n = 0;
  for (let i = 0; i < shots.length; i++) {
    const ext = (shots[i].match(/\.(jpg|jpeg|png|webp)$/i) || ['.jpg'])[0].toLowerCase().replace('.jpeg', '.jpg');
    const name = `web_${String(i + 1).padStart(2, '0')}${ext}`;
    if (have.has(name)) { already++; continue; }
    try {
      const r = await fetch(shots[i], { headers: { 'User-Agent': 'Mozilla/5.0', Referer: j.url }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 4096) throw new Error('너무 작은 파일');
      await uploadImage(name, buf, S(r.headers.get('content-type')) || 'image/jpeg', carId);
      up++; n++;
    } catch (e) { failed++; console.log(`   ⚠ ${j.plate}/${name} — ${(e as Error).message.slice(0, 60)}`); }
  }
  const url = `https://drive.google.com/drive/folders/${carId}`;
  const reqs = writesByBook.get(j.bookId) || [];
  reqs.push({ updateCells: { range: { sheetId: j.gid, startRowIndex: j.rn, endRowIndex: j.rn + 1, startColumnIndex: j.li, endColumnIndex: j.li + 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: url } }] }], fields: 'userEnteredValue' } });
  reqs.push({ updateCells: { range: { sheetId: j.gid, startRowIndex: j.rn, endRowIndex: j.rn + 1, startColumnIndex: j.pi, endColumnIndex: j.pi + 1 }, rows: [{ values: [{ userEnteredFormat: { textFormat: { link: { uri: url } } } }] }], fields: 'userEnteredFormat.textFormat.link' } });
  writesByBook.set(j.bookId, reqs);
  done.push({ 공급사: j.label, 차번: j.plate, 원본: j.url, 새폴더: hit ? S(hit.name) : carName, 올림: n, 주소: url });
  console.log(`  ${String(cars).padStart(3)}/${jobs.length} ${j.label.padEnd(8)} ${j.plate.padEnd(10)} ${String(n).padStart(2)}장 → freepasspics/${sup.name}/${hit ? S(hit.name) : carName}`);
}
for (const [bookId, reqs] of writesByBook) await call(`${SH}/${bookId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
writeFileSync('tmp/adopted-web-photos.json', JSON.stringify(done, null, 2));
console.log(`\n■ 끝 — 차 ${done.length}대 · 올림 ${up}장 · 이미 있어 건너뜀 ${already}장${failed ? ` · 실패 ${failed}` : ''} · 시트 링크 ${done.length}줄 바꿈`);
console.log(`  기록 tmp/adopted-web-photos.json\n`);
