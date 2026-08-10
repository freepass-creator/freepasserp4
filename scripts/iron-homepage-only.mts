/**
 * **아이언은 홈페이지만 본다** — 시트로 들어온 아이언 레코드를 걷어내고 시트 유입을 끊는다.
 * 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-10)
 *   아이언(RP006)의 정본은 `ironrentcar.com` 수집이다. 그런데 시트에서도 따로 들어오고 있어
 *   같은 공급사가 두 갈래로 쌓였다 — 홈페이지 38건 · 시트 16건.
 *   시트 쪽 8건은 차번이 아예 없는데, `_row_text` 를 보면
 *   「협의 무한/30 1억/30 차량/50~100 우리은행 …」 — **표 꼬리의 정책·계좌 안내 줄**을
 *   차량으로 읽은 것이다. 없는 차를 영업자 표에 상품으로 올리고 있었다.
 *
 * ★홈페이지 수집기는 차번이 없으면 레코드를 만들지 않는다(`RP006_{차번}` 키 강제).
 *   그러므로 **키 앞머리로 출처가 갈린다** — `RP006_` = 홈페이지, `EXT_` = 시트.
 *
 * ⚠ 지우지 않고 `_deleted` 로 내린다. 되살릴 일이 생길 수 있고, 무엇을 내렸는지 남아야 한다.
 * ⚠ 홈페이지에만 있는 차는 건드리지 않는다. 여기서 줄어드는 건 시트發뿐이다.
 *
 *   npx tsx scripts/iron-homepage-only.mts
 *   npx tsx scripts/iron-homepage-only.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const CODE = 'RP006';
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;

const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbT}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const iron = Object.entries<Rec>(prods)
  .filter(([, p]) => p && typeof p === 'object' && !dead(p) && S(p.provider_company_code) === CODE)
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));

const fromHome = iron.filter((p) => /^RP006_/.test(S((p as Rec)._key)));
const fromSheet = iron.filter((p) => !/^RP006_/.test(S((p as Rec)._key)));
const homePlates = new Set(fromHome.map((p) => norm((p as Rec).car_number)).filter(Boolean));

const sellable = (p: EntityRecord) => !isHiddenFromCatalog(p as Rec) && priceList(p).length > 0;

console.log(`■ 아이언은 홈페이지만 본다 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  홈페이지(RP006_)  ${String(fromHome.length).padStart(3)}건 · 목록에 섬 ${fromHome.filter(sellable).length}  ← 남긴다`);
console.log(`  시트(EXT_ 등)     ${String(fromSheet.length).padStart(3)}건 · 목록에 섬 ${fromSheet.filter(sellable).length}  ← 내린다\n`);

const onlyInSheet: EntityRecord[] = [];
for (const p of fromSheet) {
  const pl = norm((p as Rec).car_number);
  const dup = pl && homePlates.has(pl);
  const mark = sellable(p) ? '목록에 섬' : '이미 안 섬';
  if (pl && !dup) onlyInSheet.push(p);
  console.log(`   ${(pl || '(번호없음)').padEnd(12)} ${S((p as Rec)._key).slice(0, 20).padEnd(22)} ${mark.padEnd(10)} ${dup ? '홈페이지에도 있음' : pl ? '★홈페이지엔 없는 번호' : '표 꼬리로 보임'}`);
}

if (onlyInSheet.length) {
  console.log(`\n  ★홈페이지에 없는 번호 ${onlyInSheet.length}대 — 내리면 이 차는 목록에서 사라진다.`);
  console.log(`    홈페이지가 정본이라는 결정에 따르면 «지금 아이언이 안 갖고 있는 차»다.`);
}

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

let down = 0;
const at = new Date().toISOString();
for (const p of fromSheet) {
  const key = S((p as Rec)._key);
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(key)}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    // 지우지 않고 내린다 — 무엇을 왜 내렸는지 남아야 한다.
    body: JSON.stringify({ _deleted: true, deletedAt: at, deleted_reason: '아이언은 홈페이지 정본 — 시트 유입 정리(2026-08-10)', updatedAt: at }),
  });
  if (res.ok) down++;
  else console.log(`  △ ${key} — ${res.status} ${(await res.text()).slice(0, 100)}`);
}
console.log(`\n  내림 ${down}건`);

// 시트 유입을 끊는다 — 주소가 남아 있으면 다음 동기화에서 다시 쌓인다.
for (const node of ['partners/RP006', 'v4/partners/RP006']) {
  const cur = JSON.parse(await (await fetch(`${DB}/${node}.json?access_token=${dbT}`)).text());
  if (!cur) continue;
  const res = await fetch(`${DB}/${node}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sheet_url: '', sheet_tab: '',
      // 시트 자체는 남는다 — 보관용이라는 뜻을 적어 둔다.
      sheet_note: '보관용 — 정본은 ironrentcar.com 수집(2026-08-10)',
      sheet_archive_url: S(cur.sheet_url),
    }),
  });
  console.log(`  ${node}: 시트 유입 ${res.ok ? '끊음' : `실패 ${res.status}`}`);
}
console.log('\n  다음: 영업자 시트 두 탭을 다시 찍는다.\n');
