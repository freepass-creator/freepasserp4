/**
 * **보증금을 규칙으로 받는 공급사의 빈 보증금 칸에 그 규칙을 적어 넣는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-12 · 사장님)
 *   손오공 구독 **반납형**은 보증금이 「연수 × 대여료」다 — 12개월 1개월치, 24개월 2개월치,
 *   36개월 3개월치… ERP 는 그걸 `deposit_rule = months_per_year` 로 이미 정확히 계산한다.
 *   문제는 **시트가 빈칸이라는 것**이다. 사람이 보면 «보증금 없음»으로 읽힌다. 그건 사실이 아니다.
 *   그래서 칸에 규칙을 글자로 적는다 — 시트를 읽는 사람과 코드가 같은 말을 하게.
 *
 * ★이 글자는 **금액 계산을 바꾸지 않는다.** 파서는 순수 숫자 칸만 금액으로 인정하고
 *   (`depositCell`), 「무보증」류 확정 표현만 0원으로 본다(`MEANS_NO_DEPOSIT`).
 *   「연수×대여료」는 둘 다 아니라 그대로 규칙 계산으로 넘어간다.
 *   ⚠ 그래서 **문구를 바꿀 때는 저 두 판정을 먼저 확인해야 한다.** 숫자로 시작하는 문구를
 *     넣으면 그게 보증금 금액이 된다.
 * ★**빈 칸만** 채운다. 공급사가 금액을 적어 뒀으면 그게 이긴다 — 규칙보다 시트가 위다.
 *
 *   npx tsx scripts/mark-deposit-rule-cells.mts
 *   npx tsx scripts/mark-deposit-rule-cells.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * 어느 공급사의 어느 탭, 어느 보증금 열에 무엇을 적을지.
 * ★코드에 박는 이유 — 이건 «공급사와 합의한 문구»지 우리가 추론할 값이 아니다.
 *   새 공급사가 규칙 운영을 시작하면 여기 한 줄을 추가하고 파트너의 `deposit_rule` 을 맞춘다.
 */
const MARKS = [
  {
    code: 'RP012', tab: '구독 상품 현황', column: '보증금', block: '반납형',
    text: '연수×대여료', rule: 'months_per_year',
    note: '손오공 구독 반납형 — 12개월 1개월치 · 24개월 2개월치 · 36개월 3개월치 …',
  },
];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const [t3, t4] = await Promise.all(['partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };

const A = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
console.log(`■ 보증금 규칙을 시트 칸에 적기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);

for (const m of MARKS) {
  const partner = Object.values<Rec>(partners).find((x) => !dead(x) && S(x.partner_code) === m.code && S(x.sheet_url));
  const id = (S(partner?.sheet_url).match(/\/d\/([\w-]+)/) || [])[1];
  const name = S(partner?.partner_name || partner?.name) || m.code;
  if (!id) { console.log(`  ${name}(${m.code}) — 시트 주소가 없다\n`); continue; }
  // ★파트너 규칙이 실제로 그 규칙인지 먼저 본다. 규칙이 다른데 문구만 적으면 시트가 거짓말을 한다.
  if (S(partner?.deposit_rule) !== m.rule) {
    console.log(`  ★${name}(${m.code}) — 파트너 보증금규칙이 「${S(partner?.deposit_rule) || '(없음)'}」 이다.`);
    console.log(`     「${m.text}」 라고 적으려면 규칙이 「${m.rule}」 이어야 한다. 건너뛴다.\n`);
    continue;
  }

  const vals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${m.tab}!A1:BZ600`)}`);
  const rows = ((vals.values || []) as string[][]);
  // 헤더 줄을 찾는다 — 안내 행이 위에 낀 시트가 있다.
  const hi = rows.findIndex((r) => r.map(S).includes('차량번호'));
  if (hi < 0) { console.log(`  ${name} 「${m.tab}」 — 차량번호 헤더를 못 찾았다\n`); continue; }
  const hdr = rows[hi].map(S);
  const iPlate = hdr.indexOf('차량번호');
  /**
   * ★같은 이름의 보증금 열이 **두 벌**이다 — 인수형·반납형. 이름만 보고 고르면 첫 번째(인수형)를 잡는다.
   *   구분은 헤더 «위» 줄의 블록 표식(「인수형」·「반납형」)에 있다. 그 표식부터 오른쪽에서 찾는다.
   *   (손오공 실측 2026-08-12: 헤더는 2행이고 1행에 [11]인수형 [17]반납형 이 있다.)
   */
  const marker = m.block ? (rows[hi - 1] || []).map(S).findIndex((h) => h === m.block) : -1;
  if (m.block && marker < 0) { console.log(`  ${name} 「${m.tab}」 — 블록 표식 「${m.block}」 을 못 찾았다\n`); continue; }
  const iDep = hdr.findIndex((h, i) => h === m.column && i >= marker);
  if (iDep < 0) { console.log(`  ${name} 「${m.tab}」 — 「${m.column}」 열이 없다\n`); continue; }
  /**
   * ★그 보증금 열이 관할하는 기간 열은 **자기 오른쪽**이다(블록 스코프 — `parsePriceColumns` 와 같다).
   *   그 구간에 요금이 하나라도 있는 줄에만 적는다. 안 파는 줄에 보증금 규칙을 적으면
   *   «파는 차»로 읽힌다.
   */
  const nextDep = hdr.findIndex((h, i) => i > iDep && /보증/.test(h));
  const scope = hdr.map((h, i) => ({ h, i }))
    .filter((x) => x.i > iDep && (nextDep < 0 || x.i < nextDep) && /^\d+개월/.test(x.h));

  const writes: { range: string; values: string[][] }[] = [];
  let kept = 0; let idle = 0;
  for (let r = hi + 1; r < rows.length; r++) {
    if (!S(rows[r]?.[iPlate])) continue;
    if (S(rows[r][iDep])) { kept++; continue; }        // 공급사가 적은 값이 이긴다
    if (!scope.some((c) => S(rows[r][c.i]))) { idle++; continue; }
    writes.push({ range: `${m.tab}!${A(iDep)}${r + 1}`, values: [[m.text]] });
  }
  console.log(`  ${name}(${m.code}) 「${m.tab}」 · 「${m.column}」 열 (관할 기간 ${scope.map((c) => c.h).join(' ') || '없음'})`);
  console.log(`    ${m.note}`);
  console.log(`     적을 칸 ${writes.length}개 · 이미 금액이 있어 둔 칸 ${kept}개 · 그 구간 요금이 없어 건너뛴 줄 ${idle}개`);
  if (!APPLY || !writes.length) { console.log(''); continue; }
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST',
    // ★USER_ENTERED 면 구글이 「연수×대여료」를 수식으로 오해할 여지가 없지만, 굳이 해석시키지 않는다.
    body: JSON.stringify({ valueInputOption: 'RAW', data: writes }),
  });
  console.log('     적었다\n');
}
if (!APPLY) console.log('※ dry-run. 실제 반영은 --apply\n');
