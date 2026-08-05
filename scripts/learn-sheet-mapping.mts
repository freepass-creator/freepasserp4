/**
 * 공급사별 시트 매핑을 **한 번 학습해서 박는다.**
 *
 * 지금 문제: 매핑 프로파일이 저장된 공급사가 0/16이다. 그래서 동기화할 때마다
 * 헤더 행·컬럼 매핑·어댑터를 **매번 다시 추측한다.** 유입 사고가 반복된 이유다
 * (손오공·웰릭스 0대 = 3행 헤더, 오토플러스 18대 = 배너, 아이카 = 종합시트 24탭).
 *
 * 저장하면 켜지는 것: `sheet-import.ts:537-555` 의 **fail-closed 드리프트 감지**.
 * 공급사가 열을 옮기거나 이름을 바꾸면 조용히 잘못 읽는 대신 던진다 —
 *   「시트 헤더 변경 감지 — car_number 매핑을 다시 저장하세요」
 * 지금은 저장이 0이라 이 보호가 전혀 안 걸려 있다.
 *
 * 다탭 공급사 주의: 매핑은 공급사당 하나다. 탭마다 헤더가 다르면 하나로 못 박는다
 * (박는 순간 나머지 탭이 전부 드리프트로 막힌다). 그런 곳은 «고정 불가»로 보고하고 건너뛴다.
 *
 * 실행(기본 dry-run — 아무것도 쓰지 않는다):
 *   npx tsx scripts/learn-sheet-mapping.mts
 *   ... --apply              partner.mapping_profile · mapping_header_signature 저장
 *   ... --only=RP012,RP013   특정 공급사만
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { autoMapHeaders, buildMappingHeaderSignature, normalizeSheetHeader } from '../lib/domain/sheet-import';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO } from '../lib/domain/sheet-autoplus';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length)
  .split(',').map((s) => s.trim()).filter(Boolean);
const S = (v: unknown) => String(v ?? '').trim();

/** A,B,…,Z,AA — 사람이 시트를 열어 눈으로 대조할 수 있어야 한다. 그게 이 스크립트의 목적이다. */
function colLetter(index: number): string {
  let n = index, out = '';
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let field = '', row: string[] = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchTab(sheetId: string, gid: string): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${encodeURIComponent(gid)}` : ''}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`CSV ${res.status}`);
  return parseCsv(await res.text());
}

const mergeNodes = (a: unknown, b: unknown) => {
  const m: Record<string, EntityRecord> = {};
  for (const [k, v] of Object.entries((a || {}) as Record<string, EntityRecord>)) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((b || {}) as Record<string, EntityRecord>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};

async function main() {
  const [t3, t4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const partners = mergeNodes(t3.val(), t4.val());
  const targets = Object.values(partners)
    .filter((p) => p && p._deleted !== true && S(p.sheet_url))
    .filter((p) => !ONLY.length || ONLY.includes(S(p.partner_code)))
    .sort((a, b) => S(a.partner_code).localeCompare(S(b.partner_code)));

  console.log(`시트 연결 공급사 ${targets.length}곳 — 매핑 학습\n`);
  const updates: Record<string, unknown> = {};
  let pinnable = 0, blocked = 0;

  for (const p of targets) {
    const code = S(p.partner_code) || S(p._key);
    const name = S(p.name) || S(p.partner_name) || code;
    const sheetId = (S(p.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || '';
    if (!sheetId) { console.log(`${code} ${name} — ❌ URL 형식 이상\n`); blocked++; continue; }
    const adapter = resolveAdapter(p);
    const headerRow = Math.max(0, Number(p.header_row) || 0);
    const gids = (S(p.sheet_gid) || S(p.sheet_tab) || '').split(/[,\s|]+/).filter(Boolean);
    // 오토플러스는 전용 어댑터가 자기 탭을 코드에 갖고 있어 partner.sheet_tab 이 비어 있다.
    //  기본 탭을 읽으면 엉뚱한 시트라 차량번호를 못 찾는다 — 어댑터가 아는 탭을 그대로 쓴다.
    const tabs = gids.length
      ? gids
      : adapter.id === 'autoplus' ? [AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO] : [''];

    // 탭별로 매핑을 따로 뽑아 «전부 같은가»를 본다. 다르면 하나로 못 박는다.
    const perTab: { gid: string; headers: string[]; mapping: Record<string, number> }[] = [];
    let fetchError = '';
    for (const gid of tabs) {
      try {
        const raw = await fetchTab(sheetId, gid);
        const table = adapter.prepareTable(raw, { headerRow });
        if (table.length < 2) continue;
        const headers = table[0].map((h) => S(h));
        perTab.push({ gid: gid || '(기본)', headers, mapping: autoMapHeaders(headers) });
      } catch (e) { fetchError = String((e as Error).message || e); }
    }
    if (!perTab.length) {
      console.log(`${code} ${name} — ❌ 읽을 수 있는 탭 없음${fetchError ? ` (${fetchError})` : ''}\n`);
      blocked++; continue;
    }

    const sig = (m: Record<string, number>, h: string[]) =>
      Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
        .map(([f, i]) => `${f}@${normalizeSheetHeader(h[i])}`).join('|');
    const first = perTab[0];
    const same = perTab.every((t) => sig(t.mapping, t.headers) === sig(first.mapping, first.headers));

    console.log(`${code} ${name}  [${adapter.id}${tabs.length > 1 ? ` ${perTab.length}탭` : ''}${headerRow ? ` 헤더${headerRow + 1}행` : ''}]`);
    if (!same) {
      console.log(`   ⚠ 탭마다 헤더가 다르다 — 매핑을 하나로 고정할 수 없다(고정하면 나머지 탭이 전부 막힌다)`);
      perTab.forEach((t) => console.log(`      gid ${t.gid}: ${Object.keys(t.mapping).length}필드 · ${t.headers.filter(Boolean).length}열`));
      console.log('');
      blocked++; continue;
    }

    const mapping = first.mapping;
    const signature = buildMappingHeaderSignature(first.headers, mapping);
    if (mapping.car_number === undefined) {
      console.log(`   ⚠ 차량번호 열을 못 찾음 — 사람이 확인해야 한다\n`);
      blocked++; continue;
    }
    pinnable++;
    const shown = Object.entries(mapping).sort(([, a], [, b]) => a - b);
    console.log(`   ${shown.length}필드 인식`);
    for (const [field, idx] of shown) {
      console.log(`      ${field.padEnd(24)} ← ${colLetter(idx).padStart(2)}열  「${first.headers[idx] || '(빈 헤더)'}」`);
    }
    console.log('');
    updates[`partners/${S(p._key)}/mapping_profile`] = mapping;
    updates[`partners/${S(p._key)}/mapping_header_signature`] = signature;
    updates[`partners/${S(p._key)}/mapping_learned_at`] = new Date().toISOString();
  }

  console.log(`━━ 고정 가능 ${pinnable}곳 · 사람 확인 필요 ${blocked}곳`);
  if (!pinnable) return;
  if (!APPLY) {
    console.log('\n※ dry-run. 위 매핑이 시트와 맞는지 «눈으로» 확인한 뒤 --apply');
    console.log('   열 문자(A,B,C…)로 실제 시트를 열어 대조할 수 있다.');
    return;
  }
  await db.ref('v4').update(updates);
  console.log(`\n반영 완료 — ${pinnable}곳에 mapping_profile · mapping_header_signature 저장`);
  console.log('이제 동기화는 추측하지 않고, 헤더가 바뀌면 fail-closed 로 막힌다.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
