/**
 * **하허호 전용 상품시트 F86 발행기** — 원자 스냅샷 하나 → «발행 계획»(`lib/server/channel-f86-plan`) → 시트.
 *
 * ★사장님 2026-09-16 「일단 중요한 건 SSOT이고 … 그중 하허호 시트는 제일 중요하게 관리해야 한다고」.
 *   칸·줄·값·차례는 «계획» 한 벌에서만 나온다 — 감사기(`audit-f86-vs-atom`)가 같은 계획으로 시트를 칸 단위로 대조한다.
 *   규격 정본 = `docs/영업자시트-매뉴얼.md` §하허호 F86 · 잠금 = `check:f86` · 운영 쓰기 = 통합 워크플로만(`production-sheet-write-gate`).
 * ⚠ 영업채널에 주는 것이라 **원가·수수료는 한 칸도 넣지 않는다.** 판매시트(본시트)는 읽지도 쓰지도 않는다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/build-channel-supplier-sheet.mts --채널=하허호 [--apply --snapshot=<고정 스냅샷> [--시트=<미리보기 사본 id>]]
 */
import { spawnSync } from 'node:child_process';
import { JWT } from 'google-auth-library';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { erp5InventoryAppOptions } from '../lib/server/erp5-inventory-service-account';
import { captureSalesPublishSnapshot, readSalesPublishSnapshot, salesPublishTabMark } from '../lib/server/sales-publish-snapshot';
import { buildSalesFormatRequests, columnWidths } from '../lib/domain/sales-sheet-format';
import { HAHUHO_PRODUCT_SHEET_ID } from '../lib/domain/legacy-sheets';
import { assertProductionSheetWrite } from '../lib/server/production-sheet-write-gate';
import { ensureNoticeTab } from '../lib/server/channel-sheet-tabs';
import { applyRetroSkin, retroTabColorRequest } from '../lib/domain/channel-retro-skin';
import { buildF86Plan } from '../lib/server/channel-f86-plan';
import { googleSheetsServiceAccount } from '../lib/server/google-service-account';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const channel = S(arg('채널')) || '하허호';
/**
 * ★**미리보기 사본에 찍기** — `--시트=<사본 문서 id>`. 운영 F86 을 덮기 전에 사람이 눈으로 본다.
 *   ⚠ 운영 F86 id 를 주면 막는다(그건 --시트 없이 부르는 길이다). 이름 검사도 사본이라 건너뛴다.
 */
const 미리보기 = S(arg('시트'));
/** ★하허호는 «레트로 겉» — 글꼴·정렬·색·폭은 옛 「프리패스 공급사 상품리스트」(`lib/domain/channel-retro-skin`). */
const RETRO = channel === '하허호';
const snapshotPath = arg('snapshot');
if (APPLY && !snapshotPath) throw new Error('채널시트 발행은 --snapshot=<회차별 고정 스냅샷>이 필요하다. 먼저 capture:sales-publish를 실행하라.');
/**
 * ★문서 이름 = 「[F코드 사용중] 프리패스x<채널> 전용 상품시트」 (사장님 2026-09-08).
 *   F코드 정본은 `lib/server/channel-sheet-tabs` 의 `CHANNEL_F_CODE`(영업채널 = F80번대)와 지도 `aiops/docs/SHEET_MAP.md`.
 */
const CHANNEL_PRODUCT_F: Record<string, string> = { 하허호: 'F86' };
const DOC_NAME = `[${CHANNEL_PRODUCT_F[channel] || 'F8?'} 사용중] 프리패스x${channel} 전용 상품시트`;
const sheetsAccount = googleSheetsServiceAccount('tmp/firebase-auth/sa.json');
/**
 * ★Firestore 는 «스냅샷 파일이 없을 때만» 연다 — gate 엔진의 ERP5 문(`erp5InventoryAppOptions`).
 *   ⚠ `firebaseAdminApp()` 은 RTDB 주소를 요구한다 — RTDB 는 영구 폐기라 그 길로 가지 않는다. 발행(--apply)은 늘 --snapshot.
 */
const publishSnapshot = snapshotPath
  ? readSalesPublishSnapshot(snapshotPath)
  : await captureSalesPublishSnapshot(getFirestore(initializeApp(erp5InventoryAppOptions())));
