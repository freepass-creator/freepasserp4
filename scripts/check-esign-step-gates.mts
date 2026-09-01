/**
 * 「없는 화면의 값을 요구하지 않는다」 — 손님이 갇히는 사고를 잡는다.
 *
 * ★오늘 같은 사고가 두 번 났다(2026-08-29).
 *   ① 개인정보 입력에서 나갈 때 `idCardRrnMasked` 를 요구했는데,
 *      그 체크는 «다음 화면»인 신분증 촬영에 있었다 → 손님이 영영 못 나감
 *   ② 화면이 `sales_proof` 단계를 만들었는데 서버 허용목록에 없어 400 → 같은 갇힘
 *      (그건 sim-esign-progress-keys 가 잡는다)
 *
 * 눈으로는 «왜 안 넘어가지»로만 보인다. 화면 하나하나 걸어 봐야 나온다.
 * 여기서는 코드만 읽고 잡는다 —
 *   화면 A 를 나갈 때 요구하는 값이, 화면 A 보다 «뒤»에 있는 화면에서만 켜지면 갇힌 것이다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const NL = String.fromCharCode(10);
const page = readFileSync('app/sign/[token]/page.tsx', 'utf8');

// ── ① 단계 차례
const stepsStart = page.indexOf('const steps = useMemo<JourneyStep[]>');
assert.ok(stepsStart > 0, '화면에서 steps 목록을 찾지 못했습니다');
const stepsBlock = page.slice(stepsStart, page.indexOf('], [', stepsStart));
const order = [...new Set([...stepsBlock.matchAll(/kind: '([a-z-]+)'/g)].map((m) => m[1]))];
assert.ok(order.length >= 4, `단계가 너무 적게 잡혔습니다 (${order.length}) — 이 검사의 파싱이 깨진 것입니다`);

/** `{step?.kind === 'x' ? ( … ) : null}` 한 덩어리를 괄호 짝으로 잘라 낸다. */
function renderBlock(kind: string): string {
  const head = `{step?.kind === '${kind}'`;
  const a = page.indexOf(head);
  if (a < 0) return '';
  let depth = 0;
  for (let i = a; i < page.length; i += 1) {
    if (page[i] === '{') depth += 1;
    else if (page[i] === '}') { depth -= 1; if (depth === 0) return page.slice(a, i + 1); }
  }
  return '';
}

/**
 * next() 안에서 그 단계를 나갈 때 도는 검사 «전부».
 *
 * ⚠ 한 단계에 검사 덩어리가 여러 개다 — 한 줄짜리(`if (kind==='x' && …) return …`)와
 *   블록짜리(`if (kind==='x') { … }`)가 섞여 있다.
 *   처음 하나만 보면 «헛가드»가 된다(2026-08-29: 실제로 그래서 오늘 낸 사고를 못 잡았다).
 */
function gateBlocks(kind: string): string {
  const nextAt = page.indexOf('const next = async () => {');
  if (nextAt < 0) return '';
  const nextEnd = page.indexOf('const submit = async () => {', nextAt);
  const scope = page.slice(nextAt, nextEnd > 0 ? nextEnd : undefined);
  const head = `if (step.kind === '${kind}'`;
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const a = scope.indexOf(head, from);
    if (a < 0) break;
    const lineEnd = scope.indexOf(NL, a);
    const paren = scope.indexOf(')', a);
    const brace = scope.indexOf('{', paren < 0 ? a : paren);
    if (brace < 0 || brace > lineEnd) {
      out.push(scope.slice(a, lineEnd));           // 한 줄짜리
      from = lineEnd;
    } else {
      let depth = 0;
      let end = brace;
      for (let i = brace; i < scope.length; i += 1) {
        if (scope[i] === '{') depth += 1;
        else if (scope[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      out.push(scope.slice(a, end + 1));           // 블록짜리
      from = end + 1;
    }
  }
  return out.join(NL);
}

// ── ② 어느 화면이 어느 값을 «켜는가» (setXxx → xxx)
const owner = new Map<string, string>();
for (const kind of order) {
  const block = renderBlock(kind);
  if (!block) continue;
  for (const m of block.matchAll(/\bset([A-Z]\w*)\s*\(/g)) {
    const state = m[1][0].toLowerCase() + m[1].slice(1);
    if (!owner.has(state)) owner.set(state, kind);
  }
}

// ── ③ 어느 화면이 나갈 때 무엇을 «요구하는가»
const trapped: string[] = [];
order.forEach((kind, index) => {
  const gate = gateBlocks(kind);
  if (!gate) return;
  for (const [state, ownerKind] of owner) {
    if (ownerKind === kind) continue;
    if (!new RegExp(`\\b${state}\\b`).test(gate)) continue;
    const ownerIndex = order.indexOf(ownerKind);
    if (ownerIndex > index) {
      trapped.push(
        `  「${kind}」 화면을 나갈 때 ${state} 를 요구하는데,\n`
        + `     그 값은 «뒤»에 있는 「${ownerKind}」 화면에서만 켜집니다 — 손님이 갇힙니다.`,
      );
    }
  }
});

assert.deepEqual(
  trapped, [],
  '없는 화면의 값을 요구하는 검사가 있습니다.\n' + trapped.join('\n')
  + '\n  → 검사를 그 값이 «있는» 화면으로 옮기거나, 앞선 중복이면 지웁니다.',
);

console.log(`✓ 단계 게이트: ${order.length}단계 · 화면이 스스로 켤 수 없는 값을 요구하지 않는다`);
console.log(`  차례: ${order.join(' → ')}`);
