/**
 * **거래처 명부 정리 — 죽은 줄을 걷어낸다.** 기본은 «보기만», `--apply` 라야 고친다.
 *
 * ★사장님 2026-08-27 「니가 딱 봤을때 정리할거는 과감하게 말해줘봐」 「추천대로해」.
 *
 * 실측 2026-08-27 — 명부 63곳 중 **25곳이 아무 데도 안 쓰인다.** 대부분 `PT-00xx` 무리다.
 * 옛 번호(PT)가 새 번호(공급사 RP · 영업채널 SP)로 바뀌면서 옛 줄이 그대로 남았다.
 * 그 줄들이 «같은 회사 두 줄»을 만들어 코드 붙이기를 막는다 —
 * 「렌트존」이 실제로 그래서 코드를 못 받고 있다(PT-0001 · PT-0014 · RP007 «셋»에 걸린다).
 *
 * ★★★**지우기 전에 «어디서 쓰이나»를 다시 센다.** 목록은 아래에 박아 뒀지만 그걸 믿지 않는다 —
 *   그 사이 누가 썼을 수 있다. 하나라도 걸리면 **그 줄은 안 지운다.**
 * ★★**지우기 전에 통째로 뜬다.** `tmp/거래처-백업-<시각>.json`. 되돌릴 길 없이 지우지 않는다.
 * ⚠ **소스에 박힌 코드는 참조로 안 잡힌다.** `OP001`(정산서 발행인 `ISSUER_CODE`)이 그렇다 —
 *   「안 쓰임」으로 보이지만 지우면 청구서에서 «우리 회사»가 사라진다. 그래서 `KEEP` 에 박아 둔다.
 * ⚠ 짝 없이 안 쓰이는 곳(RP033 스카이렌트카 · SP003 · SP006 · SP009)은 **목록에 없다** —
 *   「죽은 것」이 아니라 «등록만 하고 아직 거래가 없는» 것이다.
 *
 *   npx tsx scripts/cleanup-partners.mts            무엇을 고칠지 표로만
 *   npx tsx scripts/cleanup-partners.mts --apply    뜨고 나서 정말로 고친다
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

/** **절대 안 지운다.** 참조로는 안 잡히는데 살아 있는 것. ★까닭 없는 예외는 다음 사람이 지운다. */
const KEEP: Record<string, string> = {
  OP001: '정산서 발행인(ISSUER_CODE) — 소스에 박혀 있어 참조로 안 잡힌다',
};

/** 지울 줄 — 「안 쓰임」이면서 «살아 있는 짝이 있는» 것. */
const DROP: { code: string; why: string }[] = [
  { code: 'PT-0004', why: '이름도 없는 빈 줄' },
  { code: 'PT-0018', why: '이름도 없는 빈 줄' },
  { code: 'PT-0019', why: '이름도 없는 빈 줄' },
  { code: 'PT-0022', why: '이름도 없는 빈 줄' },
  { code: 'PT-0025', why: '이름도 없는 빈 줄' },
  { code: 'PT-0002', why: '에이카솔루션 — 산 줄은 SP007(정산2)' },
  { code: 'PT-0005', why: '에이카솔루션 — 산 줄은 SP007(정산2)' },
  { code: 'PT-0003', why: '오토웨이브 — 산 줄은 SP006' },
  { code: 'PT-0006', why: '천조(카인베스트) — 산 줄은 SP004(계정3)' },
  { code: 'PT-0007', why: '차대표 물류 — 산 줄은 SP003' },
  { code: 'PT-0008', why: '에스엠씨(S.M.C) — 산 줄은 SP008(정산4)' },
  { code: 'PT-0009', why: '누누장렌트카 — 산 줄은 SP009' },
  { code: 'PT-0010', why: '(주)에스아이그룹 — 산 줄은 SP010(계정1)' },
  { code: 'PT-0011', why: '주식회사 이상한친구들 — 산 줄은 SP005(계정1 계약1)' },
  { code: 'PT-0012', why: '주식회사 제이앤제이렌트카 — 산 줄은 RP030(상품7 정책3)' },
  { code: 'PT-0013', why: '주식회사 렌트야 — 산 줄은 SP002(계정16 계약13 정산23)' },
  { code: 'PT-0017', why: '이렌시카 — 산 줄은 PT100(계정1)' },
  { code: 'PT-0014', why: '(주)렌트존 — 산 줄은 PT-0001(상품6)' },
  { code: 'RP007', why: '렌트존 — 산 줄은 PT-0001(상품6). ★이 줄 때문에 「렌트존」이 «여럿»이라 코드를 못 받았다' },
];

/** 유형이 안 박혀 명부에서 통째로 빠지던 곳. 지우는 게 아니라 **채우는** 것이다. */
const SET_TYPE: { code: string; type: string; why: string }[] = [
  { code: 'PT-0023', type: '공급사', why: '주식회사 에스에이렌터카 — 상품12 정책2 계약1 인데 유형이 비어 명부에서 빠졌다' },
  { code: 'RP030', type: '공급사', why: '주식회사 제이앤제이렌트카 — 상품7 정책3 인데 유형이 비었다' },
];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({
    credential: cert(sa),
    databaseURL: S(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL)
      || 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
  });
}
const db = getDatabase();
const g = async (p: string) => ((await db.ref(p).get().catch(() => null))?.val() || {}) as Record<string, Record<string, unknown>>;

const [pBase, pOver, users, srows, veh, vehV4, prod, prodV4, pol, polV4, con, conV4] = await Promise.all([
  g('partners'), g('v4/partners'), g('users'), g('v4/settlement_rows'),
  g('vehicles'), g('v4/vehicles'), g('products'), g('v4/products'),
  g('policies'), g('v4/policies'), g('contracts'), g('v4/contracts'),
]);
const merged = { ...pBase, ...pOver };
const nm = (p: Record<string, unknown> = {}) => S(p.name) || S(p.partner_name) || S(p.company_name);

