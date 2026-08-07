/**
 * 계약 중복 접기 — 같은 `contract_code` 가 두 키로 들어간 것을 정본 하나로 접는다.
 * 기본 dry-run, 실제 반영은 --apply.
 *
 * 왜 필요한가: 2026-08-05 이관이 v3 계약을 **푸시키**(`-OxKob…`)로 한 번,
 * **계약코드 키**(`TMP-260712-01`)로 또 한 번 넣었다. 어댑터의 계약 병합은
 * `_key` 기준이라(`lib/firebase/rtdb-adapter.ts` readContractsScoped) 키가 다르면
 * 둘 다 살아남는다 → 계약 목록이 2줄, 완료 26건이 실제 14건인데 26으로 집계된다.
 *
 * ★정본은 «계약코드 키» 쪽이다. 앱이 새 계약을 저장할 때 쓰는 자연키가 `contract_code`이므로
 *   (`naturalKey()` · ENTITIES.contract.idFrom) 계약코드 키가 앞으로도 계속 쓰인다.
 *
 * ★안전 계약
 *   · **물리 삭제하지 않는다.** `_deleted:true` 소프트 삭제만 — 되돌리려면 그 필드를 지우면 된다.
 *   · 접기 전 `tmp/migration-backups/<stamp>/v4_contracts.json` 에 전량 백업한다.
 *   · **필드 유실 검사**: 중복본에만 있는 값(마커 제외)이 하나라도 있으면 그 쌍은 건너뛴다.
 *   · **참조 검사**: 정산·방이 중복본 키를 참조하면 그 쌍은 건너뛴다.
 *   · 정본(키 === contract_code)이 없는 그룹은 손대지 않고 사람 판단으로 남긴다.
 *
 *   npx tsx scripts/fold-duplicate-contracts.mts            (미리보기)
 *   npx tsx scripts/fold-duplicate-contracts.mts --apply    (반영)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

/** 이관 흔적 — 이 필드가 중복본에만 있어도 «유실»로 치지 않는다. */
const MIGRATION_MARKERS = new Set([
  '_key', 'migrated_from_v3_at', 'field_backfilled_from_v3_at', 'createdAt', 'createdBy', 'companyId',
]);

/** 정산·방이 계약을 가리킬 수 있는 필드 이름. */
const REF_FIELDS = ['contract_code', 'contract_key', 'contract_id', 'contract_uid', '_contract_key', 'contract'];

const DB_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * RTDB 접근은 **REST** 로 한다 — admin SDK 의 소켓 `.get()` 이 이 환경에서 대용량 노드에
 * 응답 없이 멎는 일이 재현된다(2026-08-06 실측: 소켓 15분 무응답 / REST 1.4초).
 * REST 의 단일 PATCH 는 소켓 `update()` 와 같은 원자성을 가진다.
 */
async function restGet(token: string, node: string): Promise<Record<string, Rec>> {
  const res = await fetch(`${DB_URL}/${node}.json?access_token=${token}`);
  if (!res.ok) throw new Error(`${node} 읽기 실패 ${res.status}`);
  return (JSON.parse(await res.text()) || {}) as Record<string, Rec>;
}