const jwt = new JWT({
  email: sheetsAccount.client_email, key: sheetsAccount.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
/** ★얼마나 두드렸나를 센다 — 구글 시트는 «분당» 한도라, 넘으면 그 회차가 통째로 죽는다(2026-09-08 429). */
const 셈 = { 읽기: 0, 쓰기: 0, 재시도: 0, 시작: Date.now() };
const api = async (u: string, init?: RequestInit): Promise<any> => {
  if (String(init?.method || 'GET').toUpperCase() === 'GET') 셈.읽기++; else 셈.쓰기++;
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { 셈.재시도++; await new Promise((k) => setTimeout(k, 4000 * (n + 1))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};

/**
 * ★★**계획 한 벌** — 줄은 «원자»에서 만든다(판매시트를 다시 읽지 않는다 · 사장님 2026-09-09).
 *   실을 차·탭·줄 차례·칸·값·굳힌 양식 판정은 전부 `buildF86Plan` 이 정하고, 감사기도 같은 함수로 기대값을 만든다.
 */
const mark = salesPublishTabMark(publishSnapshot);
const plan = await buildF86Plan({ snapshot: publishSnapshot, mark, channel });
console.log(`  공급사 이름 ${plan.nameByProvider.size}개 · 전용계좌 ${plan.acctCount}개 (공용 문맥)`);
if (plan.inventoryViolation) { console.error(`  ⛔ 재고 계약 위반 — ${plan.inventoryViolation}`); process.exit(1); }
if (plan.invalidPlates.length) {
  for (const c of plan.invalidPlates.slice(0, 10)) console.error(`  ⛔ 차번 아님: ${c}`);
  console.error('  채널시트를 건드리기 전에 중단한다.');
  process.exit(1);
}
console.log(`  원자에서 만든 줄 ${plan.rowsAll.length} — ${plan.kindSummary}`);
/** ★공급사를 모르는 차는 채널에 안 내보낸다 — 고칠 곳은 문패의 공급사명이지 이 시트가 아니다. */
if (plan.unnamed.length) console.log(`  ⚠ 공급사 이름을 모르는 차 ${plan.unnamed.length}대 — 채널에 안 내보낸다(문패 「공급사명」을 채워라): ${plan.unnamed.slice(0, 6).map((x) => S(x.cells['차량번호'])).join(' · ')}`);
if (APPLY && plan.unnamed.length) { console.error('  ⛔ 공급사명이 없는 차를 누락한 채 운영 채널시트를 덮지 않는다.'); process.exit(1); }
if (RETRO && plan.shortOnly.length) console.log(`   ○ 장기 요금 없는 차 ${plan.shortOnly.length}대 — 싣되 요금 칸은 빈 채(F01 과 대수를 맞춘다): ${plan.shortOnly.slice(0, 6).map((x) => `${S(x.cells['차량번호'])}(${x.company})`).join(' · ')}`);
console.log(`\n■ ${DOC_NAME} — 회사 ${plan.order.length}곳 · 총 ${plan.rowsAll.length}대 · 열 ${plan.columns.length}`);
for (const t of plan.tabs) console.log(`   ${String(t.rows.length).padStart(4)}  ${t.company.padEnd(10)} 칸 ${t.cols.length}`);
/** ★★하허호 «굳힌 양식» 문지기 — 표 밖 회사·표 밖 요금 칸에 값이 오면 멈춘다(판정은 계획의 layoutViolations). */
if (RETRO) {
  if (plan.layoutViolations.length) {
    for (const m of plan.layoutViolations) console.error(`  ⛔ 굳힌 양식 밖 — ${m}`);
    if (APPLY) { console.error('  ⛔ 하허호 F86 굳힌 양식과 다른 데이터 — 채널시트를 건드리지 않고 멈춘다(lib/domain/channel-retro-skin.ts 표).'); process.exit(1); }
  } else console.log('   ○ 굳힌 양식 — 탭 차례·요금 칸 표 안에 다 든다');
}
if (!APPLY) { console.log('\n※ dry-run — --apply 로 만든다.\n'); process.exit(0); }

/**
 * ★★**F86 확정 규격 잠금 — 어긋난 규격으로는 «시트를 안 건드린다»** (사장님 2026-09-16 「이제 픽스해서 규격화해」).
 *   규격 정본 = `docs/영업자시트-매뉴얼.md` §하허호 F86 «완전 커스텀 레트로» · 검사 = `scripts/check-f86-locked.mts`.
 */
if (RETRO) {
  const lock = spawnSync('npx', ['tsx', '--require', './scripts/lib/server-only-shim.cjs', 'scripts/check-f86-locked.mts'], { stdio: 'inherit', shell: true });
  if (lock.status !== 0) {
    console.error('  ⛔ F86 확정 규격 잠금(check:f86)이 어긋났다 — 채널시트를 건드리지 않고 멈춘다.');
    process.exit(1);
  }
}

// 준비 시간이 길었어도 실제 운영 시트를 건드리기 직전에 신선도와 해시를 다시 확인한다.
readSalesPublishSnapshot(snapshotPath);

// ── 채널 문서. 운영 중인 하허호 F86은 이름이 아니라 불변 ID로 고정한다. ──
if (미리보기 && 미리보기 === HAHUHO_PRODUCT_SHEET_ID) throw new Error('--시트 는 미리보기 사본용이다 — 운영 F86 은 --시트 없이 부른다');
/** ★운영 F86 은 통합 워크플로만 쓴다(`production-sheet-write-gate` · 사장님 2026-09-16). 미리보기 사본은 막지 않는다. */
if (!미리보기 && channel === '하허호') assertProductionSheetWrite('F86', 'build-channel-supplier-sheet --apply');
const fixedId = 미리보기 || (channel === '하허호' ? HAHUHO_PRODUCT_SHEET_ID : '');
let id = fixedId;
if (미리보기) {
  console.log(`   ○ 미리보기 사본에 찍는다 — ${미리보기}`);
} else if (id) {
  const fixedMeta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title`);
  if (S(fixedMeta?.properties?.title) !== DOC_NAME) {
    throw new Error(`F86 불변 ID의 문서명이 다르다: ${S(fixedMeta?.properties?.title)} (${id})`);
  }
} else {
  const q = encodeURIComponent(`name = '${DOC_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  id = (found.files || [])[0]?.id || '';
}
if (!id) {
  const made = await api('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST', body: JSON.stringify({ properties: { title: DOC_NAME, locale: 'ko_KR', timeZone: 'Asia/Seoul' } }),
  });
  id = made.spreadsheetId;
  await api(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false`, {
    method: 'POST', body: JSON.stringify({ type: 'domain', domain: 'teamjpk.com', role: 'writer' }),
  });
  console.log('   ✓ 새로 만들었다 · 회사(teamjpk.com)에만 열었다 — 채널에 주는 것은 사람이 누른다');
}
/**
 * ★공지사항은 채널 정산시트와 «같은 것»(`ensureNoticeTab`) · 이미 있으면 손대지 않는다(적어 둔 공지가 날아간다).
 * ★★2026-09-16 (사장님 「그리고 f86은 공지사항 탭 지워주시고」) — **하허호 F86 엔 공지사항 탭이 없다.**
 *   만들지 않고, 이미 있으면 아래 묵은 탭 정리에서 지운다. 그 밖 채널 시트는 예전대로 만든다.
 */
if (!RETRO) {
  const tok = async () => (await jwt.getAccessToken()).token;
  const made = await ensureNoticeTab(tok, id);
  console.log(`   ${made ? '+ 「공지사항」 만듦' : '○ 「공지사항」 있음 — 손대지 않음'}`);
}
const cur = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets(properties(sheetId,title),conditionalFormats(ranges(sheetId)))`);
const have: [string, any][] = (cur.sheets || []).map((s: any) => [S(s.properties.title), s.properties]);
/** ★탭에 쌓인 조건부서식 수 — 서식기는 규칙을 «더하기»만 한다(운영 손오공 탭에 7,034개 쌓였던 적 · 2026-09-15). 매 회차 먼저 걷는다. */
const 규칙수 = new Map<number, number>((cur.sheets || []).map((s: any) => [Number(s.properties.sheetId), (s.conditionalFormats || []).length]));

const reqs: any[] = [];
/** ★차번 셀 링크 요청 — 값 쓰기 «뒤»에 따로 보낸다(먼저 보내면 값 쓰기가 지운다 · 2026-09-09 703대 링크 0). */
const 링크요청: any[] = [];
const puts: { range: string; values: (string | number)[][] }[] = [];
/** 이번 회차에 실제로 채운 탭 — 여기 없는 회사 탭은 묵은 것이라 지운다(아래). */
const 쓴탭 = new Set<number>();
/** 탭 자리 — 하허호는 「상품리스트」가 맨 앞(공지사항이 없다) · 그 밖 채널은 0 번이 공지사항. */
let index = RETRO ? 0 : 1;
for (const tab of plan.tabs) {
  const { company, cols, body, values, title, rows } = tab;
  const old = have.find(([t]) => title === company ? (t === company || t.startsWith(`${company} `)) : t.startsWith(`${company} `));
  let gid: number;
  if (old) {
    gid = Number(old[1].sheetId);
    reqs.push({ updateSheetProperties: { properties: { sheetId: gid, title, index }, fields: 'title,index' } });
  } else {
    const made = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title, index, gridProperties: { rowCount: rows.length + 30, columnCount: cols.length } } } }] }),
    });
    gid = Number(made.replies[0].addSheet.properties.sheetId);
  }
  reqs.push({ updateCells: { range: { sheetId: gid }, fields: 'userEnteredValue' } });
  for (let k = 0; k < (old ? 규칙수.get(gid) || 0 : 0); k++) reqs.push({ deleteConditionalFormatRule: { sheetId: gid, index: 0 } });
  reqs.push({ updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, rowCount: rows.length + 30, columnCount: cols.length } }, fields: 'gridProperties(frozenRowCount,rowCount,columnCount)' } });
  /** ★숨김은 «다 편 뒤» 이름으로 다시 접는다 — 칸 자리가 바뀌면 지난 회차 숨김이 옛 자리에 남는다(2026-09-15). */
  reqs.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: cols.length }, properties: { hiddenByUser: false }, fields: 'hiddenByUser' } });
  /** ★서식은 판매시트와 «같은 한 벌»(`buildSalesFormatRequests`) 위에 하허호만 레트로 겉을 덮는다. */
  const 서식 = buildSalesFormatRequests({
    gid, columns: cols, headerAt: 0, widths: columnWidths(cols, body),
    columnCountNow: cols.length, tabTitle: title, body, linkOut: 링크요청,
  }) as any[];
  reqs.push(...(RETRO ? applyRetroSkin(서식, 링크요청, { gid, columns: cols, headerAt: 0, body }) : 서식));
  const TAB_HUES = [
    { red: 0.10, green: 0.24, blue: 0.47 }, { red: 0.65, green: 0.20, blue: 0.20 },
    { red: 0.16, green: 0.44, blue: 0.30 }, { red: 0.50, green: 0.35, blue: 0.06 },
    { red: 0.38, green: 0.24, blue: 0.53 }, { red: 0.13, green: 0.42, blue: 0.47 },
    { red: 0.58, green: 0.30, blue: 0.12 }, { red: 0.30, green: 0.30, blue: 0.30 },
  ];
  reqs.push(RETRO ? retroTabColorRequest(gid, company) : { updateSheetProperties: { properties: { sheetId: gid, tabColor: TAB_HUES[index % TAB_HUES.length] }, fields: 'tabColor' } });
  reqs.push({ setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: cols.length } } } });
  puts.push({ range: `'${title}'!A1`, values: [cols, ...values] });
  쓴탭.add(gid);
  index++;
}

