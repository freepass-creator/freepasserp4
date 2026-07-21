'use client';
import type { ReactNode } from 'react';
import {
  MessageCircleMore, MessageCircle, MessageCircleWarning,
  FileText, FileClock, FileCheck2, FileX2, ClipboardList,
  CircleCheck, Package, Handshake, Ban, Car, ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { contractStage, getProgress, contractTone } from '@/lib/domain/contract';
import { vehicleName, canonProductType } from '@/lib/domain/product';
import {
  Badge, CountPill, NUM, C, FS, productTypeStyle,
  type BadgeTone,
} from '@/components/ui';
import {
  FeedListRow, FeedThumbIcon, FeedTitle, FeedSub, FeedBadges, FeedTitleRow,
} from '@/components/ui/feedrow';
import { CardSpecs } from '@/components/product-card-atoms';
import { vehicleTone } from '@/lib/domain/product';
import { msgClock } from '@/lib/format';

function plateSpan(plate: string) {
  if (!plate) return null;
  return (
    <span style={{ fontFamily: NUM, fontWeight: 600, fontSize: FS.sub, color: C.mute }}>{plate}</span>
  );
}

function dotJoin(parts: (ReactNode | string | false | null | undefined)[]) {
  const xs = parts.filter(Boolean);
  if (!xs.length) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0, minWidth: 0, overflow: 'hidden' }}>
      {xs.map((x, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
          {i > 0 ? <span style={{ color: C.faint, margin: '0 5px', flex: '0 0 auto' }}>·</span> : null}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x}</span>
        </span>
      ))}
    </span>
  );
}

/** 문의 — 안읽음=확인필요 · 상담 · 진행 · 완료/취소 */
function chatStatusIcon(stage: { label: string; tone: BadgeTone }, unread: number): {
  icon: LucideIcon; tone: BadgeTone; title: string;
} {
  if (unread > 0) {
    return { icon: MessageCircleWarning, tone: 'amber', title: `확인 필요 · 안읽음 ${unread}` };
  }
  if (stage.label === '상담') return { icon: MessageCircle, tone: 'gray', title: '상담' };
  if (stage.label === '계약완료') return { icon: MessageCircleMore, tone: 'green', title: '계약완료' };
  if (stage.label === '취소') return { icon: MessageCircleMore, tone: 'red', title: '취소' };
  // 단계 진행
  return { icon: MessageCircleMore, tone: stage.tone, title: stage.label };
}

/** 계약 — 문의·재고와 동일: 좌측=상태 아이콘+색 · 진행숫자는 우측 메타 */
function contractStatusIcon(c: EntityRecord): { icon: LucideIcon; tone: BadgeTone; title: string } {
  const st = String(c.contract_status || '');
  const tone = contractTone(st);
  const pr = getProgress(c);
  if (st === '계약완료') return { icon: FileCheck2, tone: 'green', title: '계약완료' };
  if (st === '계약취소') return { icon: FileX2, tone: 'red', title: '계약취소' };
  if (st === '계약요청' || pr.done === 0) {
    return { icon: ClipboardList, tone: 'blue', title: `확인 필요 · ${st || '계약요청'}` };
  }
  if (st === '계약대기' || st === '계약발송') {
    return { icon: FileClock, tone: 'amber', title: `${st} · ${pr.done}/${pr.total}` };
  }
  return { icon: FileText, tone: tone || 'amber', title: `${st || '진행'} · ${pr.done}/${pr.total}` };
}

/** 재고 — 출고가능=판매중 · 상품화=준비 · 협의 · 불가 */
function inventoryStatusIcon(p: EntityRecord): { icon: LucideIcon; tone: BadgeTone; title: string } {
  const st = String(p.vehicle_status || '');
  const tone = vehicleTone(st) as BadgeTone;
  if (st === '즉시출고' || st === '출고가능') {
    return { icon: CircleCheck, tone: 'green', title: `${st} · 판매중` };
  }
  if (st === '상품화중') return { icon: Package, tone: 'amber', title: '상품화중' };
  if (st === '출고협의') return { icon: Handshake, tone: 'blue', title: '출고협의' };
  if (st === '계약중') return { icon: FileText, tone: 'orange' as BadgeTone, title: '계약중' };
  if (st === '출고불가') return { icon: Ban, tone: 'red', title: '출고불가' };
  if (p._needs_master_review) return { icon: ClipboardList, tone: 'amber', title: '검수 필요' };
  return { icon: Car, tone: tone, title: st || '재고' };
}

/**
 * 문의 목록 3줄
 *   1 차명 · 시간
 *   2 상담뱃지 · 차번 · 상대
 *   3 마지막 메시지 (+안읽음)
 * 좌측 = 상태 아이콘(색)
 */
export function ChatRoomRow({
  room, stageContract, counter, unread, selected, onClick,
}: {
  room: EntityRecord;
  stageContract?: EntityRecord | null;
  counter: string;
  unread: number;
  selected?: boolean;
  onClick: () => void;
}) {
  const stage = contractStage(stageContract);
  const msg = String(room.last_message || '대화를 시작하세요').replace(/\s+/g, ' ').trim();
  const ic = chatStatusIcon(stage, unread);
  return (
    <FeedListRow
      selected={selected}
      onClick={onClick}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} />}
      lines={[
        <FeedTitleRow
          key="t"
          title={<FeedTitle>{String(room.vehicle_name || '매물')}</FeedTitle>}
          meta={<span style={{ fontSize: FS.cap, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{msgClock(room.last_message_at, { dateOnly: true })}</span>}
        />,
        <FeedBadges key="b">
          <Badge tone={stage.tone}>{stage.label}</Badge>
          {plateSpan(String(room.car_number || ''))}
          {counter ? <span style={{ fontSize: FS.sub, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{counter}</span> : null}
        </FeedBadges>,
        <div key="m" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: '100%' }}>
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <FeedSub>{msg}</FeedSub>
          </div>
          {unread > 0 ? <CountPill n={unread} /> : null}
        </div>,
      ]}
    />
  );
}

