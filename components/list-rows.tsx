'use client';
import { memo } from 'react';
import type { ReactNode } from 'react';
import {
  MessageCircleMore, MessageCircle, MessageCircleWarning,
  FileText, FileClock, FileCheck2, FileX2, ClipboardList,
  CircleCheck, Package, Handshake, Ban, Car, ShieldCheck, Plus,
  Building2, UserPlus, UserRoundCheck, UserRoundX,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROLE_LABEL_RAW, type EntityRecord } from '@/lib/intake/entities';
import { contractStage, getProgress, contractTone } from '@/lib/domain/contract';
import { vehicleName, canonProductType } from '@/lib/domain/product';
import {
  ACTOR_TONE, Badge, CountPill, NUM, C, FS, FW, productTypeStyle, VEHICLE_STATUS_TONE,
  type BadgeTone,
} from '@/components/ui';
import {
  FeedListRow, FeedThumbIcon, FeedTitle, FeedSub, FeedBadges, FeedTitleRow,
} from '@/components/ui/feedrow';
import { useIsMobile } from '@/lib/use-mobile';
import { CardSpecs } from '@/components/product-card-atoms';
import { vehicleTone } from '@/lib/domain/product';
import { msgClock } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { partnerTypeLabel } from '@/lib/domain/partner';

const MEMBER_ROLE_LABEL: Record<string, string> = ROLE_LABEL_RAW;

