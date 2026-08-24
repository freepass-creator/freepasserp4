/**
 * **차종사전(재고관리 드롭다운)을 «차종마스터»에서 만든다** → `public/data/vehicle-catalog.json`.
 *
 * ★사장님이 그린 구조(2026-08-23)
 *   「공급사가 편하게 입력 → 그걸 **차종마스터와 연동해서 정제칸에 반영**하고 →
 *    ERP 는 정제칸과 공급사가 올린 것을 **보여주기로 그대로 활용**한다 →
 *    **정제칸은 차종마스터를 그대로 가져온 것**이고 → **ERP 직접입력도 차종마스터 기준으로 설계**한다」
 *
 *   ```
 *   공급사 원문(편하게)  ─┐
 *                       ├─ 연동 ─▶ 정제칸(= 마스터 글자) ─▶ 판매시트 ─▶ ERP «보여주기»
 *   차종마스터 ──────────┘                                                  ▲
 *        └──────────────────────────────▶ ERP 직접입력 드롭다운 ────────────┘
 *   ```
 *
 *   **기준이 하나여야 정제칸과 ERP 입력이 저절로 같아진다.** 그래서 사전의 뿌리는 차종마스터다.
 *   ⚠ 처음엔 이걸 «정제칸에서 파생»으로 만들었다가 바로잡았다(2026-08-23) —
 *     그러면 사장님이 **마스터에 차종을 추가해도 드롭다운에 안 뜬다.** 방향이 거꾸로였다.
 *
 * 두 가지를 마스터에 얹는다:
 *   · **「AI 정제」 치환 사전** — 정제칸을 채울 때(`fill-supplier-ai-columns`) 쓰는 그 사전을 여기서도 태운다.
 *     안 태우면 드롭다운엔 「디 올 뉴 싼타페 MX5」가 뜨고 정제칸엔 「디 올 뉴 싼타페」가 들어가 **둘이 갈린다.**
 *   · **정제칸 실적(대수)** — 실제로 굴러가는 조합이 목록 위로 온다. 이름을 정하는 데는 안 쓴다.
 *
 *   npx tsx scripts/build-vehicle-catalog.mts                        # 무엇이 담기는지 보기만
 *   npx tsx scripts/build-vehicle-catalog.mts --apply                # public/data/vehicle-catalog.json 쓰기
 *   npx tsx scripts/build-vehicle-catalog.mts --apply --write-tab    # 시트 「차종사전」에도 비추기
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JWT } from 'google-auth-library';
import { buildCatalog } from '../lib/domain/vehicle-catalog';
import { SHEET_NAME_MATCH, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { SALES_SHEET_ID, MASTER_SHEET_ID } from '../lib/domain/legacy-sheets';
import { substFromAiRefineRows } from '../lib/domain/ai-refine-guard';

/** 사람이 손으로 차종을 더하는 자리. 숨은 탭이다 — 영업자 표를 어지럽히지 않는다. */
const CATALOG_TAB = '차종사전';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (u: string): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * ── ①「AI 정제」 치환 사전 — 정제칸을 채울 때와 **같은 사전**을 태운다.
 *   이걸 빼면 드롭다운엔 마스터 원문(「디 올 뉴 싼타페 MX5」)이 뜨고 정제칸엔 정제값이 들어가 둘이 갈린다.
 */
