'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Send } from 'lucide-react';
import { useAuthReady, useSession } from '@/lib/auth-context';
import { getCompanyId } from '@/lib/tenant';
import { useFinderData } from '@/features/finder/useFinderData';
import { finderDataScope } from '@/features/finder/finder-data-store';
import { cheapest, priceList, vehicleName } from '@/lib/domain/product';
import { Btn, ICON } from '@/components/ui';
import styles from './workspace.module.css';

const won = (value: unknown) => `${(Number(value) || 0).toLocaleString('ko-KR')}원`;
const mileage = (value: unknown) => {
  const raw = String(value || '').trim();
  const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
  return raw && Number.isFinite(parsed) ? `${parsed.toLocaleString('ko-KR')}km` : raw || '—';
};

export function SelectionReview({ mode }: { mode: 'compare' | 'proposal' }) {
  const authReady = useAuthReady();
  const session = useSession();
  const { rows } = useFinderData({ companyId: getCompanyId(), authReady, sessionUid: session?.uid, sessionScope: finderDataScope(session) });
  const [codes, setCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCodes((new URLSearchParams(window.location.search).get('products') || '').split(',').filter(Boolean).slice(0, 5));
  }, []);

  const products = useMemo(
    () => codes.map((code) => (rows || []).find((row) => String(row.product_code || row._key || '') === code)).filter(Boolean),
    [codes, rows],
  );
  const shareText = products.map((product, index) => {
    if (!product) return '';
    const price = cheapest(product);
    return `${index + 1}. ${vehicleName(product)}${price ? ` · ${price.m}개월 월 ${won(price.rent)} · 보증금 ${won(price.deposit)}` : ''}`;
  }).join('\n');

  const share = async () => {
    if (navigator.share) await navigator.share({ title: '트리패스 추천 차량', text: shareText });
    else {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
    }
  };

  return <main className={styles.selectionReviewPage}>
    <header><a href="/erp5"><ArrowLeft size={ICON.md} /> 상품찾기</a><div><span>{mode === 'compare' ? 'COMPARE' : 'SHARE'}</span><h1>{mode === 'compare' ? '선택 차량 비교' : '고객 전달 내용'}</h1></div>{mode === 'proposal' ? <Btn onClick={() => void share()}>{copied ? <Check size={ICON.sm} /> : <Send size={ICON.sm} />}{copied ? '복사됨' : '공유하기'}</Btn> : null}</header>
    <section>
      <div className={styles.reviewGrid}>{products.map((product) => product ? <article key={String(product.product_code || product._key)}>
        <span>{String(product.vehicle_status || '출고협의')}</span><h2>{vehicleName(product)}</h2><p>{String(product.car_number || '번호 미정')} · {String(product.provider_name || product.provider_company_code || '')}</p>
        <dl><div><dt>연식·주행</dt><dd>{String(product.year || '—')} · {mileage(product.mileage)}</dd></div><div><dt>파워트레인</dt><dd>{String(product.variant || product.fuel_type || '—')}</dd></div><div><dt>세부트림</dt><dd>{String(product.trim_name || '—')}</dd></div></dl>
        <div className={styles.reviewPrices}>{priceList(product).sort((a, b) => a.m - b.m).map((price) => <div key={price.m}><b>{price.m}개월</b><strong>{won(price.rent)}</strong><small>보증금 {won(price.deposit)}</small></div>)}</div>
        <a href={`/erp5/esign?product=${encodeURIComponent(String(product.product_code || product._key))}`}>이 차량으로 계약</a>
      </article> : null)}</div>
      {mode === 'proposal' ? <div className={styles.sharePreview}><h2>전달 문구 미리보기</h2><pre>{shareText}</pre><Btn variant="bare" onClick={() => void navigator.clipboard.writeText(shareText).then(() => setCopied(true))}><Copy size={ICON.sm} /> 문구 복사</Btn></div> : null}
    </section>
  </main>;
}
