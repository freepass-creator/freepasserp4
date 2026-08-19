'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { ClipboardCheck, Gauge, LayoutDashboard, WalletCards } from 'lucide-react';
import { useAuthReady, useSession } from '@/lib/auth-context';
import { canAccessOwnedRecord, organizationRole } from '@/lib/domain/authorization';
import type { EntityRecord } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { FS, FW, ICON, NUM } from '@/components/ui';
import styles from '../workspace.module.css';

type Section = 'contracts' | 'settlements' | 'inventory';
const text = (value: unknown, fallback = '—') => String(value || '').trim() || fallback;
const money = (value: unknown) => `${(Number(value) || 0).toLocaleString('ko-KR')}원`;

const sectionMeta: Record<Section, { title: string; eyebrow: string; entity: 'contract' | 'settlement' }> = {
  contracts: { title: '계약진행', eyebrow: 'CONTRACTS', entity: 'contract' },
  settlements: { title: '정산확인', eyebrow: 'SETTLEMENTS', entity: 'settlement' },
  inventory: { title: '재고관리', eyebrow: 'INVENTORY', entity: 'contract' },
};

function NavItem({ href, active, icon, children }: { href: string; active?: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return <a href={href} className={`${styles.navItem} ${active ? styles.navActive : ''}`}>{icon}<span>{children}</span></a>;
}

export default function Erp5SectionPage() {
  const params = useParams<{ section: string }>();
  const section = (['contracts', 'settlements', 'inventory'].includes(params.section) ? params.section : 'contracts') as Section;
  const meta = sectionMeta[section];
  const companyId = getCompanyId();
  const authReady = useAuthReady();
  const session = useSession();
  const role = organizationRole(session);
  const isProvider = role === 'admin' || role?.startsWith('provider');
  const [rows, setRows] = useState<EntityRecord[] | null>(null);

  useEffect(() => {
    if (!authReady || section === 'inventory') return;
    let active = true;
    getStore().list(meta.entity, companyId).catch(() => []).then((result) => {
      if (active) setRows(result.filter((row) => canAccessOwnedRecord(session, row)));
    });
    return () => { active = false; };
  }, [authReady, companyId, meta.entity, section, session]);

  const sorted = useMemo(() => [...(rows || [])].sort((a, b) => String(b.updated_at || b.contract_date || '').localeCompare(String(a.updated_at || a.contract_date || ''))), [rows]);
  const rootStyle = {
    '--e5-fs-page': `${FS.page}px`, '--e5-fs-title': `${FS.title}px`, '--e5-fs-body': `${FS.body}px`,
    '--e5-fs-sub': `${FS.sub}px`, '--e5-fs-cap': `${FS.cap}px`, '--e5-fw-head': FW.head,
    '--e5-fw-title': FW.title, '--e5-fw-strong': FW.strong, '--e5-num': NUM,
  } as CSSProperties;

  return <div className={styles.workspace} style={rootStyle}>
    <aside className={styles.sidebar}>
      <a href="/erp5" className={styles.brand}><span className={styles.brandMark}>T5</span><span><strong>TRIPASS</strong><small>ERP WORKSPACE</small></span></a>
      <nav className={`${styles.nav} ${isProvider ? styles.navWithInventory : styles.navSales}`} aria-label="ERP5 주요 메뉴">
        <span className={styles.navLabel}>업무 메뉴</span>
        <NavItem href="/erp5" icon={<LayoutDashboard size={ICON.md} />}>상품찾기</NavItem>
        <NavItem href="/erp5/contracts" active={section === 'contracts'} icon={<ClipboardCheck size={ICON.md} />}>계약진행</NavItem>
        <NavItem href="/erp5/settlements" active={section === 'settlements'} icon={<WalletCards size={ICON.md} />}>정산확인</NavItem>
        {isProvider ? <NavItem href="/erp5/inventory" active={section === 'inventory'} icon={<Gauge size={ICON.md} />}>재고관리</NavItem> : null}
      </nav>
      <div className={styles.sidebarFoot}><span className={styles.userAvatar}>{text(session?.name, '사').slice(0, 1)}</span><span><strong>{text(session?.name, '사용자')}</strong><small>{isProvider ? '관리 워크스페이스' : '영업 워크스페이스'}</small></span></div>
    </aside>
    <main className={styles.main}>
      <header className={styles.topbar}><div><span className={styles.eyebrow}>{meta.eyebrow}</span><h1>{meta.title}</h1></div></header>
      <div className={styles.content}>
        {section === 'inventory' ? (
          isProvider ? <section className={styles.sectionPageCard}><div><span className={styles.live}><i /> 공급사 시트 연동</span><h2>재고 등록과 상태 변경</h2><p>공급사 재고를 등록하고 출고 상태를 관리합니다.</p></div><a href="/inventory">재고관리 열기</a></section>
            : <section className={styles.sectionPageCard}><h2>접근할 수 없습니다</h2><p>재고관리는 관리자와 공급사만 사용할 수 있습니다.</p></section>
        ) : <section className={styles.sectionTable}>
          <div className={styles.sectionTableHead}><div><span className={styles.eyebrow}>{meta.eyebrow}</span><h2>{meta.title} <b>{sorted.length.toLocaleString('ko-KR')}</b></h2></div>{section === 'contracts' ? <a href="/erp5/esign">새 계약서</a> : null}</div>
          {rows == null ? <div className={styles.empty}>자료를 불러오는 중입니다.</div> : sorted.length ? sorted.map((row, index) => {
            const recordKey = String(section === 'contracts'
              ? row.contract_code || row._key || ''
              : row.settlement_code || row._key || '');
            const detailHref = section === 'contracts'
              ? `/contract?c=${encodeURIComponent(recordKey)}`
              : `/settlement?s=${encodeURIComponent(recordKey)}`;
            return <a href={detailHref} className={styles.sectionDataRow} key={recordKey || String(index)}>
            <span><strong>{text(row.vehicle_name_snapshot || row.car_number_snapshot, section === 'contracts' ? '차량 미지정' : '정산 항목')}</strong><small>{text(row.customer_name || row.agent_name, '담당자 미입력')}</small></span>
            <span><small>{section === 'contracts' ? '진행상태' : '정산상태'}</small><strong>{text(section === 'contracts' ? row.contract_status : row.settlement_status, '대기')}</strong></span>
            <span><small>{section === 'contracts' ? '계약일' : '정산금액'}</small><strong>{section === 'contracts' ? text(row.contract_date, '미입력') : money(row.agent_payout)}</strong></span>
          </a>}) : <div className={styles.empty}>표시할 자료가 없습니다.</div>}
        </section>}
      </div>
    </main>
  </div>;
}
