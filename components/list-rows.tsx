'use client';
import { memo } from 'react';
import type { ReactNode } from 'react';
import {
  MessageCircleMore, MessageCircle, MessageCircleWarning, MessageCircleCheck, MessageCircleX,
  FileText, FileClock, FileCheck2, FileX2, ClipboardList,
  CircleCheck, Package, Handshake, Ban, Car, ShieldCheck, Plus,
  Building2, UserPlus, UserRoundCheck, UserRoundX,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROLE_LABEL_RAW, type EntityRecord } from '@/lib/intake/entities';
import { contractStage, getProgress, isContractInProgress } from '@/lib/domain/contract';
import {
  UNKNOWN_VEHICLE_STATUS,
  canonProductType,
  normalizeVehicleDisplayStatus,
} from '@/lib/domain/product';
import { contractVehicleLabel, productVehicleLabel } from '@/lib/domain/vehicle-label';
import {
  ACTOR_TONE, Badge, CountPill, NUM, C, FS, FW, productTypeStyle, VEHICLE_STATUS_TONE,
  won, type BadgeTone,
} from '@/components/ui';
import {
  FEED_LINE, FeedListRow, FeedThumbIcon, FeedTitle, FeedSub, FeedTitleRow,
} from '@/components/ui/feedrow';
import { useIsMobile } from '@/lib/use-mobile';
import { CardSpecs } from '@/components/product-card-atoms';
import { msgClock } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { partnerTypeLabel } from '@/lib/domain/partner';
import { memberAccountState } from '@/features/members/member-filter';
import { joinMetaText } from '@/features/work-list-display';
import {
  SETTLEMENT_RATE_WARNING,
  SETTLEMENT_RENT_WARNING,
  settlementNetTone,
  settlementWarning,
  type SettlementListDisplay,
} from '@/lib/domain/settlement-display';

const MEMBER_ROLE_LABEL: Record<string, string> = ROLE_LABEL_RAW;

/** 레거시 공백-only 값이 빈 제목·배지로 남지 않게 목록 문구를 정규화한다. */
const listText = (value: unknown) => joinMetaText([value]);

function plateSpan(plate: string) {
  const value = String(plate || '').trim();
  if (!value) return null;
  return (
    <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong, fontSize: FS.sub, color: C.mute }}>{value}</span>
  );
}

