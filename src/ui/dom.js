// Tiny DOM helper: h("div", { class: "x", onclick }, "text", child, [more, children]).
// Strings become text nodes, so untrusted strings are safe. Nested arrays are flattened.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

export const $ = (id) => document.getElementById(id);