/**
 * ★★**이번에 안 쓴 회사 탭은 지운다** — 묵은 탭은 «덜 새로운 표»가 아니라 «틀린 표»다(2026-09-08).
 *   공지사항·안내 탭은 남긴다. ⚠ 채운 탭이 없으면 아무것도 안 지운다(못 읽은 회차가 회사 탭을 다 지우는 사고 방지).
 */
{
  /** ★★2026-09-16 — 하허호 F86 만 「공지사항」을 지킴에서 뺀다(사장님 「f86은 공지사항 탭 지워주시고」). 다른 채널 시트는 그대로 남긴다. */
  const 지킴 = RETRO ? /안내|이 시트|시트 지도/ : /공지|안내|이 시트|시트 지도/;
  const 버릴 = 쓴탭.size === 0 ? [] : have.filter(([t, p]) => !지킴.test(t) && !쓴탭.has(Number(p.sheetId)));
  if (!쓴탭.size) console.log('   ⚠ 이번 회차에 채운 탭이 없다 — 묵은 탭 정리를 «건너뛴다»(못 읽은 회차일 수 있다).');
  if (버릴.length) {
    console.log(`   ○ 묵은 탭 ${버릴.length}장 지움 — ${버릴.map(([t]) => t).join(' · ')}`);
    for (const [, p] of 버릴) reqs.push({ deleteSheet: { sheetId: Number(p.sheetId) } });
  }
}

