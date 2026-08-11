import { excelFitPlan } from '../components/ui/table';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
};

const common = { months: [1, 12, 24, 36, 48, 60], hasOpts: true };
const filterWide = excelFitPlan({ ...common, availPx: 1350, mode: 'filter' });
const filterPanel = excelFitPlan({ ...common, availPx: 1100, mode: 'filter' });
const full = excelFitPlan({ ...common, availPx: 1500, mode: 'full' });

check('필터 열림 넓은 표에 공급사 표시', filterWide.show.has('provider_name'));
check('필터 패널로 폭이 줄어도 공급사 표시', filterPanel.show.has('provider_name'));
check('필터 닫힘 표에도 공급사 표시', full.show.has('provider_name'));

if (failed) process.exit(1);
