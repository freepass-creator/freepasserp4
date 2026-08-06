/**
 * **매핑이 어디서 빗나가나 — 못 잡은 열과 모자란 신호를 공급사별로 센다. 쓰기 없음.**
 *
 * 검수대기(low)는 «차종을 못 붙였다»는 결과만 알려 준다. 고치려면 원인이 필요하다:
 * 그 신호가 시트에 아예 없는 것인지, 시트에는 있는데 우리가 그 «열»을 못 잡은 것인지.
 * 둘은 손볼 곳이 다르다 — 앞은 공급사, 뒤는 우리 매핑이다.
 *
 * 그래서 세 가지를 같이 낸다:
 *   ① 매핑된 열 / 못 잡은 열 — 못 잡은 열에 무슨 값이 들어 있는지 샘플까지
 *   ② 검수대기 행에서 «비어 있는 신호» 순위(트림·연식·연료·배기·구동)
 *   ③ 못 잡은 열 중 차종 신호로 보이는 것 — 앵커(차번·모델명·주행거리) 기준 좌우 몇 칸인지
 *
 * ③ 이 핵심이다. 시트마다 열 순서는 달라도 «차번 옆에 모델, 그 옆에 연식» 같은 이웃 관계는
 * 대체로 유지된다. 앵커 기준 상대 위치가 공급사별로 얼마나 안정적인지를 보고,
 * 열 이름 학습 대신 앵커+이웃으로 읽을 수 있는지 판단한다.
 *
 *   npx tsx scripts/audit-sheet-mapping-gaps.mts
 *   npx tsx scripts/audit-sheet-mapping-gaps.mts --code=RP021
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import { autoMapHeaders, importSheetTable, parseMappingProfile, parseMappingHeaderSignature, parseDepositRule } from '../lib/domain/sheet-import';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import { isExactRealPlate } from '../lib/domain/product';
import type { MasterEntry } from '../lib/domain/vehicle-master-match';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

const FIELDS = [
  'sheets(properties(sheetId,title,hidden)',
  'data(startRow,rowData(values(formattedValue,effectiveValue)),rowMetadata(hiddenByFilter,hiddenByUser)))',
].join(',');

function parseCsv(t: string): string[][] {
  const rows: string[][] = []; let f = '', r: string[] = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}

/** 차종 확정에 쓰이는 신호 — 비면 확신도가 안 올라간다. */
const SIGNALS = ['trim_name', 'variant', 'year', 'fuel_type', 'engine_cc', 'drive_type', 'seats', 'sub_model'] as const;
const SIGNAL_LABEL: Record<string, string> = {
  trim_name: '트림', variant: '세부등급', year: '연식', fuel_type: '연료',
  engine_cc: '배기량', drive_type: '구동', seats: '인승', sub_model: '세부모델',
};

/** 열 값이 무엇처럼 보이는지 — 못 잡은 열의 정체를 사람이 읽을 수 있게. */
function guessKind(values: string[]): string {
  const v = values.filter(Boolean);
  if (!v.length) return '(빈 열)';
  const hit = (re: RegExp) => v.filter((x) => re.test(x)).length / v.length;
  if (hit(/^\d{2,3}[가-힣]\d{4}$/) > 0.5) return '차번';
  if (hit(/^(20)?\d{2}(년|년식)?$/) > 0.5) return '연식';
  if (hit(/가솔린|디젤|하이브리드|전기|LPG|EV|PHEV/i) > 0.4) return '연료';
  if (hit(/^\d{1,3}(,\d{3})+$|^\d{4,}$/) > 0.6) return '금액·수치';
  if (hit(/2WD|4WD|AWD|사륜|전륜|후륜/i) > 0.3) return '구동';
  if (hit(/^\d{1,2}인승$/) > 0.3) return '인승';
  if (hit(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/) > 0.4) return '날짜';
  if (hit(/km|킬로/i) > 0.3) return '주행거리';
  if (v.some((x) => x.length > 12)) return '문장·메모';
  return '문자';
}

