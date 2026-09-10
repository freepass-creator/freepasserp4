/**
 * **회차가 «원자»를 RTDB 에 쓰지 않는다.** 어기면 exit 1.
 *
 * > 사장님 2026-09-10 「너한테 지금 계속 얘기를 하는데도 **RTDB 를 왜 못 지우는지** … 답답해 죽겠다」
 *
 * ⚠⚠ **첫 판이 «0» 이라고 거짓말했다 — 검사가 한 가지 꼴만 봤다.**
 *   `.ref(...).update(` 만 찾았는데, ERP 비추기 셋은 **REST 로** 쓴다:
 * ```
 *   fetch(`${DB}/v4/products/${key}.json?access_token=…`, { method: 'PATCH', … })
 * ```
 *   그래서 「쓰는 곳 0」이 찍혔는데 실제로는 셋이 쓰고 있었다. **거짓으로 안심시키는 검사가
 *   아예 없는 검사보다 나쁘다** — 사진링크 검사가 거짓으로 울어 진짜 사고를 덮었던 것의 반대 짝이다.
 *   ⇒ SDK 꼴과 REST 꼴을 «둘 다» 본다.
 *
 * ★★**두 가지 쓰기를 가른다 — 같은 RTDB 라도 뜻이 다르다.**
 * ```
 *   ㉠ 원자(products) 를 RTDB 에 쓴다        ⛔ 금지. 원자 SSOT 는 Firestore 다.
 *   ㉡ ERP 저장소(= 아직 RTDB)에 쓴다        ○ 지금은 허용. 앱 이관 전엔 옮길 수 없다.
 * ```
 *   ㉡ 을 지금 Firestore 로 바꾸면 **ERP 가 그 값을 못 읽어** 기능이 죽는다.
 *   그래서 «없는 척»하지 않고 **명단에 적어 눈에 보이게** 둔다. 앱 저장소가 옮겨가면 이 명단이 비고,
 *   그때 이 검사를 「RTDB 쓰기 0」으로 조인다.
 *
 *   npm run check:cycle-no-rtdb-write
 */
import { readFileSync, existsSync } from 'node:fs';

const S = (v: unknown) => String(v ?? '').trim();

/** 회차 = 이 둘이 부르는 것 전부. 새 회차가 생기면 여기 더한다. */
const 회차 = ['scripts/hourly-sync.mts', 'scripts/refresh-sync.mts'];

/**
 * ★**앱(ERP) 저장소가 RTDB 라서 남는 것** — 옮기면 기능이 죽는다. 앱 이관과 «같이» 없앤다.
 *   ⚠ 여기 한 줄을 더할 때는 **왜 Firestore 로 못 가는지**를 적는다. 못 적으면 그건 그냥 빚이다.
 */
const 앱몫: Record<string, string> = {
  'scripts/mirror-sales-absent.mts': '⑦′ 시트에 없는 차를 ERP 에서 출고불가로 — 쓰는 대상이 ERP 저장소다',
  'scripts/mirror-sales-photos.mts': '⑦′ 사진을 ERP 에 비춘다 — 쓰는 대상이 ERP 저장소다',
  'scripts/mirror-sales-vehicle-name.mts': '⑦′ 이름을 ERP 에 비춘다 — 쓰는 대상이 ERP 저장소다',
};

const 부르는것 = new Set<string>();
for (const f of 회차) {
  if (!existsSync(f)) { console.error(`  ✗ ${f} 가 없다 — 명단을 고쳐라`); process.exit(1); }
  for (const m of readFileSync(f, 'utf8').matchAll(/scripts\/[a-zA-Z0-9._-]+\.mts/g)) 부르는것.add(m[0]);
}

/** RTDB 에 «쓰는» 꼴 — SDK 와 REST 둘 다. 읽기(`.get()`·`.json` GET)는 안 잡는다. */
const SDK쓰기 = /\.ref\([^)]*\)\s*\.\s*(update|set|remove|push|transaction)\s*\(/;
const REST주소 = /v4\/(products|partners|policies)[^`'"]*\.json/;
const REST쓰기 = /method:\s*['"`](PATCH|PUT|POST|DELETE)['"`]/i;

const 주석뺀다 = (raw: string): string =>
  raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
     .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

const 어긋남: string[] = [];
const 허용됨: string[] = [];
let 읽기만 = 0;
for (const f of [...부르는것].sort()) {
  if (!existsSync(f)) continue;
  const src = 주석뺀다(readFileSync(f, 'utf8'));
  const lines = src.split('\n');
  const 쓴줄: string[] = [];
  lines.forEach((line, i) => {
    if (SDK쓰기.test(line)) { 쓴줄.push(`${i + 1}: ${S(line).slice(0, 100)}`); return; }
    /** REST 는 주소와 method 가 다른 줄에 있다 — 앞뒤 여섯 줄을 한 덩이로 본다. */
    if (REST주소.test(line)) {
      const 덩이 = lines.slice(i, i + 6).join('\n');
      if (REST쓰기.test(덩이)) 쓴줄.push(`${i + 1}: ${S(line).slice(0, 90)} … ${S((덩이.match(REST쓰기) || [''])[0])}`);
    }
  });
  if (!쓴줄.length) { if (/getDatabase|v4\/(products|partners|policies)/.test(src)) 읽기만++; continue; }
  if (앱몫[f]) 허용됨.push(`${f} — ${앱몫[f]} (${쓴줄.length}곳)`);
  else for (const l of 쓴줄) 어긋남.push(`${f}:${l}`);
}

console.log(`\n■ 회차가 «원자»를 RTDB 에 쓰는가 — 부르는 스크립트 ${부르는것.size}개`);
console.log(`  읽기만 하는 곳 ${읽기만} (대조·다리 — 값을 틀리게 만들지 않는다)`);
if (허용됨.length) {
  console.log(`  ○ 앱(ERP) 저장소 몫이라 «아직» 남는 RTDB 쓰기 ${허용됨.length}곳 — 앱 이관과 같이 없앤다`);
  for (const x of 허용됨) console.log(`     ${x}`);
}
if (!어긋남.length) {
  console.log(`  ✓ 원자를 RTDB 에 쓰는 곳 0\n`);
  process.exit(0);
}
console.error(`  ⛔ 원자를 RTDB 에 쓰는 곳 ${어긋남.length}`);
for (const x of 어긋남) console.error(`    ${x}`);
console.error('\n  고치는 법 — 원자는 Firestore `products` 다. 그 문서에 바로 써라.');
console.error('  ERP 저장소에 써야 하는 것이라면 위 «앱몫» 명단에 «왜»와 함께 적어라.');
console.error('  규칙 정본 = docs/원자-내려보내기-로직.md\n');
process.exit(1);
