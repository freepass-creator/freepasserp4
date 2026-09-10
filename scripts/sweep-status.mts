/**
 * **차량상태만 «전 공급사» 한 바퀴 — 30분 회차의 심장.** 기본 미리보기 · 반영은 `--apply`.
 *
 * > 사장님 2026-09-08 「**30분에 한 번씩은 상태만 챙기는 게 맞겠어**」
 *
 * ⚠⚠ **돌아가며(rotation) 방식으로는 30분마다 상태를 못 챙긴다.** 한 회차에 세 곳씩이면
 *   스무 곳 한 바퀴가 «세 시간 반»이다 — 그 사이 팔린 차가 목록에 계속 선다.
 *   ⇒ 상태만 볼 때는 **한 회차에 전 공급사를 다 훑는다.** 실측으로 그게 되는지 재고 세웠다:
 * ```
 *   공급사 한 곳 = 두드림 «두 번»   ← ① 탭 이름 ② 재고 탭들의 A1:P1000 을 «한 요청»에 몰아서
 *   실측 2026-09-08 — 23곳 · 두드림 46번 · 17~20초 · 시트가 말해 준 차 1,051
 * ```
 * ★★**커버리지를 안 재면 «반쪽 회차»를 못 알아챈다.** 세 번 다 ✓ 로 끝났는데 실제로는 이랬다:
 * ```
 *   8열까지만 읽음        상태 칸이 뒤인 곳을 통째로 놓침(오플 「판매상태」는 11열째)
 *   탭 이름 없는 범위      구글이 «첫 탭»만 준다 → 오플은 「공지사항」만 읽혔다   68%
 *   머리글을 8줄까지만     오플 머리글은 «9번째 줄» — 한 줄 차이로 77대를 놓쳤다   81%
 *   ⇒ 셋을 고쳐 89%. 남은 11% 는 못 읽은 게 아니라 «원천에 없는 차»(59)와 아이언(17)이다.
 * ```
 *   무거운 회차가 시트 «전체»를 읽는 것과 다르다 — 여긴 **차번과 상태 두 칸**만 본다.
 *
 * ★**바뀐 것만 쓴다.** 상태가 그대로면 원자를 안 건드린다(쓰기도 한도를 먹는다).
 * ★**상태는 한 벌** — `vehicle_status` 를 쓰면 `status`·`status_kind`·`listable` 도 같이 맞춘다.
 * ★**푸는 것도 공급사 시트가 한다.** 정산원장은 「잠그기만 하고 안 푼다」이고,
 *   다시 팔 수 있는지는 «사람이 공급사 시트에서» 정한다(`mark-contract-in-listings` 머리글).
 *   그래서 이 훑기가 시트의 「출고가능」을 그대로 반영하는 것이 맞다.
 *   ⚠ 다만 회차에서 **이 훑기를 «먼저», 정산원장 잠금을 «나중에»** 돌린다 — 잠금이 늘 이기게.
 *
 * ⚠ **손오공·아이언은 시트가 원천이 아니다**(API 덤프 · 홈페이지).
 *   ★**손오공은 그래도 챙긴다** — 실측 2026-09-08 로 **세운 차의 42%(308/727)**다. 이 한 곳을 빼면
 *     「30분마다 상태를 챙긴다」가 절반짜리 말이 된다(빼고 재니 훑기가 402대만 챙겼다).
 *     덤프 당기기는 캐시를 써서 거의 공짜라, **회차가 먼저 당기고 여기서는 읽기만** 한다(두드림 0).
 *   ○ 아이언 17대(2.4%)만 2시간 회차 몫으로 남긴다. 홈페이지를 긁는데 **차 한 대마다 상세 한 번**이라
 *     30분마다면 남의 사이트를 한 달에 3만 번 두드린다 — 열일곱 대 때문에 할 일이 아니다.
 *   건너뛴 곳은 «건너뛰었다»고 찍는다 — 「안 했다」와 「했는데 0건」은 다르다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/sweep-status.mts [--apply]
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { listSheetTabs, readSheetGrid } from '../lib/server/google-sheets';
import { HUB_CODE_SHEET_ID } from '../lib/domain/legacy-sheets';
import { hubSourceMap } from '../lib/domain/supplier-source';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { isOpenInventoryAtom } from '../lib/domain/inventory-contract';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore(app);
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});

/** 시트가 원천이 아닌 곳 — 2시간 회차가 맡는다. */
const 시트아님 = new Set(['RP012', ...MIRROR_SOURCES.filter((m) => m.kind === 'iron').map((m) => m.code)]);
/** 정제시트로 오는 곳은 «원본»을 본다 — 우리가 만든 사본이 아니라 공급사가 적는 곳. */
const 원본주소 = new Map(MIRROR_SOURCES.filter((m) => m.kind === 'sheet' && m.from).map((m) => [m.code, m.from!]));

