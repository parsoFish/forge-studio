// ── Journey player: scripted tours with cursor, captions, scenario ────
// Activate with ?journey=<id> (the query string survives hash routing).
// Steps: { cap, goto?, click?, hover?, type?:[sel,text], select?:[sel,val],
//          drag?:[sel,dx,dy], patch?, ms? }
// Headless capture waits for body[data-journey-done="true"].

function jSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function jWaitFor(sel, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeout || 4000)) {
    const el = document.querySelector(sel);
    if (el) return el;
    await jSleep(120);
  }
  return null;
}

function jTypeInto(el, text) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  return (async () => {
    el.focus();
    for (let k = 1; k <= text.length; k++) {
      setter.call(el, text.slice(0, k));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await jSleep(34);
    }
  })();
}

function JourneyPlayer({ journeyId }) {
  const journey = JOURNEYS[journeyId];
  const [stepIdx, setStepIdx] = React.useState(-1);
  const [done, setDone] = React.useState(false);
  const cursorRef = React.useRef(null);
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (!journey || startedRef.current) return;
    startedRef.current = true;

    const moveToXY = (x, y) => {
      const c = cursorRef.current;
      if (!c) return;
      c.classList.add('on');
      c.style.left = x + 'px';
      c.style.top = y + 'px';
    };
    const moveTo = el => {
      const r = el.getBoundingClientRect();
      moveToXY(r.left + Math.min(r.width / 2, 160), r.top + r.height / 2);
    };
    const pulse = () => {
      const c = cursorRef.current;
      if (!c) return;
      c.classList.remove('click'); void c.offsetWidth; c.classList.add('click');
    };

    (async () => {
      await jSleep(1600); // fonts + babel settle
      for (let i = 0; i < journey.steps.length; i++) {
        const s = journey.steps[i];
        setStepIdx(i);
        if (s.goto) { location.hash = s.goto.slice(1); await jSleep(550); }
        if (s.patch) { window.setSCN(s.patch); await jSleep(380); }
        const sel = s.click || s.hover;
        if (sel) {
          const el = await jWaitFor(sel);
          if (el) {
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            await jSleep(500);
            moveTo(el);
            await jSleep(680);
            if (s.click) {
              pulse();
              await jSleep(200);
              if (typeof el.click === 'function') el.click();
              else el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
          }
        }
        if (s.type) {
          const el = await jWaitFor(s.type[0]);
          if (el) {
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            await jSleep(380);
            moveTo(el);
            await jSleep(500);
            await jTypeInto(el, s.type[1]);
          }
        }
        if (s.select) {
          const el = await jWaitFor(s.select[0]);
          if (el) {
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            await jSleep(380);
            moveTo(el);
            await jSleep(500);
            pulse();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
            setter.call(el, s.select[1]);
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        if (s.drag) {
          const el = await jWaitFor(s.drag[0]);
          if (el) {
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            await jSleep(400);
            const r = el.getBoundingClientRect();
            const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
            moveToXY(x0, y0);
            await jSleep(560);
            const opts = p => ({ bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, isPrimary: true });
            el.dispatchEvent(new PointerEvent('pointerdown', opts({ x: x0, y: y0 })));
            const steps = 14;
            for (let k = 1; k <= steps; k++) {
              const x = x0 + (s.drag[1] * k) / steps, y = y0 + (s.drag[2] * k) / steps;
              moveToXY(x, y);
              window.dispatchEvent(new PointerEvent('pointermove', opts({ x, y })));
              await jSleep(55);
            }
            window.dispatchEvent(new PointerEvent('pointerup', opts({ x: x0 + s.drag[1], y: y0 + s.drag[2] })));
          }
        }
        await jSleep(s.ms || 2600);
      }
      setDone(true);
      await jSleep(400);
      document.body.dataset.journeyDone = 'true';
    })();
  }, []);

  if (!journey) return null;
  const step = stepIdx >= 0 ? journey.steps[stepIdx] : null;
  return (
    <React.Fragment>
      <div className="j-cursor" ref={cursorRef}></div>
      <div className="j-caption">
        <div className="j-title">{journey.title}</div>
        <div className="j-text">{done ? 'Journey complete.' : step ? step.cap : 'Starting…'}</div>
        <div className="j-step">{done ? '' : (stepIdx + 1) + ' / ' + journey.steps.length}</div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { JourneyPlayer });