function plateSpan(plate: string) {
  if (!plate) return null;
  return (
    <span style={{ fontFamily: NUM, fontWeight: FW.strong, fontSize: FS.sub, color: C.mute }}>{plate}</span>
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

/** 재고 — 아이콘 모양만 로컬. 색 = VEHICLE_STATUS_TONE SSOT. */
function inventoryStatusIcon(p: EntityRecord): { icon: LucideIcon; tone: BadgeTone; title: string } {
  const st = String(p.vehicle_status || '');
  const key = st.replace(/\s+/g, '');
  const tone = ((VEHICLE_STATUS_TONE as Record<string, BadgeTone>)[key] || 'gray');
  if (st === '즉시출고' || st === '출고가능') {
    return { icon: CircleCheck, tone, title: `${st} · 판매중` };
  }
  if (st === '상품화중') return { icon: Package, tone, title: '상품화중' };
  if (st === '출고협의') return { icon: Handshake, tone, title: '출고협의' };
  if (st === '계약중') return { icon: FileText, tone, title: '계약중' };
  if (st === '출고불가') return { icon: Ban, tone, title: '출고불가' };
  if (p._needs_master_review) return { icon: ClipboardList, tone: 'amber', title: '검수 필요' };
  return { icon: Car, tone, title: st || '재고' };
}

/**
 * 문의 목록 3줄
 *   1 차명 · 시간
 *   2 상담뱃지 · 차번 · 상대
 *   3 마지막 메시지 (+안읽음)
 * 좌측 = 상태 아이콘(색)
 */
/**
 * 문의 목록 3줄
 *   1 영업·공급=차명 / 관리자=차량번호·공급사명 · 날짜
 *   2 상태뱃지 · (비관리자)차번 · 상대코드
 *   3 마지막 메시지 · 안읽음
 */
export const ChatRoomRow = memo(function ChatRoomRow({
  room, stageContract, counter, unread, selected, onClick, displayName, providerSuffix,
}: {
  room: EntityRecord;
  stageContract?: EntityRecord | null;
  counter: string;
  unread: number;
  selected?: boolean;
  onClick: (room: EntityRecord) => void; // 항목을 인자로 받는 안정 핸들러(부모 useCallback) — memo 유효화
  displayName?: string;
  /** 관리자만 — 차량번호 뒤 공급사(번호 말줄임, 공급사는 유지) */
  providerSuffix?: string;
}) {
  const stage = contractStage(stageContract);
  const msg = String(room.last_message || '대화를 시작하세요').replace(/\s+/g, ' ').trim();
  const ic = chatStatusIcon(stage, unread);
  const inProg = !!stageContract && !['상담', '계약완료', '취소'].includes(stage.label);
  const accent: BadgeTone | undefined = unread > 0 ? 'amber' : inProg ? 'blue' : undefined;
  const head = displayName || String(room.vehicle_name || '상품');
  const titleNode = providerSuffix ? (
    <div style={{ display: 'flex', alignItems: 'baseline', minWidth: 0, width: '100%', gap: 0 }}>
      <div style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}>
        <FeedTitle mono>{head}</FeedTitle>
      </div>
      <span style={{
        flex: '0 0 auto', maxWidth: '46%',
        fontSize: FS.sub, fontWeight: FW.strong, color: C.mute,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        marginLeft: 4,
      }}>· {providerSuffix}</span>
    </div>
  ) : (
    <FeedTitle>{head}</FeedTitle>
  );
  return (
    <FeedListRow
      accent={accent}
      selected={selected}
      onClick={() => onClick(room)}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} />}
      lines={[
        <FeedTitleRow
          key="t"
          title={titleNode}
          meta={<span style={{ fontSize: FS.cap, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{msgClock(room.last_message_at, { dateOnly: true })}</span>}
        />,
        <FeedBadges key="b">
          <Badge tone={stage.tone}>{stage.label}</Badge>
          {!providerSuffix ? plateSpan(String(room.car_number || '')) : null}
          {counter ? <span style={{ fontSize: FS.sub, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{counter}</span> : null}
        </FeedBadges>,
        <div key="m" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: '100%' }}>
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <FeedSub strong={unread > 0}>{msg}</FeedSub>
          </div>
          {unread > 0 ? <CountPill n={unread} /> : null}
        </div>,
      ]}
    />
  );
});

/**
 * 계약 목록 3줄
 *   1 차종/계약자 · 진행 n/5
 *   2 상태뱃지 · 차번 · 계약코드
 *   3 계약자 · 계약일
 * 좌측 = 상태 아이콘(색) — 문의·재고와 동일 규격(액센트 바 없음)
 */
export function ContractListRow({
  c, selected, onClick,
}: {
  c: EntityRecord;
  selected?: boolean;
  onClick: () => void;
}) {
  const pr = getProgress(c);
  const carName = [c.maker_snapshot, c.sub_model_snapshot].filter(Boolean).join(' ').trim();
  const title = carName || String(c.vehicle_name || c.customer_name || c.contract_code || '계약');
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
            <span style={{ fontSize: FS.sub, fontWeight: FW.head, color: C.brand, fontFamily: NUM }}>{pr.done}/{pr.total}</span>
          ) : null}
        />,
        <FeedBadges key="b">
          <Badge tone={contractTone(String(c.contract_status))}>{String(c.contract_status || '—')}</Badge>
          {plateSpan(String(c.car_number_snapshot || ''))}
          <span style={{ fontSize: FS.cap, fontFamily: NUM, color: C.faint, fontWeight: FW.strong }}>{String(c.contract_code || '')}</span>
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
export const InventoryListRow = memo(function InventoryListRow({
  p, selected, onClick,
}: {
  p: EntityRecord;
  selected?: boolean;
  onClick: (p: EntityRecord) => void; // 항목을 인자로 받는 안정 핸들러(부모 useCallback) — memo 유효화
}) {
  const st = String(p.vehicle_status || '');
  const pt = String(p.product_type || '');
  const provider = String(p.provider_name || p.provider_company_code || '').trim();
  const ic = inventoryStatusIcon(p);
  return (
    <FeedListRow
      selected={selected}
      onClick={() => onClick(p)}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} />}
      lines={[
        <FeedTitle key="t">{vehicleName(p) || String(p.car_number || '상품')}</FeedTitle>,
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
                fontSize: FS.sub, color: C.faint, fontWeight: FW.meta,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{provider}</span>
            </>
          ) : null}
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
    return { icon: Building2, tone: partnerType === '공급사' ? 'blue' : 'gray', title: partnerType };
  }
  if (String(row.status || '') === 'pending') {
    return { icon: UserPlus, tone: 'amber', title: '가입 승인대기' };
  }
  if (String(row.is_active || '') === '아니오') {
    return { icon: UserRoundX, tone: 'gray', title: '비활성 사용자' };
  }
  return { icon: UserRoundCheck, tone: 'green', title: '활성 사용자' };
}

