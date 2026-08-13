/**
 * **사람이 판단한 표기 규칙을 사전에 박는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★`fill-master-gap.mts` 는 «같은 뜻 다른 말»을 기계로 찾아 넣는다. 그게 못 잡는 것 —
 *   연료 이름이 아예 다르거나(마일드하이브리드→가솔린), 축이 하나 더 붙은 것(2WD)은
 *   사람이 정해야 한다. 그 판단을 여기 적어 두면 사전에 `reviewed` 로 들어가고,
 *   기계가 나중에 덮어쓰지 못한다.
 *
 * ★근거는 마스터가 그 세부모델에 실제로 갖고 있는 축이다(실측 2026-08-13). 지어내지 않았다.
 *
 *   npx tsx scripts/seed-master-aliases.mts
 *   npx tsx scripts/seed-master-aliases.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { EMPTY_BOOK, upsert, type AliasBook, type AliasRule } from '../lib/domain/master-alias';

const APPLY = process.argv.includes('--apply');
const FILE = (process.argv.find((a) => a.startsWith('--alias=')) || '').split('=')[1] || 'public/data/master-aliases.json';

/** 사람이 정한 규칙. `why` 는 왜 그렇게 정했는지 — 나중에 되짚을 사람을 위해 남긴다. */
const SEED: (AliasRule & { why: string })[] = [
  {
    kind: 'variant', maker: '벤츠', model: 'CLE-클래스', sub_model: 'CLE-클래스 C236',
    from: '하이브리드 3.0 4MATIC', to: '가솔린 3.0 4MATIC', reviewed: true,
    why: 'CLE450 은 3.0 직렬6기통 48V 마일드하이브리드다. 국내 표기는 가솔린이고 마스터도 그렇게 부른다',
  },
  {
    kind: 'variant', maker: '벤츠', model: 'E-클래스', sub_model: 'E-클래스 W214',
    from: '가솔린 2.0 2WD', to: '가솔린 2.0', reviewed: true,
    why: '마스터는 2WD 를 적지 않는다(4MATIC 만 적는다). 붙은 2WD 는 군더더기다',
  },
  {
    kind: 'variant', maker: '기아', model: '쏘렌토', sub_model: '더 뉴 쏘렌토 MQ4',
    from: '하이브리드 1.6 5인승 4WD', to: '하이브리드 1.6 4WD', reviewed: true,
    why: '마스터 축은 「하이브리드 1.6 4WD」다. 인승보다 구동이 값을 가른다',
  },
  {
    kind: 'variant', maker: '현대', model: '싼타페', sub_model: '디 올 뉴 싼타페 MX5',
    from: '하이브리드 2WD 플러스 6인승', to: '하이브리드 2WD 6인승', reviewed: true,
    why: '마스터에 「하이브리드 2WD 6인승」이 있다. 「플러스」는 트림 조각(프레스티지 플러스)이라 축이 아니다',
  },
  {
    kind: 'trim', maker: '제네시스', model: 'GV80', sub_model: 'GV80 JX1',
    from: '기본형', to: '기본', reviewed: true,
    why: '같은 말이다. 마스터가 쓰는 쪽으로 맞춘다',
  },
  {
    kind: 'trim', maker: 'BMW', model: '5시리즈', sub_model: '5시리즈 G60',
    from: '520i M Spt', to: '520i M 스포츠', reviewed: true,
    why: 'Spt = 스포츠. 마스터에 「520i M 스포츠」가 있다',
  },
  {
    kind: 'trim', maker: '기아', model: 'K5', sub_model: 'K5 TF',
    from: 'LPI 트렌디', to: '트렌디', reviewed: true,
    why: 'LPI 는 연료 표기지 등급 이름이 아니다. 마스터 트림은 「트렌디」',
  },
  {
    kind: 'trim', maker: '닷지', model: '캘리버', sub_model: '캘리버',
    from: '블랙에디션 7인승', to: '블랙에디션', reviewed: true,
    why: '인승은 트림이 아니다. 파워트레인 축에서 다룬다',
  },
  {
    kind: 'trim', maker: '미니', model: '컨트리맨', sub_model: '쿠퍼 S 컨트리맨 U25',
    from: '에디션', to: 'S ALL4 Tailored/First Edition(테일러드 에디션)', reviewed: true,
    why: '마스터가 그 세부모델에 가진 유일한 에디션 트림이다',
  },
];

let book: AliasBook = EMPTY_BOOK;
try { book = JSON.parse(readFileSync(FILE, 'utf8')) as AliasBook; } catch { /* 처음이면 빈 사전 */ }
console.log(`■ 표기 사전 ${FILE} — 지금 규칙 ${book.rules.length}개\n`);
let added = 0, changed = 0;
const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
for (const s of SEED) {
  const { why, ...rule } = s;
  const res = upsert(book, { ...rule, at: day, by: '사람' });
  book = res.book;
  if (res.added) added++;
  if (res.changed) changed++;
  console.log(`  ${res.added ? '＋' : res.changed ? '↻' : '=' } [${rule.kind}] ${rule.maker} ${rule.model} ${rule.sub_model}`);
  console.log(`      「${rule.from}」 → 「${rule.to}」`);
  console.log(`      ${why}`);
}
console.log(`\n  새로 ${added} · 바뀜 ${changed} · 합계 ${book.rules.length}`);
if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }
book.updated = day;
writeFileSync(FILE, `${JSON.stringify(book, null, 2)}\n`, 'utf8');
console.log(`\n  담았다. 발행·되읽기가 이 사전을 쓴다.\n`);