const t0 = Date.now();
let 두드림 = 0;
const hubGrid = await readSheetGrid(HUB_CODE_SHEET_ID, (await listSheetTabs(HUB_CODE_SHEET_ID))[0]); 두드림 += 2;
const hub = hubSourceMap([hubGrid.header, ...hubGrid.rows]);
for (const [code, from] of 원본주소) hub.set(code, from);   // 정제 4곳은 원본으로 바꿔 본다

/** 차번 → 시트가 말하는 상태. 여러 공급사에 같은 차번이 있으면 «먼저 읽은 곳»을 쓴다(문패 차례). */
const 시트상태 = new Map<string, { raw: string; canon: string; code: string }>();
const 건너뜀: string[] = [];
const 못읽음: { code: string; id: string; why: string }[] = [];
const tok = (await jwt.getAccessToken()).token;
/**
 * 한 곳을 읽는다. 몸은 바뀌지 않고 «다시 부를 수 있게» 떼 둔 것뿐이다 — 한도는 잠깐 밀린 것이라 다시 묻는다.
 */
async function 읽기(code: string, id: string): Promise<string | null> {
  try {
    /**
     * ★★**두드림 «두 번» — ① 탭 이름만 ② 재고 탭들의 앞 16열.**
     *
     * ⚠⚠ 실측 2026-09-08 — 처음엔 한 번에 끝내려고 `ranges=A1:P1000` 을 탭 이름 «없이» 보냈다.
     *   구글은 이름 없는 범위를 **첫 탭**으로 읽는다. 그래서 오토플러스는 「공지사항」 탭만 읽혀
     *   **재고 77대가 통째로 안 보였고**, 아이카는 「장기특별이벤트」 한 탭만 읽혀 29대가 빠졌다.
     *   그런데도 훑기는 ✓ 로 끝났다 — 「돌았다」와 「다 봤다」가 갈리는 바로 그 자리다.
     *   ⇒ 커버리지(세운 차 대비 %)를 찍게 하니 **68%**로 드러났다. 숫자를 안 찍었으면 몰랐다.
     *
     * ★그래서 이름부터 묻는다. 곳당 두 번이라도 23곳이면 46번 — 한도에 견줘 여전히 싸다.
     */
    const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${tok}` } });
    두드림++;
    const mj = await meta.json() as { sheets?: { properties?: { title?: string } }[]; error?: { message?: string } };
    if (!meta.ok) return S(mj.error?.message).slice(0, 60) || `HTTP ${meta.status}`;
    /** 재고가 아닌 탭은 아예 «묻지도» 않는다 — 공지·프로모션 탭이 재고로 들어온 사고가 있었다. */
    const 탭 = (mj.sheets || []).map((x) => S(x.properties?.title)).filter((t) => t && !isOurNonInventoryTab(t));
    if (!탭.length) return null;
    const q = 탭.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'!A1:P1000`)}`).join('&');
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets(properties(title),data(rowData(values(formattedValue))))&${q}`,
      { headers: { Authorization: `Bearer ${tok}` } });
    두드림++;
    const j = await r.json() as { sheets?: { properties?: { title?: string }; data?: { rowData?: { values?: { formattedValue?: string }[] }[] }[] }[]; error?: { message?: string } };
    if (!r.ok) return S(j.error?.message).slice(0, 60) || `HTTP ${r.status}`;
    for (const sh of j.sheets || []) {
      const title = S(sh.properties?.title);
      if (isOurNonInventoryTab(title)) continue;
      const rows = (sh.data?.[0]?.rowData || []).map((row) => (row.values || []).map((c) => S(c.formattedValue)));
      if (!rows.length) continue;
      /**
       * 머리글은 «이름으로» 찾는다 — 자리로 찾으면 시트마다 밀린다.
       * ⚠ 실측 2026-09-08 — 여덟 줄만 뒤졌더니 **오토플러스를 «한 줄 차이»로 놓쳤다**(머리글이 9번째 줄).
       *   공지·안내가 위에 여러 줄 깔린 시트가 흔하다. 열다섯 줄까지 본다 —
       *   차번·상태 «둘 다» 있는 줄만 머리글로 치므로 깊이 봐도 헛짚지 않는다.
       */
      let hi = -1, ci = -1, si = -1;
      for (let k = 0; k < Math.min(15, rows.length); k++) {
        const h = rows[k].map(N);
        const c = h.findIndex((x) => /^(차량번호|차번)$/.test(x));
        const s = h.findIndex((x) => /^(상태|배차상태|차량상태|판매상태|재고상태|출고상태)$/.test(x));
        if (c >= 0 && s >= 0) { hi = k; ci = c; si = s; break; }
      }
      if (hi < 0) continue;
      for (const row of rows.slice(hi + 1)) {
        const plate = N(row[ci]); if (!plate) continue;
        const raw = S(row[si]);
        if (!raw) continue;                       // ★빈 상태는 «모른다» — 아는 값을 덮지 않는다
        if (시트상태.has(plate)) continue;
        시트상태.set(plate, { raw, canon: canonSheetVehicleStatus(raw), code });
      }
    }
    return null;
  } catch (e) { return (e as Error).message.slice(0, 60); }
}