/**
 * 계약 목록 3줄
 *   1 차종/계약자 · 진행 n/5
 *   2 상태뱃지 · 차번 · 계약코드
 *   3 계약자 · 계약일
 * 좌측 = 상태 아이콘(색) — 문의·재고와 동일 규격
 */
export function ContractListRow({
  c, selected, onClick,
}: {
  c: EntityRecord;
  selected?: boolean;
  onClick: () => void;
}) {
  const pr = getProgress(c);
  const title = String(c.sub_model_snapshot || c.vehicle_name || c.customer_name || c.contract_code || '계약');
  const ic = contractStatusIcon(c);
  const inProgress = String(c.contract_status || '') !== '계약완료'
    && String(c.contract_status || '') !== '계약취소';
  return (
    <FeedListRow
      selected={selected}
      onClick={onClick}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} />}
      lines={[
        <FeedTitleRow
          key="t"
          title={<FeedTitle>{title}</FeedTitle>}
          meta={inProgress ? (
            <span style={{ fontSize: FS.sub, fontWeight: 800, color: C.brand, fontFamily: NUM }}>{pr.done}/{pr.total}</span>
          ) : null}
        />,
        <FeedBadges key="b">
          <Badge tone={contractTone(String(c.contract_status))}>{String(c.contract_status || '—')}</Badge>
          {plateSpan(String(c.car_number_snapshot || ''))}
          <span style={{ fontSize: FS.cap, fontFamily: NUM, color: C.faint, fontWeight: 600 }}>{String(c.contract_code || '')}</span>
        </FeedBadges>,
        <FeedSub key="s">
          {dotJoin([
            c.customer_name ? String(c.customer_name) : null,
            c.contract_date ? String(c.contract_date) : null,
          ]) || '—'}
        </FeedSub>,
      ]}
    />
  );
}

/**
 * 재고 목록 3줄 (문의·계약과 동일 골격)
 *   1 차명
 *   2 상태·상품유형 뱃지 (+검수)
 *   3 차번 · 스펙 · 공급사
 * 좌측 = 출고/판매 상태 아이콘(색)
 */
export function InventoryListRow({
  p, selected, onClick,
}: {
  p: EntityRecord;
  selected?: boolean;
  onClick: () => void;
}) {
  const st = String(p.vehicle_status || '');
  const pt = String(p.product_type || '');
  const provider = String(p.provider_name || p.provider_company_code || '').trim();
  const ic = inventoryStatusIcon(p);
  return (
    <FeedListRow
      selected={selected}
      onClick={onClick}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} />}
      lines={[
        <FeedTitle key="t">{vehicleName(p) || String(p.product_code || '매물')}</FeedTitle>,
        <FeedBadges key="b">
          {st ? <Badge tone={vehicleTone(st)} variant={st === '계약중' ? 'solid' : 'line'} pulse={st === '계약중'}>{st}</Badge> : null}
          {pt ? (() => { const c = canonProductType(pt) || pt; const pts = productTypeStyle(c); return <Badge tone={pts.tone} variant={pts.variant}>{c}</Badge>; })() : null}
          {p._needs_master_review ? <Badge tone="amber" variant="solid">검수</Badge>
            : p._snapped ? <Badge tone="blue" variant="quiet">변환</Badge> : null}
        </FeedBadges>,
        <div key="s" style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
            <CardSpecs p={p} dense />
          </div>
          {provider ? (
            <>
              <span style={{ color: C.faint, margin: '0 5px', flex: '0 0 auto' }}>·</span>
              <span style={{
                flex: '0 1 auto', maxWidth: '42%',
                fontSize: FS.sub, color: C.faint, fontWeight: 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{provider}</span>
            </>
          ) : null}
        </div>,
      ]}
    />
  );
}

/** 정책 — 전용/공용 아이콘 · 유형뱃지 · 코드·심사 (문의·계약·재고와 동일 3줄) */
function policyStatusIcon(p: EntityRecord): { icon: LucideIcon; tone: BadgeTone; title: string } {
  const shared = !String(p.provider_company_code || '').trim();
  return { icon: ShieldCheck, tone: shared ? 'gray' : 'blue', title: shared ? '공용 정책' : '전용 정책' };
}

export function PolicyListRow({
  p, selected, onClick,
}: {
  p: EntityRecord;
  selected?: boolean;
  onClick: () => void;
}) {
  const ic = policyStatusIcon(p);
  const ptype = String(p.policy_type || '').trim();
  const shared = !String(p.provider_company_code || '').trim();
  return (
    <FeedListRow
      selected={selected}
      onClick={onClick}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} />}
      lines={[
        <FeedTitle key="t">{String(p.policy_name || p.policy_code || '정책')}</FeedTitle>,
        <FeedBadges key="b">
          {ptype ? <Badge tone="blue">{ptype}</Badge> : null}
          <Badge tone={shared ? 'gray' : 'blue'} variant="quiet">{shared ? '공용' : String(p.provider_company_code)}</Badge>
        </FeedBadges>,
        <FeedSub key="s">
          {dotJoin([
            p.policy_code ? <span key="c" style={{ fontFamily: NUM }}>{String(p.policy_code)}</span> : null,
            p.screening_criteria ? String(p.screening_criteria) : null,
          ]) || '—'}
        </FeedSub>,
      ]}
    />
  );
}
