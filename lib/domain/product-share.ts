/**
 * 매물 공유·복사 SSOT — 손님링크(/q) · 카톡용 텍스트.
 * erp3 formatProductForCopy / searchActionShare 이관.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { priceList, vehicleName, creditDisplay, isOperatedPeriod, parseProductOptions } from '@/lib/domain/product';
import { fuelDisplay, yearDisplay } from '@/lib/domain/vehicle-master-match';
import { kmDisplay } from '@/lib/format';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';

function optsOf(p: EntityRecord): string[] {
  return parseProductOptions(p.options);
}

/** 손님공유 URL — /q/{code}?a={영업 사람키 user_code}. */
export function guestShareUrl(p: EntityRecord, agentCode: string, origin = typeof location !== 'undefined' ? location.origin : ''): string {
  const code = String(p.product_code || p._key || '');
  const q = new URLSearchParams();
  if (agentCode) q.set('a', agentCode);
  return `${origin}/q/${encodeURIComponent(code)}${q.toString() ? `?${q}` : ''}`;
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

/** 카톡/문자용 상품 텍스트 — 차번·스펙·요금·심사·담당. */
export function formatProductForCopy(p: EntityRecord, agent?: CopyAgent): string {
  const lines: string[] = [];
  const carNo = String(p.car_number || '');
  // ⚠ 예전 식은 `[${carNo}] ${model}…`.trim() || vehicleName(p) 였는데, 대괄호 때문에 앞부분이
  //  절대 빈 문자열이 될 수 없어 **폴백이 영영 안 걸렸다** — 차명이 통째로 비면 손님에게 `[]` 만 나갔다.
  //  차명은 SSOT(T2)로 만들고, 차번은 있을 때만 대괄호로 붙인다.
  const title = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', fallback: 'none' });
  lines.push([carNo ? `[${carNo}]` : '', title || '미등록 차량'].filter(Boolean).join(' '));

  const specs: string[] = [];
  const y = yearDisplay(p.year);
  if (y) specs.push(y);
  if (p.mileage) specs.push(kmDisplay(p.mileage) || `${Number(p.mileage).toLocaleString()}km`);
  const fuel = fuelDisplay(p.fuel_type) || String(p.fuel_type || '');
  if (fuel) specs.push(fuel);
  if (p.ext_color) specs.push(`외부 ${p.ext_color}`);
  if (p.int_color) specs.push(`내부 ${p.int_color}`);
  if (specs.length) lines.push(specs.join(' | '));

  const opts = optsOf(p);
  if (opts.length) lines.push(`옵션: ${opts.join(', ')}`);

  const prices = priceList(p).filter((x) => isOperatedPeriod(x.m) && x.rent > 0);
  if (prices.length) {
    lines.push('');
    lines.push('대여료 (월 / 보증금)');
    for (const x of prices) {
      const r = Math.round(x.rent / 10000);
      const d = Math.round((x.deposit || 0) / 10000);
      lines.push(`· ${x.m}개월: ${r}만 / ${d}만`);
    }
  }

  const credit = creditDisplay(p);
  if (credit) {
    lines.push('');
    lines.push(`심사: ${credit}`);
  }

  if (agent) {
    const parts = [agent.company, [agent.name].filter(Boolean).join(' '), agent.roleLabel].filter(Boolean);
    if (parts.length) {
      lines.push('');
      lines.push(`담당: ${parts.join(' | ')}`);
    }
    if (agent.phone) lines.push(`연락처: ${agent.phone}`);
  }

  return lines.join('\n');
}