function dotJoin(parts: (ReactNode | string | false | null | undefined)[]) {
  const xs = parts.flatMap((part) => {
    if (typeof part === 'string') {
      const value = part.replace(/\s+/g, ' ').trim();
      return value ? [value] : [];
    }
    return part ? [part] : [];
  });
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

/** 문의 — 안읽음=확인필요 · 문의 · 진행 · 완료/취소 */
function chatStatusIcon(stage: { label: string; tone: BadgeTone }, unread: number): {
  icon: LucideIcon; tone: BadgeTone; title: string;
} {
  if (stage.label === '계약완료') return { icon: MessageCircleCheck, tone: 'green', title: '계약완료' };
  if (stage.label === '계약취소') return { icon: MessageCircleX, tone: 'red', title: '계약취소' };
  // 좌측 아이콘은 업무 lifecycle 전용이다. 안읽음은 경고 아이콘과 CountPill로 표시한다.
  if (stage.label !== '문의') return { icon: MessageCircleMore, tone: stage.tone, title: stage.label };
  if (unread > 0) return { icon: MessageCircleWarning, tone: 'amber', title: `확인 필요 · 안읽음 ${unread}` };
  return { icon: MessageCircle, tone: 'gray', title: '문의' };
}

/** 계약 — 문의·재고와 동일: 좌측=상태 아이콘+색 · 진행숫자는 우측 메타 */
function contractStatusIcon(c: EntityRecord): { icon: LucideIcon; tone: BadgeTone; title: string } {
  const stage = contractStage(c);
  const pr = getProgress(c);
  if (stage.label === '계약완료') return { icon: FileCheck2, tone: 'green', title: '계약완료' };
  if (stage.label === '계약취소') return { icon: FileX2, tone: 'red', title: '계약취소' };
  if (stage.tone === 'red') return { icon: FileX2, tone: 'red', title: stage.label };
  if (pr.done === 0) {
    return { icon: ClipboardList, tone: 'blue', title: `확인 필요 · ${stage.label}` };
  }
  return { icon: FileClock, tone: stage.tone, title: `${stage.label} · ${pr.done}/${pr.total}` };
}

/** 재고 — 아이콘 모양만 로컬. 색 = VEHICLE_STATUS_TONE SSOT. */
function inventoryStatusIcon(p: EntityRecord): { icon: LucideIcon; tone: BadgeTone; title: string } {
  const st = normalizeVehicleDisplayStatus(p.vehicle_status);
  const tone = st === UNKNOWN_VEHICLE_STATUS
    ? 'red'
    : ((VEHICLE_STATUS_TONE as Record<string, BadgeTone>)[st] || 'gray');
  if (st === '즉시출고' || st === '출고가능') {
    return { icon: CircleCheck, tone, title: `${st} · 판매중` };
  }
  if (st === '상품화중') return { icon: Package, tone, title: '상품화중' };
  if (st === '출고협의') return { icon: Handshake, tone, title: '출고협의' };
  if (st === '계약중') return { icon: FileText, tone, title: '계약중' };
  if (st === '출고불가') return { icon: Ban, tone, title: '출고불가' };
  if (st === UNKNOWN_VEHICLE_STATUS) return { icon: FileX2, tone: 'red', title: st };
  if (p._needs_master_review) return { icon: ClipboardList, tone: 'amber', title: '검수 필요' };
  return { icon: Car, tone, title: st || '재고' };
}

/**
 * 문의 목록 2줄(카톡형)
 *   1 차량명 · 차번 · 상대방 / 시각 — 단계는 왼쪽 아이콘
 *   2 마지막 메시지 / 안읽음
 */
export const ChatRoomRow = memo(function ChatRoomRow({
  room, stageContract, counter, unread, selected, onClick, displayName, plate,
}: {
  room: EntityRecord;
  stageContract?: EntityRecord | null;
  counter: string;
  unread: number;
  selected?: boolean;
  onClick: (room: EntityRecord) => void; // 항목을 인자로 받는 안정 핸들러(부모 useCallback) — memo 유효화
  /** ①줄 주제 = 차량명. 차번·상대방은 같은 줄에 뮤트로 붙인다. */
  displayName?: string;
  /** 차량번호. 관리자 상담방은 빈 값 */
  plate?: string;
}) {
  const stage = contractStage(stageContract);
  const msg = listText(room.last_message) || '대화를 시작하세요';
  const ic = chatStatusIcon(stage, unread);
  const head = listText(displayName) || listText(room.vehicle_name) || '상품';
  const plateText = String(plate || '').trim();
  const counterText = String(counter || '').replace(/\s+/g, ' ').trim();
  const titleText = [head, plateText, counterText].filter(Boolean).join(' · ');
  return (
    <FeedListRow
      selected={selected}
      onClick={() => onClick(room)}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} decorative={stage.label !== '문의' || unread > 0} />}
      lines={[
        <FeedTitleRow
          key="t"
          title={<FeedTitle>{titleText}</FeedTitle>}
          meta={<span style={{ fontSize: FS.cap, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>{msgClock(room.last_message_at, { dateOnly: true })}</span>}
        />,
        <div key="m" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: '100%' }}>
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <FeedSub strong={unread > 0}>{msg}</FeedSub>
          </div>
          {unread > 0 ? <CountPill n={unread} title={`안읽음 ${unread}건`} /> : null}
        </div>,
      ]}
    />
  );
});

/**
 * 계약 목록 2줄
 *   1 차량명 · 진행 n/5 — 단계는 왼쪽 아이콘
 *   2 차번 · 계약코드 · 계약자 · 상대방 · 계약일
 */
