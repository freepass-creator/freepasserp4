/**
 * 계약서 서식 두 사본이 갈렸는지 본다.
 *
 * ★왜 필요한가
 *   손님에게 실제로 나가는 서식은 **착한거래**가 렌더·봉인한다.
 *   이 리포의 `public/contract-template/` 은 그 «사본»으로, 여기 sim 이 읽는다.
 *
 *   2026-08-10 실제로 사고가 났다 — 한쪽에서는 계약서 문구를 다듬고
 *   다른 쪽에서는 약관 조문을 신설해, 같은 계약서가 두 벌로 갈렸다.
 *   sim 은 사본을 보고 통과했지만 손님에게 나가는 것은 다른 문서였다.
 *   **검사기가 초록불인데 실제로는 틀린 상태** — 가장 나쁜 종류다.
 *
 *   그래서 여기서 두 사본을 통째로 비교한다. 갈리면 실패다.
 *   고치는 방향은 언제나 착한거래 → 이 리포(사본)다.
 *
 * ★착한거래 리포가 없으면
 *   배포 환경·CI 에는 옆 리포가 없다. 그때는 «검사 못 함»이라고 말하고 넘어간다.
 *   조용히 통과시키면 위 사고를 다시 못 잡는다.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 착한거래 리포 위치 — 환경변수로 덮어쓸 수 있다. */
const PEER = process.env.CHAKHANDEAL_REPO || resolve(process.cwd(), '..', 'chakhandeal');
const HERE = resolve(process.cwd(), 'public', 'contract-template');
const THERE = join(PEER, 'public', 'contract-template');

/** 줄바꿈(CRLF/LF)만 다른 것은 갈린 것이 아니다. */
const norm = (s: string) => s.replace(/\r\n/g, '\n');

if (!existsSync(THERE)) {
  console.log(`⚠ 착한거래 서식을 찾지 못해 대조하지 못했습니다 — ${THERE}`);
  console.log('  (CHAKHANDEAL_REPO 로 경로를 지정하면 대조합니다)');
  process.exit(0);
}

const names = new Set([...readdirSync(HERE), ...readdirSync(THERE)].filter((f) => f.endsWith('.html')));
const drifted: string[] = [];

for (const name of [...names].sort()) {
  const a = join(HERE, name);
  const b = join(THERE, name);
  if (!existsSync(a)) { drifted.push(`${name} — 이 리포에 없음`); continue; }
  if (!existsSync(b)) { drifted.push(`${name} — 착한거래에 없음`); continue; }
  const same = norm(readFileSync(a, 'utf8')) === norm(readFileSync(b, 'utf8'));
  console.log(`${same ? '✓' : '✗'} ${name}`);
  if (!same) drifted.push(`${name} — 내용이 다름`);
}

if (drifted.length) {
  console.log(`\n━━ 서식이 갈렸습니다 (${drifted.length}건)`);
  drifted.forEach((d) => console.log(`  · ${d}`));
  console.log('\n손님에게 나가는 것은 착한거래 쪽입니다. 그쪽을 기준으로 맞추세요:');
  console.log('  cp ../chakhandeal/public/contract-template/*.html public/contract-template/');
  process.exit(1);
}

console.log(`\n━━ 서식 ${names.size}개가 착한거래와 같습니다`);
