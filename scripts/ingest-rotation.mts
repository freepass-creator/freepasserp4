/**
 * **원천 → 원자 직접수집을 «돌아가며» 자동으로 돌린다.** 기본 미리보기 · 반영은 `--apply`.
 *
 * ⚠⚠ 2026-09-08 — 직접수집(`ingest-supplier-to-firestore`)이 **매시간 회차에 아예 없었다.**
 *   사람이 손으로 돌릴 때만 원자가 갱신됐다. 그래서
 *   · 웰릭스가 **폐기된 시트**를 24일 읽는 동안 아무도 몰랐고(K8이 「모닝」으로 실렸다),
 *   · 마음카 3대가 몇 주째 「요금 없는 차」로 서 있었다.
 *   원자가 낡으면 **그 아래가 전부 낡는다** — 상품리스트·하허호·ERP·손님 면이 한꺼번에.
 *
 * ★**왜 «돌아가며»인가** — 구글 시트 읽기는 «분당» 한도가 있다. 스무 곳을 한 회차에 다 읽으면
 *   429 로 죽고, 죽으면 **한 곳도 갱신이 안 된다**. 그래서 매 회차 **가장 오래된 몇 곳만** 읽는다.
 *   두 시간에 셋이면 스무 곳이 하루 안에 한 바퀴 돈다.
 * ★**하루 단은 `--all`** — 나눠 볼 까닭이 없다. 실측 20곳 한 바퀴에 한도는 «한 번도» 안 걸렸다.
 *
 * ★**실패는 알리되 멈추지 않는다.** 한 공급사가 못 읽힌다고 나머지를 굶기지 않는다.
 *   ⚠ 다만 **얼마나 묵었는지**는 반드시 찍는다 — 24일을 몰랐던 것은 「본 적이 없어서」다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/ingest-rotation.mts [--apply] [--n=3|--all]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
/**
 * ★★**`--all` 이면 «전 공급사»를 다 돈다** — 하루 한 번 도는 단(day)의 몫이다.
 *
 * > 사장님 2026-09-08 「**프리패스 일일은 전체를 다 봐주면 좋지 — 하루에 한 번 하는 건데**」
 *
 * ⚠ 실측 2026-09-08 — 하루 회차도 기본값 `--n=3` 으로 돌고 있었다. 하루에 한 번 도는데
 *   세 곳만 보니 스무 곳 한 바퀴가 **일주일**이었다. 「하루에 한 번 전부 최신화」가 아니었던 것이다.
 *   그래서 원천에서 사라진 차 59대가 계속 서 있었다(내림은 그 공급사를 «읽어야» 도는 일이다).
 * ★돌아가며는 «자주 도는 단»의 장치다. 하루 한 번이면 나눠 볼 까닭이 없다 — 다 본다.
 */
const ALL = process.argv.includes('--all');
const N = Number(process.argv.find((a) => a.startsWith('--n='))?.split('=')[1] || 3);
/** ★`--status-only` 를 그대로 넘긴다 — 30분 회차는 차량상태만 본다(사장님 2026-09-08). */
const STATUS_ONLY = process.argv.includes('--status-only');
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });

/**
 * ★수집 «대상»은 원자가 말해 준다 — 지금 우리 차가 있는 공급사.
 *   명단을 따로 두면 새 공급사가 들어와도 아무도 안 고쳐서 조용히 빠진다(실측으로 여러 번 겪었다).
 */
const docs = (await getFirestore().collection('products').get()).docs.map((d) => d.data() as any);
type Row = { code: string; name: string; n: number; last: number };
const by = new Map<string, Row>();
for (const v of docs) {
  const code = S(v.provider_company_code); if (!code) continue;
  const r = by.get(code) || { code, name: S(v.provider_name) || code, n: 0, last: 0 };
  r.n++; if (S(v.provider_name)) r.name = S(v.provider_name);
  r.last = Math.max(r.last, Number(v._direct_ingest_at) || 0, Number(v._var_polled_at) || 0);
  by.set(code, r);
}
/**
 * ★★**«본 때»는 회차가 스스로 적는다.**
 *   ⚠ 자동 회차는 이제 `--variable`(상태만)이라, **바뀐 게 없으면 원자에 아무 도장도 안 찍힌다.**
 *   원자의 `_direct_ingest_at` 만 보고 차례를 정하면 «봤는데 안 본 것»으로 세어져 같은 곳만 계속 고른다.
 *   ⇒ 회차가 「누구를 언제 봤나」를 따로 적는다. 원자 도장은 «처음 들인 때»의 뜻으로 남는다.
 */