export function ContractListRow({
  c, selected, onClick, displayName, plate, party = [],
}: {
  c: EntityRecord;
  selected?: boolean;
  onClick: () => void;
  displayName?: string;
  /** 계약 snapshot 우선, 없으면 연결 상품에서 복원한 차번. */
  plate?: string;
  party?: string[];
}) {
  const pr = getProgress(c);
  const title = listText(displayName) || contractVehicleLabel(c) || '차량명 미확인';
  const ic = contractStatusIcon(c);
  const stage = contractStage(c);
  const inProgress = isContractInProgress(c);
  // 철회·부결·알 수 없는 상태는 단계 진행률이 아니라 상태 확인이 우선이다.
  const showProgress = inProgress && stage.tone !== 'red';
  const contractCode = String(c.contract_code || '').trim();
  return (
    <FeedListRow
      selected={selected}
      onClick={onClick}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} decorative />}
      lines={[
        <FeedTitleRow
          key="t"
          title={<FeedTitle>{title}</FeedTitle>}
          meta={showProgress ? (
            <span style={{ fontSize: FS.sub, fontWeight: FW.head, color: stage.tone === 'amber' ? C.warn : C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{pr.done}/{pr.total}</span>
          ) : null}
        />,
        <FeedSub key="s">
          {dotJoin([
            plateSpan(String(plate || c.car_number_snapshot || '')),
            contractCode ? <span style={{ fontSize: FS.cap, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', color: C.mute, fontWeight: FW.strong }}>{contractCode}</span> : null,
            c.customer_name ? String(c.customer_name) : null,
            ...party,
            c.contract_date ? String(c.contract_date) : null,
          ]) || '—'}
        </FeedSub>,
      ]}
    />
  );
}

/**
 * 재고 목록 2줄
 *   1 차량명 — 출고상태는 왼쪽 아이콘
 *   2 상품유형 · 차번·스펙 · 공급사 (+검수·변환)
 */
export const InventoryListRow = memo(function InventoryListRow({
  p, selected, onClick,
}: {
  p: EntityRecord;
  selected?: boolean;
  onClick: (p: EntityRecord) => void; // 항목을 인자로 받는 안정 핸들러(부모 useCallback) — memo 유효화
}) {
  const pt = listText(p.product_type);
  const provider = listText(p.provider_name) || listText(p.provider_company_code);
  const ic = inventoryStatusIcon(p);
  const ptCanon = pt ? (canonProductType(pt) || pt) : '';
  const pts = ptCanon ? productTypeStyle(ptCanon) : null;
  return (
    <FeedListRow
      selected={selected}
      onClick={() => onClick(p)}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} decorative />}
      lines={[
        <FeedTitle key="t">{productVehicleLabel(p) || '차량명 미확인'}</FeedTitle>,
        <div key="s" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', width: '100%' }}>
          {pts ? <Badge tone={pts.tone} variant={pts.variant}>{ptCanon}</Badge> : null}
          <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
            <CardSpecs p={p} dense />
          </div>
          {provider ? (
            <span style={{
              flex: '0 1 auto', maxWidth: '28%', minWidth: 0,
              fontSize: FS.sub, color: C.mute, fontWeight: FW.meta,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{provider}</span>
          ) : <Badge tone="red">공급사 미지정</Badge>}
          {p._needs_master_review ? <Badge tone="amber" variant="solid">검수</Badge>
            : p._snapped ? <Badge tone="blue" variant="quiet">변환</Badge> : null}
        </div>,
      ]}
    />
  );
});

/** 재고 목록 맨 위 — 목록행과 동일 아이콘 슬롯(+), 옆에 상품등록 + 모바일 보조문구. */
export function InventoryCreateRow({ onClick }: { onClick: () => void }) {
  return (
    <CreateListRow
      label="상품등록"
      hint="여기를 눌러 신규 상품을 등록해주세요"
      ariaLabel="상품등록"
      onClick={onClick}
    />
  );
}

function memberStatus(row: EntityRecord, kind: 'user' | 'partner'): {
  icon: LucideIcon; tone: BadgeTone; title: string;
} {
  if (kind === 'partner') {
    const partnerType = partnerTypeLabel(row.partner_type, row.partner_code || row._key);
    return { icon: Building2, tone: partnerType === '공급사' ? 'blue' : partnerType === '분류 필요' ? 'red' : 'gray', title: partnerType };
  }
  const state = memberAccountState(row);
  if (state === 'pending') {
    return { icon: UserPlus, tone: 'amber', title: '가입 승인대기' };
  }
  if (state === 'inactive') {
    return { icon: UserRoundX, tone: 'gray', title: '비활성 계정' };
  }
  return { icon: UserRoundCheck, tone: 'green', title: '활성 계정' };
}

/** 회원·파트너 — 문의·계약·재고와 동일한 아이콘 + 2줄 목록 규격. */
export function MemberListRow({
  row, kind, selected, onClick,
}: {
  row: EntityRecord;
  kind: 'user' | 'partner';
  selected?: boolean;
  onClick?: () => void;
}) {
  const role = listText(row.role);
  const accountState = kind === 'user' ? memberAccountState(row) : null;
  const pending = accountState === 'pending';
  const inactive = accountState === 'inactive';
  const partnerType = partnerTypeLabel(row.partner_type, row.partner_code || row._key);
  const code = kind === 'user'
    ? (String(row.user_code || '').trim() || String(row.uid || '').trim())
    : String(row.partner_code || '').trim();
  const company = listText(row.company_name) || listText(row.company_code);
  const channel = listText(row.agent_channel_code);
  const ic = memberStatus(row, kind);
  const rate = kind === 'user'
    ? row.agent_payout_rate
    : row.fee_rate;
  const rateNumber = Number(rate);
  const rateLabel = rate != null && listText(rate) !== '' && Number.isFinite(rateNumber)
    ? `${Math.round(rateNumber * 100)}%`
    : '기본';

  return (
    <FeedListRow
      selected={selected}
      onClick={onClick}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} decorative />}
      lines={[
        <FeedTitle key="t">{listText(row.name) || code || (kind === 'user' ? '계정' : '회사')}</FeedTitle>,
        <div key="s" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', width: '100%' }}>
          {kind === 'user' ? (
            <>
              <Badge tone={ACTOR_TONE[role] || (role.startsWith('agent') ? 'blue' : 'gray')}>
                {MEMBER_ROLE_LABEL[role] || role || '역할 미지정'}
              </Badge>
              {pending ? <Badge tone="amber" variant="solid">승인대기</Badge>
                : inactive ? <Badge tone="gray" variant="quiet">비활성</Badge> : null}
            </>
          ) : (
            <>
              <Badge tone={partnerType === '공급사' ? 'blue' : partnerType === '분류 필요' ? 'red' : 'gray'}>{partnerType}</Badge>
              <Badge tone="gray" variant="quiet">수수료 {rateLabel}</Badge>
            </>
          )}
          <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
            <FeedSub>
              {dotJoin([
                code ? <span key="c" style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{code}</span> : null,
                kind === 'user' ? (company || channel) : null,
                String(row.phone || row.contact || '') || null,
                String(row.email || '') || null,
              ]) || ''}
            </FeedSub>
          </div>
        </div>,
      ]}
    />
  );
}

