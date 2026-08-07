/**
 * v3 `products.photo_link` → v4 `v4/products.photo_link` 일회성 이관. 기본 dry-run, 반영은 --apply.
 *
 * 왜: 재고는 **v4 단독**이 원칙인데(erp3 절연, `MIGRATION_PLAN.md`) 사진 출처만 v3 에 남아 있어
 * 시트 내보내기가 매번 v3 를 읽고 있었다. 값을 v4 로 옮겨 그 의존을 끊는다.
 *
 * ★안전 계약
 *   · **이미 값이 있는 v4 매물은 건드리지 않는다**(덮어쓰기 없음). 빈 곳만 채운다.
 *   · 매칭은 **실차번**만. 차번 없는 매물(EXT_* 해시키)은 이어붙일 키가 없어 건너뛴다.
 *   · 한 차번에 v3 링크가 여러 개면 «살아있는 것 우선» 하나만 쓴다.
 *   · 쓰기 전 대상 v4 매물의 현재 photo_link 를 백업 파일로 남긴다.
 *
 *   npx tsx scripts/migrate-photo-links-to-v4.mts
 *   npx tsx scripts/migrate-photo-links-to-v4.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (p: Rec) => S(p.car_number || p.car_number_snapshot).replace(/\s/g, '');
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

async function main() {
  const apply = process.argv.includes('--apply');
  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });
  const token = (await getApps()[0].options.credential!.getAccessToken()).access_token;
  const get = async (node: string) => {
    const res = await fetch(`${DB}/${node}.json?access_token=${token}`);
    if (!res.ok) throw new Error(`${node} 읽기 실패 ${res.status}`);
    return (JSON.parse(await res.text()) || {}) as Record<string, Rec>;
  };

  const [v3, v4] = await Promise.all([get('products'), get('v4/products')]);
  console.log(`\n══ 사진 출처 v3 → v4 이관 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);

  // v3 차번 → photo_link (살아있는 것 우선)
  const linkByPlate = new Map<string, string>();
  for (const pass of [false, true]) {
    for (const p of Object.values(v3)) {
      if (!p || typeof p !== 'object' || dead(p) !== pass) continue;
      const k = plate(p);
      const link = S(p.photo_link);
      if (k && link && !linkByPlate.has(k)) linkByPlate.set(k, link);
    }
  }
  console.log(`  v3 사진 링크: 차번 ${linkByPlate.size}개`);

  const patch: Rec = {};
  const before: Rec = {};
  let already = 0, noPlate = 0, noSource = 0;
  for (const [key, p] of Object.entries(v4)) {
    if (!p || typeof p !== 'object' || dead(p)) continue;
    if (S(p.photo_link)) { already++; continue; }      // ★있는 값은 안 덮는다
    const k = plate(p);
    if (!k) { noPlate++; continue; }
    const link = linkByPlate.get(k);
    if (!link) { noSource++; continue; }
    patch[`${key}/photo_link`] = link;
    before[key] = S(p.photo_link);
  }
  const n = Object.keys(patch).length;
  console.log(`  v4 활성 매물 중`);
  console.log(`    이미 사진 있음   ${already}대 (건드리지 않음)`);
  console.log(`    차번 없음        ${noPlate}대 (이어붙일 키 없음)`);
  console.log(`    v3 에도 없음     ${noSource}대`);
  console.log(`    ★채울 수 있음    ${n}대`);

  if (!apply) { console.log('\n※ dry-run. 반영은 --apply\n'); return; }
  if (!n) { console.log('\n채울 것이 없다.\n'); return; }

  const stamp = process.env.BACKUP_STAMP || 'photo-link-migrate';
  const dir = `tmp/migration-backups/${stamp}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/v4_photo_link_before.json`, JSON.stringify(before, null, 2), 'utf8');
  console.log(`\n  백업 ${dir}/v4_photo_link_before.json (${Object.keys(before).length}건)`);

  const res = await fetch(`${DB}/v4/products.json?access_token=${token}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`쓰기 실패 ${res.status} ${(await res.text()).slice(0, 300)}`);
  console.log(`  반영 ${n}대\n`);
  console.log('끝. 이제 build-photo-map 은 v4 만 읽는다.\n');
}

main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
