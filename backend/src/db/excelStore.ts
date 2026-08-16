import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

import { config, dataDir } from '../config';
import { ColumnDef, SheetDef, SHEETS } from './schema';

export type Row = Record<string, unknown>;

/** Errors thrown by the store that map cleanly onto HTTP responses. */
export class StoreError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'STORE_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const LOCK_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);
const FLUSH_RETRY_DELAYS = [150, 400, 900, 2000, 4000];
const LOCK_RETRY_INTERVAL_MS = 5000;

function isLockError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && LOCK_ERROR_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Turn whatever ExcelJS handed us into a primitive.
 * Cells can be rich text, hyperlinks, formulas or error objects.
 */
function flattenCell(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[]).map((part) => part.text ?? '').join('');
    }
    if ('result' in obj) return flattenCell(obj.result);
    if ('text' in obj) return flattenCell(obj.text);
    if ('error' in obj) return null;
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

/** Keys ExcelJS puts on its cell-value objects; anything else is our own data. */
const EXCEL_CELL_KEYS = ['richText', 'result', 'formula', 'sharedFormula', 'error', 'hyperlink'];

function isExcelCellObject(value: object): boolean {
  return EXCEL_CELL_KEYS.some((key) => key in value);
}

/** Coerce a flattened cell into the type declared by the column definition. */
function coerce(raw: unknown, column: ColumnDef): unknown {
  // Rows arriving from the API already hold real arrays/objects for list and
  // json columns. flattenCell() would throw those away, so handle them first.
  if (column.type === 'list' && Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (
    column.type === 'json' &&
    raw !== null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    !(raw instanceof Date) &&
    !isExcelCellObject(raw)
  ) {
    return raw;
  }

  const value = flattenCell(raw);

  switch (column.type) {
    case 'number': {
      if (value === null || value === '') return 0;
      const n = typeof value === 'number' ? value : Number(String(value).replace(/[, ]/g, ''));
      return Number.isFinite(n) ? n : 0;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === null || value === '') return false;
      const s = String(value).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' || s === 'y';
    }
    case 'date': {
      if (value instanceof Date) return value.toISOString();
      if (value === null || value === '') return '';
      return String(value);
    }
    case 'json': {
      if (value === null || value === '') return {};
      if (typeof value === 'object') return value;
      try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        // A human may have typed something into the cell — don't crash the app.
        return {};
      }
    }
    case 'list': {
      if (value === null || value === '') return [];
      return String(value)
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    case 'string':
    default: {
      if (value === null) return '';
      if (value instanceof Date) return value.toISOString();
      return String(value);
    }
  }
}

/** Turn a JS value back into something Excel is happy to store. */
function serialize(value: unknown, column: ColumnDef): string | number | boolean | null {
  if (value === undefined || value === null) {
    return column.type === 'number' ? 0 : column.type === 'boolean' ? false : '';
  }
  switch (column.type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'boolean':
      return Boolean(value);
    case 'json':
      return JSON.stringify(value ?? {});
    case 'list':
      return Array.isArray(value) ? value.join(', ') : String(value);
    default:
      return value instanceof Date ? value.toISOString() : String(value);
  }
}

export interface StoreHealth {
  ready: boolean;
  dbPath: string;
  dirty: boolean;
  lastFlushAt: string | null;
  lastError: string | null;
  fileLocked: boolean;
  rowCounts: Record<string, number>;
}

class ExcelStore {
  private cache = new Map<string, Row[]>();
  private ready = false;
  private dirty = false;
  private fileLocked = false;
  private lastError: string | null = null;
  private lastFlushAt: string | null = null;