const SUBST = new Map<string, string>();
try {
  const v = await api(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent("'AI 정제'!A1:C4000")}`) as { values?: string[][] };
  const subst = substFromAiRefineRows((v.values || []) as string[][]);
  for (const [k, val] of subst.map) SUBST.set(k, val);
  console.log(`  치환 사전 「AI 정제」 ${SUBST.size}줄${subst.skipped ? ` · 개발코드 떨기 ${subst.skipped}줄 무시` : ''}`);
} catch (e) {
  console.log(`  ⚠ 「AI 정제」를 못 읽어 치환 없이 돈다 — ${String((e as Error).message).slice(0, 60)}`);
}
const clean = (col: string, val: string) => SUBST.get(`${col}|${S(val)}`) ?? S(val);

/** ── ② 차종마스터 — **사전의 뿌리**. 여기 없는 차는 드롭다운에도 없다(손으로는 칠 수 있다). */
const mv = await api(`${SH}/${MASTER_SHEET_ID}/values/${encodeURIComponent("'차종마스터'")}`) as { values?: string[][] };
const mrows = ((mv.values || []) as string[][]).map((r) => (r || []).map(S));
const mhead = mrows[0] || [];
const [cMaker, cModel, cSub, cTrim] = ['제조사', '모델', '세부모델', '세부트림'].map((n) => mhead.indexOf(n));
if (cMaker < 0 || cModel < 0) throw new Error('차종마스터에 「제조사」·「모델」 열이 없다 — 열 이름이 바뀌었는지 보라');
/**
 * ★**마스터 글자를 그대로 담는다 — 여기서 빼거나 바꾸지 않는다.**
 *   (사장님 2026-08-23 「니가 빼면 안 되고 있는 걸 그대로 갖고 오는 거잖아 · 그렇게 로직을 짜야 해」)
 * ⚠ 2026-08-23 오전에 「AI 정제」 치환을 태웠다가 되돌렸다. 개발코드(MX5·GN7)를 떼려던 것인데,
 *   그러면 드롭다운 이름과 마스터·정제칸이 갈린다. 이름이 잘못돼 보이면 **마스터 시트를 고친다.**
 */
const rows: { maker: string; model: string; sub_model: string; trim_name: string }[] = [];
for (const r of mrows.slice(1)) {
  const maker = S(r[cMaker]);
  if (!maker || !S(r[cModel])) continue;
  rows.push({
    maker,
    model: S(r[cModel]),
    sub_model: cSub >= 0 ? S(r[cSub]) : '',
    trim_name: cTrim >= 0 ? S(r[cTrim]) : '',
  });
}
console.log(`  차종마스터 ${rows.length}줄`);

/**
 * ── ③ 정제칸 실적 — **이름을 정하는 데는 안 쓴다.** 실제로 굴러가는 조합을 목록 위로 올리는 데만 쓴다.
 *   그리고 마스터에 아직 없는 조합이 정제칸에 있으면 그것도 담는다 — 굴러가는 차가 드롭다운에서 빠지면 안 된다.
 */
const live: { maker: string; model: string; sub_model: string; trim_name: string }[] = [];
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
for (const f of (found.files || [])) {
  const meta = await api(`${SH}/${S(f.id)}?fields=sheets.properties(title,hidden)`);
  for (const sh of (meta.sheets || [])) {
    const title = S(sh.properties.title);
    if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
    const v = await api(`${SH}/${S(f.id)}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:CZ700`)}`) as { values?: string[][] };
    const all = ((v.values || []) as string[][]).map((r) => (r || []).map(S));
    const hi = all.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const head = all[hi];
    const [ip, iMaker, iModel, iSub, iTrim] = ['차량번호', '제조사(정제)', '모델', '세부모델', '세부트림'].map((n) => head.indexOf(n));
    if (iMaker < 0 || iModel < 0) break;
    for (const r of all.slice(hi + 1)) {
      if (!S(r[ip])) continue;
      live.push({
        maker: S(r[iMaker]), model: S(r[iModel]),
        sub_model: iSub >= 0 ? S(r[iSub]) : '', trim_name: iTrim >= 0 ? S(r[iTrim]) : '',
      });
    }
    break;
  }
  await sleep(100);
}
console.log(`  정제칸 실적 ${live.length}줄`);

/**
 * ★**사람이 손으로 넣는 입구 — 판매시트 숨은 탭 「차종사전」**
 *   (사장님 2026-08-23 「필요하면 정제시트랑 차종마스터를 추가해서 반영할 거야」).
 *   재고에 아직 없는 차도 미리 적어 두면 재고관리 드롭다운에 바로 뜬다.
 *   ⚠ 탭이 없으면 그냥 파생분만 쓴다 — 없다고 멈추지 않는다.
 */
