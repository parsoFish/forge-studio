/**
 * demo-overlay.ts — the forge-owned recording overlay (forge-mfv5.2.4).
 *
 * `installForgeOverlay` is handed DIRECTLY to `context.addInitScript()` /
 * `page.addInitScript()` — Playwright stringifies the function and
 * re-evaluates it standalone inside the page on every navigation, so the
 * body must be fully self-contained: no closures over this module's scope,
 * no imports, nothing but browser globals. That is also why every helper it
 * needs is declared INSIDE it rather than beside it.
 *
 * It draws into one fixed, `pointer-events:none`, max-z-index layer appended
 * to `document.documentElement` (a sibling of `<body>`, not a child of it —
 * `zoom()` transforms `<body>`, and a `position:fixed` descendant of a
 * transformed ancestor rebases to that ancestor instead of the viewport, so
 * the overlay would drift with the zoomed page if it lived inside `<body>`).
 * That layer renders over canvas-based UIs (z-index alone, no stacking
 * context project code can outrank), and no project code draws anything —
 * every visual cue the recorder produces comes from here.
 */

/** A region the recorder can outline/zoom: a CSS selector, or an explicit
 *  viewport-relative box. Shared with demo-capture.ts's declared steps. */
export type OverlayRegion = string | { x: number; y: number; w: number; h: number };

/** The page-side handle the recorder drives via `page.evaluate`. */
export type ForgeOverlayHandle = {
  outline(regions: OverlayRegion[]): void;
  zoom(region: OverlayRegion | null): void;
};

/**
 * Install the overlay on the current document. Idempotent per document (a
 * second call on the same page is a no-op) — `addInitScript` re-runs this on
 * every navigation, which is exactly the point, since each navigation is a
 * fresh `window`.
 */