for (const [code, id] of hub) {
  if (시트아님.has(code)) { 건너뜀.push(code); continue; }
  const why = await 읽기(code, id);
  if (why) 못읽음.push({ code, id, why });
}
/**
 * ★★**한도(429)로 못 읽은 곳은 «한 번 더» 묻는다.**
 *
 * ⚠ 실측 2026-09-08 — 회차가 다시 돌면서 이 훑기가 429 를 맞았고, 그 번에 낸
 *   「시트가 말한 차」가 669 → **565** 로 줄었다. 그런데도 회차는 ✓ 로 끝났다 —
 *   **반쪽만 보고도 «다 봤다»고 말하는** 꼴이다. 그게 제일 나쁘다.
 * ⇒ 한도로 못 읽은 곳만 모아 25초 쉬었다 다시. 그래도 안 되면 «못 읽었다»고 적는다.
 */
{
  const 한도 = 못읽음.filter((x) => /RESOURCE_EXHAUSTED|Quota exceeded|429/.test(x.why));
  if (한도.length) {
    console.log(`  ⏳ 한도로 못 읽은 곳 ${한도.length} — 25초 쉬었다 한 번 더`);
    await new Promise((r) => setTimeout(r, 25000));
    for (const x of 한도) {
      const why = await 읽기(x.code, x.id);
      if (!why) 못읽음.splice(못읽음.indexOf(x), 1);
      else x.why = why;
    }
  }
}

/**
 * ★★**손오공은 «덤프»에서 상태를 읽는다 — 시트가 원천이 아니다.**
 *
 * ⚠⚠ 실측 2026-09-08 — 손오공이 **세운 차의 42%**(308/727)다. 이 한 곳을 빼면
 *   「30분마다 상태를 챙긴다」가 절반짜리 말이 된다(훑기가 402대만 챙겼다).
 *   ★다행히 덤프 당기기(`sonokong/scripts/손오공.mjs`)는 캐시를 재사용해 **거의 공짜**다.
 *   ⇒ 30분 회차가 그걸 먼저 돌리고, 여기서는 **떠 있는 덤프를 읽기만** 한다(두드림 0).
 *
 * 상태 판정은 수집기(`ingest-supplier-to-firestore` 손오공 리더)와 «같은 규칙»이다 —
 * 갈리면 30분 훑기와 2시간 수집이 서로 다른 상태를 써서 값이 진동한다.
 */
{
  try {
    const dump = JSON.parse(readFileSync('sonokong/lib/wonja/손오공차량.json', 'utf8')) as { 갱신?: string; 차량?: Record<string, unknown>[] };
    let n = 0;
    for (const c of dump.차량 || []) {
      const plate = N(c.차번); if (!plate) continue;
      const raw = c.계약중 ? '계약중' : (S(c.계약가능) === 'Y' ? '출고가능' : '출고협의');
      if (시트상태.has(plate)) continue;
      시트상태.set(plate, { raw, canon: canonSheetVehicleStatus(raw), code: 'RP012' });
      n++;
    }
    const 나이 = dump.갱신 ? Math.round((Date.now() - new Date(`${dump.갱신}+09:00`).getTime()) / 60000) : -1;
    console.log(`  ○ 손오공 덤프에서 ${n}대 (갱신 ${나이 >= 0 ? `${나이}분 전` : '모름'}) — 두드림 0`);
    /** ⚠ 덤프가 묵으면 «옛 상태»를 새 것처럼 쓴다. 회차가 먼저 당기는지 확인하라는 뜻으로 알린다. */
    if (나이 > 90) 못읽음.push({ code: 'RP012', id: '', why: `덤프가 ${나이}분 묵었다 — 회차가 손오공 pull 을 먼저 돌리는지 보라` });
    const i = 건너뜀.indexOf('RP012'); if (i >= 0) 건너뜀.splice(i, 1);
  } catch (e) { 못읽음.push({ code: 'RP012', id: '', why: `덤프: ${(e as Error).message.slice(0, 50)}` }); }
}

