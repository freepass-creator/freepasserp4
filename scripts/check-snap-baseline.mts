/**
 * **차종 판정 회귀 기준선 — 파서를 고칠 때마다 «어느 차»가 달라졌는지 이름으로 낸다.**
 *
 * 지금까지는 「확정 440대」라는 총합만 봤다. 그래서 3대 얻고 1대 잃어도 +2 로만 보이고,
 * 잃은 1대가 무엇인지 몰랐다(실제로 웰릭스 1대가 그렇게 조용히 틀어졌다).
 *
 * 기준선은 차번 하나하나의 판정 결과다. 규칙을 바꾸면 이 표와 대조해 **얻음·잃음·바뀜**을
 * 차번과 함께 낸다. 총합이 늘어도 «다른 차로 바뀐» 게 있으면 그건 개선이 아니다.
 *
 * ⚠ 이 기준선은 «사람이 확인한 정답»이 아니라 **그 시점의 동작 스냅샷**이다.
 *   `verified: true` 로 표시된 항목만 정답으로 취급한다. 나머지는 «달라졌다»는 사실만 알려 준다.
 *   사람이 확인한 건 손으로 verified 를 올려 두면, 그 뒤로는 그게 무너질 때 실패로 잡힌다.
 *
 *   npx tsx scripts/check-snap-baseline.mts --save    # 지금 동작을 기준선으로 저장
 *   npx tsx scripts/check-snap-baseline.mts           # 기준선과 대조
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import { importSheetTable, parseMappingProfile, parseMappingHeaderSignature, parseDepositRule } from '../lib/domain/sheet-import';
import type { MasterEntry } from '../lib/domain/vehicle-master-match';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const SAVE = process.argv.includes('--save');
const FILE = 'docs/snap-baseline.json';

type Entry = {
  provider: string;
  plate: string;
  maker: string;
  model: string;
  sub_model: string;
  trim: string;
  confidence: string;
  /** 사람이 «이 차가 맞다»고 확인했나. 확인된 항목이 무너지면 실패로 잡는다. */
  verified: boolean;
};

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });

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

