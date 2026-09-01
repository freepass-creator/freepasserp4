/**
 * **아이카 사진링크를 «모드렌터카 원본 주소»로 되돌린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-23 「니가 사진을 잘못 다운받았어」 · 「외부폴더로 갖고온 거 다 삭제하고 새로 저장해서 넣어」
 *   · 「암튼 **공급사시트에 있는 사진폴더가 그 차량에 맞아야 함**」 · 「잘되게만 해 줘」
 *
 * ★무엇이 잘못됐나(실측 2026-08-23)
 *   폴더 **이름**은 다 맞았다(남의 차 폴더 0건). 그런데 폴더 **안 사진**이 다른 차였다 — 55건.
 *   73%가 «한 사진을 여러 폴더가 나눠 쓴 것»이다(10호3819 사진이 7개 폴더에, 109호3398 이 5개 폴더에).
 *   상세페이지 하나를 여러 매물이 같이 쓰는데, 차번 대조 없이 폴더마다 그대로 복사한 탓이다.
 *
 * ★되돌릴 근거
 *   아이카 사진의 원본은 **모드렌터카 상세페이지**(`moderentcar.co.kr`)다. 아이카 «원본 시트»엔 사진 열이 없고,
 *   그 주소는 리셋 전 ERP 에만 남아 있었다 — 리셋이력 백업에서 꺼낸다(528대 · 서로 다른 주소 512개).
 *
 * ⚠ **한 주소를 여러 차가 나눠 쓰면 되돌리지 않는다**(21개 주소 · 47대).
 *   그건 그 차 사진이 아니다(`photo-link-guard` 규칙 ②). **틀린 사진보다 빈칸이 낫다.**
 *
 * 이 스크립트는 **주소만 되돌린다.** 실제 사진 내려받기·드라이브 저장·링크 교체는 그다음에
 * `adopt-web-photos` 가 한다 — 그 도구는 문지기(`judgePhotoLink`)를 이미 태운다.
 *
 *   npx tsx scripts/restore-aica-origin-photo-urls.mts
 *   npx tsx scripts/restore-aica-origin-photo-urls.mts --apply
 *   그다음: npx tsx scripts/adopt-web-photos.mts --who=아이카 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';

const APPLY = process.argv.includes('--apply');
/**
 * `--fill-empty` — OCR 불일치뿐 아니라 **사진이 비어 있는 차**도 원본 주소로 채운다.
 * ★사장님 2026-08-23 「공급사 시트에 사진링크 다 했니?? 하고 이어서 작업해」 —
 *   실측 351대가 사진 없음이었다(아이카가 135대로 제일 많다). 백업에 원본 주소가 있으면 채운다.
 * ⚠ 이미 사진이 걸린 차는 안 건드린다(멀쩡한 걸 덮으면 그게 또 사고다).
 */
const FILL_EMPTY = process.argv.includes('--fill-empty');
const S = (v: unknown) => String(v ?? '').trim();
const plateKey = (v: unknown) => S(v).replace(/\s+/g, '');
/**
 * ★**손댈 차 = OCR 로 «다름»이 확인된 것만**(코덱스 2026-08-23 사진↔번호판 대조 결과의 아이카 51건).
 *   폴더 이름은 다 맞아서(남의 차 폴더 0건) 이름 대조로는 못 가른다. 사진 속 번호판을 읽어야 나온다.
 * ⚠ 「맞음」으로 확인된 차와 **아직 확인 안 된 차는 건드리지 않는다.** 멀쩡한 사진을 지우면 그게 또 사고다.
 */
const MISMATCH = new Set(`109호1041 109호1816 109호2042 109호2052 109호2145 109호2298 109호2564 109호2667
109호2671 109호2865 109호2904 109호2979 109호3005 109호3107 109호3117 109호3261 109호3267 109호3325
109호3719 109호3893 109호3894 109호3954 109호3960 109호4078 109호4117 109호4160 109호4161 109호4172
109호4390 109호4645 109호4868 109호4941 109호5132 109호5138 109호5146 109호5173 109호5176 109호5178
109호5196 109호5352 109호5367 109호5369 109호5435 109호5436 109호5437 109호5440 109호5611 109호5612
124하2114 146하4495 57호9876`.split(/\s+/).filter(Boolean));

const backupArg = process.argv.find((a) => a.startsWith('--backup='));
const BACKUP = backupArg ? backupArg.slice('--backup='.length) : 'D:/backup/freepasserp4-rtdb/리셋이력-2026-08-23-2050/v4_products.json';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com',
});
const api = async (u: string, init?: RequestInit): Promise<any> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

// ── ① 백업에서 차번 → 모드렌터카 주소
const backup = JSON.parse(readFileSync(BACKUP, 'utf8')) as Record<string, any>;
const urlPlates = new Map<string, Set<string>>();
const plateUrl = new Map<string, string>();
for (const p of Object.values(backup)) {
  if (!p || typeof p !== 'object') continue;
  const url = S((p as any).photo_link);
  const plate = plateKey((p as any).car_number);
  if (!plate || !/moderentcar\.co\.kr/i.test(url)) continue;
  if (!urlPlates.has(url)) urlPlates.set(url, new Set());
  urlPlates.get(url)!.add(plate);
  plateUrl.set(plate, url);
}
/** ⚠ 여러 차가 나눠 쓰는 주소는 **버린다** — 그건 한 차 사진이 아니다. */
const shared = new Set<string>();
for (const [url, plates] of urlPlates) if (plates.size > 1) shared.add(url);
const usable = new Map<string, string>();
for (const [plate, url] of plateUrl) if (!shared.has(url)) usable.set(plate, url);

