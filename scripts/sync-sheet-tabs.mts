/**
 * 공급사 시트의 **데이터 탭 전체**를 partner.sheet_tab 에 기록한다.
 *
 * 왜: 앱은 sheet_tab 에 적힌 탭만 읽는다. 재고를 탭으로 쪼개 둔 공급사는 한 탭만 읽히고,
 * 나머지 탭 차량은 「시트에 없음」 → 부재처리로 **출고불가**가 된다. 조용히 일어나서 더 위험하다.
 * (2026-07-31 실측: 빌린카 RP021 은 3탭에 45대인데 21대만 읽히고 있었다.)
 *
 * 판정: 탭을 CSV 로 받아 실번호판이 1개 이상 있으면 데이터 탭. 0개면 안내/양식 탭이라 뺀다.
 * 오토플러스는 전용 어댑터가 자기 탭을 직접 알고 있어 건드리지 않는다.
 *
 * 실행(기본 dry-run — 아무것도 쓰지 않는다):
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/sync-sheet-tabs.mts
 *   ... --apply     실제로 partner.sheet_tab 갱신
 */
import { readFileSync } from 'node:fs';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
initializeApp({ credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault(), databaseURL: DB });
const db = getDatabase();

const APPLY = process.argv.includes('--apply');


type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /^\d{2,3}[가-힣]\d{4}$/;

function sheetId(url: string): string {
  const m = url.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

/** 탭 gid 열거 — Sheets API 가 비활성이라 htmlview 의 `gid=NNN` 링크를 긁는다. */
async function listGids(id: string): Promise<number[]> {
  try {
    const h = await (await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`)).text();
    const gids = [...new Set([...h.matchAll(/gid=(\d+)/g)].map((m) => Number(m[1])))];
    if (gids.length) return gids;
  } catch { /* 아래 기본 탭 */ }
  return [0];
}

/** ⚠ gviz 는 행을 조용히 빠뜨린다. 반드시 export?format=csv. */
async function plateCount(id: string, gid: number): Promise<number> {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow',
  });
  if (!r.ok) return -1;
  const text = await r.text();
  if (/^\s*<(!doctype|html)/i.test(text)) return -1;
  let n = 0;
  for (const m of text.matchAll(/[\d]{2,3}[가-힣][\d]{4}/g)) { if (PLATE.test(m[0])) n++; }
  return n;
}

async function main() {
  // v3 partners 위에 v4 오버레이 — 브리지가 살아 있는 동안은 둘 다 봐야 실제 화면과 같다.
  const [v3, v4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const merged: Record<string, Rec> = { ...(v3.val() || {}), ...(v4.val() || {}) };
  const partners: Rec[] = Object.entries(merged)
    .map(([k, v]) => ({ ...(v as Rec), _key: k }))
    .filter((p) => S(p.sheet_url) && p._deleted !== true && S(p.status) !== 'deleted')
    .filter((p) => !/영업|sales/i.test(S(p.partner_type)))
    // 오토플러스는 전용 어댑터가 본탭+프로모탭을 스스로 안다(isAutoplusPartner). sheet_tab 은 쓰지도 읽지도 않는다.
    .filter((p) => S(p.adapter_id) !== 'autoplus')
    .filter((p) => !/autoplus|오토플러스|RP023/i.test(`${S(p.partner_code)} ${S(p.name)} ${S(p.partner_name)}`));

  console.log(`시트 연결 공급사 ${partners.length}곳 (오토플러스 제외) · ${APPLY ? '적용' : 'DRY-RUN'}\n`);

  const updates: Record<string, string> = {};
  for (const p of partners) {
    const code = S(p.partner_code || p._key);
    const label = S(p.name || p.partner_name || code);
    const id = sheetId(S(p.sheet_url));
    if (!id) { console.log(`  ${code} ${label} — 시트 URL 파싱 실패`); continue; }
    const gids = await listGids(id);
    const dataTabs: number[] = [];
    for (const g of gids) {
      const n = await plateCount(id, g);
      if (n > 0) dataTabs.push(g);
    }
    const now = S(p.sheet_gid || p.sheet_tab);
    const next = dataTabs.join(',');
    if (!dataTabs.length) { console.log(`  ${code} ${label} — 데이터 탭 0 (현재 「${now || '기본'}」) ⚠`); continue; }
    if (now === next) { console.log(`  ${code} ${label} — 동일 (${next})`); continue; }
    console.log(`  ${code} ${label} — 「${now || '기본'}」 → 「${next}」 (탭 ${dataTabs.length}개)`);
    updates[`v4/partners/${p._key}/sheet_tab`] = next;
  }

  console.log(`\n갱신 대상 ${Object.keys(updates).length}곳`);
  if (!APPLY) { console.log('DRY-RUN — 쓰지 않았다. 적용하려면 --apply'); return; }
  if (!Object.keys(updates).length) return;
  // set() 금지 — 멀티패스 update 로 sheet_tab 만 건드린다.
  await db.ref().update(updates);
  console.log('✓ 적용 완료');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
