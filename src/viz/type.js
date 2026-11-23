// Typography for the whole app (DOM + every canvas).
//   SANS    Inter            — body, labels, numbers on canvas
//   DISPLAY Inter Tight      — headlines
//   MONO    IBM Plex Mono    — metadata, readouts
//   EMOJI   Crucible Emoji   — Noto Emoji pinned to its thin 300 weight: slim black-and-white glyphs
// Scenes were written with many hand-made canvas font strings; instead of touching each one,
// the canvas `font` setter is wrapped once so every stack resolves to this system.

export const EMOJI_FAMILY = '"Crucible Emoji"';
export const SANS = `"Inter", ${EMOJI_FAMILY}, system-ui, -apple-system, "Segoe UI", sans-serif`;
export const DISPLAY = `"Inter Tight", "Inter", ${EMOJI_FAMILY}, system-ui, sans-serif`;
export const MONO = `"IBM Plex Mono", ${EMOJI_FAMILY}, ui-monospace, Menlo, monospace`;
export const EMOJI = `${EMOJI_FAMILY}, "Inter", sans-serif`;

// "[style] [variant] [weight] <size>[/<line-height>] <family-list>"
const FONT_RE = /^(.*?)(\d+(?:\.\d+)?px)(\s*\/\s*[\d.]+[a-z%]*)?\s+(.+)$/i;

export function rewriteFont(font) {
  const m = FONT_RE.exec(String(font));
  if (!m) return font;
  const fam = m[4];
  if (fam.includes('Crucible Emoji')) return font;
  if (/"g_d\d|pdfjs|'g_d\d/.test(fam)) return font; // pdf.js embedded fonts: never touch
  let stack;
  if (/mono/i.test(fam)) stack = MONO;
  else if (/STIX|Cambria|Latin Modern|Georgia|Times/i.test(fam) || (/\bserif\b/.test(fam) && !/sans-serif/.test(fam))) stack = `${fam}, ${EMOJI_FAMILY}`;
  else stack = SANS;
  return `${m[1]}${m[2]}${m[3] ?? ''} ${stack}`;
}

// U+FE0F ("render as colour emoji") makes browsers skip our monochrome font for that cluster,
// so it is stripped everywhere text is drawn; U+FE0E is fine to keep.
const VS16 = /\uFE0F/g;
export const stripVS = (t) => (typeof t === 'string' ? t.replace(VS16, '') : t);

let installed = false;
export function installCanvasType() {
  if (installed || typeof CanvasRenderingContext2D === 'undefined') return;
  installed = true;
  const proto = CanvasRenderingContext2D.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, 'font');
  if (!d?.set) return;
  Object.defineProperty(proto, 'font', {
    configurable: true,
    enumerable: d.enumerable,
    get() { return d.get.call(this); },
    set(v) { d.set.call(this, rewriteFont(v)); },
  });
  for (const fn of ['fillText', 'strokeText', 'measureText']) {
    const orig = proto[fn];
    proto[fn] = function (text, ...rest) { return orig.call(this, stripVS(String(text)), ...rest); };
  }
}

// Same for the DOM: strip U+FE0F from every text node as it appears.
export function installDomEmojiText(root = document.body) {
  const clean = (node) => {
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) if (t.nodeValue.includes('\uFE0F')) t.nodeValue = stripVS(t.nodeValue);
  };
  clean(root);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') { if (m.target.nodeValue?.includes('\uFE0F')) m.target.nodeValue = stripVS(m.target.nodeValue); continue; }
      for (const n of m.addedNodes) n.nodeType === 3 ? (n.nodeValue.includes('\uFE0F') && (n.nodeValue = stripVS(n.nodeValue))) : n.nodeType === 1 && clean(n);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}

// Warm up the fonts (and the emoji subsets the app uses most) before the first paint,
// so canvases never flash colour emoji. Never blocks longer than `timeout` ms.
export async function loadFonts(sample = '', timeout = 1800) {
  if (!document.fonts?.load) return;
  const jobs = [
    document.fonts.load('400 16px "Inter"'), document.fonts.load('700 16px "Inter Tight"'),
    document.fonts.load('400 16px "IBM Plex Mono"'),
    document.fonts.load('300 24px "Crucible Emoji"', sample || '🔄'),
  ];
  await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, timeout))]);
}
