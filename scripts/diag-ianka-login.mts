/**
 * 진단 전용 — 이안카(https://xn--le5bt3bwxk.com/) 로그인 폼 구조를 보고, 실제로 로그인해서
 * 로그인 뒤 홈 화면에 재고 카드가 몇 개나 더 뜨는지 확인한다. 비밀번호는 절대 로그에 안 찍는다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-login.mts
 */
import { load } from 'cheerio';
const S = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const HOME = 'https://xn--le5bt3bwxk.com';
const account = JSON.parse(process.env.IANKA_ACCOUNT_JSON || '{}') as { email?: string; password?: string };
if (!account.email || !account.password) throw new Error('IANKA_ACCOUNT_JSON에 email/password가 없다');

let cookies: string[] = [];
function mergeCookies(res: Response) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    cookies = cookies.filter((existing) => !existing.startsWith(`${name}=`));
    cookies.push(pair);
  }
}

async function get(path: string): Promise<{ status: number; html: string; url: string }> {
  const res = await fetch(`${HOME}${path}`, {
    headers: { 'User-Agent': 'FreepassERP/4 diag (readonly)', Cookie: cookies.join('; ') },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  console.log(`GET ${path} → ${res.status} (최종 URL ${res.url})`);
  return { status: res.status, html: await res.text(), url: res.url };
}

// ── 1) 로그인 폼 구조 ──
const loginPage = await get('/login');
const $login = load(loginPage.html);
console.log(`\n■ /login 폼 ${$login('form').length}개`);
$login('form').each((fi, form) => {
  const $f = $login(form);
  console.log(`  form[${fi}] action="${$f.attr('action') || ''}" method="${$f.attr('method') || ''}"`);
  $f.find('input').each((_, input) => {
    const $i = $login(input);
    console.log(`    input name="${$i.attr('name') || ''}" type="${$i.attr('type') || ''}" placeholder="${$i.attr('placeholder') || ''}"`);
  });
});
// script 안에 fetch("/api/...login...") 같은 흔적이 있는지도 본다(SPA면 폼이 JS로만 제출될 수 있다).
console.log('\n■ 로그인 관련 API 흔적(script 안 문자열)');
$login('script').each((_, el) => {
  const t = $login(el).text();
  const m = [...t.matchAll(/["'`](\/api\/[^"'`]*login[^"'`]*)["'`]/gi)];
  for (const match of m) console.log(`  ${match[1]}`);
});

console.log('\n(폼 구조를 보고 실제 로그인은 다음 회차에서 시도한다 — 여기서는 구조만 본다)');