  private flushTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  /** Serialises every disk write; mutations never race each other. */
  private writeChain: Promise<void> = Promise.resolve();

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  async init(): Promise<void> {
    await fsp.mkdir(dataDir, { recursive: true });

    if (!fs.existsSync(config.dbPath)) {
      for (const sheet of SHEETS) this.cache.set(sheet.name, []);
      this.ready = true;
      await this.flushNow();
      console.log(`[db] created new workbook at ${config.dbPath}`);
      return;
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.readFile(config.dbPath);
    } catch (err) {
      if (isLockError(err)) {
        throw new StoreError(
          `database.xlsx is locked by another program. Close it in Excel and restart the server. (${config.dbPath})`,
          503,
          'DB_LOCKED',
        );
      }
      throw new StoreError(
        `database.xlsx could not be read — it may be corrupt. Move it aside to regenerate a fresh one. (${(err as Error).message})`,
        500,
        'DB_UNREADABLE',
      );
    }

    let migrated = false;

    for (const sheet of SHEETS) {
      const worksheet = workbook.getWorksheet(sheet.name);
      if (!worksheet) {
        this.cache.set(sheet.name, []);
        migrated = true;
        console.log(`[db] sheet "${sheet.name}" was missing — it will be added`);
        continue;
      }
      const { rows, addedColumns } = this.readSheet(worksheet, sheet);
      if (addedColumns.length) {
        migrated = true;
        console.log(`[db] sheet "${sheet.name}" gained columns: ${addedColumns.join(', ')}`);
      }
      this.cache.set(sheet.name, rows);
    }

    this.ready = true;
    const counts = SHEETS.map((s) => `${s.name}=${this.cache.get(s.name)!.length}`).join(' ');
    console.log(`[db] loaded ${config.dbPath} (${counts})`);

    if (migrated) await this.flushNow();
  }

