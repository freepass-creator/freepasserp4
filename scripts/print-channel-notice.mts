/**
 * **카톡방에 붙일 영업 공지를 찍는다.**
 *
 * ★사장님 2026-09-03 「시트는 대표한테만 줄거고 영업사원들은 그냥 공지사항으로」.
 *   ⇒ 대표는 시트(공지사항·영업안내·수수료·월별 정산), 영업사원은 «이 글».
 *
 * ★★시트와 카톡이 «같은 정본»(`lib/domain/channel-guide`)에서 나온다.
 *   따로 적으면 절차가 바뀔 때 한쪽만 고쳐져 방마다 옛 판이 남는다.
 * ★수수료는 안 들어간다 — 요율은 대표와 우리 사이의 값이다.
 *
 *   npx tsx scripts/print-channel-notice.mts
 */
import { channelNoticeText } from '../lib/domain/channel-guide';
console.log(channelNoticeText());
