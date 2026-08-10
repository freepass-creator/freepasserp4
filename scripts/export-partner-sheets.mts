/**
 * **공급사 연동 정리시트** — 어느 공급사가 어떤 시트로, 몇 대나 들어오고 있나.
 *
 * 표준양식을 다시 나눠줄 때 이 표를 보고 «누구에게 무엇을 보낼지»를 정한다.
 * 외부 시트는 **링크만** 싣는다 — 내용은 그 시트가 정본이라 복사해 두면 곧 어긋난다.
 *
 *   npx tsx scripts/export-partner-sheets.mts --sheet=<ID>          미리보기
 *   npx tsx scripts/export-partner-sheets.mts --sheet=<ID> --apply  반영
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isListableProduct } from '../lib/domain/product';
import { companyAlias } from '../lib/domain/identity';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const APPLY = process.argv.includes('--apply');
const SHEET = arg('sheet') || S(process.env.INVENTORY_EXPORT_SHEET_ID);
const TAB = arg('tab') || '공급사연동';
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/spreadsheets'],
});
const token = (await jwt.getAccessToken()).token;
const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {}));

const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) {
  for (const [k, v] of Object.entries(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
}
const dead = (v: Rec) => v?._deleted === true || !!v?.deletedAt || S(v?.status) === 'deleted';

/** 공급사별 집계 — 전체·목록에 서는 것·구분·마지막 갱신. */
type Stat = { total: number; listable: number; types: Map<string, number>; latest: string };
const stat = new Map<string, Stat>();
const blank = (): Stat => ({ total: 0, listable: 0, types: new Map(), latest: '' });
for (const [key, v] of Object.entries(prods as Record<string, Rec>)) {
  if (!v || typeof v !== 'object' || dead(v)) continue;
  const code = S(v.provider_company_code) || '(코드없음)';
  if (!stat.has(code)) stat.set(code, blank());
  const s = stat.get(code)!;
  s.total++;
  if (isListableProduct({ ...v, _key: key } as EntityRecord)) s.listable++;
  const t = canonProductType(v.product_type) || '(빈)';
  s.types.set(t, (s.types.get(t) || 0) + 1);
  const up = S(v.updatedAt) || S(v._snap_at);
  if (up > s.latest) s.latest = up;
}

const idOf = (u: string) => (u.match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1] || '';
/**
 * ★같은 공급사가 두 줄로 서지 않게 코드로 접는다.
 *
 * 파트너 레코드가 v3·v4 두 벌인 곳이 있고(제이앤제이 RP030), 한쪽에만 `sheet_url` 이 있다.
 * 그대로 두면 같은 회사가 「시트 있음」·「시트 미등록」 두 줄로 떠서 어느 쪽이 맞는지 모른다.
 * 시트 주소가 **있는 쪽**을 남긴다 — 그게 실제로 연동되는 레코드다.
 */
const folded = new Map<string, Rec>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  const prev = folded.get(code);
  if (!prev || (!S(prev.sheet_url) && S(p.sheet_url))) folded.set(code, p);
}
const rows = [...folded.values()]
  .map((p) => {
    const code = S(p.partner_code) || S(p._key);
    const s = stat.get(code) || blank();
    const url = S(p.sheet_url);
    return {
      code,
      name: companyAlias(S(p.partner_name || p.name || p.company_name), p.alias) || code,
      url,
      tab: S(p.sheet_tab),
      total: s.total,
      listable: s.listable,
      types: [...s.types.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '),
      latest: s.latest ? s.latest.slice(0, 10) : '',
      /** 왜 안 들어오나 — 사람이 바로 판단할 수 있게 한 줄로. */
      note: !url && s.total > 0 ? '시트 미등록 — 재고가 갱신되지 않는다'
        : !url ? '시트 없음'
          : s.total === 0 ? '시트는 있는데 재고 0 — 탭·헤더 확인'
            : '',
    };
  })
  .filter((r) => r.url || r.total > 0)
  .sort((a, b) => b.total - a.total);

const HEAD = ['공급사', '코드', '재고', '목록', '구분', '마지막갱신', '시트', '탭(gid)', '확인할 것'];
const values: (string | number)[][] = [HEAD, ...rows.map((r) => [
  r.name, r.code, r.total, r.listable, r.types, r.latest,
  // ★외부 시트는 링크만 — 내용은 그 시트가 정본이라 복사해 두면 곧 어긋난다.
  r.url ? `=HYPERLINK("${r.url}","열기")` : '',
  r.tab, r.note,
])];

console.log(`■ 공급사 연동 정리 — ${rows.length}곳\n`);
console.log(`  ${'공급사'.padEnd(16)}${'코드'.padEnd(10)}재고  목록  확인할 것`);
for (const r of rows) {
  console.log(`  ${r.name.slice(0, 15).padEnd(16)}${r.code.padEnd(10)}${String(r.total).padStart(4)}${String(r.listable).padStart(6)}  ${r.note}`);
}
const noUrl = rows.filter((r) => !r.url && r.total > 0);
if (noUrl.length) console.log(`\n  ★시트 미등록인데 재고가 있는 곳 ${noUrl.length}곳 — ${noUrl.map((r) => r.name).join(' · ')}`);

if (!SHEET) { console.log('\n※ --sheet=<ID> 를 주면 시트로 올린다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }

const api = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
const head = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const meta = await (await fetch(`${api}?fields=sheets.properties`, { headers: head })).json() as {
  sheets: { properties: { sheetId: number; title: string } }[];
};
const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
const title = `${TAB} ${kst.slice(5, 10).replace('-', '.')} ${kst.slice(11, 16)}`;
const found = meta.sheets.find((s) => s.properties.title.startsWith(TAB));
if (!found) {
  const made = await fetch(`${api}:batchUpdate`, {
    method: 'POST', headers: head,
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title, index: 2 } } }] }),
  });
  if (!made.ok) throw new Error(`탭 생성 실패 ${made.status}`);
} else {
  // 공급사가 줄면 아래에 유령이 남는다 — 비우고 쓴다.
  await fetch(`${api}/values/${encodeURIComponent(found.properties.title)}!A1:Z500:clear`, { method: 'POST', headers: head });
  await fetch(`${api}:batchUpdate`, {
    method: 'POST', headers: head,
    body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: found.properties.sheetId, title }, fields: 'title' } }] }),
  });
}
const put = await fetch(`${api}/values/${encodeURIComponent(title)}!A1?valueInputOption=USER_ENTERED`, {
  method: 'PUT', headers: head, body: JSON.stringify({ values }),
});
if (!put.ok) throw new Error(`쓰기 실패 ${put.status} ${(await put.text()).slice(0, 200)}`);
console.log(`\n✓ 반영 — 탭 「${title}」 · ${values.length}행\n`);