async function main() {
  const db = getDatabase();
  const [t3, t4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const partners: Record<string, Rec> = {};
  for (const [k, v] of Object.entries((t3.val() || {}) as Record<string, Rec>)) partners[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((t4.val() || {}) as Record<string, Rec>)) partners[k] = { ...(partners[k] || {}), ...v, _key: k };

  const master = (JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')).entries || []) as MasterEntry[];
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const dead = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';

  const missingTally = new Map<string, number>();
  const anchorOffsets = new Map<string, Map<number, number>>(); // 필드 → (차번 기준 상대위치 → 횟수)
  let reviewTotal = 0;

  console.log('\n══ 시트 매핑 구멍 (쓰기 없음) ══\n');

  for (const p of Object.values(partners)) {
    const code = S(p.partner_code) || S(p._key);
    if (ONLY && code !== ONLY) continue;
    if (!S(p.sheet_url) || dead(p)) continue;
    const label = S(p.name || p.partner_name) || code;
    let o;
    try { o = partnerSheetOpts(p as EntityRecord); } catch { continue; }
    const sheetId = (o.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!sheetId) continue;
    const adapter = resolveAdapter(p as EntityRecord);

    const meta = await (await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )).json() as SheetsGridResponse & { error?: { message?: string } };
    if (meta.error) continue;

    const tabs = o.gids.length ? o.gids : (meta.sheets || []).slice(0, 1).map((s) => String(s.properties?.sheetId ?? ''));
    let printed = false;

    for (const gid of tabs) {
      const target = meta.sheets?.find((s) => s.properties?.sheetId === Number(gid));
      if (!target?.properties) continue;
      let rows: string[][] = [];
      try {
        const csv = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`, { redirect: 'follow' });
        if (!csv.ok) throw new Error(`CSV ${csv.status}`);
        rows = parseCsv(await csv.text());
      } catch { continue; }
      let table: string[][];
      try { table = adapter.prepareTable(rows, { headerRow: o.headerRow }); } catch { continue; }
      if (table.length < 2) continue;

      const headers = table[0].map(S);
      const saved = parseMappingProfile(p.mapping_profile);
      const mapping = saved && Object.keys(saved).length ? saved : autoMapHeaders(headers);
      const mappedIdx = new Set(Object.values(mapping));
      const body = table.slice(1);

      if (!printed) { console.log(`  ${code.padEnd(9)} ${label}`); printed = true; }
      console.log(`     [${target.properties.title}] 열 ${headers.length}개 · 매핑 ${mappedIdx.size}개`);

      // ① 못 잡은 열 — 값이 실제로 들어 있는 것만(빈 열은 구멍이 아니다)
      const unmapped: string[] = [];
      for (let i = 0; i < headers.length; i++) {
        if (mappedIdx.has(i)) continue;
        const values = body.map((r) => S(r[i])).filter(Boolean);
        if (values.length < Math.max(2, body.length * 0.2)) continue;
        unmapped.push(`「${headers[i] || `(무제 ${i}열)`}」=${guessKind(values)} 예: ${values.slice(0, 2).join(' / ').slice(0, 40)}`);
      }
      if (unmapped.length) for (const u of unmapped.slice(0, 8)) console.log(`        못 잡음 · ${u}`);

      // ② 검수대기 행에서 비어 있는 신호
      const r = importSheetTable(table, {
        providerCode: code, entries: master,
        profile: saved,
        profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
        depositRule: parseDepositRule(p.deposit_rule),
      });
      const review = r.products.filter((x) => (x as Rec)._needs_master_review === true);
      reviewTotal += review.length;
      if (review.length) {
        const miss = SIGNALS.filter((k) => review.filter((x) => !S((x as Rec)[k])).length >= review.length * 0.5);
        for (const k of miss) missingTally.set(k, (missingTally.get(k) || 0) + review.length);
        console.log(`        검수 ${review.length}/${r.products.length} — 절반 이상 비어 있는 신호: ${miss.map((k) => SIGNAL_LABEL[k]).join(' · ') || '없음(다른 원인)'}`);
      }

      // ③ 앵커(차번) 기준 상대 위치 — 열 이름 대신 이웃으로 읽을 수 있는지 본다
      const plateIdx = mapping.car_number;
      if (typeof plateIdx === 'number') {
        for (const [field, idx] of Object.entries(mapping)) {
          if (field === 'car_number' || typeof idx !== 'number') continue;
          const off = idx - plateIdx;
          if (!anchorOffsets.has(field)) anchorOffsets.set(field, new Map());
          const m = anchorOffsets.get(field)!;
          m.set(off, (m.get(off) || 0) + 1);
        }
      }
      // 차번 열이 진짜 차번인지도 확인 — 앵커가 흔들리면 이웃 규칙도 못 쓴다.
      if (typeof plateIdx === 'number') {
        const vals = body.map((x) => S(x[plateIdx]).replace(/\s/g, '')).filter(Boolean);
        const rate = vals.length ? vals.filter(isExactRealPlate).length / vals.length : 0;
        if (rate < 0.8) console.log(`        ⚠ 차번 열 적중률 ${Math.round(rate * 100)}% — 앵커로 쓰기 불안정`);
      }
    }
    if (printed) console.log('');
  }

  console.log('── 검수대기에서 가장 자주 비는 신호 ──');
  for (const [k, n] of [...missingTally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}대  ${SIGNAL_LABEL[k] || k}`);
  }
  console.log(`   (검수대기 합계 ${reviewTotal}대)\n`);

  console.log('── 차번 앵커 기준 상대 위치(열 이름 대신 이웃으로 읽을 수 있나) ──');
  for (const [field, m] of [...anchorOffsets.entries()].sort((a, b) => b[1].size - a[1].size)) {
    const spread = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = spread[0];
    const total = spread.reduce((a, [, n]) => a + n, 0);
    const stable = Math.round((top[1] / total) * 100);
    console.log(`   ${String(field).padEnd(18)} 최빈 ${top[0] > 0 ? `+${top[0]}` : top[0]}칸 (${stable}%) · 서로 다른 위치 ${spread.length}가지`);
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