const SEEN = 'tmp/수집-본때.json';
let 본때: Record<string, number> = {};
try { 본때 = JSON.parse(readFileSync(SEEN, 'utf8')) as Record<string, number>; } catch { /* 첫 회차 */ }
const 시간 = (t: number) => (t ? Math.round((Date.now() - t) / 36e5) : 9999);
for (const r of by.values()) r.last = Math.max(r.last, Number(본때[r.code]) || 0);
const all = [...by.values()].sort((a, b) => 시간(b.last) - 시간(a.last) || b.n - a.n);

console.log(`\n■ 원자 갱신 나이 — 공급사 ${all.length}곳`);
for (const r of all) {
  const h = 시간(r.last);
  const 표 = h >= 9999 ? '★한 번도 없음' : (h >= 48 ? `★${Math.round(h / 24)}일` : `${h}시간`);
  console.log(`  ${r.code.padEnd(8)} ${r.name.slice(0, 10).padEnd(11)} ${String(r.n).padStart(4)}대   ${표}`);
}
/** ⚠ 이틀 넘게 안 본 곳은 «낡은 것»이 아니라 «못 보고 있는 것»일 수 있다 — 웰릭스가 그랬다. */
const 묵음 = all.filter((r) => 시간(r.last) >= 48);
if (묵음.length) console.log(`\n  ▲ 이틀 넘게 원자를 못 채운 공급사 ${묵음.length}곳 — ${묵음.map((r) => `${r.name}(${시간(r.last) >= 9999 ? '없음' : `${Math.round(시간(r.last) / 24)}일`})`).join(' · ')}`);

const 이번차례 = ALL ? all : all.slice(0, Math.max(1, N));
console.log(`\n■ 이번 회차 ${이번차례.length}곳 — ${이번차례.map((r) => r.name).join(' · ')}`);
if (!APPLY) { console.log('\n미리보기 — 실제로 당기려면 --apply\n'); process.exit(0); }