// ── 원자와 견준다 ────────────────────────────────────────────
const AVAIL = new Set(['즉시출고', '출고가능']);
const derive = (st: string) => {
  let kind = '불가';
  if (AVAIL.has(st)) kind = '가용';
  else if (st === '출고협의') kind = '협의';
  else if (st === '상품화중' || st === '차량검수') kind = '준비';
  else if (st === '계약중') kind = '선점';
  return { vehicle_status: st, status: st, status_kind: kind, listable: isOpenInventoryAtom({ vehicle_status: st }) };
};
const docs = (await fs.collection('products').get()).docs;
/** ★**세운 차** = 목록에 서는 차. 커버리지는 이 수를 분모로 잰다 — 창고에 처박힌 차까지 세면 늘 낮게 나온다. */
const 세운차 = docs.filter((d) => isOpenInventoryAtom(d.data())).length;
let 챙김 = 0, 못본차 = 0, 원천에없음 = 0;
const 없는곳 = new Map<string, number>();
const 바뀜: { ref: FirebaseFirestore.DocumentReference; car: string; from: string; to: string }[] = [];
/** 말의 «세기» — 정산원장과 «같은 자」로 잰다(`mark-contract-in-listings` 센말). 갈리면 서로 덮는다. */
const 센말 = (v: string) => (v === '출고불가' ? 2 : v === '계약중' ? 1 : 0);
let 같음 = 0, 시트에없음 = 0;
const 다툼: string[] = [];
for (const d of docs) {
  const v = d.data() as Record<string, unknown>;
  const hit = 시트상태.get(N(v.car_number));
  if (!hit) {
    시트에없음++;
    /**
     * ★★**«못 봤다»와 «원천에 없다»를 가른다.**
     *   ⚠ 둘을 뭉뚱그리면 커버리지가 89% 로 나와 «반쪽 회차»처럼 보이는데, 실제로는
     *   훑기가 원천이 말해 준 차를 **전부** 챙긴 것이고 나머지는 원천에서 «사라진» 차다.
     *   전자는 훑기를 고칠 일이고, 후자는 **내릴** 일이다(2시간 회차 `--retire`) — 손이 다르다.
     */
    if (isOpenInventoryAtom(v)) {
      const c = S(v.provider_company_code);
      if (건너뜀.includes(c) || 못읽음.some((x) => x.code === c)) 못본차++;
      else { 원천에없음++; 없는곳.set(c, (없는곳.get(c) || 0) + 1); }
    }
    continue;
  }
  if (isOpenInventoryAtom(v)) 챙김++;
  const now = S(v.vehicle_status) || S(v.status);
  if (now === hit.canon) { 같음++; continue; }
  /**
   * ★★**정산원장이 세운 상태를 이 훑기가 «약하게» 되돌리지 않는다.**
   *
   * ⚠ 우리 계약이 「출고불가」로 세운 차를 시트가 「출고가능」이라 하면, 이 훑기가 30분마다 올리고
   *   같은 회차 뒤쪽의 정산원장이 도로 내린다 — **같은 차가 회차마다 두 번씩 뒤집힌다.**
   *   대수가 흔들리고(「1초 만에 582→694」와 같은 병), 바뀐 차 줄이 영원히 차서 **진짜 변화를 가린다.**
   *   더 나쁜 것은 그 사이 목록에 **판 차가 다시 서는** 것이다.
   *
   * ★**칸이 아니라 «주인»으로 가른다.** 원자에 「정산원장」 도장이 있으면 그 차의 상태는 원장 몫,
   *   없으면 공급사 시트 몫. 한 칸에 주인이 둘이면 어느 쪽도 못 믿는다.
   * ★**세게 가는 것은 막지 않는다** — 원장이 「계약중」인데 시트가 「출고불가」면 시트 말이 더 세다(내린다).
   *   막는 것은 «푸는» 방향뿐이다. 푸는 것은 사람이 봐야 할 일이라 조용히 넘기지 않고 «다툼»으로 찍는다.
   *
   * ⚠ 실측 2026-09-08 — 지금 계약중 34대는 전부 `status_reason='공급사표기'`(시트가 한 말)라
   *   이 빗장에 걸리는 차가 «0» 이다. 그래서 이번 16대 반영은 다툼이 아니라 **진짜 변화**다.
   */
  if (S(v.status_reason) === '정산원장' && 센말(hit.canon) < 센말(now)) { 다툼.push(`${S(v.car_number)} 원장 ${now} ↔ 시트 ${hit.canon}`); continue; }
  바뀜.push({ ref: d.ref, car: S(v.car_number), from: now || '(없음)', to: hit.canon });
}

