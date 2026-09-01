/**
 * **차량번호 셀 사진 링크가 세 탭에서 같은가** — 갈리면 실패한다.
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
 * 두 가지를 본다 —
 *   ① **소스**: 발행기가 링크를 따로 걸고 있지 않은가(또 갈리는 씨앗)
 *   ② **시트**: 세 탭에서 「사진」 값과 차번 셀 링크가 한 글자도 안 어긋나는가
 *
 *   npm run check:photo-link
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
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

// ── ② 시트 — 세 탭이 실제로 같은가
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const tok = (await jwt.getAccessToken()).token;
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const get = async (u: string) => (await fetch(u, { headers: { Authorization: `Bearer ${tok}` } })).json() as any;

const meta = await get(`${SH}/${SALES_SHEET_ID}?fields=sheets.properties(title,hidden)`);
const titles = (meta.sheets || []).filter((s: any) => !s.properties.hidden).map((s: any) => S(s.properties.title));
console.log('');
for (const t of pickPublishedSalesTabs(titles)) {
  const fields = 'sheets.data.rowData.values(formattedValue,hyperlink,userEnteredFormat.textFormat.link,textFormatRuns.format.link)';
  const g = await get(`${SH}/${SALES_SHEET_ID}?includeGridData=true&ranges=${encodeURIComponent(`'${t.title.replace(/'/g, "''")}'!A1:CZ700`)}&fields=${fields}`);
  const rd = g.sheets?.[0]?.data?.[0]?.rowData || [];
  const tx = (c: any) => S(c?.formattedValue);
  /** 링크는 세 자리에 숨는다 — 셀 hyperlink · 칸 서식 · 글자 run. 하나만 보면 놓친다. */
  const lk = (c: any) => S(c?.hyperlink) || S(c?.userEnteredFormat?.textFormat?.link?.uri)
    || S((c?.textFormatRuns || []).find((r: any) => r?.format?.link?.uri)?.format?.link?.uri);
  const hi = rd.findIndex((r: any) => (r?.values || []).some((c: any) => tx(c) === '차량번호'));
  const head = (rd[hi]?.values || []).map(tx);
  const ip = head.indexOf('차량번호');
  const ic = head.indexOf('사진');
  if (ip < 0 || ic < 0) { bad++; console.log(`  ✗ ${t.title} — 「차량번호」나 「사진」 칸이 없다`); continue; }
  let rows = 0; let val = 0; let link = 0; const off: string[] = [];
  for (let r = hi + 1; r < rd.length; r++) {
    const vs = rd[r]?.values || [];
    const plate = tx(vs[ip]);
    if (!plate) continue;
    rows++;
    const v = tx(vs[ic]); const l = lk(vs[ip]);
    if (v.startsWith('http')) val++;
    if (l) link++;
    if (v.startsWith('http') && l !== v) off.push(`${plate} 값≠링크`);
    if (!v.startsWith('http') && l) off.push(`${plate} 값 없는데 링크 남음`);
  }
  const ok = off.length === 0;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${t.title.split(' ')[0].padEnd(6)} 줄 ${String(rows).padStart(3)} · 사진값 ${String(val).padStart(3)} · 차번링크 ${String(link).padStart(3)} · 어긋남 ${off.length}`);
  off.slice(0, 5).forEach((m) => console.log(`       ${m}`));
}

console.log(bad ? `\n  ✗ ${bad}곳이 어긋났다 — 세 탭을 다시 발행해라(publish-origin-tab · publish-sonogong-tab)` : '\n  ✓ 세 탭이 같다');
process.exit(bad ? 1 : 0);