/** 정책 목록 맨 위 — 재고·회원과 같은 신규 등록 규격(헤더 버튼과 두 갈래로 두지 않는다). */
export function PolicyCreateRow({ onClick }: { onClick: () => void }) {
  return <CreateListRow label="정책 등록" hint="심사·계약조건·보험 조건을 등록합니다" ariaLabel="정책 등록" onClick={onClick} />;
}

/** 회원·파트너 목록 맨 위 — 재고의 상품등록 행과 같은 신규 등록 규격. */
export function MemberCreateRow({
  kind, onClick,
}: {
  kind: 'user' | 'partner';
  onClick: () => void;
}) {
  const label = kind === 'user' ? '계정 등록' : '회사 등록';
  const hint = kind === 'user'
    ? '로그인 계정과 역할을 등록합니다'
    : '공급사·영업채널(수수료·시트)을 등록합니다';
  return (
    <CreateListRow
      label={label}
      hint={hint}
      ariaLabel={label}
      onClick={onClick}
    />
  );
}

function CreateListRow({
  label, hint, ariaLabel, onClick,
}: {
  label: string;
  hint: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  const mobile = useIsMobile();
  const bodyH = FEED_LINE.title + FEED_LINE.sub + FEED_LINE.gap;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className="fp-card fp-card-row fp-press"
      onClick={() => { haptic.tap(); onClick(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          haptic.tap();
          onClick();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: mobile ? 10 : 11,
        padding: mobile ? '8px 12px' : '7px 12px',
        minHeight: (mobile ? 16 : 14) + bodyH,
        borderBottom: `1px solid ${C.line}`,
        boxSizing: 'border-box',
        cursor: 'pointer',
        color: 'inherit',
      }}
    >
      <FeedThumbIcon icon={Plus} tone="blue" title={ariaLabel} />
      <span style={{
        display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: '1 1 auto',
        overflow: 'hidden',
      }}>
        <span style={{
          fontSize: FS.title, fontWeight: FW.head, color: C.ink, letterSpacing: '-0.02em',
          lineHeight: 1, flex: '0 0 auto',
        }}>{label}</span>
        {/* 힌트는 웹에도 그린다. 높이(bodyH)는 이 줄을 포함해 잡히므로 모바일에만 그리면
            웹은 폭이 더 넓은데 정보는 적고, 안 그려지는 줄 높이만큼 빈 밴드가 남는다. */}
        <span style={{
          fontSize: FS.cap, fontWeight: FW.meta, color: C.mute, lineHeight: 1.2,
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{hint}</span>
      </span>
    </div>
  );
}

function settlementStatusIcon(display: SettlementListDisplay): { icon: LucideIcon; tone: BadgeTone; title: string } {
  if (display.status === '정산완료') return { icon: CircleCheck, tone: display.tone, title: display.status };
  if (display.status === '환수대기' || display.status === '환수결정') {
    return { icon: Ban, tone: display.tone, title: display.status };
  }
  if (display.status === '상태 확인') return { icon: FileX2, tone: 'red', title: display.status };
  return { icon: FileClock, tone: display.tone, title: display.status };
}

/** 월별 정산 목록 — 차량명·금액 / 상태경고·차번·날짜·관계자 2줄. */
export function SettlementListRow({
  settlement, display, selected, onClick,
}: {
  settlement: EntityRecord;
  display: SettlementListDisplay;
  selected?: boolean;
  onClick: () => void;
}) {
  const ic = settlementStatusIcon(display);
  const net = Number(settlement.net_amount) || 0;
  const netColor = C[settlementNetTone(settlement.net_amount)];
  const { invalidRent, unresolvedRate } = settlementWarning(settlement);
  const settlementCode = String(settlement.settlement_code || '').trim();
  return (
    <FeedListRow
      selected={selected}
      onClick={onClick}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} decorative />}
      lines={[
        <FeedTitleRow
          key="t"
          title={<FeedTitle>{display.vehicleName}</FeedTitle>}
          meta={<span style={{ fontSize: FS.sub, fontWeight: FW.head, color: netColor, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(net)}</span>}
        />,
        <div key="s" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', width: '100%' }}>
          {invalidRent ? <Badge tone="red" variant="solid">{SETTLEMENT_RENT_WARNING}</Badge> : null}
          {unresolvedRate ? <Badge tone="amber" variant="solid">{SETTLEMENT_RATE_WARNING}</Badge> : null}
          <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
            <FeedSub>
              {dotJoin([
                plateSpan(display.plate),
                display.contractDate ? <span key="d" style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.strong }}>{display.contractDate}</span> : null,
                display.customerName || null,
                display.providerName || null,
                display.agentName || null,
                settlementCode ? <span key="c" style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{settlementCode}</span> : null,
              ]) || '—'}
            </FeedSub>
          </div>
        </div>,
      ]}
    />
  );
}

