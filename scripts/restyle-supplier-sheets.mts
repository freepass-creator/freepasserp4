/**
 * 공급사 사본 시트에 **서식만** 다시 입힌다. 기본 dry-run, 반영은 --apply.
 *
 * ★왜 별도 스크립트인가
 *   `build-supplier-sheet-set --force` 는 표(Table)를 갈아끼우려고 `deleteTable` 을 하는데,
 *   구글은 표를 지울 때 **그 안의 값까지 지운다**(실측 2026-08-11 · 13곳 196대가 헤더만 남았다).
 *   이미 공급사가 채운 시트에는 쓸 수 없다. 여기서는 값을 한 칸도 건드리지 않는다 —
 *   줄무늬(banding)와 조건부서식만 지우고 다시 건다.
 *
 * ★무엇을 고치나 (사장님 확정 2026-08-12)
 *   지금 사본들은 전 구간이 한 색(#f7f7f9)이라 어디까지가 차 정보이고 어디부터 돈인지 안 갈린다.
 *   구간을 «줄무늬 둘째 줄 색»으로 가른다 — 구간을 통으로 칠하면 줄무늬가 죽는다.
 *     요금(개월)  옅은 노랑   파는 값
 *     보증금      옅은 파랑   한 번 받는 돈 — 요금과 헷갈리면 안 된다
 *     차량정보·부가 옅은 회색   같은 톤으로 묶는다
 *
 *   npx tsx scripts/restyle-supplier-sheets.mts
 *   npx tsx scripts/restyle-supplier-sheets.mts --apply
 *   npx tsx scripts/restyle-supplier-sheets.mts --apply --sheet=<ID>
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { buildSectionBanding, tableWidth } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: any) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const ONE = (process.argv.find((a) => a.startsWith('--sheet=')) || '').slice('--sheet='.length);
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
/** 사본을 모아 둔 관제 시트 — 「우리가 뜬 사본」 열에서 대상 ID 를 얻는다. */
const INDEX_SHEET = '1cRn_XbuJXQMlVCATtDN4EpQy-KVEi65tCwcvCxdFk8w';

async function main() {
  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  const jwt = new JWT({
    email: sa.client_email, key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const token = (await jwt.getAccessToken()).token;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, { ...init, headers: H });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };

  // ── 대상 모으기 ──
  let targets: { id: string; who: string }[] = [];
  if (ONE) targets = [{ id: ONE, who: '(지정)' }];
  else {
    // 링크는 셀의 `hyperlink` 에 있다 — 표시값은 「사본 열기」라 주소가 안 나온다.
    const fields = 'sheets(data(rowData(values(formattedValue,hyperlink))))';
    const v = await call(`https://sheets.googleapis.com/v4/spreadsheets/${INDEX_SHEET}?ranges=${encodeURIComponent("'공급사연동'!A1:L60")}&includeGridData=true&fields=${encodeURIComponent(fields)}`);
    const rows = (v.sheets?.[0]?.data?.[0]?.rowData || []) as Rec[];
    const head = ((rows[0]?.values || []) as Rec[]).map((c) => S(c.formattedValue));
    const iWho = head.indexOf('구분'), iCopy = head.indexOf('우리가 뜬 사본');
    for (const row of rows.slice(1)) {
      const cells = (row.values || []) as Rec[];
      const id = S(cells[iCopy]?.hyperlink).match(/\/spreadsheets\/d\/([\w-]+)/)?.[1];
      if (id) targets.push({ id, who: S(cells[iWho]?.formattedValue) });
    }
  }

  // ── 운영 공급사 시트는 건드리지 않는다 ──
  const g = async (n: string) => JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {};
  const [live, over] = await Promise.all([g('partners'), g('v4/partners')]);
  const pm: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) pm[k] = { ...(live[k] || {}), ...(over[k] || {}), _key: k };
  const owned = new Set<string>();
  for (const p of Object.values(pm)) {
    const id = S(p.sheet_url).match(/\/spreadsheets\/d\/([\w-]+)/)?.[1];
    if (id) owned.add(id);
  }

  console.log(`\n══ 공급사 사본 서식 다시 입히기 ${APPLY ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  대상 ${targets.length}곳 (값은 건드리지 않는다)\n`);

  let done = 0;
  for (const t of targets) {
    if (owned.has(t.id)) { console.log(`  · ${t.who.padEnd(18)} 건너뜀 — 공급사 운영 시트다`); continue; }
    let meta: Rec;
    try { meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}?fields=properties.title,sheets(properties(sheetId,title),bandedRanges(bandedRangeId))`); }
    catch (e) { console.log(`  · ${t.who.padEnd(18)} 열기 실패 — ${String((e as Error).message).slice(0, 60)}`); continue; }
    const stock = (meta.sheets || []).find((s: Rec) => S(s.properties.title) === '재고');
    if (!stock) { console.log(`  · ${t.who.padEnd(18)} 「재고」 탭 없음 — 건너뜀`); continue; }
    const gid = stock.properties.sheetId as number;

    const hv = await call(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values/${encodeURIComponent("'재고'!A1:BZ1")}`);
    const head = ((hv.values || [])[0] || []).map(S).filter(Boolean);
    if (!head.length) { console.log(`  · ${t.who.padEnd(18)} 헤더 없음 — 건너뜀`); continue; }
    const cols = head.map((name: string) => ({ name }));
    const tw = tableWidth(cols);
    const stale = (stock.bandedRanges || []).map((b: Rec) => ({ deleteBanding: { bandedRangeId: b.bandedRangeId } }));
    const bands = buildSectionBanding(gid, cols, 500, tw);

    const kinds = bands.map((b: Rec) => {
      const r = b.addBanding.bandedRange.range;
      const names = head.slice(r.startColumnIndex, r.endColumnIndex);
      const c = b.addBanding.bandedRange.rowProperties.secondBandColorStyle.rgbColor;
      const tone = c.red > 0.99 ? '요금' : c.blue > 0.98 ? '보증' : '기본';
      return `${tone}(${names.length})`;
    });
    console.log(`  · ${t.who.padEnd(18)} 「${S(meta.properties.title)}」 ${head.length}열 · 표 ${tw}칸 · 옛 줄무늬 ${stale.length} → 새 ${bands.length}구간  ${kinds.join(' ')}`);

    if (!APPLY) continue;
    await call(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ requests: [...stale, ...bands] }),
    });
    done += 1;
  }

  if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); return; }
  console.log(`\n  반영 완료 — ${done}곳\n`);
}

main().catch((e) => { console.error('\n실패 —', (e as Error)?.message || e, '\n'); process.exit(1); });