console.log('■ 아이카 사진링크 → 모드렌터카 원본 주소로 되돌리기\n');
console.log(`  백업에서 읽음: ${plateUrl.size}대 · 서로 다른 주소 ${urlPlates.size}`);
console.log(`  ⚠ 여러 차가 나눠 쓰는 주소 ${shared.size}개 — **안 쓴다**(그 차 사진이 아니다)`);
console.log(`  쓸 수 있는 주소: ${usable.size}대\n`);

// ── ② 아이카 정제시트
const src = MIRROR_SOURCES.find((m) => m.name === '아이카');
if (!src) throw new Error('MIRROR_SOURCES 에 아이카가 없다');
const meta = await api(`${SH}/${src.to}?fields=sheets.properties(title,hidden)`);
const tab = (meta.sheets || [])
  .filter((s: any) => !s.properties.hidden && !isOurNonInventoryTab(S(s.properties.title)))
  .map((s: any) => S(s.properties.title))[0];
if (!tab) throw new Error('아이카 정제시트 재고 탭을 못 찾았다');

const got = await api(`${SH}/${src.to}/values/${encodeURIComponent(`${a1Tab(tab)}!A1:CZ700`)}`) as { values?: string[][] };
const rows = ((got.values || []) as string[][]).map((r) => (r || []).map(S));
const hi = rows.findIndex((r) => r.includes('차량번호'));
if (hi < 0) throw new Error('머리글에 「차량번호」가 없다');
const head = rows[hi];
const ip = head.indexOf('차량번호');
const ic = head.findIndex((h) => /사진링크|사진|이미지/.test(h));
if (ic < 0) throw new Error('사진 열을 못 찾았다');
console.log(`  시트 「${tab}」 · 사진 열 「${head[ic]}」 · ${rows.length - hi - 1}대\n`);

// ── ③ 되돌릴 줄 고르기
const updates: { range: string; values: string[][] }[] = [];
const restore: string[] = []; const clear: string[] = []; let keep = 0;
for (let r = hi + 1; r < rows.length; r++) {
  const plate = plateKey(rows[r][ip]);
  if (!plate) continue;
  const now = S(rows[r][ic]);
  // ⚠ OCR 로 «다름»이 확인된 차 + (--fill-empty 면) 사진이 빈 차만 손댄다. 멀쩡한 사진은 그대로 둔다.
  const empty = !now;
  if (!MISMATCH.has(plate) && !(FILL_EMPTY && empty)) { keep++; continue; }
  const want = usable.get(plate) || '';
  if (want) {
    if (now === want) { keep++; continue; }
    restore.push(`  ${plate}  ${now.slice(0, 40) || '(빈칸)'} ▶ ${want.slice(0, 56)}`);
    updates.push({ range: `${a1Tab(tab)}!${colA1(ic)}${r + 1}`, values: [[want]] });
    continue;
  }
  /**
   * 쓸 수 있는 원본이 없는 차 — 지금 걸린 것이 **내가 잘못 올린 드라이브 링크**면 비운다.
   * 공급사가 직접 넣은 드라이브(폴더 이름에 차번이 있는 것)는 여기 안 걸린다(아이카는 우리 폴더뿐).
   */
  if (now && /drive\.google/.test(now)) {
    clear.push(`  ${plate}  ${now.slice(0, 52)} ▶ (비움)`);
    updates.push({ range: `${a1Tab(tab)}!${colA1(ic)}${r + 1}`, values: [['']] });
  }
}
console.log(`  되돌릴 줄 ${restore.length} · 비울 줄 ${clear.length} · 이미 맞음 ${keep}\n`);
restore.slice(0, 8).forEach((l) => console.log(l));
if (restore.length > 8) console.log(`  … 외 ${restore.length - 8}줄`);
if (clear.length) {
  console.log('\n  ⚠ 원본 주소가 없어 **비우는** 줄 (틀린 사진보다 빈칸이 낫다):');
  clear.slice(0, 8).forEach((l) => console.log(l));
  if (clear.length > 8) console.log(`  … 외 ${clear.length - 8}줄`);
}

if (!APPLY) { console.log('\n  (미리보기다 — 반영하려면 --apply)'); process.exit(0); }
if (!updates.length) { console.log('\n  바꿀 것이 없다.'); process.exit(0); }

await api(`${SH}/${src.to}/values:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
});
console.log(`\n  ✓ 시트 ${updates.length}줄 바꿨다.`);
console.log('  다음 — 사진을 다시 받아 드라이브에 올리고 링크를 건다(문지기 포함):');
console.log('     npx tsx scripts/adopt-web-photos.mts --who=아이카');
console.log('     npx tsx scripts/adopt-web-photos.mts --who=아이카 --apply');
