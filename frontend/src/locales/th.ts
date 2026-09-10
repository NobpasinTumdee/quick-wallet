/**
 * Thai.
 *
 * Typed as `TranslationSchema`, so leaving a key out is a compile error rather
 * than an English word appearing mid-sentence in production.
 *
 * ---------------------------------------------------------------------------
 * ON THE WORD CHOICES
 * ---------------------------------------------------------------------------
 * These follow the vocabulary Thai banking apps actually use, not the literal
 * dictionary translation:
 *
 *   - "ภาพรวม" (overview) for the dashboard, not "แดชบอร์ด" — the transliteration
 *     is common in enterprise software and reads as jargon in a consumer app.
 *   - "การลงทุน" for investing; "พอร์ต" (portfolio) was the alternative but is
 *     narrower — it names the holdings, not the activity.
 *   - "รายการ" (items/entries) for Activity. The literal "กิจกรรม" means activity
 *     in the social sense and is wrong for a ledger.
 *   - "รายจ่ายประจำ" (regular outgoings) for Recurring, which is what the screen
 *     is actually about, rather than "การสมัครสมาชิก" (subscriptions/membership).
 *   - "บัตรเครดิต" is kept in full rather than shortened to "บัตร"; a bare "card"
 *     is ambiguous between a debit and a credit card in Thai as in English.
 *
 * Thai does not use spaces between words, and has no plural inflection — so no
 * `_plural` variants are needed here, unlike the English side would be if these
 * strings ever took counts.
 */

import type { TranslationSchema } from './en';

export const th: TranslationSchema = {
  nav: {
    dashboard: 'ภาพรวม',
    wallets: 'กระเป๋าเงิน',
    cards: 'บัตรเครดิต',
    transactions: 'รายการ',
    investments: 'การลงทุน',
    budgets: 'งบประมาณ',
    subscriptions: 'รายจ่ายประจำ',
    settings: 'ตั้งค่า',
    more: 'เมนูเพิ่มเติม',
    moreCurrent: 'เมนูเพิ่มเติม — เปิด{{label}}อยู่',
    signOut: 'ออกจากระบบ',
    signedInAs: 'เข้าสู่ระบบในชื่อ',
    mainNavigation: 'เมนูหลัก',
    collapseSidebar: 'ย่อแถบเมนู',
    expandSidebar: 'ขยายแถบเมนู',
    collapse: 'ย่อ',
  },

  common: {
    save: 'บันทึก',
    saveChanges: 'บันทึกการแก้ไข',
    cancel: 'ยกเลิก',
    confirm: 'ยืนยัน',
    close: 'ปิด',
    delete: 'ลบ',
    edit: 'แก้ไข',
    add: 'เพิ่ม',
    create: 'สร้าง',
    archive: 'เก็บเข้าคลัง',
    restore: 'กู้คืน',
    dismiss: 'ปิด',
    refresh: 'รีเฟรช',
    refreshPage: 'รีเฟรชหน้านี้',
    tryAgain: 'ลองอีกครั้ง',
    saved: 'บันทึกแล้ว',
    loading: 'กำลังโหลด…',
    optional: 'ไม่บังคับ',
    none: 'ไม่มี',
    notSet: 'ยังไม่ได้ตั้งค่า',
    today: 'วันนี้',
    previousMonth: 'เดือนก่อนหน้า',
    nextMonth: 'เดือนถัดไป',
    all: 'ทั้งหมด',
    search: 'ค้นหา',
    total: 'รวม',
    date: 'วันที่',
    amount: 'จำนวนเงิน',
    category: 'หมวดหมู่',
    note: 'บันทึกช่วยจำ',
    name: 'ชื่อ',
    type: 'ประเภท',
    balance: 'ยอดคงเหลือ',
    somethingWentWrong: 'เกิดข้อผิดพลาดบางอย่าง',
  },

  settings: {
    title: 'ตั้งค่า',
    preferences: 'การตั้งค่าทั่วไป',
    language: 'ภาษา',
    languageHint: 'เปลี่ยนภาษาของหน้าจอ รวมถึงรูปแบบวันที่และจำนวนเงิน',
    currency: 'สกุลเงิน',
    currencyHint: 'สกุลเงินที่ใช้บันทึกข้อมูล ใส่รหัส ISO เช่น USD, THB, EUR',
    locale: 'รูปแบบภูมิภาค',
    localeHint: 'กำหนดรูปแบบการแสดงตัวเลขและวันที่',
    monthlyIncome: 'รายได้ต่อเดือน',
    categories: 'หมวดหมู่',
    savePreferences: 'บันทึกการตั้งค่า',
    account: 'บัญชีผู้ใช้',
  },
};
