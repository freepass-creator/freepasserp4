/**
 * 규칙에 **비활성·삭제·반려 계정 차단**을 기계적으로 주입한다.
 *
 * 지금 서버 규칙은 `status !== 'pending'` 만 본다. 그래서 관리자가 회원을 비활성으로 바꿔도
 * 서버는 계속 통과시킨다 — 앱 게이트(isBlocked)만 막고 있어 API 를 직접 때리면 그대로 뚫린다(QA AUTH-6).
 *
 * 손으로 32곳을 고치면 반드시 빠뜨린다. 조건 문자열이 있는 자리마다 정확히 한 번씩 덧붙인다.
 *
 * is_active 실측 분포: (필드없음) 157 · true 4 · '예' 4 · false 2.
 * 회원관리 UI 는 '예'/'아니오' 문자열로 쓰고, 정리 스크립트는 boolean false 로 썼다 → **둘 다** 막는다.
 * 필드가 없는 157명은 통과해야 한다(기존 회원을 잠그면 안 된다) → 블랙리스트 방식.
 *
 * 실행:
 *   npx tsx scripts/rules-add-inactive-gate.mts <입력.json> <출력.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const IN = process.argv[2];
const OUT = process.argv[3];
if (!IN || !OUT) {
  console.error('사용법: npx tsx scripts/rules-add-inactive-gate.mts <입력.json> <출력.json>');
  process.exit(1);
}

const U = "root.child('users').child(auth.uid)";
const PENDING = `${U}.child('status').val() !== 'pending'`;
const GATE = [
  `${U}.child('is_active').val() !== '아니오'`,
  `${U}.child('is_active').val() !== false`,
  `${U}.child('status').val() !== 'deleted'`,
  `${U}.child('status').val() !== 'rejected'`,
].join(' && ');

const src = readFileSync(IN, 'utf8');
// 주석이 섞여 있을 수 있다(콘솔에서 받은 원본). JSON.parse 전에 걷어낸다.
const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const root = JSON.parse(clean) as { rules: Record<string, unknown> };

let touched = 0; let already = 0;
const hits: string[] = [];

function walk(node: unknown, path: string): void {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if ((k === '.read' || k === '.write') && typeof v === 'string') {
      if (!v.includes(PENDING)) continue;
      if (v.includes("child('is_active')")) { already += 1; continue; }
      // pending 조건 **바로 뒤**에 덧붙인다 — 문자열 어디에 넣어도 논리는 같지만,
      //  같은 자리에 모아 두어야 나중에 사람이 읽고 검증할 수 있다.
      (node as Record<string, unknown>)[k] = v.replace(PENDING, `${PENDING} && ${GATE}`);
      touched += 1;
      hits.push(`${path}/${k}`);
    } else if (v && typeof v === 'object') {
      walk(v, `${path}/${k}`);
    }
  }
}

walk(root.rules, '');

// 안전장치 — users 노드의 .read 는 절대 건드리지 않았는지 확인.
//  RTDB 는 자식 .read 가 부모 읽기를 만들지 못해, 여길 좁히면 관리자 회원목록이 통째로 빈다(에뮬레이터 실증).
const usersRead = (root.rules as any)?.users?.['.read'];
if (typeof usersRead === 'string' && usersRead.includes("child('is_active')")) {
  console.error('⛔ users/.read 가 변경됐다 — 관리자 회원목록이 빈다. 중단.');
  process.exit(2);
}

writeFileSync(OUT, JSON.stringify(root, null, 2), 'utf8');
console.log(`주입 ${touched}곳 · 이미 있음 ${already}곳 → ${OUT}`);
for (const h of hits) console.log('  ', h);
console.log(`\n크기: ${src.length} → ${readFileSync(OUT, 'utf8').length} 바이트`);
