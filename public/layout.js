// Resizable, foldable panels. Drag a dotted gutter to resize the panel next to it,
// click it to hide or show that panel. The layout is remembered in this browser.
(() => {
  const app = document.querySelector('.app');
  const main = document.querySelector('.main');
  const sidebar = document.querySelector('#sidebar');
  const request = document.querySelector('.request');
  const sideGutter = document.querySelector('#sideGutter');
  const reqGutter = document.querySelector('#reqGutter');

  const STORAGE_KEY = 'pixapie-layout';
  const SIDE_MIN = 200;
  const SIDE_SNAP = 120; // dragging the sidebar narrower than this hides it
  const REQ_MIN = 150;
  const RESPONSE_MIN = 180;

  const layout = { sideW: null, sideHidden: false, reqH: null, reqFolded: false };
  try {
    Object.assign(layout, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {});
  } catch {}

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {}
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const sideMax = () => Math.min(520, window.innerWidth * 0.5);
  const reqMax = () => main.clientHeight - reqGutter.offsetHeight - RESPONSE_MIN;

  function apply() {
    app.classList.toggle('side-hidden', layout.sideHidden);
    if (layout.sideW) app.style.setProperty('--side-w', `${clamp(layout.sideW, SIDE_MIN, sideMax())}px`);
    else app.style.removeProperty('--side-w');
    sideGutter.setAttribute('aria-expanded', String(!layout.sideHidden));

    const sized = Boolean(layout.reqH) && !layout.reqFolded;
    request.classList.toggle('folded', layout.reqFolded);
    request.classList.toggle('sized', sized);
    request.style.height = sized ? `${clamp(layout.reqH, REQ_MIN, reqMax())}px` : '';
    reqGutter.setAttribute('aria-expanded', String(!layout.reqFolded));
  }

  // Drag to resize, click (no drag) to toggle, arrow keys and Enter for the keyboard
  function makeGutter(gutter, { axis, size, resize, toggle }) {
    const pos = (e) => (axis === 'x' ? e.clientX : e.clientY);

    gutter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = pos(e);
      const from = size();
      let dragging = false;
      gutter.setPointerCapture(e.pointerId);

      const move = (ev) => {
        const delta = pos(ev) - start;
        if (!dragging && Math.abs(delta) < 4) return;
        dragging = true;
        document.body.classList.add(`resizing-${axis}`);
        resize(from + delta);
      };
      const stop = (ev) => {
        gutter.removeEventListener('pointermove', move);
        gutter.removeEventListener('pointerup', stop);
        gutter.removeEventListener('pointercancel', stop);
        document.body.classList.remove(`resizing-${axis}`);
        if (dragging) save();
        else if (ev.type === 'pointerup') toggle();
      };
      gutter.addEventListener('pointermove', move);
      gutter.addEventListener('pointerup', stop);
      gutter.addEventListener('pointercancel', stop);
    });

    gutter.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 64 : 16;
      const keys = axis === 'x' ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
      if (e.key in keys) {
        e.preventDefault();
        resize(size() + keys[e.key]);
        save();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  }

  makeGutter(sideGutter, {
    axis: 'x',
    size: () => (layout.sideHidden ? 0 : sidebar.getBoundingClientRect().width),
    resize: (w) => {
      layout.sideHidden = w < SIDE_SNAP;
      if (!layout.sideHidden) layout.sideW = clamp(w, SIDE_MIN, sideMax());
      apply();
    },
    toggle: () => {
      layout.sideHidden = !layout.sideHidden;
      apply();
      save();
    },
  });

  makeGutter(reqGutter, {
    axis: 'y',
    size: () => request.getBoundingClientRect().height,
    resize: (h) => {
      layout.reqFolded = false;
      layout.reqH = clamp(h, REQ_MIN, reqMax());
      apply();
    },
    toggle: () => {
      layout.reqFolded = !layout.reqFolded;
      apply();
      save();
    },
  });

  window.addEventListener('resize', apply);
  apply();
})();
