/**
 * **공급사 원본(시트) 설정을 넣는다. 기본 미리보기, `--apply` 로 실행.**
 *
 * 연동이 «안 되는» 공급사 중 상당수는 코드가 아니라 설정이 비어 있는 것이다.
 * 실제로 이안카(RP031)는 어댑터·탭 순서 규칙까지 코드에 다 있는데 파트너 레코드에
 * sheet_url 이 없어 대상 목록(roster)에 아예 안 잡혔다 — 70대가 갱신 없이 굳어 있었다.
 *
 * 넣기 전에 «그 설정으로 읽으면 몇 대가 나오는지»를 먼저 보여준다. 설정만 꽂고 나중에
 * 검증에서 터지면 그때는 원인이 설정인지 시트인지 구분되지 않는다.
 *
 *   npx tsx scripts/apply-partner-source.mts --code=RP031 \
 *     --url=https://docs.google.com/spreadsheets/d/<ID>/edit \
 *     --gids=126495265,2008897223 --adapter=ianka --header-row=1
 *   ... --apply
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { SHEET_ADAPTERS, orderSheetGids, type SheetAdapterId } from '../lib/domain/sheet-adapters';
import { importSheetTable } from '../lib/domain/sheet-import';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import type { MasterEntry } from '../lib/domain/vehicle-master-match';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (name: string) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const APPLY = process.argv.includes('--apply');

const CODE = arg('code');
const URL_ARG = arg('url');
const GIDS = arg('gids').split(/[,\s]+/).filter(Boolean);
const ADAPTER = (arg('adapter') || 'generic') as SheetAdapterId;
const HEADER_ROW = Number(arg('header-row') || 0);

const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

const FIELDS = [
  'sheets(properties(sheetId,title,hidden)',
  'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
].join(',');

async function main() {
  if (!CODE || !URL_ARG) { console.log('--code=<공급사코드> --url=<시트URL> 이 필요하다'); return; }
  if (!SHEET_ADAPTERS[ADAPTER]) { console.log(`어댑터 알 수 없음 — ${ADAPTER}`); return; }
  const sheetId = (URL_ARG.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
  if (!sheetId) { console.log('구글시트 URL 형식 아님'); return; }

  const db = getDatabase();
  const [t3, t4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const live = (t3.val() || {}) as Record<string, Rec>;
  const over = (t4.val() || {}) as Record<string, Rec>;
  const key = [...new Set([...Object.keys(live), ...Object.keys(over)])]
    .find((k) => S({ ...live[k], ...over[k] }.partner_code) === CODE || k === CODE);
  if (!key) { console.log(`${CODE} 파트너 레코드 없음`); return; }
  const current = { ...(live[key] || {}), ...(over[key] || {}) };

  console.log(`\n══ ${CODE} ${S(current.name || current.partner_name)} 원본 설정 ${APPLY ? '(실행)' : '(미리보기)'} ══\n`);
  console.log(`  지금  시트 ${S(current.sheet_url) ? '있음' : '없음'} · gid ${S(current.sheet_gid) || '없음'} · 어댑터 ${S(current.sheet_adapter) || '(자동)'} · 헤더행 ${S(current.header_row) || 0}`);
  console.log(`  넣을 값  gid ${GIDS.join(',') || '(기본)'} · 어댑터 ${ADAPTER} · 헤더행 ${HEADER_ROW}`);

  // 넣기 전에 그 설정으로 실제로 읽어 본다 — 설정만 꽂고 나중에 터지면 원인 구분이 안 된다.
  const master = (JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')).entries || []) as MasterEntry[];
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const meta = await (await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )).json() as SheetsGridResponse & { error?: { message?: string } };
  if (meta.error) { console.log(`\n  ❌ 시트 접근 불가 — ${meta.error.message}\n`); return; }

  const adapter = SHEET_ADAPTERS[ADAPTER];
  let total = 0, invalid = 0;
  console.log('');
  for (const gid of orderSheetGids(adapter, GIDS.length ? GIDS : ['0'])) {
    const target = meta.sheets?.find((s) => s.properties?.sheetId === Number(gid));
    if (!target?.properties) { console.log(`  gid ${gid}: ❌ 탭 없음`); invalid++; continue; }
    const a1 = `'${String(target.properties.title || '').replace(/'/g, "''")}'`;
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?includeGridData=true&ranges=${encodeURIComponent(a1)}&fields=${encodeURIComponent(FIELDS)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await res.json() as SheetsGridResponse & { error?: { message?: string } };
    if (!res.ok) { console.log(`  gid ${gid}: ❌ ${body.error?.message}`); invalid++; continue; }
    const grid = visibleRowsFromGridResponse(body, gid);
    let table: string[][];
    try { table = adapter.prepareTable(grid.rows, { headerRow: HEADER_ROW }); }
    catch (e) { console.log(`  ${target.properties.title}: ❌ ${String((e as Error).message)}`); invalid++; continue; }
    const r = importSheetTable(table, { providerCode: CODE, entries: master });
    total += r.products.length;
    invalid += r.invalidCount;
    console.log(`  ${String(target.properties.title).padEnd(14).slice(0, 14)} gid ${gid.padEnd(11)} 올림 ${String(r.products.length).padStart(3)}  (무효 ${r.invalidCount} · 중복 ${r.duplicateCount} · 가격없음 ${r.noPriceCount} · 숨김행 ${grid.hiddenRowCount ?? 0} · 사진링크 ${Object.keys(grid.photoByPlate || {}).length})`);
    for (const s of r.issueSamples.slice(0, 3)) console.log(`      원문 확인 · ${s}`);
  }
  console.log(`\n  이 설정으로 올림 ${total}대 · 무효 ${invalid}건`);
  // 무효가 하나라도 있으면 커밋 경계에서 fail-closed 된다 — 설정을 넣기 전에 알려 준다.
  if (invalid) console.log('  ⚠ 무효 행이 있으면 검증이 차단된다(헤더행·원문부터 고칠 것)');

  if (!APPLY) { console.log('\n  ※ 위 결과가 맞으면 --apply\n'); return; }
  if (invalid) { console.log('\n  ❌ 무효 행이 있어 설정을 넣지 않는다. 헤더행·원문을 고친 뒤 다시.\n'); return; }

  await db.ref(`v4/partners/${key}`).update({
    sheet_url: URL_ARG,
    sheet_gid: GIDS.join(','),
    // ⚠ 어댑터 필드는 `adapter_id` 다(`effectiveSheetAdapterId`). `sheet_adapter` 로 쓰면
    //   조용히 generic 으로 읽혀 열 보정이 빠진다 — 실측(2026-08-07): 이안카가 그렇게 되어
    //   차번 칸에 차종 문자열이 들어와 무효 95건, 16곳 전체 반영이 막혔다.
    adapter_id: ADAPTER,
    header_row: HEADER_ROW,
    updated_at: Date.now(),
  });
  console.log(`\n  ✅ ${CODE} 원본 설정 완료 — 다음 검증부터 대상에 들어간다\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