  private readSheet(
    worksheet: ExcelJS.Worksheet,
    sheet: SheetDef,
  ): { rows: Row[]; addedColumns: string[] } {
    const headerRow = worksheet.getRow(1);
    const headerToIndex = new Map<string, number>();

    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = String(flattenCell(cell.value) ?? '').trim();
      if (header) headerToIndex.set(header.toLowerCase(), colNumber);
    });

    const addedColumns: string[] = [];
    const columnIndex = new Map<string, number>();
    for (const column of sheet.columns) {
      const idx = headerToIndex.get(column.header.toLowerCase());
      if (idx) columnIndex.set(column.key, idx);
      else addedColumns.push(column.header);
    }

    const rows: Row[] = [];
    const seenKeys = new Set<string>();

    worksheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
      if (rowNumber === 1) return;

      const row: Row = {};
      let hasContent = false;

      for (const column of sheet.columns) {
        const idx = columnIndex.get(column.key);
        const raw = idx ? excelRow.getCell(idx).value : null;
        if (flattenCell(raw) !== null && String(flattenCell(raw)) !== '') hasContent = true;
        row[column.key] = coerce(raw, column);
      }

      if (!hasContent) return; // blank spacer row

      const key = String(row[sheet.primaryKey] ?? '').trim();
      if (!key) return; // row without an id is unusable
      if (seenKeys.has(key)) {
        console.warn(`[db] duplicate ${sheet.name}.${sheet.primaryKey} "${key}" — keeping the first`);
        return;
      }
      seenKeys.add(key);
      rows.push(row);
    });

    return { rows, addedColumns };
  }

  private assertReady(): void {
    if (!this.ready) {
      throw new StoreError('Database is still initialising, try again in a moment.', 503, 'DB_NOT_READY');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Reads                                                               */
  /* ------------------------------------------------------------------ */

  all<T extends object>(sheetName: string): T[] {
    this.assertReady();
    const rows = this.cache.get(sheetName);
    if (!rows) throw new StoreError(`Unknown sheet "${sheetName}"`, 500, 'UNKNOWN_SHEET');
    // Shallow copies so route handlers can't mutate the cache by accident.
    return rows.map((r) => ({ ...r })) as unknown as T[];
  }

  where<T extends object>(sheetName: string, predicate: (row: T) => boolean): T[] {
    return this.all<T>(sheetName).filter(predicate);
  }

  findOne<T extends object>(sheetName: string, predicate: (row: T) => boolean): T | undefined {
    return this.all<T>(sheetName).find(predicate);
  }

  findById<T extends object>(sheetName: string, id: string): T | undefined {
    const sheet = this.sheetDef(sheetName);
    return this.findOne<T>(sheetName, (r) => String((r as Row)[sheet.primaryKey]) === id);
  }

  /* ------------------------------------------------------------------ */
  /* Writes                                                              */
  /* ------------------------------------------------------------------ */

  insert<T extends object>(sheetName: string, row: T): T {
    this.assertReady();
    const sheet = this.sheetDef(sheetName);
    const rows = this.cache.get(sheetName)!;
    const key = String((row as Row)[sheet.primaryKey] ?? '').trim();

    if (!key) throw new StoreError(`Missing ${sheet.primaryKey} on new ${sheetName} row`, 400, 'MISSING_KEY');
    if (rows.some((r) => String(r[sheet.primaryKey]) === key)) {
      throw new StoreError(`${sheetName} row "${key}" already exists`, 409, 'DUPLICATE_KEY');
    }

    const normalized = this.normalizeRow(sheet, row as Row);
    rows.push(normalized);
    this.scheduleFlush();
    return { ...normalized } as unknown as T;
  }

  update<T extends object>(sheetName: string, id: string, patch: Partial<T>): T {
    this.assertReady();
    const sheet = this.sheetDef(sheetName);
    const rows = this.cache.get(sheetName)!;
    const index = rows.findIndex((r) => String(r[sheet.primaryKey]) === id);
    if (index === -1) throw new StoreError(`${sheetName} row "${id}" not found`, 404, 'NOT_FOUND');

    const merged = { ...rows[index], ...patch, [sheet.primaryKey]: id };
    const normalized = this.normalizeRow(sheet, merged);
    rows[index] = normalized;
    this.scheduleFlush();
    return { ...normalized } as unknown as T;
  }

  /** Insert or update, keyed on the sheet's primary key. */
  upsert<T extends object>(sheetName: string, row: T): T {
    const sheet = this.sheetDef(sheetName);
    const id = String((row as Row)[sheet.primaryKey] ?? '').trim();
    const existing = this.findById(sheetName, id);
    return existing ? this.update<T>(sheetName, id, row) : this.insert<T>(sheetName, row);
  }

  remove(sheetName: string, id: string): boolean {
    this.assertReady();
    const sheet = this.sheetDef(sheetName);
    const rows = this.cache.get(sheetName)!;
    const index = rows.findIndex((r) => String(r[sheet.primaryKey]) === id);
    if (index === -1) return false;
    rows.splice(index, 1);
    this.scheduleFlush();
    return true;
  }

  /** Bulk delete, used when cascading (e.g. deleting a wallet's transactions). */
  removeWhere(sheetName: string, predicate: (row: Row) => boolean): number {
    this.assertReady();
    const rows = this.cache.get(sheetName);
    if (!rows) return 0;
    const kept = rows.filter((r) => !predicate(r));
    const removed = rows.length - kept.length;
    if (removed > 0) {
      this.cache.set(sheetName, kept);
      this.scheduleFlush();
    }
    return removed;
  }

  private sheetDef(sheetName: string): SheetDef {
    const sheet = SHEETS.find((s) => s.name === sheetName);
    if (!sheet) throw new StoreError(`Unknown sheet "${sheetName}"`, 500, 'UNKNOWN_SHEET');
    return sheet;
  }

  /** Drop unknown keys and coerce every declared column to its type. */
  private normalizeRow(sheet: SheetDef, row: Row): Row {
    const out: Row = {};
    for (const column of sheet.columns) {
      out[column.key] = coerce(row[column.key] as never, column);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Persistence                                                         */
  /* ------------------------------------------------------------------ */

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow().catch(() => {
        /* flushNow already recorded the error */
      });
    }, config.flushDebounceMs);
  }

  /** Force a write and wait for it. Safe to call concurrently. */
  async flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const next = this.writeChain.then(() => this.writeWorkbook());
    // Keep the chain alive even if this write fails.
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  private async writeWorkbook(): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Quick Wallet';
    workbook.lastModifiedBy = 'Quick Wallet';
    workbook.modified = new Date();

    for (const sheet of SHEETS) {
      const worksheet = workbook.addWorksheet(sheet.name, {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      worksheet.columns = sheet.columns.map((c) => ({
        header: c.header,
        key: c.key,
        width: c.width ?? 18,
      }));

      const header = worksheet.getRow(1);
      header.font = { bold: true };
      header.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFF3F8' },
      };

      for (const row of this.cache.get(sheet.name) ?? []) {
        const values: Record<string, unknown> = {};
        for (const column of sheet.columns) {
          values[column.key] = serialize(row[column.key], column);
        }
        worksheet.addRow(values);
      }

      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.columns.length },
      };
    }

    const tmpPath = path.join(dataDir, `.database.${process.pid}.tmp.xlsx`);

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= FLUSH_RETRY_DELAYS.length; attempt += 1) {
      try {
        await workbook.xlsx.writeFile(tmpPath);
        // rename is atomic on the same volume, so a crash mid-write can never
        // leave a half-written database.xlsx behind.
        await fsp.rename(tmpPath, config.dbPath);

        this.dirty = false;
        this.fileLocked = false;
        this.lastError = null;
        this.lastFlushAt = new Date().toISOString();
        if (this.retryTimer) {
          clearInterval(this.retryTimer);
          this.retryTimer = null;
        }
        return;
      } catch (err) {
        lastErr = err;
        await fsp.rm(tmpPath, { force: true }).catch(() => undefined);
        if (!isLockError(err) || attempt === FLUSH_RETRY_DELAYS.length) break;
        await sleep(FLUSH_RETRY_DELAYS[attempt]);
      }
    }

    this.dirty = true;
    this.fileLocked = isLockError(lastErr);
    this.lastError = (lastErr as Error)?.message ?? 'unknown write error';

    if (this.fileLocked) {
      console.warn(
        `[db] database.xlsx is locked (probably open in Excel). Changes are held in memory and will be retried every ${
          LOCK_RETRY_INTERVAL_MS / 1000
        }s.`,
      );
      this.startLockRetry();
    } else {
      console.error('[db] failed to write workbook:', this.lastError);
    }

    throw new StoreError(
      this.fileLocked
        ? 'database.xlsx is open in another program (usually Excel). Your change is saved in memory and will be written automatically once the file is closed.'
        : `Could not write database.xlsx: ${this.lastError}`,
      this.fileLocked ? 409 : 500,
      this.fileLocked ? 'DB_LOCKED' : 'DB_WRITE_FAILED',
    );
  }

  private startLockRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      if (!this.dirty) {
        if (this.retryTimer) clearInterval(this.retryTimer);
        this.retryTimer = null;
        return;
      }
      void this.flushNow()
        .then(() => console.log('[db] workbook written after lock cleared'))
        .catch(() => undefined);
    }, LOCK_RETRY_INTERVAL_MS);
    // Don't keep the process alive purely for retries.
    this.retryTimer.unref?.();
  }

  getHealth(): StoreHealth {
    const rowCounts: Record<string, number> = {};
    for (const sheet of SHEETS) rowCounts[sheet.name] = this.cache.get(sheet.name)?.length ?? 0;
    return {
      ready: this.ready,
      dbPath: config.dbPath,
      dirty: this.dirty,
      lastFlushAt: this.lastFlushAt,
      lastError: this.lastError,
      fileLocked: this.fileLocked,
      rowCounts,
    };
  }

  /** Best-effort final write on shutdown. */
  async shutdown(): Promise<void> {
    if (!this.dirty) return;
    try {
      await this.flushNow();
      console.log('[db] final flush complete');
    } catch {
      console.error('[db] final flush failed — database.xlsx may be missing the last changes');
    }
  }
}

export const db = new ExcelStore();
