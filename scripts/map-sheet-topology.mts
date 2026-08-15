/**
 * **어디에 어떤 시트가 몇 개 있고, 무엇이 어디로 흐르는가.** 읽기 전용.
 *
 * ★왜(사장님 2026-08-15 — 「어디에 어떤 시트가 몇 개 있고 이런 거 파악해봐.
 *   어떤 구조로 판매시트까지 오는지」)
 *   문서가 늘었다 — 문패 2 · 공급사 자체시트 · 제공시트 21 · 정제시트 · 표준시트 · 차종마스터 · 판매시트.
 *   머릿속 그림과 실제가 갈리는 순간 «어느 문서를 고쳐야 하는지»를 틀리고, 그게 사고가 된다.
 *   그래서 **기억이 아니라 실측으로** 그린다.
 *
 * ⚠ 대수는 늘 «우리 시트 / 아닌 시트 / 총»으로 센다.
 * ⚠ 「열이 없다」와 「값이 비었다」를 가른다 — 섞으면 없는 구멍이 생긴다.
 *
 *   npx tsx scripts/map-sheet-topology.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED } from '../lib/domain/supplier-sheet-read';
import { companyAlias } from '../lib/domain/identity';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');
const isPlate = (v: string) => /^\d{2,3}[가-힣]\d{4}$/.test(v);
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;

const HUB_PUBLISH = '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY';   // 「공급사시트정리」 — 발행이 읽는다
const HUB_ERP = '1cRn_XbuJXQMlVCATtDN4EpQy-KVEi65tCwcvCxdFk8w';       // 웹앱 /api/sheet/hub 가 읽는다
const SALES = arg('sales', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const REFINE = arg('refine', '1nLwfgBSCpN_GnFUw_2SbG5LdyB9-l6d9ObkMP3IGa5I');
const STANDARD = arg('std', '1hL66CtpGn_IoY6A9-feMkE9zKfkBug1dmHuROsW_nH4');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));

/** 문서 한 장을 재 본다 — 탭마다 차 몇 대, 어떤 특별 탭이 있나. */
/**
 * ★**우리 것인지는 «소유자»로 가른다.** 이름으로 가르면 틀린다 —
 *   「이안카_프리패스」는 이름에 「프리패스」가 들어가지만 **소유자가 공급사(serimion@gmail.com)** 다.
 *   이름으로 셌다가 이안카 77대를 우리 시트로 잘못 세었다(실측 2026-08-15).
 */
const OUR_OWNERS = ['pyh@teamjpk.com', 'freepassmobility'];
async function look(id: string) {
  const f = await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,modifiedTime,owners(emailAddress)&supportsAllDrives=true`);
  const owner = S(((f.owners || []) as Rec[])[0]?.emailAddress);
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets.properties(title,hidden)')}`);
  const titles = ((meta.sheets || []) as Rec[]).map((s) => ({ t: S(s.properties?.title), hidden: !!s.properties?.hidden }));
  const tabs: { t: string; hidden: boolean; cars: number; hasCode: number }[] = [];
  for (const { t, hidden } of titles) {
    const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(a1(t))}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]);
    const h = rows.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (h < 0) { tabs.push({ t, hidden, cars: -1, hasCode: -1 }); continue; }
    const hdr = (rows[h] || []).map(S);
    const pi = hdr.indexOf('차량번호'), ci = hdr.indexOf('차종코드');
    let cars = 0, code = 0;
    for (const r of rows.slice(h + 1)) {
      const p = plate(r[pi]); if (!isPlate(p)) continue;
      cars++; if (ci >= 0 && S(r[ci])) code++;
    }
    tabs.push({ t, hidden, cars, hasCode: ci >= 0 ? code : -1 });
  }
  return { owner, ours: OUR_OWNERS.some((o) => owner.includes(o)), name: S(f.name), modified: S(f.modifiedTime).slice(0, 16).replace('T', ' '), tabs };
}

console.log('\n■ 시트 지도 — 무엇이 어디에 있고 어디로 흐르나 (실측)\n');

