/**
 * 전 공급사 «원천 직접 → Firestore» 오케스트레이터 — 매시간 자동(직접수집 파이프라인).
 *
 * 사장님 2026-09-04 「나머지 자동화 가자.」 공급사마다 ingest-supplier-to-firestore 를 순서대로 돈다.
 *   - 대상 = MIRROR_SOURCES(시트·홈피) + 손오공(RP012) + partner.sheet_url 등록 공급사.
 *   - 각 공급사: --apply (불변 pin + 새 차 + 상태). 한 곳이 실패(503 등)해도 다음으로 간다.
 *   - ⚠ 옛 파이프라인(hourly-sync 미러 ⑭)은 «안» 건드린다 — 이건 별도 독립 실행이다.
 *     둘이 같이 돌면 products 를 둘 다 쓰지만 값은 같은 원천이라 어긋나지 않는다(컷오버는 나중).
 *
 * 실행: GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/ingest-all-suppliers.mts
 *   --only=RP004,RP031  특정 공급사만 · --variable  변동만(가벼운 회차)
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { sheetIdFromUrl } from '../lib/domain/supplier-sheet-read';

const S = (v: unknown) => String(v ?? '').trim();
const TSX_CLI = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
const SHIM = fileURLToPath(new URL('./lib/server-only-shim.cjs', import.meta.url));
const INGEST = fileURLToPath(new URL('./ingest-supplier-to-firestore.mts', import.meta.url));
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.split('=')[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
const VARIABLE = process.argv.includes('--variable');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

// 대상 공급사 코드 모으기 — 시트·홈피(MIRROR_SOURCES) + 손오공 + partner.sheet_url.
const codes = new Set<string>([...MIRROR_SOURCES.map((m) => m.code), 'RP012']);
{
  const snap = await fs.collection('partner').get();
  for (const d of snap.docs) {
    const p = d.data() as { partner_code?: string; sheet_url?: string };
    if (p.partner_code && sheetIdFromUrl(p.sheet_url)) codes.add(S(p.partner_code));
  }
}
let targets = [...codes];
if (ONLY.length) targets = targets.filter((c) => ONLY.includes(c));
console.log(`■ 직접수집 오케스트레이터 — 공급사 ${targets.length}곳${VARIABLE ? ' (변동만)' : ''}: ${targets.join(' · ')}\n`);

const RATE = /\b429\b|\b50[0234]\b|rate.?limit|quota|UNAVAILABLE|ECONNRESET|socket hang up/i;
const runOne = (code: string): { ok: boolean; line: string } => {
  const args = [TSX_CLI, '--require', SHIM, INGEST, `--code=${code}`, '--apply', ...(VARIABLE ? ['--variable'] : [])];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    if (r.status === 0) {
      const line = out.split(/\r?\n/).reverse().find((l) => /반영 완료|변동 폴링 완료/.test(l)) || out.split(/\r?\n/).find((l) => l.includes('직접 수집')) || '완료';
      return { ok: true, line: line.trim() };
    }
    if (attempt < 2 && RATE.test(out)) { console.log(`  ${code} ⏳ 한도/일시오류 — 20초 쉬고 재시도`); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000); continue; }
    return { ok: false, line: (out.split(/\r?\n/).filter(Boolean).pop() || 'Error').slice(0, 160) };
  }
  return { ok: false, line: 'Error' };
};

let ok = 0, fail = 0;
for (const code of targets) {
  const r = runOne(code);
  console.log(`${r.ok ? '✓' : '✗'} ${code.padEnd(8)} ${r.line}`);
  if (r.ok) ok++; else fail++;
}
console.log(`\n■ 끝 — 성공 ${ok} · 실패 ${fail} / ${targets.length}`);
process.exit(fail > 0 ? 1 : 0);