async function collect(): Promise<Entry[]> {
  const db = getDatabase();
  const [t3, t4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const partners: Record<string, Rec> = {};
  for (const [k, v] of Object.entries((t3.val() || {}) as Record<string, Rec>)) partners[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((t4.val() || {}) as Record<string, Rec>)) partners[k] = { ...(partners[k] || {}), ...v, _key: k };

  const master = (JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')).entries || []) as MasterEntry[];
  if (!master.length) throw new Error('차종마스터 로드 실패');
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;

  const out: Entry[] = [];
  for (const p of Object.values(partners)) {
    const code = S(p.partner_code) || S(p._key);
    if (!S(p.sheet_url) || p._deleted === true) continue;
    let o; try { o = partnerSheetOpts(p as EntityRecord); } catch { continue; }
    const id = (o.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!id) continue;
    const adapter = resolveAdapter(p as EntityRecord);
    const meta = await (await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets(properties(sheetId,title))')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )).json() as Rec;
    if (meta.error) continue;
    const tabs = o.gids.length ? o.gids : (meta.sheets || []).slice(0, 1).map((s: Rec) => String(s.properties?.sheetId ?? ''));
    for (const gid of tabs) {
      let rows: string[][] = [];
      try {
        const csv = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: 'follow' });
        if (!csv.ok) continue;
        rows = parseCsv(await csv.text());
      } catch { continue; }
      let table: string[][];
      try { table = adapter.prepareTable(rows, { headerRow: o.headerRow }); } catch { continue; }
      if (table.length < 2) continue;
      const r = importSheetTable(table, {
        providerCode: code, entries: master,
        profile: parseMappingProfile(p.mapping_profile),
        profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
        depositRule: parseDepositRule(p.deposit_rule),
      });
      for (const x of r.products) {
        const rec = x as Rec;
        const plate = S(rec.car_number);
        if (!plate) continue; // 임시번호는 회차마다 바뀔 수 있어 기준선에 넣지 않는다
        out.push({
          provider: code,
          plate,
          maker: S(rec.maker),
          model: S(rec.model),
          sub_model: S(rec.sub_model),
          trim: S(rec.trim_name),
          confidence: S(rec._snap_confidence),
          verified: false,
        });
      }
    }
  }
  // 같은 차가 여러 탭에 있으면 먼저 읽은 쪽(정본 우선순위와 동일)만 남긴다.
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.provider}|${e.plate}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const fit = (c: string) => c === 'high' || c === 'medium';
const carOf = (e: Entry) => `${e.maker} ${e.model}`.trim();

async function main() {
  const now = await collect();

  if (SAVE) {
    mkdirSync('docs', { recursive: true });
    const prev: Entry[] = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')).entries || [] : [];
    // 사람이 확인해 둔 verified 표시는 새로 저장해도 유지한다 — 그게 이 파일의 값어치다.
    const verified = new Map(prev.filter((e) => e.verified).map((e) => [`${e.provider}|${e.plate}`, true]));
    const entries = now.map((e) => ({ ...e, verified: verified.get(`${e.provider}|${e.plate}`) === true }));
    writeFileSync(FILE, `${JSON.stringify({ savedAt: new Date().toISOString().slice(0, 10), entries }, null, 1)}\n`, 'utf8');
    console.log(`\n  기준선 저장 ${entries.length}대 → ${FILE}`);
    console.log(`  사람이 확인한 항목 ${entries.filter((e) => e.verified).length}대 유지\n`);
    return;
  }

  if (!existsSync(FILE)) { console.log(`\n  기준선이 없다 — 먼저 --save\n`); return; }
  const base: Entry[] = JSON.parse(readFileSync(FILE, 'utf8')).entries || [];
  const baseMap = new Map(base.map((e) => [`${e.provider}|${e.plate}`, e]));
  const nowMap = new Map(now.map((e) => [`${e.provider}|${e.plate}`, e]));

  const gained: string[] = [], lost: string[] = [], changed: string[] = [];
  const brokeVerified: string[] = [];
  let added = 0, removed = 0;

  for (const [k, cur] of nowMap) {
    const old = baseMap.get(k);
    if (!old) { added++; continue; }
    const line = `${k.padEnd(20)} ${carOf(old) || '(없음)'} [${old.confidence || '없음'}] → ${carOf(cur) || '(없음)'} [${cur.confidence || '없음'}]`;
    if (!fit(old.confidence) && fit(cur.confidence)) gained.push(line);
    else if (fit(old.confidence) && !fit(cur.confidence)) lost.push(line);
    else if (carOf(old) !== carOf(cur)) changed.push(line);
    if (old.verified && (carOf(old) !== carOf(cur) || (fit(old.confidence) && !fit(cur.confidence)))) brokeVerified.push(line);
  }
  for (const k of baseMap.keys()) if (!nowMap.has(k)) removed++;

  console.log('\n══ 차종 판정 기준선 대조 ══\n');
  console.log(`  기준선 ${base.length}대 · 지금 ${now.length}대 (새로 들어옴 ${added} · 사라짐 ${removed})\n`);
  console.log(`  ✅ 새로 붙음 ${gained.length}대`);
  for (const x of gained.slice(0, 20)) console.log(`       ${x}`);
  console.log(`\n  ⚠ 틀어짐 ${lost.length}대`);
  for (const x of lost.slice(0, 20)) console.log(`       ${x}`);
  console.log(`\n  ⚠ 다른 차로 바뀜 ${changed.length}대`);
  for (const x of changed.slice(0, 20)) console.log(`       ${x}`);

  if (brokeVerified.length) {
    console.log(`\n  ❌ 사람이 확인한 항목이 무너졌다 ${brokeVerified.length}대 — 이건 실패다`);
    for (const x of brokeVerified) console.log(`       ${x}`);
    process.exitCode = 1;
  }
  console.log('');
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