async function restPatch(token: string, node: string, patch: Rec): Promise<void> {
  const res = await fetch(`${DB_URL}/${node}.json?access_token=${token}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`${node} 쓰기 실패 ${res.status} ${await res.text()}`);
}

async function main() {
  const apply = process.argv.includes('--apply');

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: DB_URL });
  }
  const token = (await getApps()[0].options.credential!.getAccessToken()).access_token;

  const contracts = await restGet(token, 'v4/contracts');
  if (!Object.keys(contracts).length) throw new Error('v4/contracts 가 비어 있다 — 중단');

  // 참조 색인 — 중복본 키를 가리키는 레코드가 있으면 접지 않는다.
  const referenced = new Set<string>();
  for (const node of ['v4/settlements', 'v4/rooms', 'v4/settlements_agent_private', 'v4/settlements_provider_private', 'v4/settlements_admin_private']) {
    const val = await restGet(token, node);
    for (const r of Object.values(val)) {
      if (!r || typeof r !== 'object') continue;
      for (const f of REF_FIELDS) { const v = S(r[f]); if (v) referenced.add(v); }
    }
  }

  const byCode = new Map<string, string[]>();
  for (const [key, rec] of Object.entries(contracts)) {
    if (dead(rec)) continue;
    const code = S(rec.contract_code);
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(key);
  }
  const groups = [...byCode].filter(([, keys]) => keys.length > 1);

  console.log(`\n══ 계약 중복 접기 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  v4/contracts ${Object.keys(contracts).length}건 · 고유 계약코드 ${byCode.size}건 · 중복 그룹 ${groups.length}건\n`);

  const foldable: { code: string; canonical: string; drop: string[] }[] = [];
  const skipped: string[] = [];

  for (const [code, keys] of groups) {
    const canonical = keys.find((k) => k === code);
    if (!canonical) { skipped.push(`${code} — 정본(키=계약코드) 없음 · 키 ${keys.join(', ')}`); continue; }
    const drop: string[] = [];
    for (const k of keys) {
      if (k === canonical) continue;
      if (referenced.has(k)) { skipped.push(`${code} — 중복본 ${k} 가 정산·방에서 참조됨`); continue; }
      // 필드 유실 검사 — 중복본에만 있는 값이 있으면 접지 않는다.
      const lost = Object.keys(contracts[k]).filter((f) => {
        if (MIGRATION_MARKERS.has(f)) return false;
        const dupVal = contracts[k][f];
        if (dupVal === null || dupVal === undefined || S(dupVal) === '') return false;
        const canVal = contracts[canonical][f];
        return canVal === null || canVal === undefined || S(canVal) === '';
      });
      if (lost.length) { skipped.push(`${code} — 중복본 ${k} 에만 있는 값: ${lost.join(', ')}`); continue; }
      drop.push(k);
    }
    if (drop.length) foldable.push({ code, canonical, drop });
  }

  const dropCount = foldable.reduce((a, g) => a + g.drop.length, 0);
  console.log(`  접을 수 있음 ${foldable.length}그룹 · 삭제표시 대상 ${dropCount}건`);
  console.log(`  건너뜀 ${skipped.length}건${skipped.length ? ' (사람 판단)' : ''}`);
  for (const s of skipped.slice(0, 20)) console.log(`     · ${s}`);

  // 상태별 before/after — 집계가 얼마나 어긋나 있었는지 보여준다.
  const tally = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) { const s = S(contracts[k].contract_status) || '(빈값)'; m.set(s, (m.get(s) || 0) + 1); }
    return m;
  };
  const dropSet = new Set(foldable.flatMap((g) => g.drop));
  const aliveKeys = Object.keys(contracts).filter((k) => !dead(contracts[k]));
  const before = tally(aliveKeys);
  const after = tally(aliveKeys.filter((k) => !dropSet.has(k)));
  console.log(`\n  상태별 — 지금 → 접은 뒤`);
  for (const s of new Set([...before.keys(), ...after.keys()])) {
    console.log(`     ${s.padEnd(8)} ${String(before.get(s) || 0).padStart(3)}건 → ${String(after.get(s) || 0).padStart(3)}건`);
  }

  if (!apply) {
    console.log(`\n※ dry-run. 반영은 --apply\n`);
    return;
  }

  const stamp = process.env.BACKUP_STAMP || 'contracts-fold';
  const dir = `tmp/migration-backups/${stamp}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/v4_contracts.json`, JSON.stringify(contracts, null, 2), 'utf8');
  console.log(`\n  백업 ${dir}/v4_contracts.json (${Object.keys(contracts).length}건)`);

  const now = new Date().toISOString();
  const patch: Rec = {};
  for (const g of foldable) {
    for (const k of g.drop) {
      patch[`${k}/_deleted`] = true;
      patch[`${k}/_deleted_at`] = now;
      patch[`${k}/_deleted_reason`] = `v3 이관 중복 — 정본 ${g.canonical} 유지 (fold-duplicate-contracts)`;
    }
  }
  await restPatch(token, 'v4/contracts', patch);
  console.log(`  반영 ${dropCount}건 삭제표시 (물리 삭제 아님 — _deleted 를 지우면 복구)\n`);
  console.log(`끝. 확인: npx tsx scripts/fold-duplicate-contracts.mts (중복 그룹 0 이어야 한다)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
