/**
 * Declarative description of every sheet in database.xlsx.
 *
 * The store uses this to (a) create the workbook on first run, (b) migrate an
 * existing workbook by appending sheets/columns that were added later, and
 * (c) coerce raw cell values into properly typed JS values.
 */

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json' | 'list';

export interface ColumnDef {
  key: string;
  header: string;
  type: ColumnType;
  width?: number;
}

export interface SheetDef {
  name: string;
  /** Column key that uniquely identifies a row. */
  primaryKey: string;
  columns: ColumnDef[];
}

export const SHEETS: SheetDef[] = [
  {
    name: 'Users',
    primaryKey: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string', width: 38 },
      { key: 'username', header: 'Username', type: 'string', width: 18 },
      { key: 'displayName', header: 'Display Name', type: 'string', width: 22 },
      { key: 'salt', header: 'Salt', type: 'string', width: 34 },
      { key: 'passwordHash', header: 'Password Hash', type: 'string', width: 70 },
      { key: 'active', header: 'Active', type: 'boolean', width: 10 },
      { key: 'createdAt', header: 'Created At', type: 'date', width: 24 },
    ],
  },
  {
    name: 'Wallets',
    primaryKey: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string', width: 38 },
      { key: 'userId', header: 'User ID', type: 'string', width: 38 },
      { key: 'name', header: 'Name', type: 'string', width: 22 },
      { key: 'mode', header: 'Mode', type: 'string', width: 14 },
      { key: 'kind', header: 'Kind', type: 'string', width: 12 },
      { key: 'currency', header: 'Currency', type: 'string', width: 10 },
      { key: 'openingBalance', header: 'Opening Balance', type: 'number', width: 16 },
      { key: 'color', header: 'Color', type: 'string', width: 12 },
      { key: 'icon', header: 'Icon', type: 'string', width: 8 },
      { key: 'archived', header: 'Archived', type: 'boolean', width: 10 },
      { key: 'note', header: 'Note', type: 'string', width: 30 },
      { key: 'createdAt', header: 'Created At', type: 'date', width: 24 },
    ],
  },
  {
    name: 'Transactions',
    primaryKey: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string', width: 38 },
      { key: 'userId', header: 'User ID', type: 'string', width: 38 },
      { key: 'walletId', header: 'Wallet ID', type: 'string', width: 38 },
      { key: 'toWalletId', header: 'To Wallet ID', type: 'string', width: 38 },
      { key: 'type', header: 'Type', type: 'string', width: 12 },
      { key: 'amount', header: 'Amount', type: 'number', width: 14 },
      { key: 'category', header: 'Category', type: 'string', width: 18 },
      { key: 'note', header: 'Note', type: 'string', width: 30 },
      { key: 'date', header: 'Date', type: 'string', width: 14 },
      { key: 'createdAt', header: 'Created At', type: 'date', width: 24 },
    ],
  },
  {
    name: 'Investments',
    primaryKey: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string', width: 38 },
      { key: 'userId', header: 'User ID', type: 'string', width: 38 },
      { key: 'walletId', header: 'Wallet ID', type: 'string', width: 38 },
      { key: 'symbol', header: 'Symbol', type: 'string', width: 12 },
      { key: 'quantity', header: 'Quantity', type: 'number', width: 12 },
      { key: 'buyPrice', header: 'Buy Price', type: 'number', width: 14 },
      { key: 'fees', header: 'Fees', type: 'number', width: 10 },
      { key: 'buyDate', header: 'Buy Date', type: 'string', width: 14 },
      { key: 'tags', header: 'Tags', type: 'string', width: 22 },
      { key: 'status', header: 'Status', type: 'string', width: 10 },
      { key: 'sellPrice', header: 'Sell Price', type: 'number', width: 14 },
      { key: 'sellDate', header: 'Sell Date', type: 'string', width: 14 },
      { key: 'note', header: 'Note', type: 'string', width: 30 },
      { key: 'createdAt', header: 'Created At', type: 'date', width: 24 },
    ],
  },
  {
    name: 'Budgets',
    primaryKey: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string', width: 38 },
      { key: 'userId', header: 'User ID', type: 'string', width: 38 },
      { key: 'period', header: 'Period', type: 'string', width: 12 },
      { key: 'scope', header: 'Scope', type: 'string', width: 12 },
      { key: 'targetId', header: 'Target ID', type: 'string', width: 38 },
      { key: 'targetLabel', header: 'Target Label', type: 'string', width: 20 },
      { key: 'mode', header: 'Mode', type: 'string', width: 10 },
      { key: 'value', header: 'Value', type: 'number', width: 12 },
      { key: 'baseIncome', header: 'Base Income', type: 'number', width: 14 },
      { key: 'note', header: 'Note', type: 'string', width: 30 },
      { key: 'createdAt', header: 'Created At', type: 'date', width: 24 },
    ],
  },
  {
    name: 'Settings',
    primaryKey: 'userId',
    columns: [
      { key: 'userId', header: 'User ID', type: 'string', width: 38 },
      { key: 'theme', header: 'Theme', type: 'string', width: 12 },
      { key: 'accent', header: 'Accent', type: 'string', width: 12 },
      { key: 'customVars', header: 'Custom Vars (JSON)', type: 'json', width: 46 },
      { key: 'currency', header: 'Currency', type: 'string', width: 10 },
      { key: 'displayCurrency', header: 'Display Currency', type: 'string', width: 16 },
      { key: 'fxRate', header: 'FX Rate (base->display)', type: 'number', width: 22 },
      { key: 'fxRateUpdatedAt', header: 'FX Rate Updated At', type: 'date', width: 24 },
      { key: 'locale', header: 'Locale', type: 'string', width: 12 },
      { key: 'monthlyIncome', header: 'Monthly Income', type: 'number', width: 16 },
      { key: 'categories', header: 'Categories', type: 'list', width: 60 },
      { key: 'updatedAt', header: 'Updated At', type: 'date', width: 24 },
    ],
  },
];

export const SHEET_BY_NAME: Record<string, SheetDef> = Object.fromEntries(
  SHEETS.map((s) => [s.name, s]),
);

export const DEFAULT_CATEGORIES = [
  'Salary',
  'Bonus',
  'Needs',
  'Groceries',
  'Rent',
  'Utilities',
  'Transport',
  'Health',
  'Wants',
  'Dining',
  'Entertainment',
  'Shopping',
  'Save',
  'Invest',
  'Education',
  'Other',
];