/** ── ① 문패 둘 */
console.log('── ① 문패(주소록) 2장');
for (const [id, label, who] of [[HUB_PUBLISH, '공급사시트정리', '판매시트 발행기가 읽는다'], [HUB_ERP, '프리패스 공급사시트 정리', '웹앱 /api/sheet/hub → ERP']] as [string, string, string][]) {
  try {
    const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:Z300`) as { values?: string[][] };
    const n = ((v.values || []) as string[][]).filter((r) => S(r[1]) && /\/spreadsheets\/d\//.test(S(r[2]))).length;
    console.log(`   ${pad(label, 26)}${pad(`${n}곳`, 7)}${who}`);
  } catch { console.log(`   ${pad(label, 26)}못 읽음`); }
}

/** ── ② 문패가 가리키는 곳 — 우리 것인가 공급사 것인가 */
console.log('\n── ② 문패가 가리키는 공급사 시트');
const hub: { who: string; code: string; id: string }[] = [];
{
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB_PUBLISH}/values/A1:Z300`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) {
    const id = (S(r[2]).match(/\/d\/([\w-]+)/) || [])[1];
    if (!id || !S(r[1])) continue;
    hub.push({ who: companyAlias(S(r[0])) || S(r[0]), code: S(r[1]), id });
  }
}
let ourCars = 0, otherCars = 0, ourN = 0, otherN = 0;
const rows: string[] = [];
for (const h of hub) {
  if (NOT_SHEET_BACKED.has(h.code)) { rows.push(`   ${pad(h.who, 12)}${pad('—', 8)}홈페이지 수집(시트 없음)`); continue; }
  let d: Awaited<ReturnType<typeof look>>;
  try { d = await look(h.id); } catch { rows.push(`   ${pad(h.who, 12)}못 읽음`); continue; }
  const ours = d.ours;
  const cars = d.tabs.filter((t) => t.cars > 0).reduce((a, t) => a + t.cars, 0);
  const stockTabs = d.tabs.filter((t) => t.cars > 0).length;
  if (ours) { ourCars += cars; ourN++; } else { otherCars += cars; otherN++; }
  rows.push(`   ${pad(h.who, 12)}${pad(`${cars}대`, 8)}${pad(ours ? '우리 것' : '공급사 것', 11)}${pad(`「${d.name}」`, 30)}탭 ${stockTabs} · ${d.owner.split('@')[0]}`);
}
for (const r of rows) console.log(r);
console.log(`   ${'─'.repeat(72)}`);
console.log(`   우리 시트 ${ourCars}대(${ourN}곳) · 아닌 시트 ${otherCars}대(${otherN}곳) · 총 ${ourCars + otherCars}대`);

/** ── ③ 우리가 만든 문서들 */
console.log('\n── ③ 우리가 만든 문서');
const mine = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("name contains '프리패스 재고' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false")}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const provided = ((mine.files || []) as Rec[]).length;
console.log(`   제공시트 「<공급사> 프리패스 재고」   ${provided}장   공급사가 상태·대여료·정책을 채운다`);
for (const [id, label] of [[REFINE, '정제시트 「프리패스 차량정제」'], [STANDARD, '표준시트 「프리패스 표준 상품시트」'], [MASTER_SHEET_ID, '차종마스터 「ERP4 차종마스터 원천대장」'], [SALES, '판매시트(영업자용)']] as [string, string][]) {
  try {
    const d = await look(id);
    const stock = d.tabs.filter((t) => t.cars >= 0);
    const cars = stock.reduce((a, t) => a + Math.max(0, t.cars), 0);
    const code = stock.reduce((a, t) => a + Math.max(0, t.hasCode), 0);
    const hasCodeCol = stock.some((t) => t.hasCode >= 0);
    console.log(`   ${pad(label, 34)}탭 ${d.tabs.length}장${cars ? ` · 차 ${cars}대` : ''}${hasCodeCol ? ` · 차종코드 ${code}대` : ''} · ${d.modified}`);
    if (id === SALES) for (const t of d.tabs.filter((x) => x.cars > 0)) console.log(`        └ ${pad(t.t, 34)}${t.cars}대`);
  } catch (e) { console.log(`   ${pad(label, 34)}못 읽음 — ${String((e as Error).message).slice(0, 40)}`); }
}
/** 차종마스터는 차가 아니라 «차종»이라 따로 센다. */
try {
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(a1(MASTER_TAB))}`) as { values?: string[][] };
  const rows2 = ((v.values || []) as string[][]);
  const hdr = (rows2[0] || []).map(S);
  const ki = hdr.indexOf('트림행키'), si = hdr.indexOf('관리상태');
  const codes = rows2.slice(1).filter((r) => S(r[ki]));
  const live = codes.filter((r) => S(r[si]) !== '제외');
  console.log(`        └ 트림행키 ${codes.length}개 · 쓸 수 있는 것 ${live.length}개`);
} catch { /* 마스터를 못 읽으면 위에서 이미 알렸다 */ }

console.log(`
── ④ 흐르는 길

   [공급사 자체시트]  아이카 · 아이언(홈피) · 이안카 · 오플
        │  1차 정제 — 우리 규격으로
        ↓
   [제공시트 ${provided}장]  「<공급사> 프리패스 재고」    ← 내부시트 공급사는 여기서 시작
        │     공급사가 만진다: 상태 · 대여료 · 정책
        │  2차 모으기 — 공급사를 탭으로
        ↓
   [정제시트 1장]  ★차번 ↔ 차종코드. 우리가 만진다
        ↓                            ↖ 차종마스터(트림행키)를 조인한다
   [판매시트]  상품리스트 + 손오공구독 + 오플구독 + 오플프로모션
        ↓
   [ERP]

   ⚠ 지금은 발행기가 **정제시트가 아니라 문패의 공급사 시트 18곳**을 직접 읽는다.
     정제시트로 갈아타는 것이 다음 일이다(설계 문서 ⑤단계).
   ⚠ 표준시트는 흐름에 안 낀다 — **새 공급사가 생기면 복사해 주는 빈 서식**이다.
`);
