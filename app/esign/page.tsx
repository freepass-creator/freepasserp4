'use client';

/**
 * 전자계약 발송센터.
 * 영업자·관리자는 계약 초안과 고객 링크를 만들고, 최종 본인확인·승인은 관리자만 처리한다.
 */
import { EsignSendCenter } from '@/components/EsignSendCenter';

export default function EsignPage() {
  return <EsignSendCenter />;
}
