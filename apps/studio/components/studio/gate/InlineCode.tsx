/**
 * Renders `backtick` spans of review/criterion text as <code>, everything else
 * as plain text (React escapes both; no HTML is ever interpreted).
 */
export function InlineCode({ text }: { text: string }): JSX.Element {
  const parts = text.split(/(`[^`]+`)/);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 2
          ? <code key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.92em', color: 'var(--steel)', overflowWrap: 'anywhere' }}>{p.slice(1, -1)}</code>
          : p,
      )}
    </>
  );
}
