/**
 * 마스터 보강 노가다 목록 만들기.
 *
 * 실매물 원문에 트림처럼 적혀 있는데 **마스터 그 세대 목록에 없는 낱말**을 세대별로 모은다.
 * 사람(또는 커서)이 엔카에서 확인하고 마스터에 넣을 «작업 대상 목록»이다 — 자동 반영은 하지 않는다.
 *
 *   OUT=tmp/master-gap.csv npx tsx scripts/build-master-gap-worklist.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { realMasterTrims } from '../lib/domain/vehicle-master-options';
import { resolveTrim } from '../lib/domain/vehicle-trim-resolve';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const token = (await jwt.getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text()) || {};
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const trimsOf = (sub: string): string[] => {
  const out = new Set<string>();
  for (const e of entries as unknown as Rec[]) {
    if (S(e.sub_model) !== sub) continue;
    for (const t of realMasterTrims((e.trims || []) as never)) out.add(S(t));
    for (const v of (e.variants || []) as Rec[]) for (const t of realMasterTrims((v.trims || []) as never)) out.add(S(t));
  }
  return [...out].filter(Boolean);
};

/**
 * 트림일 리 없는 말 — 연료·구동·인승·연식·용도·차체.
 * 여기 없는 말만 «트림 후보»로 올린다. 넓게 잡아야 노가다 목록이 깨끗해진다.
 */
const NOISE = new RegExp('^('
  + '자가용|사업용|렌트|렌터카|리스|장기렌트|법인|개인|영업용|장애인용|일반인'
  + '|가솔린|디젤|엘피지|lpg|lpi|lpe|hev|phev|ev|전기|수소|하이브리드|가스'
  + '|이륜|사륜|전륜|후륜|awd|4wd|2wd|fwd|rwd|xdrive|quattro|4매틱|4matic'
  + '|도어|인승|승|년식|년|월|my|신형|구형|더뉴|올뉴|the|new|all|더|뉴|올'
  + '|오토|수동|자동|at|mt|cvt|dct|터보|t|gdi|tci|crdi|vgt|smartstream|스마트스트림'
  + '|세단|왜건|해치백|쿠페|suv|밴|van|픽업|리무진|롱바디'
  + '|인치|휠|썬루프|선루프|네비|내비|옵션|기본|없음|기타|미정|세부등급'
  // 브랜드명은 트림이 아니다 — 원문 맨 앞에 붙어 온다(「BMW X1 …」·「볼보 XC40 …」)
  + '|현대|기아|제네시스|쉐보레|르노|쌍용|kg모빌리티|bmw|벤츠|메르세데스|아우디|폭스바겐|볼보|미니|mini'
  + '|테슬라|포르쉐|렉서스|토요타|혼다|닛산|인피니티|재규어|랜드로버|캐딜락|링컨|지프|푸조|시트로엥'
  + '|[0-9.,]+' + ')$', 'i');

/** 트림이 아니라 «제원·세대 표기»인 낱말 — 「26MY」·「20인치+ECS」·「2세대」·「3.5LPI」. */
const SPEC = [
  /^\d{2,4}my$/i, /^\d+(?:\.\d+)?(?:인치|인승|도어|리터|l)$/i, /^\d+세대$/,
  /^\d+(?:\.\d+)?(?:lpi|gdi|crdi|tdi|tsi|t|d)$/i, /^\d/,
  /^[a-z]{1,4}\d{1,3}[a-z]?$/i,          // 세대코드·엔진코드 (CN7·DN8·SA·F48·G02·B4)
  /인테리어|컬러|색상|패키지|에디션$/,
];

type Gap = { model: string; sub: string; word: string; n: number; plates: string[]; cands: string[] };
const gaps = new Map<string, Gap>();

for (const p of Object.values(prods) as Rec[]) {
  if (!p || typeof p !== 'object' || dead(p) || !p._raw_vehicle) continue;
  const r = snapToMaster({ ...(p as never) }, entries) as unknown as Rec | null;
  if (S(r?.trim_name) || S(p.trim_name)) continue;           // 이미 잡힌 건 볼 것 없다
  const sub = S(r?.sub_model) || S(p.sub_model);
  const model = S(r?.model) || S(p.model);
  if (!sub) continue;
  const cands = trimsOf(sub);
  if (!cands.length) continue;                                // 제네시스처럼 목록 자체가 없는 건 정상

  const raw = p._raw_vehicle as Rec;
  const text = [raw.trim_name, raw.model, raw.sub_model, p.trim_extra].map(S).filter(Boolean).join(' ');
  if (!text) continue;
  if (resolveTrim(text, cands)) continue;                     // 지금 코드로 잡히면 결손 아님

  for (const w0 of text.split(/[\s/·,()[\]]+/)) {
    const w = S(w0).replace(/^[-+]|[-+]$/g, '');
    if (w.length < 2 || NOISE.test(w)) continue;
    if (SPEC.some((re) => re.test(w))) continue;
    if (model && (w.includes(model) || model.includes(w))) continue;   // 차명은 트림이 아니다
    if (sub.includes(w)) continue;
    const key = `${sub}|${w}`;
    if (!gaps.has(key)) gaps.set(key, { model, sub, word: w, n: 0, plates: [], cands });
    const g = gaps.get(key)!;
    g.n++;
    if (g.plates.length < 5) g.plates.push(S(p.car_number) || '(무번호)');
  }
}

const rows = [...gaps.values()].sort((a, b) => b.n - a.n || a.sub.localeCompare(b.sub, 'ko'));
console.log(`마스터 보강 후보 ${rows.length}건 (트림 못 잡은 차에서 뽑은 낱말)\n`);
console.log('대수  세대                   후보낱말            마스터에 이미 있는 트림');
for (const g of rows.slice(0, 40)) {
  console.log(`${String(g.n).padStart(3)}대  ${g.sub.slice(0, 20).padEnd(22)} ${g.word.slice(0, 16).padEnd(18)} ${g.cands.slice(0, 4).join(', ')}`);
}
if (rows.length > 40) console.log(`… 그 외 ${rows.length - 40}건 (CSV 참조)`);

const out = S(process.env.OUT);
if (out) {
  mkdirSync(out.replace(/[^/\\]+$/, '') || '.', { recursive: true });
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [
    ['대수', '제조모델', '세대(세부모델)', '후보낱말', '엔카확인결과', '마스터에추가할트림', '예시차량번호', '마스터에이미있는트림'].join(','),
    ...rows.map((g) => [
      String(g.n), g.model, g.sub, g.word, '', '', g.plates.join(' '), g.cands.join(' / '),
    ].map(esc).join(',')),
  ].join('\r\n');
  writeFileSync(out, '﻿' + csv, 'utf8');
  console.log(`\nCSV 저장: ${out}  ← 「엔카확인결과」·「마스터에추가할트림」 두 칸이 노가다 대상`);
}
