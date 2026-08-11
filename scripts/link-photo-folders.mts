/**
 * **`freepasspics` 의 차량 폴더를 그 차의 「사진링크」로 잇는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * 사진은 드라이브에 올려 두고, 시트의 「사진링크」 칸이 그 폴더를 가리키면
 * 카탈로그·상세페이지에 사진이 붙는다. 지금까지는 그 잇는 일을 손으로 했다.
 *
 * ★폴더 이름의 **맨 앞 토막이 차량번호**다(「109호1739 GV70」). 그 규격을 따른다.
 * ★**빈 칸만 채운다.** 이미 링크가 있으면 손대지 않는다 — 공급사가 넣은 주소를 덮으면 안 된다.
 *   정말 바꾸려면 `--overwrite`.
 * ★시트에 그 차번이 없으면 넘어간다. 폴더가 있다고 없는 차를 만들지 않는다.
 *
 *   npx tsx scripts/link-photo-folders.mts
 *   npx tsx scripts/link-photo-folders.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');
const ROOT = '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';   // freepasspics
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const PLATE_RE = /^\d{2,3}[가-힣]\d{4}$/;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};
const ls = async (id: string) => ((await api(
  `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${id}' in parents and trashed=false`)}&pageSize=300&fields=files(id,name,mimeType)&orderBy=name&includeItemsFromAllDrives=true&supportsAllDrives=true`,
)).files || []) as Rec[];

/** 차번 → 사진 폴더. 사진이 한 장도 없는 폴더는 잇지 않는다 — 빈 폴더를 가리키면 «사진 있음»으로 보인다. */
const byPlate = new Map<string, { url: string; supplier: string; shots: number }>();
for (const sup of await ls(ROOT)) {
  if (!S(sup.mimeType).includes('folder')) continue;
  for (const car of await ls(S(sup.id))) {
    if (!S(car.mimeType).includes('folder')) continue;
    const plate = norm(S(car.name).split(/\s+/)[0]);
    if (!PLATE_RE.test(plate)) continue;
    const shots = (await ls(S(car.id))).filter((f) => !S(f.mimeType).includes('folder')).length;
    if (!shots) continue;
    byPlate.set(plate, { url: `https://drive.google.com/drive/folders/${S(car.id)}`, supplier: S(sup.name), shots });
  }
}
console.log(`■ 사진 폴더 ↔ 시트 사진링크 잇기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  사진이 든 차량 폴더 ${byPlate.size}개\n`);

const [t3, t4] = await Promise.all(['partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };

const A = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
let linked = 0; let kept = 0; let notFound = new Set(byPlate.keys());

const seen = new Set<string>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const id = (S(p.sheet_url).match(/\/d\/([\w-]+)/) || [])[1];
  if (!id || seen.has(id)) continue;
  seen.add(id);
  const name = S(p.partner_name || p.name) || S(p.partner_code);
  let vals: Rec;
  try { vals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent('재고!A1:BZ600')}`); }
  catch { continue; }   // 「재고」 탭이 없는 공급사 자기 시트는 대상이 아니다
  const rows = ((vals.values || []) as string[][]);
  const hdr = (rows[0] || []).map(S);
  const iPlate = hdr.indexOf('차량번호');
  const iPhoto = hdr.indexOf('사진링크');
  if (iPlate < 0 || iPhoto < 0) continue;

  const writes: { range: string; values: string[][] }[] = [];
  for (let r = 1; r < rows.length; r++) {
    const plate = norm(rows[r][iPlate]);
    const hit = plate ? byPlate.get(plate) : undefined;
    if (!hit) continue;
    notFound.delete(plate);
    const now = S(rows[r][iPhoto]);
    if (now && !OVERWRITE) { kept++; continue; }
    if (now === hit.url) { kept++; continue; }
    writes.push({ range: `재고!${A(iPhoto)}${r + 1}`, values: [[hit.url]] });
    console.log(`  ★ ${name.slice(0, 12).padEnd(14)}${plate.padEnd(11)}사진 ${String(hit.shots).padStart(2)}장${now ? '  (기존 링크 덮음)' : ''}`);
  }
  if (!writes.length) continue;
  linked += writes.length;
  if (!APPLY) continue;
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writes }),
  });
}

console.log(`\n  이을 차 ${linked}대 · 이미 링크가 있어 둔 차 ${kept}대`);
if (notFound.size) {
  console.log(`  △ 사진은 있는데 시트에서 못 찾은 차 ${notFound.size}대 — ${[...notFound].slice(0, 10).join(' · ')}`);
}
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
