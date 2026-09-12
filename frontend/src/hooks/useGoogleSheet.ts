/**
 * Google Sheet data hooks.
 *
 * The implementation lives in `useExcelDB.ts` and is unchanged by the migration
 * from the local Excel/Express backend — it only ever spoke in REST-shaped
 * paths, and `api/client.ts` now translates those into Apps Script actions.
 *
 * These aliases exist so new code can use names that match where the data
 * actually lives. Both names point at the same functions; the old ones are kept
 * so the existing pages keep working without a sweeping rename.
 *
 *   useGoogleSheetQuery(path, params, options)  — read one endpoint
 *   useGoogleSheet(resource, params, options)   — full CRUD over a collection
 */

export {
  useExcelQuery as useGoogleSheetQuery,
  useExcelDB as useGoogleSheet,
  useExcelQuery,
  useExcelDB,
} from './useExcelDB';

export type { QueryState, CollectionState } from './useExcelDB';
