import { CSSProperties } from 'react';

/**
 * An amount in the new phone layout's tiles and bank cards: the currency code as a
 * small tag, the figure on one line beside it ("THB 158,281.00" →
 * [THB] 158,281.00). Screen readers get the formatter's text unchanged. If the
 * code is not in the text (a symbol format), the text is shown as it is.
 */
export function TileAmount({ text, code }: { text: string; code: string }) {
  const at = code ? text.indexOf(code) : -1;
  if (at < 0)
    return (
      <span className="tile-amount-figure" style={{ '--len': text.length } as CSSProperties}>
        {text}
      </span>
    );
  const sign = text.slice(0, at).trim();
  const figure = (sign + text.slice(at + code.length).trim()).trim();
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="tile-amount" aria-hidden="true">
        <span className="tile-amount-code">{code}</span>
        {/* Its length sizes the figure to the tile (see .tile-amount-figure). */}
        <span className="tile-amount-figure" style={{ '--len': figure.length } as CSSProperties}>
          {figure}
        </span>
      </span>
    </>
  );
}
