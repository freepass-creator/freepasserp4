/**
 * **차종마스터에 채울 것 — 손오공** (읽기 전용, 시트 안 읽음)
 *
 * ★사장님 2026-09-01 커밋(`2c0f4c10`) — 「정제칸·상품리스트·ERP 가 새 이름을 만들면 안 된다.
 *   차종마스터의 한 행을 그대로 복사하는 길이어야 한다. **마스터를 고치기 전에는 비어 있는 것이 맞다**」.
 *   그래서 마스터에 없는 트림은 «비운다» — 이건 고장이 아니라 **마스터에 채울 게 있다는 신호**다.
 *   (2026-09-01 커버리지 217/217 → 141/215 로 내려간 것이 그 신호였다. 나는 처음에 이걸
 *    「망가졌다」로 읽고 되돌리자고 했다 — 오독이었다.)
 *
 *   이 자는 그 «채울 것»을 마스터에 붙여넣기 좋게 정리한다.
 *
 *   npx tsx scripts/report-master-todo-sonokong.mts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const REFINE = 'sonokong/tmp/손오공정제.json';

if (!existsSync(REFINE)) {
  console.error(`✗ ${REFINE} 이 없습니다 — 손오공 정제를 한 번 돌린 뒤에 부르세요.`);
  process.exit(1);
}
const refined = JSON.parse(readFileSync(REFINE, 'utf8')) as {
  결과: Array<Record<string, string>>;
  미스: { 모델없음: string[]; 트림연식없음: string[] };
};

/** 「140하9992 현대 팰리세이드 [트림 GL · 2021-05-18]」 를 조각낸다. */
const LINE = /^(\S+)\s+(\S+)\s+(.+?)\s+\[트림\s+(.*?)\s+·\s+(\S+)\]$/;
type Todo = { 차번: string; 제조사: string; 모델: string; 트림: string; 최초등록: string };
const todos: Todo[] = [];
for (const raw of refined.미스?.트림연식없음 ?? []) {
  const m = LINE.exec(String(raw).trim());
  if (!m) continue;
  todos.push({ 차번: m[1], 제조사: m[2], 모델: m[3], 트림: m[4], 최초등록: m[5] });
}

/**
 * ★★분류를 지웠다 — **내가 엉뚱한 마스터를 보고 있었다.**
 *
 *   정제 엔진(`sonokong/lib/vehicle-refine.mjs` 머리)이 말한다:
 *     「정본 마스터 = **라이브 「차종마스터」시트(1T_RrE)**. 시트에 있는 행의 모델·세부모델·세부트림만
 *      복사한다. F03 작업시트로 이름을 지어내지 않는다.」
 *
 *   나는 `public/data/vehicle-master.json`(로컬 사본)과 견줘 「①모델 있음 / ②없음」을 갈랐다.
 *   그 결과 «셀토스 프레스티지»·«아반떼 모던»처럼 **로컬 JSON 에는 있는데 라이브 시트에는 없는** 것이
 *   「이미 있으니 트림만 보태면 됨」으로 찍혔다. 그대로 채웠으면 헛일이었다.
 *   (앞서 같은 파일에서 `rows` vs `entries` 로 한 번 틀렸는데, 이번엔 «어느 마스터냐»로 또 틀렸다.)
 *
 *   ★분류하려면 **라이브 시트를 읽어야 한다.** 그건 구글 API 를 쓰므로 «자동회차 사이»에 해야 한다
 *   (회차 중에 읽으면 할당량을 다퉈 회차가 밀린다 — 2026-08-30 실측).
 *   그때까지는 «무엇이 안 붙었나»만 있는 그대로 보여 준다. 없는 근거로 가르지 않는다.
 */

/** 같은 «모델+트림»을 한 줄로 묶는다 — 마스터는 차 한 대가 아니라 «차종»을 담는 표다. */
const groups = new Map<string, { 제조사: string; 모델: string; 트림: string; 대수: number; 연식: Set<string>; 차번: string[] }>();
for (const t of todos) {
  const key = `${t.제조사}|${t.모델}|${t.트림}`;
  if (!groups.has(key)) groups.set(key, { 제조사: t.제조사, 모델: t.모델, 트림: t.트림, 대수: 0, 연식: new Set(), 차번: [] });
  const g = groups.get(key)!;
  g.대수 += 1;
  g.연식.add(t.최초등록.slice(0, 4));
  if (g.차번.length < 4) g.차번.push(t.차번);
}
const all = [...groups.values()].sort((a, b) => b.대수 - a.대수);

const pad = (v: unknown, n: number) => String(v).padEnd(n);
const line = (g: typeof all[number]) =>
  `   ${pad(g.제조사, 5)} ${pad(g.모델, 14)} ${pad(g.트림, 14)} ${String(g.대수).padStart(3)}대  연식 ${[...g.연식].sort().join(',')}   ${g.차번.join(' ')}`;

console.log(`■ 차종마스터에 채울 것 — 손오공 ${todos.length}대 · ${all.length}가지 «모델+트림»`);
console.log('   (정제된 차 ' + refined.결과.length + '대는 정상. 아래는 마스터에 행이 없어 트림을 비운 것들이다)');

console.log('\n■ 라이브 「차종마스터」에 없어서 트림이 빈 조합');
console.log('   (있는 그대로다. 「행을 새로 만들지 · 트림만 보탤지」는 라이브 시트를 봐야 갈린다 —');
console.log('    로컬 vehicle-master.json 으로 가르면 «틀린다». 그건 사본이지 정본이 아니다)');
console.log(`   ${pad('제조사', 5)} ${pad('모델', 16)} ${pad('트림', 16)} 대수  연식        보기(차번)`);
for (const g of all) console.log(line(g));
if (refined.미스?.모델없음?.length) {
  console.log(`\n■ ③ 모델 자체를 못 찾은 차 ${refined.미스.모델없음.length}대`);
  for (const x of refined.미스.모델없음.slice(0, 10)) console.log(`   ${x}`);
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/master-todo-sonokong.json', JSON.stringify({ at: new Date().toISOString(), 총: todos.length, 묶음: all, todos }, null, 1));
console.log('\n기록 tmp/master-todo-sonokong.json · 여기서 고치지 않는다 — 채울 것을 보여만 준다');
