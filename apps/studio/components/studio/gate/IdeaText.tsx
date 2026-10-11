/**
 * The operator's idea, as written: markdown-ish lines rendered as a heading,
 * paragraphs and lists — plain text only, React escapes it, nothing is parsed
 * as HTML. The architect's idea used to render as one unbroken paragraph.
 */
import { InlineCode } from './InlineCode';

type Block = { kind: 'h' | 'p' | 'li'; text: string };

/** Hard-wrapped markdown → blocks: a blank line ends a block, a wrapped line continues its paragraph or list item. */
export function ideaBlocks(idea: string): Block[] {
  const out: Block[] = [];
  let open = false;
  for (const raw of idea.split('\n')) {
    const line = raw.trim();
    if (!line) { open = false; continue; }
    if (/^#{1,6}\s+/.test(line)) { out.push({ kind: 'h', text: line.replace(/^#{1,6}\s+/, '') }); open = false; continue; }
    if (/^(?:[-*]|\d+[.)])\s+/.test(line)) { out.push({ kind: 'li', text: line.replace(/^(?:[-*]|\d+[.)])\s+/, '') }); open = true; continue; }
    const last = out[out.length - 1];
    if (open && last) out[out.length - 1] = { ...last, text: `${last.text} ${line}` };
    else { out.push({ kind: 'p', text: line }); open = true; }
  }
  return out;
}

export function IdeaText({ idea }: { idea: string }): JSX.Element {
  const out: JSX.Element[] = [];
  let list: string[] = [];
  const flush = (): void => {
    if (list.length === 0) return;
    out.push(<ol key={`l${out.length}`} style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>{list.map((t, i) => <li key={i}><InlineCode text={t} /></li>)}</ol>);
    list = [];
  };
  for (const b of ideaBlocks(idea)) {
    if (b.kind === 'li') { list.push(b.text); continue; }
    flush();
    out.push(b.kind === 'h'
      ? <h3 key={out.length} style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--text)' }}><InlineCode text={b.text} /></h3>
      : <p key={out.length} style={{ margin: 0 }}><InlineCode text={b.text} /></p>);
  }
  flush();
  return <>{out}</>;
}