const byHand: { maker: string; model: string; sub_model: string; trim_name: string }[] = [];
try {
  const v = await api(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent(`'${CATALOG_TAB}'!A1:E2000`)}`) as { values?: string[][] };
  const all = ((v.values || []) as string[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('제조사'));
  if (hi >= 0) {
    const head = all[hi];
    const [im, imo, isb, itr, isrc] = ['제조사', '모델', '세부모델', '세부트림', '출처'].map((n) => head.indexOf(n));
    for (const r of all.slice(hi + 1)) {
      if (!S(r[im]) || !S(r[imo])) continue;
      /**
       * ⚠ **자기참조 오염을 막는다.** 이 탭엔 `--write-tab` 이 파생분(마스터·정제칸)까지 비춰 둔다.
       *   출처를 안 보고 통째로 읽으면 그 파생분이 다음 실행에서 **「손추가」로 둔갑**한다
       *   (2026-08-23 실측: 212줄이 그랬다). 그러면 마스터에서 지운 차종이 손추가로 되살아난다.
       *   「출처」 열이 있으면 **「손추가」인 줄만** 읽는다. 열이 없으면 사람이 손수 만든 표로 보고 전부 읽는다.
       */
      if (isrc >= 0 && S(r[isrc]) !== '손추가') continue;
      byHand.push({ maker: S(r[im]), model: S(r[imo]), sub_model: isb >= 0 ? S(r[isb]) : '', trim_name: itr >= 0 ? S(r[itr]) : '' });
    }
  }
  console.log(`  「${CATALOG_TAB}」 손추가 ${byHand.length}줄 (출처가 「손추가」인 줄만)`);
} catch {
  console.log(`  「${CATALOG_TAB}」 탭이 아직 없다 — 파생분만 쓴다(--write-tab 으로 만들 수 있다)`);
}

// 날짜는 인자로 받는다 — 스크립트가 «오늘»을 스스로 정하면 재실행 결과가 달라져 diff 를 못 믿는다.
const builtArg = process.argv.find((a) => a.startsWith('--built='));
const built = builtArg ? builtArg.slice('--built='.length) : new Date().toISOString().slice(0, 10);
const catalog = buildCatalog(rows, live, built, byHand);

console.log(`■ 차종사전 — 마스터 ${rows.length}줄 ▶ 조합 ${catalog.rows.length}가지 (${built})\n`);
const makers = new Map<string, number>();
for (const r of catalog.rows) makers.set(r.maker, (makers.get(r.maker) || 0) + 1);
for (const [m, n] of [...makers].sort((a, b) => b[1] - a[1])) console.log(`  ${m.padEnd(9)} ${String(n).padStart(3)}가지`);

const noTrim = catalog.rows.filter((r) => !r.trim_name).length;
const noSub = catalog.rows.filter((r) => !r.sub_model).length;
console.log(`\n  세부트림 빈 조합 ${noTrim} · 세부모델 빈 조합 ${noSub}`);
console.log('  (빈 축은 사전에 그대로 담는다 — 없는 것이 정상인 차가 있고, 억지로 채우면 옛 마스터와 같은 사고가 난다)');

if (!APPLY) { console.log('\n  (미리보기다 — 쓰려면 --apply)'); process.exit(0); }
const out = join(process.cwd(), 'public/data/vehicle-catalog.json');
writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`\n  ✓ ${out}`);

/**
 * `--write-tab` — 판매시트에 「차종사전」 탭을 만들고 지금 사전을 그대로 비춘다.
 * ★사람이 **아래에 줄을 더하면** 다음 갱신 때 「손추가」로 흡수된다(사장님 2026-08-23).
 * ⚠ 파생분은 매번 다시 쓰지만 **손추가 줄은 안 건드린다** — 넣어 둔 것이 날아가면 안 된다.
 */
if (!process.argv.includes('--write-tab')) {
  console.log('    (시트 「차종사전」에도 비추려면 --write-tab)');
  process.exit(0);
}

const writeApi = async (u: string, init: RequestInit) => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const sheetMeta = await api(`${SH}/${SALES_SHEET_ID}?fields=sheets.properties(sheetId,title)`);
const exists = (sheetMeta.sheets || []).some((s: any) => S(s.properties.title) === CATALOG_TAB);
if (!exists) {
  await writeApi(`${SH}/${SALES_SHEET_ID}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CATALOG_TAB, hidden: true } } }] }),
  });
  console.log(`    ✓ 탭 「${CATALOG_TAB}」 만들었다(숨김)`);
}

const header = [
  ['차종사전 — 재고관리 상품등록 드롭다운의 선택지'],
  ['「정제칸」 줄은 공급사 시트에서 자동으로 나옵니다. 여기서 고쳐도 다음 갱신에 덮입니다 — 고칠 곳은 공급사 정제칸입니다.'],
  ['「손추가」 줄은 사람이 적는 자리입니다. 아직 재고에 없는 차를 미리 넣어 두면 등록할 때 바로 고를 수 있고, 갱신해도 안 지워집니다.'],
  [''],
  ['제조사', '모델', '세부모델', '세부트림', '출처', '대수'],
];
const body = catalog.rows.map((r) => [r.maker, r.model, r.sub_model, r.trim_name, r.from, r.n ? String(r.n) : '']);
await writeApi(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent(`'${CATALOG_TAB}'!A1:F4000`)}:clear`, { method: 'POST', body: '{}' });
await writeApi(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent(`'${CATALOG_TAB}'!A1`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: [...header, ...body] }),
});
console.log(`    ✓ 「${CATALOG_TAB}」에 ${body.length}줄 비췄다 (손추가 ${catalog.rows.filter((r) => r.from === '손추가').length})`);
