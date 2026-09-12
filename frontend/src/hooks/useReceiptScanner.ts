import { useCallback, useEffect, useRef, useState } from 'react';

import { parseReceiptText } from '../lib/receiptParser';

/**
 * Receipt / slip scanning, entirely on the device.
 *
 * ---------------------------------------------------------------------------
 * WHY TESSERACT AND NOT A VISION API
 * ---------------------------------------------------------------------------
 * A receipt is a photograph of what someone bought, where, and for how much.
 * Uploading that to a third party to save a few lines of parsing is a poor
 * trade for an app whose whole premise is that the data stays in your own
 * spreadsheet. Tesseract runs in a Web Worker in the browser: **the image never
 * leaves the machine**.
 *
 * One honest caveat: the *language models* are downloaded from a CDN on first
 * use (~2MB for `eng`, ~4MB for `tha`) and cached by the browser afterwards.
 * That is a fetch of static model files, not of the user's image — but it is a
 * network request, and on a locked-down network the first scan will fail.
 * `langPath` is exposed as a constant so it can be pointed at a self-hosted
 * copy.
 *
 * ---------------------------------------------------------------------------
 * WHY PROGRESS IS REMAPPED RATHER THAN PASSED THROUGH
 * ---------------------------------------------------------------------------
 * Tesseract reports progress 0→1 *per phase*, and there are four of them. Wired
 * straight to a bar it fills, snaps back to empty, fills again — four times.
 * Each phase is given a slice of the total below so the bar only ever moves
 * forward, which is the one thing a progress bar has to do.
 *
 * ---------------------------------------------------------------------------
 * THE PARSER IS SOMEWHERE ELSE
 * ---------------------------------------------------------------------------
 * Turning OCR text into an amount, a date and a payee is in
 * `lib/receiptParser.ts` — pure, and tested against real Thai and English slip
 * layouts without needing an image or a browser. This file is only the plumbing.
 */

/** What a scan can fill in. Every field is optional — OCR half-succeeds often. */
export interface ReceiptScan {
  amount?: number;
  /** `YYYY-MM-DD`. */
  date?: string;
  note?: string;
}

export type ScanPhase = 'idle' | 'scanning' | 'done' | 'failed';

export interface ScanError {
  /** Which message to show — the copy lives in the dictionary. */
  code: 'wrongType' | 'tooLarge' | 'nothingFound' | 'failed';
}

/** Coarse stage, for a label beside the bar. */
export type ScanStage = 'preparing' | 'loading' | 'reading';

export interface ReceiptScannerState {
  phase: ScanPhase;
  /** 0…100, monotonic across the whole job. */
  progress: number;
  stage: ScanStage;
  preview: string | null;
  fileName: string | null;
  result: ReceiptScan | null;
  /** Raw OCR text, kept so a failed parse can still show what was read. */
  text: string | null;
  error: ScanError | null;
  scan: (file: File) => Promise<ReceiptScan | null>;
  reset: () => void;
}

/** Bigger than this and a phone photo is being uploaded unresized. */
export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
export const MAX_RECEIPT_LABEL = '8 MB';

/** Thai plus English. Bank slips routinely mix both in one line. */
export const OCR_LANGUAGES = 'eng+tha';

/** Point this at a self-hosted copy to work without CDN access. */
export const OCR_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

/**
 * Each Tesseract phase's slice of the bar.
 *
 * The weights are rough but the *order* is what matters: every status maps to a
 * band strictly after the previous one, so the bar cannot go backwards even
 * when Tesseract re-reports an earlier phase.
 */
const PHASES: { match: RegExp; from: number; to: number; stage: ScanStage }[] = [
  { match: /loading tesseract core/i, from: 0, to: 15, stage: 'preparing' },
  /* Anchored to "tesseract" specifically. An earlier version also listed
     "initializing api" here, and since the list is searched in order that
     matched first — sending the bar from 55 back to 15 halfway through. The
     runtime high-water mark hid it, which is exactly why the mapping itself
     has to be right rather than relying on a guard downstream. */
  { match: /initiali[sz]ing tesseract/i, from: 15, to: 25, stage: 'preparing' },
  { match: /loading language|loading lang/i, from: 25, to: 55, stage: 'loading' },
  { match: /initiali[sz](?:ing|ed) api/i, from: 55, to: 60, stage: 'reading' },
  { match: /recognizing text/i, from: 60, to: 100, stage: 'reading' },
];