/** ★서식 요청은 300개씩, 값은 탭 전부를 한 번에(`values:batchUpdate`) — 두드림 수가 곧 429 로 죽을 확률이다. */
for (let i = 0; i < reqs.length; i += 300) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs.slice(i, i + 300) }) });
}
for (let i = 0; i < puts.length; i += 40) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data: puts.slice(i, i + 40).map((p) => ({ range: p.range, values: p.values })) }),
  });
}
/** ★★마지막 — 차번 셀 링크. 값 쓰기가 끝난 «뒤»여야 한다. */
for (let i = 0; i < 링크요청.length; i += 300) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: 링크요청.slice(i, i + 300) }) });
}
console.log(`   ○ 구글 두드림 — 읽기 ${셈.읽기} · 쓰기 ${셈.쓰기} · 재시도 ${셈.재시도} · 서식요청 ${reqs.length} · 차번링크 ${링크요청.length} · ${Math.round((Date.now() - 셈.시작) / 1000)}초`);
console.log(`\n✓ 반영 완료 — 탭 ${plan.tabs.length}장 · ${plan.order.reduce((n, [, l]) => n + l.length, 0)}대 · 열 ${plan.columns.length}`);
console.log(`   https://docs.google.com/spreadsheets/d/${id}/edit`);
console.log(`   스냅샷 ${publishSnapshot.snapshotId} · ${publishSnapshot.capturedAt}`);
process.exit(0);
