/**
 * **영업채널 카드시트 발행 — 「상품시트」 갈래.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21 — 「이거도 매뉴얼 만들어서 다른시트랑 동일하게 업데이트 될수 있게끔 / 상품시트 업데이트될때 같이 하게끔」
 *   → run-daily ④″ 단계에서 상품리스트·손오공구독·오플구독을 찍은 뒤 이어서 돈다.
 *
 * 하는 일 — 채널 문서의 탭을 통째로 비우고 다시 찍는다(사람이 고친 것은 남지 않는다).
 *   ① 공급사 제공시트 재고 탭에서 줄을 읽는다(출고불가만 제외 — 판매시트와 같은 기준)
 *   ② 같은 시트 「운영정책」 탭에서 조건 칸·머리띠 문구를 뽑는다(정책이 바뀌면 저절로 따라간다)
 *   ③ 카드(7행 × 13열)를 쌓고, 블록마다 머리 띠지를 둔다
 *   ④ 숨김 탭 「이 시트는」·「AI 운영 매뉴얼」을 다시 찍는다
 *   ⑤ 문서 이름을 「MMDD <채널> 상품카드 [영업채널] [연동중]」으로 맞추고, teamjpk.com 도메인 편집 권한을 확인한다
 *
 * 규격 정본은 lib/domain/channel-card-sheet.ts — 격자·색·글자 크기·채널 명부를 여기서 지어내지 않는다.
 *
 *   npx tsx scripts/publish-channel-cards.mts                      # 미리보기
 *   npx tsx scripts/publish-channel-cards.mts --apply              # 반영
 *   npx tsx scripts/publish-channel-cards.mts --channel=천이컴퍼니 --apply
 *   npx tsx scripts/publish-channel-cards.mts --apply --keep-no-price   # 대여료 없는 차도 싣는다
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  BANNER_HEIGHT, CARD_EXCLUDE, CARD_ROWS, CHANNELS, COLUMN_WIDTHS, FONT, ROW_HEIGHT, S,
  buildCard, cardMerges, cardPolicy, cell, channelDocTitle, channelIdentityRows, channelManualRows,
  toCardVehicle, type CardBlock, type CardVehicle, type Channel, type Rec,
} from '../lib/domain/channel-card-sheet';

const APPLY = process.argv.includes('--apply');
const KEEP_NO_PRICE = process.argv.includes('--keep-no-price');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY = arg('channel');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const SS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';

async function call(url: string, opts: Rec = {}): Promise<any> {
  const { token } = await jwt.getAccessToken();
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(opts.headers || {}) } });
  const t = await r.text();
  let j: any; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 500)}`);
  return j;
}
const values = async (id: string, tab: string) =>
  (await call(`${SS}/${id}/values/${encodeURIComponent(`${tab}!A1:BB2000`)}?valueRenderOption=FORMATTED_VALUE`)).values || [];

const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const mmdd = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 10).replace('-', '');

/** 재고 탭 한 장 읽기 — 머리글 이름으로 칸을 찾는다(열 위치로 읽지 않는다). */
async function readStock(b: CardBlock): Promise<{ rows: CardVehicle[]; dropped: { 출고불가: number; 값없음: string[] }; codes: Set<string> }> {
  const v = await values(b.sheetId, b.tab);
  const head = (v[0] || []).map((x: unknown) => S(x));
  const idx = (n: string) => head.indexOf(n);
  const codes = new Set<string>();
  const all = v.slice(1).filter((r: any[]) => S(r[0]));
  const kept = all.filter((r: any[]) => !CARD_EXCLUDE.test(S(r[idx('상태')])));
  const cards: CardVehicle[] = [];
  const 값없음: string[] = [];
  for (const r of kept) {
    const get = (n: string) => { const i = idx(n); return i < 0 ? '' : r[i]; };
    codes.add(S(get('정책코드')));
    const c = toCardVehicle(get, b.pricer);
    if (c.값없음 && !KEEP_NO_PRICE) { 값없음.push(`${c.차량번호}(${c.상태})`); continue; }
    cards.push(c);
  }
  cards.sort((a, b2) => `${a.차명}|${a.차량번호}`.localeCompare(`${b2.차명}|${b2.차량번호}`));
  return { rows: cards, dropped: { 출고불가: all.length - kept.length, 값없음 }, codes };
}

