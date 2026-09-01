/**
 * 매물 공유·복사 SSOT — 손님링크(/q) · 카톡용 텍스트.
 * erp3 formatProductForCopy / searchActionShare 이관.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { priceList, isOperatedPeriod, parseProductOptions } from '@/lib/domain/product';
import { fuelDisplay, yearDisplay } from '@/lib/domain/vehicle-master-match';
import { kmDisplay } from '@/lib/format';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';

function optsOf(p: EntityRecord): string[] {
  return parseProductOptions(p.options);
}

/**
 * 손님링크의 **짧은 상품 토큰** — 상품키에서 계산해 낸다(저장하지 않는다).
 *
 * ★왜(사장님 2026-08-22 「최대한 링크는 짧게 해줘야 하고 · 우리를 최대한 감춰야 하고」)
 *   실제 상품키는 `RP021_116하9974` 처럼 **공급사코드 + 한글 차번**이다. URL 에 넣으면
 *   한글 한 글자가 `%ED%95%98`(9자)로 부풀어 링크가 길어지고, 무엇보다 **공급사코드가 손님에게 그대로 보인다.**
 *   토큰은 순수 ASCII 10자라 짧고, 키를 되돌릴 수 없어 공급사·내부코드가 안 샌다.
 * ★저장 안 하는 이유: 6,584건에 새 필드를 심는 이관 없이 오늘 바로 쓸 수 있고, 서버가 어차피
 *   상품 전체를 한 번 읽으므로(loadGuestQuote) 그때 같이 계산해 맞추면 된다.
 * ⚠ 키가 바뀌면 토큰도 바뀐다(=옛 링크가 죽는다) — 그건 키를 바꿀 때 원래 감수하던 것과 같다.
 */
const TOKEN_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // 혼동문자(0·O·1·I·l) 제외 — ids.ts 와 같은 사전
export function shareToken(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  // FNV-1a 64bit — 암호용이 아니라 «짧은 열쇠»라 해시 강도가 아니라 충돌만 보면 된다.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * prime) & mask;
  }
  const base = BigInt(TOKEN_ALPHABET.length);
  let out = '';
  for (let i = 0; i < 10; i++) { out = TOKEN_ALPHABET[Number(hash % base)] + out; hash /= base; }
  return out; // 31^10 ≈ 8×10^14 — 6.6천 건에서 충돌 확률 사실상 0
}

/**
 * 손님공유 URL — `/q/{상품토큰}-{담당자코드}`.
 *   `…/q/RP021_116%ED%95%989974?a=U0045`(56자) → `…/q/a3f9k2mq2x-U0045`(42자).
 * ★옛 링크(원본 키 · `?a=`)도 그대로 열린다 — 서버가 **통째로 먼저 찾고**, 못 찾을 때만 하이픈으로 가른다.
 *   상품키 599건이 하이픈을 품고 있어서(`PD-260506-020`) 무조건 가르면 그 링크들이 죽는다(2026-08-22 실측).
 */
export function guestShareUrl(p: EntityRecord, agentCode: string, origin = typeof location !== 'undefined' ? location.origin : ''): string {
  const token = shareToken(p.product_code || p._key);
  const agent = String(agentCode ?? '').trim();
  return `${origin}/q/${encodeURIComponent(agent ? `${token}-${agent}` : token)}`;
}

/**
 * 링크 한 조각을 «상품 + 담당자»로 가르는 **폴백** — 통째 조회가 실패한 뒤에만 쓴다(위 주석).
 * 담당자 코드(U0045·S0006…)에는 하이픈이 없다(2026-08-22 실측 0건)라 마지막 하이픈에서 가르면 된다.
 */
export function splitShareSegment(segment: string): { code: string; share: string } {
  const seg = String(segment ?? '').trim();
  const at = seg.lastIndexOf('-');
  if (at <= 0 || at === seg.length - 1) return { code: seg, share: '' };
  return { code: seg.slice(0, at), share: seg.slice(at + 1) };
}

