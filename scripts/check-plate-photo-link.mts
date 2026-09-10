/**
 * **차량번호 셀 사진 링크가 규격대로 걸렸는가** — 어긋나면 실패한다.
 *
 * ★사장님 2026-08-24 「손오공하고 오플은 들어가 있는데 상품리스트에는 링크가 없다고 사진링크가」
 *   「사진링크를 좀 동일하게 처리해줘야지」
 *   사장님이 «사진링크»라고 부르시는 것은 「사진」 칸의 주소 «글자»가 아니라 **차번 셀의 파란 링크**다.
 *   원본 오토플러스 시트가 「★★★ 차량번호 클릭 후 차량이미지 다운로드 가능합니다 ★★★」라고
 *   가르쳐 놓았고, 우리 표도 그 손버릇을 그대로 잇는다.
 *
 * ★**왜 갈렸나** — 발행기 두 곳이 각자 링크를 걸고 있었고, 상품리스트 쪽은 「사진」 칸이 아니라
 *   «원본 차번 셀 링크»만 보고 있었다. 원본에 링크가 없으니 늘 0대였다.
 *   지금은 서식층 `buildSalesFormatRequests` 맨 끝 한 곳만 건다.
 *
 * ★★**규격 = 「차번링크」 칸 하나**
 *   (정본 `lib/domain/sales-sheet-format.ts` 맨 끝 · 픽업 예외는 사장님 2026-08-28
 *    「픽업(T카)은 사진이 아니라 티카 상세페이지로 간다」).
 *
 * ⚠⚠ 2026-09-09 — 이 검사가 «사진만» 보고 있었다. 픽업 예외가 생겼는데 검사는 안 따라왔다.
 *   그래서 **픽업구독 224대·손오공구독 26대를 «어긋남»으로 찍었다 — 실제로는 규격대로 맞는 것들이었다.**
 *   ★거짓으로 우는 검사는 사람이 안 믿게 되고, **그 소음이 진짜 경보를 죽인다.**
 *   실제로 그 소음 뒤에 **채널시트(F86) 703대의 링크가 «한 대도» 없는** 사고가 숨어 있었다.
 *
 * 셋을 본다 —
 *   ① **소스**: 발행기가 링크를 따로 걸고 있지 않은가(또 갈리는 씨앗)
 *   ② **판매시트 F01**: 네 탭이 규격대로 걸렸는가
 *   ③ **채널시트 F86**: 같은 규격으로 걸렸는가 ← 안 보다가 사고가 났다
 *
 *   npm run check:photo-link
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HAHUHO_PRODUCT_SHEET_ID, SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';

const S = (v: unknown) => String(v ?? '').trim();
let bad = 0;

// ── ① 소스 — 발행기가 링크를 따로 걸면 안 된다
const PUBLISHERS = ['scripts/publish-origin-tab.mts', 'scripts/publish-sonogong-tab.mts'];
for (const f of PUBLISHERS) {
  const src = readFileSync(f, 'utf8');
  // 주석이 아닌 줄에서 링크를 «거는» 모양을 찾는다.
  const hit = src.split('\n').filter((l) => /link:\s*\{\s*uri/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  if (hit.length) {
    bad++;
    console.log(`  ✗ ${f} — 링크를 따로 건다(${hit.length}줄). 서식층 한 곳만 걸어야 한다.`);
  }
}
if (!bad) console.log('  ✓ 발행기는 링크를 따로 걸지 않는다 — 서식층 한 곳');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const tok = (await jwt.getAccessToken()).token;
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const get = async (u: string) => (await fetch(u, { headers: { Authorization: `Bearer ${tok}` } })).json() as any;

const GRID = 'sheets.data.rowData.values(formattedValue,hyperlink,userEnteredFormat.textFormat.link,textFormatRuns.format.link)';
const tx = (c: any) => S(c?.formattedValue);
/** 링크는 세 자리에 숨는다 — 셀 hyperlink · 칸 서식 · 글자 run. 하나만 보면 놓친다. */
const lk = (c: any) => S(c?.hyperlink) || S(c?.userEnteredFormat?.textFormat?.link?.uri)
  || S((c?.textFormatRuns || []).find((r: any) => r?.format?.link?.uri)?.format?.link?.uri);
