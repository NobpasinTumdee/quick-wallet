/**
 * The month review's strings. The banner and the links live in en.ts / th.ts
 * (`review.title`, `review.banner…`, `review.pillLink…`); everything on the
 * page itself travels with the page's chunk and is added to i18next there
 * (registerReviewStrings), so nothing here costs the first paint.
 * types/i18next.d.ts adds reviewEn to the typed key space.
 */

import i18n from '../lib/i18n';

export const reviewEn = {
  pageHint: 'A look back at {{month}}',
  currentHint: '{{month}} isn’t over yet, so these are the figures so far.',
  futureHint: '{{month}} hasn’t started yet.',
  loadFailed: 'Couldn’t load this month’s review.',
  empty: 'Nothing was recorded in {{month}}.',
  saveNote: 'Save as note',
  savingNote: 'Saving…',
  savedNote: 'Saved to Notes. Add your own comments there.',
  saveFailed: 'Couldn’t save the note. Try again.',
  openNote: 'Open note',
  print: 'Print',

  highlights: 'Highlights',
  totals: 'Income and spending',
  income: 'Income',
  spent: 'Spent',
  saved: 'Saved',
  rate: 'Savings rate',
  noteAvg: '3-mo avg',
  avgCol: '{{count}}-month avg',
  noAvg: 'No earlier months to compare yet.',

  categories: 'Top categories',
  category: 'Category',
  vsMonth: 'vs {{month}}',
  catEmpty: 'No spending this month.',
  biggestUp: 'Biggest rise',
  biggestDown: 'Biggest drop',

  budgets: 'Budgets',
  budgetsHit: '{{hit}} of {{total}} on track',
  budgetsEmpty: 'No budgets were set for this month.',
  budgetOk: '{{spent}} of {{limit}}',
  budgetOver: '{{spent}} of {{limit}} (over {{over}})',
  onTrack: 'On track',
  over: 'Over',

  goals: 'Goals',
  goalsEmpty: 'No goals yet.',
  goalBought: 'bought {{date}} · {{amount}}',
  goalProgress: '{{percent}}% · {{saved}} of {{target}}',
  goalPace: '{{amount}} a month to arrive on time',
  goalOverdue: 'Past its date',
  goalNoDate: 'No date set',
  goalFunded: 'Fully saved',
  goalsNoHistory: 'Deposit history isn’t recorded, so this is today’s progress.',

  biggest: 'Biggest purchases',
  biggestEmpty: 'No purchases this month.',

  newRecurring: 'New recurring',
  recurringEmpty: 'No new recurring items.',
  recurringNoHistory: 'Changes to existing items aren’t recorded, so only new ones are listed.',
  freq_weekly: 'weekly',
  freq_monthly: 'monthly',
  freq_yearly: 'yearly',

  glanceTitle: 'At a glance',
  noSpendTitle: 'No-spend days',
  noSpendLine_one: '{{count}} (longest run {{run}})',
  noSpendLine_other: '{{count}} (longest run {{run}})',
  noSpendOutOf: 'of {{count}} days',
  longestRun_one: 'Longest run: {{count}} day',
  longestRun_other: 'Longest run: {{count}} days',

  leftTitle: 'Safe to spend at month end',
  leftHint: 'Cash minus card debt on the last day',
  leftUnknown: 'Not available for this month',
  leftNotYet: 'Shown once the month is over',

  myNotes: 'My notes',
  noteTitle: '{{month}} review',

  hlSaved: 'You saved {{rate}} of your income.',
  hlSavedUp: 'You saved {{rate}} of your income, up from {{previous}} in {{month}}.',
  hlSavedDown: 'You saved {{rate}} of your income, down from {{previous}} in {{month}}.',
  hlSavedSame: 'You saved {{rate}} of your income, about the same as {{month}}.',
  hlNoIncome: 'No income was recorded this month.',
  hlSpendBelowAvg: 'You spent {{amount}}, {{pct}}% less than your recent average.',
  hlSpendAboveAvg: 'You spent {{amount}}, {{pct}}% more than your recent average.',
  hlSpendAboutAvg: 'You spent {{amount}}, about your recent average.',
  hlCategoryUp: '{{category}} was your biggest change: +{{amount}}{{pct}}.',
  hlCategoryDown: '{{category}} fell the most: −{{amount}}{{pct}}.',
  hlBudgetsAll: 'All {{total}} budgets stayed on track.',
  hlBudgetsSome: '{{hit}} of {{total}} budgets stayed on track.',
  hlGoalsBought_one: 'You reached {{count}} goal and bought it.',
  hlGoalsBought_other: 'You reached {{count}} goals and bought them.',
  hlNoSpendDays_one: '{{count}} no-spend day (longest run {{run}}).',
  hlNoSpendDays_other: '{{count}} no-spend days (longest run {{run}}).',
};

