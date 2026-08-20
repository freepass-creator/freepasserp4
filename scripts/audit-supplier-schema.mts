/**
 * **공급사 제공시트 양식이 같은가** — 기준 시트와 머리행을 견준다. 읽기 전용.
 *
 * ★사장님 2026-08-14 — 「공급사 시트 왜 양식이 다 다르냐, 웰릭스 표본으로 전체 확인해서 통일해줘」.
 *   양식이 갈리면 매핑이 시트마다 다르게 걸리고, 그게 곧 «값이 밀리는» 원인이 된다.
 *
 * ★기준은 `--base` 로 준 시트의 머리행이다(기본 웰릭스).
 *   빠진 열 · 남는 열 · 자리가 다른 열을 셋으로 갈라 보여 준다.
 * ⚠ 여기서 고치지 않는다. 무엇이 다른지 먼저 다 보고 나서 한 번에 맞춘다.
 *
 *   npx tsx scripts/audit-supplier-schema.mts
 *   npx tsx scripts/audit-supplier-schema.mts --base=<시트ID>
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const BASE = arg('base', '1T9az8BfEpM-QUllo5Sr2VxOcJBy3UvXPAvkuGy4C6hI');   // 웰릭스 프리패스 재고
const NAME = arg('name', '프리패스 재고');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
/**
 * ⚠ 시트 API 는 «분당 읽기» 쿼터가 있다 — 17곳을 훑으면 중간에 429 로 끊긴다(실측 2026-08-14).
 *   끊긴 자리는 「못 읽음」으로 남아 대조가 반쪽이 된다. 기다렸다 다시 친다.
 */
const get = async (u: string) => {
  for (let n = 0; ; n++) {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    const t = await r.text();
    if (r.ok) return JSON.parse(t) as Rec;
    if ((r.status === 429 || r.status >= 500) && n < 6) {
      await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n)));
      continue;
    }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

/** 그 시트의 «재고 탭» 머리행. 우리 양식의 표식은 「차명(세부모델+트림)」이다. */
async function headerOf(id: string): Promise<{ book: string; tabs: { tab: string; hdr: string[]; row: number }[] }> {
  const meta = await get(`${SH}/${id}?fields=properties.title,sheets.properties(title,hidden)`);
  const out: { tab: string; hdr: string[]; row: number }[] = [];
  for (const s of (meta.sheets || []) as Rec[]) {
    if (s.properties.hidden) continue;
    const tab = S(s.properties.title);
    if (/정책|안내|공지/.test(tab)) continue;
    const v = await get(`${SH}/${id}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:BZ12`)}`) as { values?: string[][] };
    const rows = (v.values || []) as string[][];
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === norm('차명(세부모델+트림)')));
    if (hi < 0) continue;
    out.push({ tab, hdr: rows[hi].map(S).filter(Boolean), row: hi + 1 });
  }
  return { book: S(meta.properties?.title), tabs: out };
}

const base = await headerOf(BASE);
if (!base.tabs.length) throw new Error('기준 시트에서 재고 탭을 못 찾음');
const REF = base.tabs[0].hdr;
console.log(`■ 기준 — ${base.book} 「${base.tabs[0].tab}」 ${REF.length}열 (머리행 ${base.tabs[0].row}행)\n`);
console.log(`   ${REF.join(' | ')}\n`);

const q = `name contains '${NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const files = ((await get(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[];
console.log(`■ 제공시트 ${files.length}곳 대조\n`);

let same = 0;
/** 못 읽은 시트 — 양식이 같은지 «모른다»는 뜻이라 초록불을 줄 수 없다. */
let unread = 0;
const report: string[] = [];
for (const f of files.sort((a, b) => S(a.name).localeCompare(S(b.name), 'ko'))) {
  let got: Awaited<ReturnType<typeof headerOf>>;
  try { got = await headerOf(S(f.id)); } catch (e) { console.log(`  ✗ ${S(f.name)} — 못 읽음 ${(e as Error).message.slice(0, 50)}`); unread++; continue; }
  for (const t of got.tabs) {
    /**
     * ★예비칸(기타기간①②③)은 «제목을 바꿔 쓰는 칸»이다 — 「6개월」·「18개월」처럼 N개월로 갈아 썼으면 규격 안이다.
     *   같은 자리에 「N개월」이 서 있으면 기준 이름으로 본다(빌린카·J&J·이안카 6개월 — 2026-08-18 통일 때 확정).
     */
    const hdrN = t.hdr.map((x, j) => (/^\d+개월$/.test(x) && /^기타기간/.test(REF[j] || '') ? REF[j] : x));
    const missing = REF.filter((c) => !hdrN.some((x) => norm(x) === norm(c)));
    const extra = hdrN.filter((c) => !REF.some((x) => norm(x) === norm(c)));
    const moved: string[] = [];
    REF.forEach((c, i) => {
      const j = hdrN.findIndex((x) => norm(x) === norm(c));
      if (j >= 0 && j !== i) moved.push(`${c}(${i}→${j})`);
    });
    if (!missing.length && !extra.length && !moved.length) { same++; console.log(`  ✓ ${S(f.name)} 「${t.tab}」 — 같다`); continue; }
    console.log(`  ✗ ${S(f.name)} 「${t.tab}」 — ${t.hdr.length}열`);
    if (missing.length) console.log(`       빠진 열 ${missing.length}: ${missing.join(', ')}`);
    if (extra.length) console.log(`       남는 열 ${extra.length}: ${extra.join(', ')}`);
    if (moved.length) console.log(`       자리 다름 ${moved.length}: ${moved.slice(0, 8).join(', ')}${moved.length > 8 ? ' …' : ''}`);
    report.push(`${S(f.name)}「${t.tab}」 빠짐${missing.length}·남음${extra.length}·자리${moved.length}`);
  }
}
console.log(`\n  기준과 같은 탭 ${same} · 다른 탭 ${report.length}`);

/**
 * ★**감사가 제 일을 못 했으면 초록불을 주지 않는다.**
 *   ⚠ 못 읽은 시트는 「양식이 다르다」가 아니라 «모른다»다. 예전엔 그래도 0 으로 끝나서,
 *     자동화에 걸면 반쪽만 보고도 통과했다.
 *   ⚠ 「다른 탭」 수로는 실패시키지 않는다 — 손오공 구독재고처럼 원래 규격이 다른 탭이 있어
 *     늘 빨간불이 되면 아무도 안 본다.
 */
if (unread) {
  console.log(`\n  ⛔ 못 읽은 시트 ${unread}곳 — 양식이 같은지 «모른다». 초록불을 줄 수 없다.`);
  process.exitCode = 1;
}
