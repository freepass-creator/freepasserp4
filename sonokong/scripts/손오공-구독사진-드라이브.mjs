/** 손오공 구독 판매차 사진을 freepasspics/손오공렌터카/<차번 모델>/에 보관한다. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCall, token } from '../lib/goog.mjs';
import { sheet } from '../lib/sheet.mjs';
import { withLease } from '../lib/lease.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';
const PICS = '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';
const APPLY = process.argv.includes('--apply');
const LIMIT = Number((process.argv.find((x) => x.startsWith('--limit=')) || '').slice(8) || '0');
const S = (x) => String(x ?? '').trim();
const N = (x) => S(x).replace(/\s/g, '');
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const EXTRA = 'includeItemsFromAllDrives=true&supportsAllDrives=true';
const call = makeCall(await token());
const driveFolder = (x) => /drive\.google\.com\/drive\/folders\/[\w-]{15,}/i.test(S(x));

async function children(parent) {
  const out = []; let page = '';
  do { const r = await call(`${DRIVE}?q=${encodeURIComponent(`'${parent}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&${EXTRA}${page ? `&pageToken=${page}` : ''}`); out.push(...(r.files || [])); page = S(r.nextPageToken); } while (page);
  return out;
}
async function folder(name, parent) {
  const q = `'${parent}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed=false`;
  const hit = await call(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)&${EXTRA}`);
  if (hit.files?.length) return S(hit.files[0].id);
  return S((await call(`${DRIVE}?${EXTRA}`, { method: 'POST', body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) })).id);
}
async function put(name, bytes, mime, parent) {
  const b = '----fp-sonokong'; const meta = JSON.stringify({ name, parents: [parent] });
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from(`\r\n--${b}--\r\n`)]);
  await call(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
}
const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/wonja/손오공차량.json'), 'utf8')).차량;
const byPlate = new Map(source.filter((x) => x.버킷 === 'SON_NO_KONG').map((x) => [N(x.차번), x]));
const s = await sheet(ID); const t = await s.table('구독재고', { headerRow: 1, keyCol: 0 });
for (const h of ['차량번호', '상태', '사진링크', '모델명']) if (!(h in t.col)) throw new Error(`구독재고 「${h}」 열 없음`);
const jobs = t.rows.map((r) => ({ row: r.rowNo, plate: N(t.get(r, '차량번호')), model: S(t.get(r, '모델명')), status: S(t.get(r, '상태')), photo: S(t.get(r, '사진링크')) }))
  .map((x) => ({ ...x, shots: byPlate.get(x.plate)?.사진들 || [] }))
  .filter((x) => x.status !== '출고불가' && !driveFolder(x.photo) && x.shots.length);
console.log(`■ 손오공구독 사진 Drive 백업 ${APPLY ? '(반영)' : '(dry-run)'}`);
console.log(`  판매중 ${t.rows.filter((r) => S(t.get(r, '상태')) !== '출고불가').length}대 · 대상 ${jobs.length}대 · 이미 Drive ${t.rows.filter((r) => driveFolder(t.get(r, '사진링크'))).length}대`);
if (!APPLY) { for (const j of jobs.slice(0, 15)) console.log(`  ${j.plate} ${j.model} · ${j.shots.length}장`); console.log('※ 실제 다운로드·업로드·시트 연결은 --apply'); process.exit(0); }

await withLease('drive', { agent: 'codex', taskId: `OPS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-017`, purpose: '손오공 구독 사진 Drive 백업' }, async () => {
  const sup = await folder('손오공렌터카', PICS); const writes = []; const done = []; let uploaded = 0, failed = 0;
  for (const [i, j] of (LIMIT ? jobs.slice(0, LIMIT) : jobs).entries()) {
    const car = await folder(`${j.plate} ${j.model}`.trim(), sup); const have = new Set((await children(car)).map((x) => S(x.name))); let files = have.size;
    for (let k = 0; k < j.shots.length; k++) try {
      const u = S(j.shots[k]); const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw Error(`HTTP ${r.status}`);
      const bytes = Buffer.from(await r.arrayBuffer()); if (bytes.length < 4096) throw Error('너무 작은 파일');
      const ext = new URL(u).pathname.match(/\.(jpe?g|png|webp)$/i)?.[1]?.replace('jpeg', 'jpg') || 'jpg'; const name = `sonokong_${String(k + 1).padStart(2, '0')}.${ext}`;
      if (!have.has(name)) { await put(name, bytes, S(r.headers.get('content-type')) || 'image/jpeg', car); have.add(name); uploaded++; } files++;
    } catch (e) { failed++; console.log(`  ⚠ ${j.plate}/${k + 1}: ${e.message}`); }
    if (files) { const link = `https://drive.google.com/drive/folders/${car}`; writes.push({ tab: '구독재고', row: j.row, col: '사진링크', value: link }); done.push({ 차량번호: j.plate, 사진링크: link, 원본사진수: j.shots.length }); }
    console.log(`  ${i + 1}/${LIMIT ? Math.min(LIMIT, jobs.length) : jobs.length} ${j.plate} · ${files}장`);
  }
  if (writes.length) await s.patch(writes);
  fs.writeFileSync(path.join(ROOT, 'tmp', '손오공구독-drive-photos.json'), JSON.stringify(done, null, 2));
  console.log(`■ 끝 — 연결 ${done.length}대 · 새 업로드 ${uploaded}장${failed ? ` · 실패 ${failed}장` : ''}`);
});
