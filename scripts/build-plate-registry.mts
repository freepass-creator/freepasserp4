/**
 * **차량번호 대장을 쌓는다** — 판매시트(상품리스트)에서 차번·차명 세 축·공급사만 긁어 누적한다.
 *
 * ★사장님 2026-08-26
 *   「상품리스트 업데이트할때 누적으로 차량번호 모델명 공급사 정보만 인지해서
 *     차량번호 쓰면 공급사 모델명 끌고오게」
 *   「지금 시트기준으로 하고 / 모델명 세부모델 세부트림 구조로」
 *   「지금있는 차들부터해 / 기존차들은 없어도됨 / 나중에 일괄 채울게 / **현재 상품시트만**」
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★★**왜 쌓나 — 상품시트는 «지금»만 담기 때문이다.**
 *   판매시트는 발행할 때마다 다시 쓰인다. 팔린 차는 빠진다.
 *   그런데 정산은 «팔린 뒤»에 일어난다 — 접수·인도·청구가 다 그 뒤다.
 *   실측 2026-08-26: 원장 406대 중 **375대(92%)** 가 지금 재고에 없어
 *   「차량번호를 고르면 모델명·공급사가 따라온다」가 사실상 안 돌고 있었다.
 *   ⇒ 발행될 때마다 여기에 «쌓아 두면» 빠진 차도 이름을 잃지 않는다.
 *
 * ★★**여기만 본다 — 판매시트 세 탭.** 재고(`v4/products`)도 정산원장도 안 본다.
 *   사장님 「현재 상품시트만」. 옛 차는 나중에 일괄로 채운다.
 *   ⚠ **탭 이름에 날짜가 붙는다**(「상품리스트 08.26 09:34 · 346대」).
 *     이름을 통째로 맞추면 못 찾는다 — 반드시 «앞머리»로 찾는다(2026-08-26 그래서 0줄이었다).
 *
 * ★★**차명은 세 축 그대로.** 모델 · 세부모델 · 세부트림을 각각 담는다.
 *   이어 붙여 한 칸에 담으면 다시 못 가른다.
 *
 * ★★**사진 링크는 «차번 셀»에 걸려 있다** — 값이 아니라 서식(`textFormatRuns.format.link`)이다.
 *   사장님 2026-08-26 「차량번호 누르면 들어가는거」. 그래서 값만 읽으면 «안 보인다» —
 *   `includeGridData` 로 격자를 통째로 받아야 한다(집 규칙: 사진은 차번 셀 링크에도 있다).
 *   ⚠ **판단하지 않는다.** 그 차 것인지는 공급사 시트에 넣을 때 문지기가 이미 봤다.
 *
 * ⚠ **덮어쓰지 않는다.** 이미 아는 값은 새 값이 «있을 때만» 바뀐다(`mergeEntry`).
 * ⚠ 저장은 `v4/plate_registry` 한 곳. v3 노드는 건드리지 않는다.
 *
 *   npx tsx scripts/build-plate-registry.mts            무엇이 쌓일지만 본다
 *   npx tsx scripts/build-plate-registry.mts --apply    실제로 쌓는다
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { mergeAll, carName, type PlateEntry, type PlateInput } from '../lib/domain/plate-registry';

const APPLY = process.argv.includes('--apply');
const NODE = 'v4/plate_registry';
/** ★앞머리로 찾는다 — 탭 이름 뒤에 날짜·대수가 붙는다. */
const TAB_HEADS = ['상품리스트', '손오공구독', '픽업구독', '오플구독'];

const S = (v: unknown) => String(v ?? '').trim();
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (path: string) => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, { headers: { Authorization: `Bearer ${t}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 200)}`);
  return x ? JSON.parse(x) : {};
};

console.log(`\n■ 차량번호 대장 — 상품시트에서 ${APPLY ? '(반영)' : '(dry-run)'}\n`);

const meta = await api(`${SALES_SHEET_ID}?fields=properties.title,sheets.properties.title`) as
  { properties?: { title?: string }; sheets: { properties: { title: string } }[] };
console.log(`   ${S(meta.properties?.title)}`);