export function installForgeOverlay(): void {
  const host = window as unknown as { __forgeOverlay?: ForgeOverlayHandle };
  if (host.__forgeOverlay) return;

  const Z = '2147483647';
  const ACCENT = '#ff5a5a';

  let root: HTMLElement | null = null;
  let cursorDot: HTMLElement | null = null;
  let keyChip: HTMLElement | null = null;
  let keyChipText = '';
  let keyChipTimer: number | undefined;
  const outlineBoxes: HTMLElement[] = [];

  function ensureRoot(): HTMLElement {
    if (root && root.isConnected) return root;
    const el = document.createElement('div');
    el.setAttribute('data-forge-overlay-root', '');
    el.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${Z};`;
    document.documentElement.appendChild(el);
    root = el;
    return el;
  }

  function ensureCursorDot(): HTMLElement {
    if (cursorDot && cursorDot.isConnected) return cursorDot;
    const dot = document.createElement('div');
    dot.setAttribute('data-forge-overlay-cursor', '');
    dot.style.cssText =
      'position:fixed;left:0;top:0;width:14px;height:14px;margin:-7px 0 0 -7px;' +
      `border-radius:50%;background:${ACCENT};opacity:.9;box-shadow:0 0 0 2px rgba(255,255,255,.85);` +
      `pointer-events:none;z-index:${Z};`;
    ensureRoot().appendChild(dot);
    cursorDot = dot;
    return dot;
  }

  function spawnRing(x: number, y: number): void {
    const ring = document.createElement('div');
    ring.setAttribute('data-forge-overlay-ring', '');
    ring.style.cssText =
      `position:fixed;left:${x}px;top:${y}px;width:10px;height:10px;margin:-5px 0 0 -5px;` +
      `border-radius:50%;border:3px solid ${ACCENT};pointer-events:none;z-index:${Z};` +
      'opacity:1;transition:width .4s ease-out,height .4s ease-out,margin .4s ease-out,opacity .4s ease-out;';
    ensureRoot().appendChild(ring);
    requestAnimationFrame(() => {
      ring.style.width = '46px';
      ring.style.height = '46px';
      ring.style.margin = '-23px 0 0 -23px';
      ring.style.opacity = '0';
    });
    setTimeout(() => ring.remove(), 500);
  }

  function ensureKeyChip(): HTMLElement {
    if (keyChip && keyChip.isConnected) return keyChip;
    const chip = document.createElement('div');
    chip.setAttribute('data-forge-overlay-keychip', '');
    chip.style.cssText =
      'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);min-width:24px;' +
      'padding:6px 12px;border-radius:6px;background:rgba(20,20,24,.88);color:#f5f5f7;' +
      'font:600 14px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.02em;' +
      `pointer-events:none;z-index:${Z};opacity:0;transition:opacity .15s ease;`;
    ensureRoot().appendChild(chip);
    keyChip = chip;
    return chip;
  }

  function keyLabel(e: KeyboardEvent): string {
    if (e.key.length === 1) return e.key;
    const named: Record<string, string> = {
      Enter: '⏎',
      Backspace: '⌫',
      Tab: '⇥',
      Escape: '⎋',
      ' ': '␣',
    };
    return named[e.key] ?? `[${e.key}]`;
  }

  function showKeyChip(text: string): void {
    const chip = ensureKeyChip();
    keyChipText = (keyChipText + text).slice(-40);
    chip.textContent = keyChipText;
    chip.style.opacity = '1';
    if (keyChipTimer !== undefined) window.clearTimeout(keyChipTimer);
    keyChipTimer = window.setTimeout(() => {
      chip.style.opacity = '0';
      keyChipText = '';
    }, 900);
  }

  function clearOutline(): void {
    for (const b of outlineBoxes.splice(0)) b.remove();
  }

  function resolveRegionRect(
    region: OverlayRegion,
  ): { x: number; y: number; w: number; h: number } | null {
    if (typeof region === 'string') {
      const el = document.querySelector(region);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return region;
  }

  function outline(regions: OverlayRegion[]): void {
    clearOutline();
    const list = Array.isArray(regions) ? regions : [regions];
    let first = true;
    for (const region of list) {
      const rect = resolveRegionRect(region);
      if (!rect) continue;
      const box = document.createElement('div');
      box.setAttribute('data-forge-overlay-outline', '');
      // The FIRST resolvable region carries the "dim everything else" shadow
      // (a huge spread reaching past the viewport leaves only this box's own
      // footprint un-dimmed); later regions are appended after it so they
      // paint on top of that shadow at their own location instead of being
      // dimmed by it. Multiple simultaneous regions is a rare declared case;
      // this keeps ONE region exact and every additional one still outlined.
      const dim = first ? ',0 0 0 100vmax rgba(0,0,0,.45)' : '';
      box.style.cssText =
        `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;` +
        `border:3px solid ${ACCENT};border-radius:4px;box-sizing:border-box;` +
        `pointer-events:none;z-index:${Z};box-shadow:0 0 0 0 rgba(0,0,0,0)${dim};`;
      ensureRoot().appendChild(box);
      outlineBoxes.push(box);
      first = false;
    }
  }

  function zoom(region: OverlayRegion | null): void {
    document.body.style.transition = 'transform .4s ease';
    if (!region) {
      document.body.style.transform = '';
      document.body.style.transformOrigin = '';
      return;
    }
    const rect = resolveRegionRect(region);
    if (!rect) return;
    document.body.style.transformOrigin = `${rect.x + rect.w / 2}px ${rect.y + rect.h / 2}px`;
    document.body.style.transform = 'scale(1.6)';
  }

  window.addEventListener(
    'mousemove',
    (e) => {
      ensureCursorDot().style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    },
    true,
  );
  window.addEventListener('mousedown', (e) => spawnRing(e.clientX, e.clientY), true);
  window.addEventListener('keydown', (e) => showKeyChip(keyLabel(e)), true);

  host.__forgeOverlay = { outline, zoom };
}