/** ★박아 둔 목록을 믿지 않고 **지금 다시 센다.** */
const usedBy = (code: string) => {
  const n = (o: Record<string, Record<string, unknown>>, ks: string[]) =>
    Object.values(o).filter((x) => ks.some((k) => S(x?.[k]) === code)).length;
  const out: string[] = [];
  const u = n(users, ['company_code', 'agent_channel_code']);
  const v = n(veh, ['provider_company_code', 'partner_code', 'supplier_code'])
    + n(vehV4, ['provider_company_code', 'partner_code', 'supplier_code']);
  const p = n(prod, ['provider_company_code', 'partner_code']) + n(prodV4, ['provider_company_code', 'partner_code']);
  const o = n(pol, ['provider_company_code', 'provider_code', 'partner_code'])
    + n(polV4, ['provider_company_code', 'provider_code', 'partner_code']);
  const c = n(con, ['provider_company_code', 'partner_code', 'agent_channel_code'])
    + n(conV4, ['provider_company_code', 'partner_code', 'agent_channel_code']);
  const s = n(srows, ['supplierCode', 'channelCode']);
  if (u) out.push(`계정${u}`);
  if (v) out.push(`매물${v}`);
  if (p) out.push(`상품${p}`);
  if (o) out.push(`정책${o}`);
  if (c) out.push(`계약${c}`);
  if (s) out.push(`정산${s}`);
  return out;
};

console.log(`\n■ 거래처 명부 정리 — 명부 ${Object.keys(merged).length}곳${APPLY ? '' : '   ★보기만 합니다'}\n`);

const go: string[] = [];
let stopped = 0;
for (const { code, why } of DROP) {
  if (KEEP[code]) { stopped++; console.log(`   ⛔ ${code.padEnd(9)}${nm(merged[code]).padEnd(22)}안 지웁니다 — ${KEEP[code]}`); continue; }
  if (!(code in pBase) && !(code in pOver)) { console.log(`   ·  ${code.padEnd(9)}${''.padEnd(22)}이미 없습니다`); continue; }
  const hit = usedBy(code);
  if (hit.length) { stopped++; console.log(`   ⛔ ${code.padEnd(9)}${nm(merged[code]).padEnd(22)}★안 지웁니다 — 지금 쓰입니다: ${hit.join(' ')}`); continue; }
  go.push(code);
  console.log(`   ○  ${code.padEnd(9)}${nm(merged[code]).padEnd(22)}${why}`);
}

console.log('\n▸ 유형 채우기');
const types = SET_TYPE.filter(({ code, type }) => {
  if (!(code in pBase) && !(code in pOver)) { console.log(`   ·  ${code.padEnd(9)}없습니다`); return false; }
  if (S(merged[code]?.partner_type) === type) { console.log(`   ·  ${code.padEnd(9)}${nm(merged[code]).padEnd(22)}이미 「${type}」`); return false; }
  return true;
});
for (const { code, type, why } of types) console.log(`   ○  ${code.padEnd(9)}${nm(merged[code]).padEnd(22)}→ 「${type}」  ${why}`);

console.log(`\n   지울 것 ${go.length}  ·  멈춘 것 ${stopped}  ·  유형 채울 것 ${types.length}`);
if (!APPLY) { console.log('\n   ★아직 «안 고쳤습니다». --apply 를 붙이세요.\n'); process.exit(0); }
if (!go.length && !types.length) { console.log('\n   ○ 할 것이 없습니다.\n'); process.exit(0); }

/** ★되돌릴 길을 «먼저» 만든다. 뜨는 데 실패하면 아무것도 안 건드린다. */
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = `tmp/거래처-백업-${stamp}.json`;
const touched = [...go, ...types.map((t) => t.code)];
writeFileSync(file, JSON.stringify({
  at: stamp,
  dropped: go,
  typed: types,
  partners: Object.fromEntries(touched.filter((c) => c in pBase).map((c) => [c, pBase[c]])),
  'v4/partners': Object.fromEntries(touched.filter((c) => c in pOver).map((c) => [c, pOver[c]])),
}, null, 2), 'utf8');
console.log(`\n   ○ 먼저 떴습니다 — ${file}`);

const patch: Record<string, unknown> = {};
for (const c of go) {
  if (c in pBase) patch[`partners/${c}`] = null;
  if (c in pOver) patch[`v4/partners/${c}`] = null;
}
// 유형은 «있는 노드에만» 채운다. 없는 노드에 새로 만들면 유령 줄이 하나 더 생긴다.
for (const { code, type } of types) {
  if (code in pOver) patch[`v4/partners/${code}/partner_type`] = type;
  else if (code in pBase) patch[`partners/${code}/partner_type`] = type;
}
await db.ref().update(patch);

const [b2, o2] = await Promise.all([g('partners'), g('v4/partners')]);
const m2 = { ...b2, ...o2 };
const left = go.filter((c) => c in b2 || c in o2);
const bad = types.filter(({ code, type }) => S(m2[code]?.partner_type) !== type);
console.log(left.length || bad.length
  ? `\n   ⛔ 안 된 것 — 못 지운 ${left.join(',') || '없음'} · 유형 안 박힌 ${bad.map((t) => t.code).join(',') || '없음'}\n`
  : `\n   ○ ${go.length}곳 지우고 ${types.length}곳 유형 채웠습니다 — 명부 ${Object.keys(m2).length}곳\n`);
console.log('   다음  npm run settlement:codes   「렌트존」·「에스에이」가 붙는지 보세요\n');
process.exit(left.length || bad.length ? 1 : 0);
