/**
 * **잘못 받은 아이카 사진을 폴더째 비운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-23 「니가 사진을 잘못 다운받았어」 · 「**외부폴더로 갖고온 거 다 삭제하고 새로 저장해서 넣어**」
 *   · 「공급사시트에 있는 사진폴더가 그 차량에 맞아야 함」
 *
 * ★왜 비워야 하나
 *   `adopt-web-photos` 는 **이미 있는 파일을 건너뛴다**(실측 2026-08-23: 「건너뜀 180장」).
 *   그래서 주소를 원본으로 되돌리고 다시 받아도 **폴더 안 옛 사진(남의 차)이 그대로 남는다.**
 *   비운 뒤에 받아야 그 차 사진만 남는다.
 *
 * ★대상 = OCR 로 «다름»이 확인된 아이카 51대의 폴더뿐.
 *   ⚠ 「맞음」으로 확인된 차와 아직 확인 안 된 차는 **건드리지 않는다.** 멀쩡한 사진을 지우면 그게 또 사고다.
 * ⚠ 지운 파일은 **휴지통**으로 간다(완전 삭제 아님) — 잘못 지웠으면 드라이브에서 되살릴 수 있다.
 *
 *   npx tsx scripts/purge-wrong-aica-photos.mts
 *   npx tsx scripts/purge-wrong-aica-photos.mts --apply
 *   그다음: npx tsx scripts/adopt-web-photos.mts --who=아이카 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { PLATE_IN_NAME } from '../lib/domain/photo-link-guard';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const picsArg = process.argv.find((a) => a.startsWith('--pics='));
const PICS = picsArg ? picsArg.slice('--pics='.length) : '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';

/** OCR 로 «다름»이 확인된 아이카 51대(코덱스 2026-08-23 사진↔번호판 대조). */
const MISMATCH = new Set(`109호1041 109호1816 109호2042 109호2052 109호2145 109호2298 109호2564 109호2667
109호2671 109호2865 109호2904 109호2979 109호3005 109호3107 109호3117 109호3261 109호3267 109호3325
109호3719 109호3893 109호3894 109호3954 109호3960 109호4078 109호4117 109호4160 109호4161 109호4172
109호4390 109호4645 109호4868 109호4941 109호5132 109호5138 109호5146 109호5173 109호5176 109호5178
109호5196 109호5352 109호5367 109호5369 109호5435 109호5436 109호5437 109호5440 109호5611 109호5612
124하2114 146하4495 57호9876`.split(/\s+/).filter(Boolean));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const EXTRA = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const call = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    if (r.status === 204) return {};
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && n < 5) { await new Promise((ok) => setTimeout(ok, 3000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const children = async (parent: string) => {
  const out: { id: string; name: string; mimeType: string }[] = [];
  let page = '';
  do {
    const r = await call(`${DRIVE}?q=${encodeURIComponent(`'${parent}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&${EXTRA}${page ? `&pageToken=${page}` : ''}`);
    out.push(...(r.files || []));
    page = r.nextPageToken || '';
  } while (page);
  return out;
};

console.log('■ 잘못 받은 아이카 사진 비우기 — 폴더는 남기고 «안의 파일»만 휴지통으로\n');

// freepasspics → 공급사 폴더 → 차량 폴더
const suppliers = (await children(PICS)).filter((f) => f.mimeType.endsWith('.folder'));
const aica = suppliers.find((f) => /아이카/.test(f.name));
if (!aica) throw new Error('freepasspics 아래 아이카 폴더를 못 찾았다');

const cars = (await children(aica.id)).filter((f) => f.mimeType.endsWith('.folder'));
console.log(`  아이카 폴더 아래 차량 폴더 ${cars.length}개 · 비울 대상 ${MISMATCH.size}대\n`);

let folders = 0; let files = 0; const lines: string[] = []; const gone: string[] = [];
const targets: { id: string; name: string }[] = [];
for (const car of cars) {
  const plate = (car.name.match(PLATE_IN_NAME) || [])[1] || '';
  if (!plate || !MISMATCH.has(plate)) continue;
  const kids = await children(car.id);
  const photos = kids.filter((k) => !k.mimeType.endsWith('.folder'));
  folders++; files += photos.length;
  if (lines.length < 10) lines.push(`  ${car.name.padEnd(26)} 사진 ${photos.length}장`);
  for (const ph of photos) targets.push({ id: ph.id, name: `${car.name}/${ph.name}` });
}
for (const plate of MISMATCH) {
  if (!cars.some((c) => (c.name.match(PLATE_IN_NAME) || [])[1] === plate)) gone.push(plate);
}
console.log(`  비울 폴더 ${folders}개 · 사진 ${files}장`);
lines.forEach((l) => console.log(l));
if (folders > 10) console.log(`  … 외 ${folders - 10}개 폴더`);
if (gone.length) console.log(`\n  폴더가 아예 없는 차 ${gone.length}대: ${gone.slice(0, 6).join(' · ')}${gone.length > 6 ? ' 외' : ''}`);

if (!APPLY) { console.log('\n  (미리보기다 — 비우려면 --apply · 파일은 휴지통으로 간다)'); process.exit(0); }
if (!targets.length) { console.log('\n  비울 것이 없다.'); process.exit(0); }

let done = 0;
for (const t of targets) {
  await call(`${DRIVE}/${t.id}?${EXTRA}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) });
  done++;
  if (done % 25 === 0) console.log(`  … ${done}/${targets.length}`);
}
console.log(`\n  ✓ 사진 ${done}장을 휴지통으로 보냈다(폴더는 그대로).`);
console.log('  다음 — 원본에서 다시 받는다(문지기 포함):');
console.log('     npx tsx scripts/adopt-web-photos.mts --who=아이카 --apply');