const rows: PlateInput[] = [];
for (const head of TAB_HEADS) {
  const tab = meta.sheets.map((s) => S(s.properties.title)).find((t) => t.startsWith(head));
  if (!tab) { console.log(`   ✕ 「${head}…」 탭을 못 찾았다`); continue; }

  // ★격자로 받는다 — 사진 링크가 «셀 서식»에 있어 값만 읽으면 안 보인다.
  const range = `'${tab.replace(/'/g, "''")}'!A1:CZ4000`;
  const grid = await api(`${SALES_SHEET_ID}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=${encodeURIComponent('sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns.format.link.uri)')}`) as
    { sheets?: { data?: { rowData?: { values?: { formattedValue?: string; hyperlink?: string; textFormatRuns?: { format?: { link?: { uri?: string } } }[] }[] }[] }[] }[] };
  const rowData = grid.sheets?.[0]?.data?.[0]?.rowData || [];
  const all = rowData.map((r) => (r.values || []).map((c) => S(c?.formattedValue)));
  /** 그 줄 차번 셀에 걸린 링크. `hyperlink` 든 글자 서식이든 다 본다. */
  const linkAt = (row: number, col: number) => {
    const c = rowData[row]?.values?.[col];
    return S(c?.hyperlink) || S(c?.textFormatRuns?.find((x) => x?.format?.link?.uri)?.format?.link?.uri);
  };
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) { console.log(`   ✕ 「${tab}」 머리글에 «차량번호»가 없다`); continue; }

  const h = all[hi];
  const at = (n: string) => h.indexOf(n);
  // ⚠ 공급사는 «맨 끝»(68열 중 마지막)이다. 앞 26칸만 보면 없는 줄 안다(2026-08-26).
  const iP = at('차량번호'); const iM = at('모델'); const iSm = at('세부모델');
  const iT = at('세부트림'); const iS = at('공급사');
  if (iS < 0) console.log(`   ⚠ 「${tab}」 에 «공급사» 칸이 없다 — 공급사는 비워 담는다`);

  const list: PlateInput[] = [];
  for (let r = hi + 1; r < all.length; r++) {
    const row = all[r];
    if (!S(row[iP])) continue;
    list.push({
      plate: row[iP],
      model: iM >= 0 ? row[iM] : '',
      subModel: iSm >= 0 ? row[iSm] : '',
      trim: iT >= 0 ? row[iT] : '',
      supplier: iS >= 0 ? row[iS] : '',
      photo: linkAt(r, iP),
    });
  }
  rows.push(...list);
  console.log(`   ${tab.padEnd(30)} ${list.length}대`);
}

const haveSnap = await db.ref(NODE).get().catch(() => null);
const have = (haveSnap?.val() || {}) as Record<string, PlateEntry>;
const { changed, added, updated, skipped } = mergeAll(have, rows, today);
const after = { ...have, ...changed };

console.log(`\n   대장에 있던 것 ${Object.keys(have).length}대`);
console.log(`   새로 담김 ${added} · 값이 바뀜 ${updated} · 차번이 아니라 거른 것 ${skipped}`);
console.log(`   쌓인 뒤 모두 ${Object.keys(after).length}대`);

const gap = (k: keyof PlateEntry) => Object.values(after).filter((e) => !S(e[k])).length;
console.log(`   빈칸 — 모델 ${gap('model')} · 세부모델 ${gap('subModel')} · 세부트림 ${gap('trim')} · 공급사 ${gap('supplier')}`);
console.log(`   ★사진 링크가 있는 차 ${Object.values(after).filter((e) => S(e.photo)).length}대 / ${Object.keys(after).length}`);

for (const e of Object.values(changed).slice(0, 5)) {
  console.log(`      ${e.plate.padEnd(10)} ${carName(e).padEnd(26)} ${e.supplier || '공급사?'}`);
}

if (!APPLY) { console.log('\n   --apply 를 붙이면 쌓습니다.\n'); process.exit(0); }
if (!Object.keys(changed).length) { console.log('\n   바뀐 것이 없습니다.\n'); process.exit(0); }

// ★한 번에 쓴다. 줄마다 쓰면 수백 번 왕복한다.
await db.ref(NODE).update(changed);
console.log(`\n   ✓ ${NODE} 에 ${Object.keys(changed).length}줄 반영\n`);
process.exit(0);
