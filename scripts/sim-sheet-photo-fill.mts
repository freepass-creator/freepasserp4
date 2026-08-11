/**
 * **시트 링크 사진이 상품까지 «꽂히나» — 실제 유입 경로로 끝까지 태워 센다. 쓰기 없음.**
 *
 * 시트에는 사진 열이 없다. 공급사는 차량번호 셀에 링크를 건다(하이퍼링크·스마트칩).
 * `audit-sheet-photo-links` 는 그 링크가 «시트에 있나»만 봤다. 여기서는 그 다음을 본다 —
 * 링크가 `photoByPlate` 로 나와서 `importSheetTable` 이 `photo_link` 에 실제로 채우는가.
 *
 * 미리보기 화면(SyncPreview)의 「사진 없음」 칩과 같은 값이어야 한다. 다르면 둘 중 하나가 거짓말이다.
 *
 *   npx tsx scripts/sim-sheet-photo-fill.mts            # 시트 URL 있는 공급사 전체
 *   npx tsx scripts/sim-sheet-photo-fill.mts --code=RP004
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { importSheetTable, parseMappingProfile, parseMappingHeaderSignature, parseDepositRule } from '../lib/domain/sheet-import';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { importAutoplusMerged } from '../lib/domain/sheet-autoplus';
// 서버 래퍼(lib/server/google-sheet-visible)는 'server-only' 라 스크립트에서 못 부른다.
// 정작 검증하려는 «그리드 → 행+사진링크» 변환은 도메인 함수라 그대로 쓴다 — OAuth/fetch만 여기서 한다.
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import { JWT } from 'google-auth-library';
import type { EntityRecord } from '../lib/intake/entities';

const GRID_FIELDS = [
  'sheets(properties(sheetId,title,hidden)',
  'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
].join(',');

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
}
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();
const S = (v: unknown) => String(v ?? '').trim();
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();

const mergeNodes = (a: unknown, b: unknown) => {
  const m: Record<string, EntityRecord> = {};
  for (const [k, v] of Object.entries((a || {}) as Record<string, EntityRecord>)) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((b || {}) as Record<string, EntityRecord>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};

async function main() {
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const fetchGrid = async (id: string, gid: string) => {
    const meta = await (await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )).json() as SheetsGridResponse;
    const target = meta.sheets?.find((item) => item.properties?.sheetId === Number(gid));
    if (!target?.properties) throw new Error(`탭 없음(gid ${gid})`);
    const a1 = `'${String(target.properties.title || '').replace(/'/g, "''")}'`;
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(a1)}&fields=${encodeURIComponent(GRID_FIELDS)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await res.json() as SheetsGridResponse & { error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message || `Sheets API ${res.status}`);
    return visibleRowsFromGridResponse(body, gid);
  };

  const [t3, t4, m3, m4] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners').get(),
    db.ref('vehicle_master').get(), db.ref('v4/vehicle_master').get(),
  ]);
  const partners = mergeNodes(t3.val(), t4.val());
  const master = Object.values(mergeNodes(m3.val(), m4.val())).filter(Boolean);

  console.log('\n══ 시트 링크 → photo_link 실측 (쓰기 없음) ══\n');
  let allIn = 0, allPhoto = 0;

  for (const p of Object.values(partners)) {
    const code = S(p.partner_code) || S(p._key);
    if (ONLY && code !== ONLY) continue;
    if (!S(p.sheet_url) || p._deleted === true || S(p.status) === 'deleted') continue;
    const adapter = resolveAdapter(p);
    const id = (S(p.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];

    // 오토플러스는 본탭∪프로모션을 한 번에 병합하는 전용 경로가 정본이다 — 탭별로 돌리면
    // 프로모션 전용 가격이 안 붙어 전량 «가격없음»이 된다. 화면과 같은 경로로 태운다.
    if (adapter.id === 'autoplus') {
      if (!id) { console.log(`⏭  ${code.padEnd(9)} 시트 ID 없음`); continue; }
      try {
        const r = await importAutoplusMerged({
          url: S(p.sheet_url), providerCode: code, entries: master as never,
          profile: parseMappingProfile(p.mapping_profile),
          profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
          headerRow: Math.max(0, Number(p.header_row) || 0),
          depositRule: parseDepositRule(p.deposit_rule),
          fetchTable: async (url, gid, options = {}) => {
            const grid = await fetchGrid((url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || '', String(gid || '0'));
            options.onPhotoByPlate?.(grid.photoByPlate || {});
            return grid.rows;
          },
        });
        const withPhoto = r.products.filter((x) => S(x.photo_link)).length;
        allIn += r.products.length; allPhoto += withPhoto;
        console.log(`${withPhoto ? '✅' : '❌'} ${code.padEnd(9)} ${(S(p.name) || S(p.partner_name)).padEnd(16).slice(0, 16)} 사진 ${withPhoto}/${r.products.length}대  (본탭∪프로모)`);
        for (const x of r.products.filter((y) => S(y.photo_link)).slice(0, 2)) console.log(`      ${S(x.car_number)}  ${S(x.photo_link)}`);
      } catch (e) {
        console.log(`❌ ${code.padEnd(9)} 오토플러스 경로 실패 — ${String((e as Error).message || e)}`);
      }
      continue;
    }

    const gids = (S(p.sheet_gid) || S(p.sheet_tab) || '').split(/[,\s|]+/).filter(Boolean);
    if (!id || !gids.length) { console.log(`⏭  ${code.padEnd(9)} gid 미설정 — 숨김행 제외 경로 불가`); continue; }

    let imported = 0, withPhoto = 0, linkKeys = 0;
    const sample: string[] = [];
    for (const gid of gids) {
      let grid;
      try { grid = await fetchGrid(id, gid); } catch (e) { console.log(`   gid ${gid}: ❌ ${String((e as Error).message || e)}`); continue; }
      const photoByPlate = grid.photoByPlate || {};
      linkKeys += Object.keys(photoByPlate).length;
      const table = adapter.prepareTable(grid.rows, { headerRow: Math.max(0, Number(p.header_row) || 0) });
      if (table.length < 2) continue;
      let r;
      try {
        r = importSheetTable(table, {
          providerCode: code, entries: master as never,
          profile: parseMappingProfile(p.mapping_profile),
          profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
          depositRule: parseDepositRule(p.deposit_rule),
          photoByPlate,
        });
      } catch (error) {
        console.log(`   ${code} gid ${gid}: ❌ 가져오기 실패 — ${String((error as Error).message || error)}`);
        console.log(`      감지 헤더: ${table[0]?.slice(0, 20).join(' | ') || '(없음)'}`);
        continue;
      }
      imported += r.products.length;
      for (const x of r.products) {
        if (!S(x.photo_link)) continue;
        withPhoto++;
        // ⚠ 링크는 자르지 않는다 — 잘린 주소로 «없는 폴더»를 조회한 사고가 있었다.
        if (sample.length < 2) sample.push(`${S(x.car_number)}  ${S(x.photo_link)}`);
      }
    }
    allIn += imported; allPhoto += withPhoto;
    console.log(`${withPhoto ? '✅' : '❌'} ${code.padEnd(9)} ${(S(p.name) || S(p.partner_name)).padEnd(16).slice(0, 16)} 사진 ${withPhoto}/${imported}대  (셀링크 ${linkKeys}개)`);
    for (const s of sample) console.log(`      ${s}`);
  }

  console.log(`\n  합계 ${allPhoto}/${allIn}대에 photo_link\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
