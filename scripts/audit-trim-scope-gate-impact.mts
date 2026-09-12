/**
 * 트림 게이트 강화 «영향범위 사전측정» — 코드를 고치기 전에 얼마나 흔들리는지 잰다. 읽기 전용.
 *
 * 배경(사장님 2026-09-1x): 「원문을 보고 선택되는 그 로직 — 트림이나 하위 모델을 벗어난 거를
 *   절대 선택할 수 없다는 거지.」 실제로 확인해 보니 `lib/domain/atom-invariants.ts` 의 트림 규칙(TRIM)이
 *   `severity:'warn'`이라 «세부모델 밖 트림»이 확정을 막지 못하고, 게다가 실제 대량 유입 경로인
 *   `lib/domain/sheet-import.ts` 의 `prepareMasterIngress()`는 `atomViolations`/`isConfirmable`을
 *   아예 안 부른다(snap confidence만 본다) — «절대 불가능」이 지금은 구조적으로 안 지켜진다.
 *
 * 고치는 방향은 명확하다(①TRIM→block ②prepareMasterIngress에 게이트 연결 ③resolveGen 순서버그 수정).
 * 그런데 이 저장소 규칙은 «게이트를 바꾸기 전에 실데이터로 영향범위를 잰다»(CLAUDE.md 여러 사고 사례).
 * 이 스크립트는 그 «잼» 전용이다 — 아무것도 안 고친다. 지금 «확정»으로 살아있는 상품 중
 *   - (A) 이미 block 위반이 있는데도 확정으로 남은 것 = ②(게이트 미연결)의 영향범위
 *   - (B) block 위반은 없지만 TRIM warn만 있는 것 = ①(TRIM→block)만 올렸을 때 새로 검수대기로 떨어질 대수
 *   - (C) (B) 중에서 그 트림이 «같은 모델의 다른 세대» 트림풀에는 있는 것 = resolveGen류 순서버그(③) 의심 신호
 * 를 센다. 실 Firebase 자격증명이 있는 사람/에이전트가 돌린다.
 *
 *   npx tsx scripts/audit-trim-scope-gate-impact.mts
 *   npx tsx scripts/audit-trim-scope-gate-impact.mts --code=RP021   (공급사 하나만)
 *   npx tsx scripts/audit-trim-scope-gate-impact.mts --json         (tmp/trim-scope-gate-impact.json 로도 저장)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { atomViolations, type AtomView } from '../lib/domain/atom-invariants';
import { buildMasterIndex } from '../lib/domain/atom-health';
import { makerGroup } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');
const arg = (n: string) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const JSON_OUT = process.argv.includes('--json');
const only = arg('code').toUpperCase();

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const entries: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const idx = buildMasterIndex(entries);

/** 같은 (제조사·모델)의 «다른» 세부모델들 중 이 트림이 실재하는 세부모델 목록 — resolveGen류 세대이월 신호. */
function otherGensWithTrim(maker: unknown, model: unknown, curSub: unknown, trim: unknown): string[] {
  const mk = N(maker), mo = N(model), sub = N(curSub), tr = N(trim);
  const hits = new Set<string>();
  for (const e of entries) {
    if (N(e.model) !== mo || N(e.sub_model) === sub) continue;
    if (!makerGroup(N(e.maker)).some((a) => makerGroup(mk).includes(a))) continue;
    if ((e.trims || []).some((t) => N(t) === tr)) hits.add(S(e.sub_model));
  }
  return [...hits];
}

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const products = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;

  type Row = { car: string; code: string; maker: string; model: string; sub: string; trim: string; codes: string[]; otherGens: string[] };
  const blockedButConfirmed: Row[] = [];
  const trimWarnOnly: Row[] = [];
  const trimWarnCrossGen: Row[] = [];
  const otherWarnOnly: Row[] = [];
  let confirmedTotal = 0;

  for (const [key, p] of Object.entries(products)) {
    if (!p || typeof p !== 'object' || dead(p)) continue;
    const code = S(p.provider_company_code);
    if (only && code !== only) continue;
    const conf = S(p._snap_confidence);
    const confirmed = p._needs_master_review === false || (p._needs_master_review == null && (conf === 'high' || conf === 'medium'));
    if (!confirmed) continue;
    confirmedTotal++;

    const view: AtomView = {
      maker: p.maker, model: p.model, sub_model: p.sub_model, trim_name: p.trim_name,
      fuel_type: p.fuel_type, engine_cc: p.engine_cc, seats: p.seats,
      source: p.source, source_schema: p.source_schema, provider_company_code: p.provider_company_code,
      원문: p._raw_vehicle && typeof p._raw_vehicle === 'object' ? { 차명: (p._raw_vehicle as Rec).차명 ?? (p._raw_vehicle as Rec).vname } : undefined,
    };
    const vio = atomViolations(view, idx);
    const blocks = vio.filter((v) => v.severity === 'block');
    const row: Row = {
      car: S(p.car_number) || `(무번호:${key.slice(0, 8)})`, code,
      maker: S(p.maker), model: S(p.model), sub: S(p.sub_model), trim: S(p.trim_name),
      codes: vio.map((v) => `${v.severity[0]}:${v.code}`), otherGens: [],
    };

    if (blocks.length) { blockedButConfirmed.push(row); continue; }
    const trimVio = vio.find((v) => v.code === 'TRIM');
    if (trimVio && vio.every((v) => v.code === 'TRIM')) {
      row.otherGens = otherGensWithTrim(p.maker, p.model, p.sub_model, p.trim_name);
      (row.otherGens.length ? trimWarnCrossGen : trimWarnOnly).push(row);
    } else if (vio.length) {
      otherWarnOnly.push(row);
    }
  }

  console.log('■ 트림/세부모델 게이트 강화 — 사전 영향범위 측정 (읽기전용, 아무것도 안 고침)\n');
  console.log(`  확정으로 살아있는 상품 ${confirmedTotal}대${only ? ` (공급사 ${only}만)` : ''}\n`);

  console.log(`(A) 이미 block 위반인데 «확정» — prepareMasterIngress에 게이트 미연결(②)의 현재 노출 ${blockedButConfirmed.length}대`);
  for (const r of blockedButConfirmed.slice(0, 30)) console.log(`   ${r.car.padEnd(11)} ${r.code.padEnd(9)} 「${r.maker} ${r.model} ${r.sub}」 트림「${r.trim}」  ${r.codes.join(' ')}`);
  if (blockedButConfirmed.length > 30) console.log(`   … 그 외 ${blockedButConfirmed.length - 30}대`);

  console.log(`\n(B) block 위반은 없고 TRIM warn만 — ①(TRIM→block) 단독 적용 시 새로 검수대기 ${trimWarnOnly.length + trimWarnCrossGen.length}대`);
  console.log(`    그중 트림이 «다른 세대» 풀에는 있음(③ resolveGen류 이월 의심) ${trimWarnCrossGen.length}대`);
  for (const r of trimWarnCrossGen.slice(0, 30)) console.log(`   ${r.car.padEnd(11)} ${r.code.padEnd(9)} 「${r.maker} ${r.model} ${r.sub}」 트림「${r.trim}」 ← 다른세대: ${r.otherGens.join(', ')}`);
  if (trimWarnCrossGen.length > 30) console.log(`   … 그 외 ${trimWarnCrossGen.length - 30}대`);
  console.log(`    그중 어느 세대 풀에도 없음(순수 오타·미등록 트림 의심) ${trimWarnOnly.length}대`);
  for (const r of trimWarnOnly.slice(0, 20)) console.log(`   ${r.car.padEnd(11)} ${r.code.padEnd(9)} 「${r.maker} ${r.model} ${r.sub}」 트림「${r.trim}」`);
  if (trimWarnOnly.length > 20) console.log(`   … 그 외 ${trimWarnOnly.length - 20}대`);

  console.log(`\n(참고) 그 밖의 warn만 있는 확정 상품 ${otherWarnOnly.length}대 (FUEL_RAW·CC_RAW·SEATS_*·PROV — 이번 결정과 무관, 참고용)`);

  const summary = {
    confirmedTotal, only: only || null,
    blockedButConfirmed: blockedButConfirmed.length,
    trimWarnOnly: trimWarnOnly.length,
    trimWarnCrossGen: trimWarnCrossGen.length,
    otherWarnOnly: otherWarnOnly.length,
  };
  console.log(`\n요약: ${JSON.stringify(summary)}`);
  console.log('\n※ 이 스크립트는 exit 1 이어도 게이트가 아니다 — 「고치면 몇 대가 움직이는가」를 보여줄 뿐,');
  console.log('   실제로 ①②③을 적용할지·언제 할지는 이 결과를 보고 사람이 정한다.');

  if (JSON_OUT) {
    writeFileSync('tmp/trim-scope-gate-impact.json', JSON.stringify({ summary, blockedButConfirmed, trimWarnCrossGen, trimWarnOnly, otherWarnOnly }, null, 1));
    console.log('\ntmp/trim-scope-gate-impact.json 저장');
  }

  process.exit((blockedButConfirmed.length + trimWarnOnly.length + trimWarnCrossGen.length) > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