export function mapProgress(status: string, value: number): { percent: number; stage: ScanStage } | null {
  const phase = PHASES.find((candidate) => candidate.match.test(status));
  if (!phase) return null;

  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  return {
    percent: Math.round(phase.from + (phase.to - phase.from) * clamped),
    stage: phase.stage,
  };
}

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

export function useReceiptScanner(): ReceiptScannerState {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<ScanStage>('preparing');
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptScan | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<ScanError | null>(null);

  /** Held in a ref so cleanup can revoke and terminate without a render. */
  const objectUrl = useRef<string | null>(null);
  const worker = useRef<import('tesseract.js').Worker | null>(null);
  /** Bumped on every scan; a stale run checks this before touching state. */
  const runId = useRef(0);
  /** Progress only ever moves forward, whatever Tesseract reports. */
  const highWater = useRef(0);

  const releasePreview = useCallback(() => {
    if (objectUrl.current) {
      // Every createObjectURL pins the file in memory until it is revoked.
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
  }, []);

  const killWorker = useCallback(() => {
    const current = worker.current;
    worker.current = null;
    // Terminating frees the wasm heap, which for Tesseract is tens of MB.
    if (current) void current.terminate().catch(() => undefined);
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    highWater.current = 0;
    killWorker();
    releasePreview();
    setPreview(null);
    setFileName(null);
    setResult(null);
    setText(null);
    setError(null);
    setProgress(0);
    setStage('preparing');
    setPhase('idle');
  }, [killWorker, releasePreview]);

  useEffect(
    () => () => {
      runId.current += 1;
      killWorker();
      releasePreview();
    },
    [killWorker, releasePreview],
  );

  const scan = useCallback(
    async (file: File): Promise<ReceiptScan | null> => {
      const run = (runId.current += 1);
      const live = () => runId.current === run;

      killWorker();
      releasePreview();
      highWater.current = 0;

      /* Validate before showing anything: a preview of a PDF is a broken image
         icon, and a 40MB photo janks the page before the error appears. */
      const fail = (code: ScanError['code']) => {
        setPreview(null);
        setFileName(file.name);
        setResult(null);
        setText(null);
        setError({ code });
        setPhase('failed');
        return null;
      };

      if (!file.type.startsWith('image/')) return fail('wrongType');
      if (file.size > MAX_RECEIPT_BYTES) return fail('tooLarge');

      const url = URL.createObjectURL(file);
      objectUrl.current = url;

      setPreview(url);
      setFileName(file.name);
      setResult(null);
      setText(null);
      setError(null);
      setProgress(0);
      setStage('preparing');
      setPhase('scanning');

      try {
        /* Imported here, not at module scope: tesseract.js and its wasm are
           several hundred kB, and a user who never scans a receipt should never
           download them. */
        const { createWorker } = await import('tesseract.js');
        if (!live()) return null;

        const instance = await createWorker(OCR_LANGUAGES, 1, {
          langPath: OCR_LANG_PATH,
          logger: (message) => {
            if (!live()) return;
            const mapped = mapProgress(message.status, message.progress);
            if (!mapped) return;
            // Monotonic: a later phase reporting 0% must not empty the bar.
            if (mapped.percent >= highWater.current) {
              highWater.current = mapped.percent;
              setProgress(mapped.percent);
              setStage(mapped.stage);
            }
          },
        });

        if (!live()) {
          void instance.terminate().catch(() => undefined);
          return null;
        }
        worker.current = instance;

        const { data } = await instance.recognize(file);
        if (!live()) return null;

        killWorker();
        setProgress(100);

        const parsed = parseReceiptText(data.text ?? '');
        setText(parsed.text);

        if (parsed.empty) {
          /* Read, but nothing structured came out. The text still goes back so
             the UI can offer the first line as a note — a scan that read
             *something* beats one that shrugs. */
          setError({ code: 'nothingFound' });
          setPhase('failed');
          return null;
        }

        const scanResult: ReceiptScan = {
          amount: parsed.amount,
          date: parsed.date,
          note: parsed.note,
        };
        setResult(scanResult);
        setPhase('done');
        return scanResult;
      } catch {
        if (!live()) return null;
        killWorker();
        setError({ code: 'failed' });
        setPhase('failed');
        return null;
      }
    },
    [killWorker, releasePreview],
  );

  return {
    phase,
    progress,
    stage,
    preview,
    fileName,
    result,
    text,
    error,
    scan,
    reset,
  };
}