const 성공: string[] = [], 실패: string[] = [];
for (const r of 이번차례) {
  /**
   * ★★**자동 회차는 «상태값만» 바꾼다** (`--variable`) — 사장님 2026-09-08
   *   「우리는 **상태값만 바꾸고** 없는 거 추가는 **등록하는 개념**으로 가는 거지」.
   *   원천에 새 차번이 뜨면 자동으로 들이지 않고 `tmp/등록대기.json` 에 적어만 둔다.
   *   들이는 것은 사람의 한 수다 — `scripts/register-car.mts`.
   *   ⚠ 자동으로 들이면 원천의 실수(시험 줄·남의 차·오타 차번)가 그대로 상품이 된다.
   *
   * ★**`--retire` 를 켠다 — 원천에서 빠진 차를 내린다.**
   *   ⚠ 실측 2026-09-08 — 손오공 원천(291대)에 «없는» 차 9대가 원자에선 「출고가능」으로 서 있었다.
   *   원천이 안 주는 차를 팔 수 있다고 두면 **판 차를 또 파는** 길이 열린다.
   *   ★안전판 둘이 이미 있다 — 계약중(락)은 안 내린다 · 수집분이 우리 것의 절반도 안 되면 아예 안 내린다
   *     (원천 읽기 실패 의심). 그 둘 덕에 「못 읽은 날 재고가 사라지는」 사고는 안 난다.
   */
  /**
   * ★★**오토플러스(RP023)는 «홈피»에서 당긴다 — 시트가 원천이 아니다.**
   *
   * > 사장님 2026-09-08 「**오플은 이제 홈피 연동이잖아**」 · 「너는 **원자만 당기는** 거야」
   *
   * ⚠⚠ 실측 2026-09-08 — 그런데 `ingest-reborncar-to-firestore` 가 **어느 회차에도 안 붙어 있었다.**
   *   그래서 회차는 여태 오플 «시트»를 읽으려다 매번 「요금이 한 대도」로 ✗ 를 냈다.
   *   시트의 기간 칸이 「12개월2만 · 12개월3만 …」처럼 주행거리 밴드로 두 벌이라 우리 파서가 못 읽는데,
   *   **홈피는 그 두 벌을 그대로 원자 키(`12_20000`·`12_30000`)로 준다.** 골라야 할 일이 아니라 당기면 될 일이었다.
   *
   * ★상태는 여전히 «시트»가 말한다 — 30분 훑기(`sweep-status`)가 오플 「판매상태」 칸을 읽는다.
   *   원천이 둘이라 헷갈리지 않게 나눠 둔다: **상태 = 시트 · 내용(제원·요금·옵션) = 홈피.**
   */
  const 홈피 = r.code === 'RP023';
  const 한번 = () => spawnSync('npx', 홈피
    ? ['tsx', '--require', './scripts/lib/server-only-shim.cjs', 'scripts/ingest-reborncar-to-firestore.mts', '--apply']
    : ['tsx', '--require', './scripts/lib/server-only-shim.cjs', 'scripts/ingest-supplier-to-firestore.mts', `--code=${r.code}`, '--apply', '--variable', '--retire', ...(STATUS_ONLY ? ['--status-only'] : [])], {
    encoding: 'utf8', shell: process.platform === 'win32', env: process.env,
  });
  let out = 한번();
  let txt = `${out.stdout || ''}${out.stderr || ''}`;
  /**
   * ★★**한도(429)면 쉬었다 «한 번 더» 묻는다 — 특히 전체(`--all`)를 돌 때.**
   *
   * ⚠ 실측 2026-09-08 — 스무 곳을 잇달아 읽으면 구글 «분당» 한도에 걸린다. 한 곳이 걸리면
   *   그 공급사는 **다음 바퀴까지 통째로 낡은 채**로 남는데, 하루 한 번 도는 단에서는
   *   그게 «하루»다. 「돌았는데 세 곳이 비었다」는 것을 사람이 알 길도 없다.
   * ★한도는 «고장»이 아니라 잠깐 밀린 것이다. 35초 쉬고 한 번만 더 — 그래도 안 되면 적어 둔다.
   * ★**503·500(서버가 잠깐 안 되는 것)도 같이 넣는다** — 한도보다 더 명백한 「잠깐 밀린 것」이다.
   *   실측 2026-09-08 전체 한 바퀴에서 경진렌트카·웰릭스가 이것 하나로 빠졌다(둘 다 멀쩡한 시트다).
   */
  if (/RESOURCE_EXHAUSTED|Quota exceeded|429|Sheets 50[03]|UNAVAILABLE/.test(txt) && !/반영 완료|변동 폴링 완료/.test(txt)) {
    console.log(`  ⏳ ${r.name} — 잠깐 밀린 것(한도·503), 35초 쉬고 한 번 더`);
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},35000)'], { stdio: 'ignore' });
    out = 한번(); txt = `${out.stdout || ''}${out.stderr || ''}`;
  }
  /** ★홈피 길은 끝말이 다르다 — 「■ --apply — 매칭 오플 N대」. 끝말을 안 맞추면 성공을 실패로 센다. */
  const done = /반영 완료|변동 폴링 완료|■ --apply —/.test(txt);
  const 내림 = Number((txt.match(/listable=false (\d+)건/) || [])[1] || 0);
  const 대기 = Number((txt.match(/원천에 «새 차» (\d+)대/) || [])[1] || 0);
  const 왜 = /요금이 한 대도/.test(txt) ? '요금 열을 못 읽음(두 줄 머리글 — 정제시트 길로 들어온다)'
    : /폐기된 시트/.test(txt) ? '원천이 폐기 주소 — 문패를 고쳐라'
    : /RESOURCE_EXHAUSTED|429/.test(txt) ? '구글 요청한도(다음 회차에 다시)'
    : /Sheets 50[03]|UNAVAILABLE/.test(txt) ? '구글이 잠깐 안 됨(503 — 다음 회차에 다시)'
    : /PERMISSION_DENIED|403/.test(txt) ? '권한 — 어느 신분으로 읽는지부터 보라'
    : (txt.match(/Error: ([^\n]{0,80})/)?.[1] || '까닭 모름');
  if (done) { 성공.push(`${r.name} ${(txt.match(/바뀐 (\d+) 씀|직접 원자 (\d+)건|매칭 오플 (\d+)대/) || []).slice(1).find(Boolean) || '0'}건${내림 ? ` · 내림 ${내림}` : ''}${대기 ? ` · 등록대기 ${대기}` : ''}`); console.log(`  ✔ ${r.name} — ${성공[성공.length - 1]}`); }
  else { 실패.push(`${r.name}: ${왜}`); console.log(`  ✗ ${r.name} — ${왜}`); }
}
/**
 * ★★**«본 때»를 적는다 — 성공·실패와 «무관하게».**
 *   ⚠ 2026-09-08(코덱스가 잡았다) — 읽기만 하고 «쓰기»가 없어서 파일이 안 생겼고, 차례가 안 넘어갔다.
 *   ★실패한 곳도 「봤다」로 적는다. 안 그러면 못 읽는 한 곳을 매 회차 붙잡고 나머지가 굶는다
 *     (실패한 까닭은 위에 찍혀 있고, 다음 바퀴에 다시 온다).
 */
mkdirSync('tmp', { recursive: true });
for (const r of 이번차례) 본때[r.code] = Date.now();
writeFileSync(SEEN, JSON.stringify(본때, null, 1), 'utf8');
console.log(`\n✓ 돌아가며 수집 — 성공 ${성공.length} · 실패 ${실패.length}`);
for (const x of 실패) console.log(`  ▲ ${x}`);
process.exit(0);