/** 운영정책 탭에서 한 줄(정책코드) 을 이름→값 으로. */
async function readPolicy(sheetId: string, code: string): Promise<Record<string, string>> {
  const v = await values(sheetId, '운영정책');
  const head = (v[0] || []).map((x: unknown) => S(x));
  const row = v.slice(1).find((r: any[]) => S(r[head.indexOf('정책코드')]) === code);
  if (!row) throw new Error(`운영정책에 ${code} 줄이 없습니다`);
  return Object.fromEntries(head.map((h: string, i: number) => [h, S(row[i])]).filter(([h]: any) => h));
}

/** 탭 하나를 통째로 다시 찍는 요청 묶음. */
function tabRequests(sheetId: number, title: string, blocks: { b: CardBlock; rows: CardVehicle[]; P: Rec }[], rowCount: number): Rec[] {
  const reqs: Rec[] = [];
  COLUMN_WIDTHS.forEach((pixelSize, i) =>
    reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize }, fields: 'pixelSize' } }));
  reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: rowCount }, properties: { pixelSize: ROW_HEIGHT }, fields: 'pixelSize' } });

  const banner = (rowIndex: number, text: string, size: number) => {
    reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 }, properties: { pixelSize: BANNER_HEIGHT }, fields: 'pixelSize' } });
    reqs.push({ updateCells: { start: { sheetId, rowIndex, columnIndex: 0 }, fields: 'userEnteredValue,userEnteredFormat',
      rows: [{ values: COLUMN_WIDTHS.map((_, i) => cell(i === 0 ? text : '', { size, bold: true, halign: 'LEFT', wrap: 'OVERFLOW_CELL', noBorder: true })) }] } });
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: COLUMN_WIDTHS.length }, mergeType: 'MERGE_ALL' } });
  };

  const total = blocks.reduce((a, x) => a + x.rows.length, 0);
  banner(0, `${title} 상품 · ${kst().slice(0, 10)} 기준 · 총 ${total}대`, 13);
  let r = 1;
  for (const { b, rows, P } of blocks) {
    banner(r, `▎${b.갈래} ${rows.length}대 · ${P.정비문구} · ${P.기본주행} · ${P.분납문구}`, 11);
    r += 1;
    for (const v of rows) {
      reqs.push({ updateCells: { start: { sheetId, rowIndex: r, columnIndex: 0 }, fields: 'userEnteredValue,userEnteredFormat,textFormatRuns', rows: buildCard(v, P as any).map((x) => ({ values: x })) } });
      reqs.push(...cardMerges(sheetId, r));
      r += CARD_ROWS;
    }
  }
  return reqs;
}

/** 숨김 안내 탭(「이 시트는」·「AI 운영 매뉴얼」). */
function noteTabRequests(sheetId: number, rows: string[][], widths: number[]): Rec[] {
  const reqs: Rec[] = [];
  widths.forEach((pixelSize, i) =>
    reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize }, fields: 'pixelSize' } }));
  reqs.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, fields: 'userEnteredValue,userEnteredFormat',
    rows: rows.map((r, i) => ({ values: r.map((t) => cell(t, { size: 10, bold: i === 0, halign: 'LEFT', wrap: 'WRAP', noBorder: true })) })) } });
  return reqs;
}