/** 정책 — 전용/공용 아이콘 · 유형·소속 · 코드·심사 2줄 */
function policyStatusIcon(p: EntityRecord): { icon: LucideIcon; tone: BadgeTone; title: string } {
  if (!listText(p.policy_name)) {
    return { icon: FileX2, tone: 'red', title: '정책명 확인' };
  }
  const shared = !String(p.provider_company_code || '').trim();
  return { icon: ShieldCheck, tone: shared ? 'gray' : 'blue', title: shared ? '공용 정책' : '전용 정책' };
}

export function PolicyListRow({
  p, providerName: resolvedProviderName, selected, onClick,
}: {
  p: EntityRecord;
  providerName?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  const ic = policyStatusIcon(p);
  const ptype = listText(p.policy_type);
  const providerCode = listText(p.provider_company_code);
  const providerName = listText(resolvedProviderName) || listText(p.provider_name) || providerCode;
  const policyCode = String(p.policy_code || '').trim();
  const policyName = listText(p.policy_name);
  const missingName = !policyName;
  const screeningCriteria = String(p.screening_criteria || '').trim();
  const shared = !providerCode;
  return (
    <FeedListRow
      selected={selected}
      onClick={onClick}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} decorative />}
      lines={[
        <FeedTitle key="t">{policyName || '정책명 미지정'}</FeedTitle>,
        <div key="s" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', width: '100%' }}>
          {missingName ? <Badge tone="red" variant="solid">정보 확인</Badge> : null}
          {ptype ? <Badge tone="blue">{ptype}</Badge> : null}
          <Badge tone={shared ? 'gray' : 'blue'} variant="quiet">{shared ? '공용' : providerName}</Badge>
          <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
            <FeedSub>
              {dotJoin([
                policyCode ? <span key="c" style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{policyCode}</span> : null,
                screeningCriteria || null,
              ]) || ''}
            </FeedSub>
          </div>
        </div>,
      ]}
    />
  );
}