export const reviewTh: Record<keyof typeof reviewEn, string> = {
  pageHint: 'ย้อนดู{{month}}',
  currentHint: '{{month}}ยังไม่จบ ตัวเลขนี้เป็นยอดถึงวันนี้',
  futureHint: '{{month}}ยังไม่เริ่ม',
  loadFailed: 'โหลดสรุปเดือนนี้ไม่ได้',
  empty: 'ไม่มีรายการใน{{month}}',
  saveNote: 'บันทึกเป็นโน้ต',
  savingNote: 'กำลังบันทึก…',
  savedNote: 'บันทึกลงโน้ตแล้ว เพิ่มความเห็นของคุณได้ที่นั่น',
  saveFailed: 'บันทึกโน้ตไม่ได้ ลองอีกครั้ง',
  openNote: 'เปิดโน้ต',
  print: 'พิมพ์',

  highlights: 'ไฮไลต์',
  totals: 'รายรับและรายจ่าย',
  income: 'รายรับ',
  spent: 'ใช้ไป',
  saved: 'เก็บได้',
  rate: 'อัตราการออม',
  noteAvg: 'เฉลี่ย 3 เดือน',
  avgCol: 'เฉลี่ย {{count}} เดือน',
  noAvg: 'ยังไม่มีเดือนก่อนหน้าให้เทียบ',

  categories: 'หมวดที่ใช้มากที่สุด',
  category: 'หมวด',
  vsMonth: 'เทียบ{{month}}',
  catEmpty: 'เดือนนี้ไม่มีรายจ่าย',
  biggestUp: 'เพิ่มขึ้นมากที่สุด',
  biggestDown: 'ลดลงมากที่สุด',

  budgets: 'งบประมาณ',
  budgetsHit: 'อยู่ในงบ {{hit}} จาก {{total}}',
  budgetsEmpty: 'เดือนนี้ไม่ได้ตั้งงบไว้',
  budgetOk: '{{spent}} จาก {{limit}}',
  budgetOver: '{{spent}} จาก {{limit}} (เกิน {{over}})',
  onTrack: 'อยู่ในงบ',
  over: 'เกินงบ',

  goals: 'เป้าหมาย',
  goalsEmpty: 'ยังไม่มีเป้าหมาย',
  goalBought: 'ซื้อแล้ว {{date}} · {{amount}}',
  goalProgress: '{{percent}}% · {{saved}} จาก {{target}}',
  goalPace: 'เดือนละ {{amount}} เพื่อให้ทันกำหนด',
  goalOverdue: 'เลยกำหนดแล้ว',
  goalNoDate: 'ไม่ได้ตั้งวันที่',
  goalFunded: 'เก็บครบแล้ว',
  goalsNoHistory: 'ไม่มีประวัติการฝากเงิน จึงแสดงความคืบหน้า ณ วันนี้',

  biggest: 'รายการซื้อที่ใหญ่ที่สุด',
  biggestEmpty: 'เดือนนี้ไม่มีรายการซื้อ',

  newRecurring: 'รายการประจำที่เพิ่มใหม่',
  recurringEmpty: 'ไม่มีรายการประจำใหม่',
  recurringNoHistory: 'ไม่มีประวัติการแก้ไขรายการเดิม จึงแสดงเฉพาะรายการใหม่',
  freq_weekly: 'รายสัปดาห์',
  freq_monthly: 'รายเดือน',
  freq_yearly: 'รายปี',

  glanceTitle: 'สรุปสั้น ๆ',
  noSpendTitle: 'วันที่ไม่ได้ใช้เงิน',
  noSpendLine_one: '{{count}} วัน (ติดกันนานสุด {{run}} วัน)',
  noSpendLine_other: '{{count}} วัน (ติดกันนานสุด {{run}} วัน)',
  noSpendOutOf: 'จาก {{count}} วัน',
  longestRun_one: 'ติดกันนานสุด {{count}} วัน',
  longestRun_other: 'ติดกันนานสุด {{count}} วัน',

  leftTitle: 'ใช้ได้อีก ณ สิ้นเดือน',
  leftHint: 'เงินสดหักหนี้บัตร ณ วันสุดท้าย',
  leftUnknown: 'ไม่มีข้อมูลของเดือนนี้',
  leftNotYet: 'แสดงเมื่อจบเดือน',

  myNotes: 'บันทึกของฉัน',
  noteTitle: 'สรุป{{month}}',

  hlSaved: 'คุณเก็บได้ {{rate}} ของรายรับ',
  hlSavedUp: 'คุณเก็บได้ {{rate}} ของรายรับ เพิ่มจาก {{previous}} ใน{{month}}',
  hlSavedDown: 'คุณเก็บได้ {{rate}} ของรายรับ ลดจาก {{previous}} ใน{{month}}',
  hlSavedSame: 'คุณเก็บได้ {{rate}} ของรายรับ ใกล้เคียงกับ{{month}}',
  hlNoIncome: 'เดือนนี้ไม่มีรายรับที่บันทึกไว้',
  hlSpendBelowAvg: 'คุณใช้ไป {{amount}} น้อยกว่าค่าเฉลี่ยช่วงหลัง {{pct}}%',
  hlSpendAboveAvg: 'คุณใช้ไป {{amount}} มากกว่าค่าเฉลี่ยช่วงหลัง {{pct}}%',
  hlSpendAboutAvg: 'คุณใช้ไป {{amount}} ใกล้เคียงค่าเฉลี่ยช่วงหลัง',
  hlCategoryUp: '{{category}} เปลี่ยนมากที่สุด: +{{amount}}{{pct}}',
  hlCategoryDown: '{{category}} ลดลงมากที่สุด: −{{amount}}{{pct}}',
  hlBudgetsAll: 'อยู่ในงบครบทั้ง {{total}} รายการ',
  hlBudgetsSome: 'อยู่ในงบ {{hit}} จาก {{total}} รายการ',
  hlGoalsBought_one: 'คุณทำเป้าหมายสำเร็จและซื้อแล้ว {{count}} รายการ',
  hlGoalsBought_other: 'คุณทำเป้าหมายสำเร็จและซื้อแล้ว {{count}} รายการ',
  hlNoSpendDays_one: 'ไม่ได้ใช้เงิน {{count}} วัน (ติดกันนานสุด {{run}} วัน)',
  hlNoSpendDays_other: 'ไม่ได้ใช้เงิน {{count}} วัน (ติดกันนานสุด {{run}} วัน)',
};

/** Adds the page's strings to i18next (merged into `review`, beside the banner's). */
export function registerReviewStrings(): void {
  for (const [language, strings] of [['en', reviewEn], ['th', reviewTh]] as const) {
    i18n.addResourceBundle(language, 'translation', { review: strings }, true, false);
  }
}