async function publish(ch: Channel) {
  console.log(`\n■ ${ch.이름} — https://docs.google.com/spreadsheets/d/${ch.문서}/edit`);
  const built: { tab: typeof ch.tabs[number]; blocks: { b: CardBlock; rows: CardVehicle[]; P: Rec }[] }[] = [];
  const counts: Record<string, number> = {};
  let 뺀값없음: string[] = [];

  for (const t of ch.tabs) {
    const blocks: { b: CardBlock; rows: CardVehicle[]; P: Rec }[] = [];
    for (const b of t.blocks) {
      const [{ rows, dropped, codes }, pol] = await Promise.all([readStock(b), readPolicy(b.sheetId, b.정책코드)]);
      const other = [...codes].filter((c) => c && c !== b.정책코드);
      if (other.length) console.log(`   ⚠ ${t.title}/${b.갈래} 재고 줄에 다른 정책코드가 섞여 있다: ${other.join(' ')} (카드는 ${b.정책코드} 기준)`);
      const P = cardPolicy(pol, b.pricer, b.override);
      counts[`${t.title}/${b.갈래}`] = rows.length;
      뺀값없음 = 뺀값없음.concat(dropped.값없음.map((x) => `${b.공급사}/${b.갈래} ${x}`));
      console.log(`   ${t.title} / ${b.갈래}: ${rows.length}대 (출고불가 ${dropped.출고불가}대 안 실음${dropped.값없음.length ? ` · 대여료 없는 차 ${dropped.값없음.length}대 뺌` : ''})`);
      console.log(`      조건 ${b.정책코드}: 소득증빙 ${P.소득증빙} · 만21세 ${P.만21세} · 면허1년미만 ${P.면허1년} · 카드결제 ${P.카드결제} · 보증금협의 ${P.보증금협의} / ${P.정비문구} / ${P.분납문구} / ${P.기본주행}`);
      blocks.push({ b, rows, P });
    }
    built.push({ tab: t, blocks });
  }
  if (뺀값없음.length) console.log(`   ⚠ 대여료가 한 칸도 없어 뺀 차: ${뺀값없음.join(' · ')} — 공급사 시트에 요금을 채우면 다음 발행에 실린다`);
  if (!APPLY) { console.log('   (미리보기 — --apply 를 붙여야 반영된다)'); return; }

  // 탭을 통째로 갈아 끼운다: 임시 탭 → 옛 탭 삭제 → 새 탭 → 임시 탭 삭제.
  const rowsOf = (i: number) => 1 + built[i].blocks.reduce((a, x) => a + 1 + x.rows.length * CARD_ROWS, 0) + 2;
  const meta = await call(`${SS}/${ch.문서}?fields=sheets.properties(sheetId,title)`);
  const NOTE = [{ id: 900, title: '이 시트는' }, { id: 901, title: 'AI 운영 매뉴얼' }];
  await call(`${SS}/${ch.문서}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
    { addSheet: { properties: { sheetId: 999, title: '__tmp__', index: 0 } } },
    ...meta.sheets.filter((x: Rec) => x.properties.sheetId !== 999).map((x: Rec) => ({ deleteSheet: { sheetId: x.properties.sheetId } })),
    ...ch.tabs.map((t, i) => ({ addSheet: { properties: { sheetId: t.sheetId, title: t.title, index: i, gridProperties: { rowCount: rowsOf(i), columnCount: COLUMN_WIDTHS.length } } } })),
    ...NOTE.map((n, i) => ({ addSheet: { properties: { sheetId: n.id, title: n.title, index: ch.tabs.length + i, hidden: true, gridProperties: { rowCount: 200, columnCount: 3 } } } })),
    { deleteSheet: { sheetId: 999 } },
  ] }) });

  const reqs: Rec[] = [];
  built.forEach((x, i) => reqs.push(...tabRequests(x.tab.sheetId, x.tab.title, x.blocks, rowsOf(i))));
  reqs.push(...noteTabRequests(900, channelIdentityRows(ch, counts, kst()).map((r) => [...r]), [190, 700, 420]));
  reqs.push(...noteTabRequests(901, channelManualRows(ch).map((r) => [...r]), [230, 900]));
  for (let i = 0; i < reqs.length; i += 150) {
    await call(`${SS}/${ch.문서}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs.slice(i, i + 150) }) });
    process.stdout.write('.');
  }

  // 이름 표기 · 워크스페이스 권한
  const title = channelDocTitle(ch.이름, mmdd());
  await call(`${DRIVE}/${ch.문서}?supportsAllDrives=true`, { method: 'PATCH', body: JSON.stringify({ name: title }) });
  const perms = await call(`${DRIVE}/${ch.문서}/permissions?fields=permissions(id,type,role,domain,emailAddress)&supportsAllDrives=true`);
  const hasDomain = (perms.permissions || []).some((p: Rec) => p.type === 'domain' && p.domain === 'teamjpk.com');
  if (!hasDomain) {
    await call(`${DRIVE}/${ch.문서}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, { method: 'POST', body: JSON.stringify({ role: 'writer', type: 'domain', domain: 'teamjpk.com' }) });
    console.log('\n   teamjpk.com 도메인 편집 권한 부여');
  }
  console.log(`\n   ✓ 반영 완료 — ${title}`);
}

const targets = CHANNELS.filter((c) => !ONLY || c.이름 === ONLY);
if (!targets.length) throw new Error(`채널을 못 찾았습니다: ${ONLY} (있는 것: ${CHANNELS.map((c) => c.이름).join(' ')})`);
for (const ch of targets) await publish(ch);
console.log(APPLY ? '\n끝.' : '\n끝(미리보기).');