/** 회원·파트너 — 재고·문의·계약과 동일한 아이콘 + 3줄 목록 규격. */
export function MemberListRow({
  row, kind, selected, onClick,
}: {
  row: EntityRecord;
  kind: 'user' | 'partner';
  selected?: boolean;
  onClick?: () => void;
}) {
  const role = String(row.role || '');
  const pending = kind === 'user' && String(row.status || '') === 'pending';
  const inactive = kind === 'user' && String(row.is_active || '') === '아니오';
  const partnerType = partnerTypeLabel(row.partner_type, row.partner_code || row._key);
  const code = kind === 'user'
    ? String(row.user_code || row.uid || '')
    : String(row.partner_code || '');
  const company = String(row.company_name || row.company_code || '').trim();
  const ic = memberStatus(row, kind);
  const rate = kind === 'user'
    ? row.agent_payout_rate
    : row.fee_rate;
  const rateNumber = Number(rate);
  const rateLabel = rate != null && rate !== '' && Number.isFinite(rateNumber)
    ? `${Math.round(rateNumber * 100)}%`
    : '기본';

  return (
    <FeedListRow
      selected={selected}
      onClick={onClick}
      thumb={<FeedThumbIcon icon={ic.icon} tone={ic.tone} title={ic.title} />}
      lines={[
        <FeedTitle key="t">{String(row.name || code || (kind === 'user' ? '사용자' : '파트너'))}</FeedTitle>,
        <FeedBadges key="b">
          {kind === 'user' ? (
            <>
              <Badge tone={ACTOR_TONE[role] || (role.startsWith('agent') ? 'blue' : 'gray')}>
                {MEMBER_ROLE_LABEL[role] || role || '역할 미지정'}
              </Badge>
              {pending ? <Badge tone="amber" variant="solid">승인대기</Badge>
                : <Badge tone={inactive ? 'gray' : 'green'} variant="quiet">{inactive ? '비활성' : '활성'}</Badge>}
            </>
          ) : (
            <>
              <Badge tone={partnerType === '공급사' ? 'blue' : 'gray'}>{partnerType}</Badge>
              <Badge tone="gray" variant="quiet">수수료 {rateLabel}</Badge>
            </>
          )}
        </FeedBadges>,
        <FeedSub key="s">
          {dotJoin([
            code ? <span key="c" style={{ fontFamily: NUM }}>{code}</span> : null,
            kind === 'user'
              ? (company || String(row.agent_channel_code || ''))
              : String(row.contact || ''),
          ]) || '—'}
        </FeedSub>,
      ]}
    />
  );
}

/** 회원·파트너 목록 맨 위 — 재고의 상품등록 행과 같은 신규 등록 규격. */
export function MemberCreateRow({
  kind, onClick,
}: {
  kind: 'user' | 'partner';
  onClick: () => void;
}) {
  const label = kind === 'user' ? '사용자 등록' : '파트너 등록';
  const hint = kind === 'user'
    ? '새 사용자와 권한을 등록합니다'
    : '새 공급사 또는 영업채널을 등록합니다';
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
  const bodyH = 18 + 20 + 15 + 6;
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
        padding: mobile ? '8px 14px' : '7px 14px',
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
        {mobile && (
          <span style={{
            fontSize: FS.cap, fontWeight: FW.meta, color: C.faint, lineHeight: 1.2,
            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{hint}</span>
        )}
      </span>
    </div>
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