/**
 * 코드 후보 — 새 발행분에서 뗀 접두(`veh_`·`usr_`)를 다시 붙여 본다.
 * 원본 → 접두 붙인 값 순서. (운영 데이터는 접두 없는 키가 대부분이라 대개 원본 하나로 끝난다.)
 */
export function codeCandidates(raw: string, prefix: string): string[] {
  const v = String(raw ?? '').trim();
  if (!v) return [];
  return [...new Set([v, v.startsWith(`${prefix}_`) ? '' : `${prefix}_${v}`].filter(Boolean))];
}

/** /q?a= 로 영업자 찾기 — user_code 우선, uid·레거시 채널코드 폴백. */
export function matchAgentByShareCode(users: EntityRecord[], raw: string | null | undefined): EntityRecord | null {
  const a = String(raw || '').trim();
  if (!a) return null;
  const byUser = users.find((u) => String(u.user_code || '') === a);
  if (byUser) return byUser;
  const byUid = users.find((u) => String(u.uid || u._key || '') === a);
  if (byUid) return byUid;
  // 구링크(?a=채널코드) — 동채널 첫 영업자(표시용). 신규크는 user_code.
  const byCh = users.filter((u) => String(u.agent_channel_code || '') === a);
  return byCh[0] || null;
}

export type CopyAgent = { name?: string; phone?: string; company?: string; roleLabel?: string };

/** 카톡/문자용 상품 텍스트 — 차번·스펙·요금·심사·담당.
 * 고객에게 그대로 전달되는 정본이므로, 값은 넓히지 않고 읽는 순서와 줄 규격만 유지한다.
 */
export function formatProductForCopy(p: EntityRecord, agent?: CopyAgent): string {
  const lines: string[] = [];
  // ⚠ 예전 식은 `[${carNo}] ${model}…`.trim() || vehicleName(p) 였는데, 대괄호 때문에 앞부분이
  //  절대 빈 문자열이 될 수 없어 **폴백이 영영 안 걸렸다** — 차명이 통째로 비면 손님에게 `[]` 만 나갔다.
  //  차명·세부모델·세부트림은 SSOT(T2)의 완성 차량명 한 줄로 낸다.
  const title = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', fallback: 'none' });
  lines.push('■ 차량 설명');
  lines.push(`차명  ${title || '미등록 차량'}`);

  const opts = optsOf(p);
  if (opts.length) lines.push(`옵션  ${opts.join(' · ')}`);

  const y = yearDisplay(p.year);
  const fuel = fuelDisplay(p.fuel_type) || String(p.fuel_type || '');
  const engineCc = Number(p.engine_cc);
  const specifications = [
    y,
    p.mileage ? (kmDisplay(p.mileage) || `${Number(p.mileage).toLocaleString()}km`) : '',
    fuel,
    Number.isFinite(engineCc) && engineCc > 0 ? `${engineCc.toLocaleString('ko-KR')}cc` : '',
    String(p.drive_type || '').trim(),
    p.seats ? `${p.seats}인승` : '',
  ].filter(Boolean);
  if (specifications.length) lines.push(specifications.join('  |  '));

  const prices = priceList(p).filter((x) => isOperatedPeriod(x.m) && x.rent > 0);
  if (prices.length) {
    lines.push('');
    lines.push('■ 기간별 대여료');
    for (const x of prices) {
      const r = Math.round(x.rent / 10000);
      const d = Math.round((x.deposit || 0) / 10000);
      lines.push(`· ${x.m}개월  |  월 ${r}만 원  |  보증금 ${d}만 원`);
    }
  }

  if (agent) {
    const name = String(agent.name || '').trim();
    const phone = String(agent.phone || '').trim();
    if (name || phone) {
      lines.push('');
      lines.push('■ 담당자 정보');
      lines.push([name && `담당자  ${name}`, phone && `연락처  ${phone}`].filter(Boolean).join('  |  '));
    }
  }

  return lines.join('\n');
}