console.log(`\n■ 차량상태 한 바퀴 — 공급사 ${hub.size - 건너뜀.length}곳 · 두드림 ${두드림}번 · ${Math.round((Date.now() - t0) / 1000)}초`);
console.log(`  시트가 말한 차 ${시트상태.size} · 그대로 ${같음} · **바뀐 차 ${바뀜.length}** · 시트에 없는 원자 ${시트에없음}`);
/**
 * ★★**«몇 대를 챙겼나»를 매 회차 찍는다 — 「돌았다」와 「다 봤다」는 다르다.**
 *   ⚠ 한 곳이라도 못 읽으면 그 공급사 차는 통째로 옛 상태로 남는데, 회차 기록엔 ✓ 만 남는다.
 *   ⇒ 세운 차 대비 몇 %를 실제로 확인했는지 숫자로 남긴다. 9할 밑이면 «반쪽 회차»로 본다.
 */
const 몫 = 세운차 ? Math.round((챙김 / 세운차) * 100) : 0;
console.log(`  ${못본차 ? '▲' : '✓'} 상태를 확인한 차 ${챙김} / 세운 차 ${세운차} = ${몫}%`);
if (못본차) console.log(`     ▲ 못 본 차 ${못본차} — 건너뛰거나 못 읽은 공급사 몫이다. 이게 «반쪽 회차»다`);
if (원천에없음) console.log(`     ○ 원천에 없는 차 ${원천에없음} — 못 본 게 아니라 «사라진» 차다(내릴 후보 · 2시간 회차 몫)  ${[...없는곳].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ')}`);
if (다툼.length) { console.log(`  ▲ 원장이 세운 것을 시트가 되돌리려 한다 ${다툼.length}대 — 안 썼다(사람이 본다)`); for (const x of 다툼.slice(0, 8)) console.log(`     ${x}`); }
if (건너뜀.length) console.log(`  ○ 건너뜀(시트가 원천이 아님 — 2시간 회차 몫) ${건너뜀.join(' · ')}`);
if (못읽음.length) { console.log(`  ▲ 못 읽은 곳 ${못읽음.length}`); for (const x of 못읽음.slice(0, 6)) console.log(`     ${x.code}: ${x.why}`); }
for (const x of 바뀜.slice(0, 15)) console.log(`     ${x.car.padEnd(11)} ${x.from} → ${x.to}`);
if (바뀜.length > 15) console.log(`     … 그 밖 ${바뀜.length - 15}대`);

/**
 * ★**한 바퀴에 너무 많이 바뀌면 멈춘다** — 시트를 잘못 읽었을 때 재고가 통째로 뒤집힌다.
 *   30분에 상태가 «세운 차의 3할»이 바뀌는 일은 정상이 아니다.
 */
if (바뀜.length > Math.max(50, 세운차 * 0.3)) {
  console.error(`\n⛔ 한 바퀴에 ${바뀜.length}대가 바뀐다 — 세운 차 ${세운차}의 3할이 넘는다. 시트를 잘못 읽었는지 먼저 보라.\n`);
  process.exit(1);
}
if (!APPLY) { console.log(`\n미리보기 — 쓰려면 --apply\n`); process.exit(0); }
if (!바뀜.length) { console.log(`\n✓ 바뀐 상태 없음\n`); process.exit(0); }
let n = 0;
for (let i = 0; i < 바뀜.length; i += 400) {
  const batch = fs.batch();
  for (const x of 바뀜.slice(i, i + 400)) { batch.set(x.ref, { ...derive(x.to), status_reason: '공급사시트', _status_swept_at: Date.now() }, { merge: true }); n++; }
  await batch.commit();
}
console.log(`\n✓ ${n}대 상태 갱신\n`);
process.exit(0);