/** 「사진」이 여러 장이면 차번 셀에는 «첫 장»만 건다 — 전체를 href 로 넣으면 깨진 링크가 된다. */
const 첫장 = (v: string) => S(S(v).split(/[\n,]/)[0]);
const 주소인가 = (v: string) => /^https?:\/\//i.test(v);

/** 한 탭을 잰다 — 어긋난 곳이 있으면 1, 없으면 0. */
async function 재다(sheetId: string, title: string, wide: boolean): Promise<number> {
  const range = `'${title.replace(/'/g, "''")}'!A1:CZ${wide ? 3000 : 700}`;
  const g = await get(`${SH}/${sheetId}?includeGridData=true&ranges=${encodeURIComponent(range)}&fields=${GRID}`);
  const rd = (g.sheets?.[0]?.data?.[0]?.rowData || []) as any[];
  const hi = rd.findIndex((r: any) => (r?.values || []).some((c: any) => tx(c) === '차량번호'));
  if (hi < 0) { console.log(`  ✗ ${title} — 「차량번호」 머리글을 못 찾았다`); return 1; }
  const head = (rd[hi]?.values || []).map(tx);
  const ip = head.indexOf('차량번호'), il = head.indexOf('차번링크');
  if (ip < 0 || il < 0) { console.log(`  ✗ ${title} — 「차량번호/차번링크」 칸이 없다`); return 1; }

  let rows = 0, 걸림 = 0, 티카 = 0; const off: string[] = [];
  for (let r = hi + 1; r < rd.length; r++) {
    const vs = rd[r]?.values || [];
    const plate = tx(vs[ip]); if (!plate) continue;
    rows++;
    const dl = 첫장(tx(vs[il]));
    const 규격 = 주소인가(dl) ? dl : '';
    const l = lk(vs[ip]);
    if (규격) {
      걸림++;
      try { if (/(^|\.)lotterentacar\.net$/i.test(new URL(규격).hostname)) 티카++; } catch { /* 위에서 주소 형식 검사 */ }
    }
    if (규격 && l !== 규격) off.push(`${plate} ${l ? '값≠링크' : '링크가 «빠졌다»'}`);
    if (!규격 && l) off.push(`${plate} 규격엔 없는데 링크가 «남았다»`);
  }
  const ok = off.length === 0;
  console.log(`  ${ok ? '✓' : '✗'} ${title.slice(0, 14).padEnd(15)} 줄 ${String(rows).padStart(4)} · 링크 있어야 ${String(걸림).padStart(4)}(티카 ${String(티카).padStart(3)}) · 어긋남 ${off.length}`);
  off.slice(0, 5).forEach((m) => console.log(`       ${m}`));
  return ok ? 0 : 1;
}

// ── ② 판매시트 F01
console.log('\n■ 판매시트 F01');
const meta = await get(`${SH}/${SALES_SHEET_ID}?fields=sheets.properties(title,hidden)`);
const titles = (meta.sheets || []).filter((s: any) => !s.properties.hidden).map((s: any) => S(s.properties.title));
for (const t of pickPublishedSalesTabs(titles)) bad += await 재다(SALES_SHEET_ID, t.title, false);

// ── ③ 채널시트 F86 — 여기를 안 봐서 703대 링크가 통째로 빠진 채 나갔다(2026-09-09)
console.log('\n■ 채널시트 F86(하허호)');
{
  const NAME = '[F86 사용중] 프리패스x하허호 전용 상품시트';
  const cid = HAHUHO_PRODUCT_SHEET_ID;
  const cmeta = await get(`${SH}/${cid}?fields=properties.title,sheets.properties(title,hidden)`);
  if (S(cmeta?.properties?.title) !== NAME) {
    bad++;
    console.log(`  ✗ F86 불변 ID의 문서명이 다르다: ${S(cmeta?.properties?.title)} (${cid})`);
  } else {
    const ctabs = (cmeta.sheets || []).filter((s: any) => !s.properties.hidden)
      .map((s: any) => S(s.properties.title)).filter((t: string) => !/공지사항/.test(t));
    for (const title of ctabs) bad += await 재다(cid, title, true);
  }
}

console.log(bad ? `\n  ✗ ${bad}곳이 어긋났다 — 그 시트를 다시 발행해라` : '\n  ✓ 판매시트·채널시트 모두 규격대로 걸렸다');
process.exit(bad ? 1 : 0);
