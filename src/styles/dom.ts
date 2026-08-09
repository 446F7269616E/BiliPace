export type IconName =
  | "arrow"
  | "bar-chart"
  | "calendar"
  | "check"
  | "chevron"
  | "clock"
  | "close"
  | "edit"
  | "external"
  | "eye"
  | "focus"
  | "home"
  | "info"
  | "lock"
  | "pause"
  | "play"
  | "plus"
  | "refresh"
  | "settings"
  | "shield"
  | "sparkles"
  | "trash"
  | "unlock"
  | "warning";

type ElementOptions = {
  className?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  dataset?: Record<string, string>;
  children?: Array<Node | string | null | undefined | false>;
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    if (value === true) node.setAttribute(name, "");
    else node.setAttribute(name, String(value));
  }

  for (const [name, value] of Object.entries(options.dataset ?? {})) {
    node.dataset[name] = value;
  }

  for (const child of options.children ?? []) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function svgPart(tag: string, attributes: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

export function icon(name: IconName, label?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }

  const shapes: Record<IconName, SVGElement[]> = {
    arrow: [svgPart("path", { d: "M5 12h14M13 6l6 6-6 6" })],
    "bar-chart": [svgPart("path", { d: "M4 20V10M10 20V4M16 20v-7M22 20H2" })],
    calendar: [
      svgPart("rect", { x: "3", y: "5", width: "18", height: "16", rx: "2" }),
      svgPart("path", { d: "M16 3v4M8 3v4M3 10h18" })
    ],
    check: [svgPart("path", { d: "m5 12 4 4L19 6" })],
    chevron: [svgPart("path", { d: "m9 18 6-6-6-6" })],
    clock: [
      svgPart("circle", { cx: "12", cy: "12", r: "9" }),
      svgPart("path", { d: "M12 7v5l3 2" })
    ],
    close: [svgPart("path", { d: "M18 6 6 18M6 6l12 12" })],
    edit: [svgPart("path", { d: "m14 4 6 6M4 20l3.5-.7L19 7.8a2.1 2.1 0 0 0-3-3L4.7 16.5Z" })],
    external: [
      svgPart("path", { d: "M14 4h6v6M20 4 10 14" }),
      svgPart("path", { d: "M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" })
    ],
    eye: [
      svgPart("path", { d: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" }),
      svgPart("circle", { cx: "12", cy: "12", r: "2.5" })
    ],
    focus: [
      svgPart("path", {
        d: "M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"
      }),
      svgPart("circle", { cx: "12", cy: "12", r: "3" })
    ],
    home: [svgPart("path", { d: "m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" })],
    info: [
      svgPart("circle", { cx: "12", cy: "12", r: "9" }),
      svgPart("path", { d: "M12 11v5M12 8h.01" })
    ],
    lock: [
      svgPart("rect", { x: "4", y: "10", width: "16", height: "11", rx: "2" }),
      svgPart("path", { d: "M8 10V7a4 4 0 0 1 8 0v3" })
    ],
    pause: [svgPart("path", { d: "M9 5v14M15 5v14" })],
    play: [svgPart("path", { d: "m8 5 11 7-11 7Z" })],
    plus: [svgPart("path", { d: "M12 5v14M5 12h14" })],
    refresh: [
      svgPart("path", { d: "M20 7v5h-5M4 17v-5h5" }),
      svgPart("path", { d: "M18.5 9A7 7 0 0 0 6 7l-2 5M5.5 15A7 7 0 0 0 18 17l2-5" })
    ],
    settings: [
      svgPart("circle", { cx: "12", cy: "12", r: "3" }),
      svgPart("path", {
        d: "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"
      })
    ],
    shield: [svgPart("path", { d: "M12 22s8-3.8 8-10V5l-8-3-8 3v7c0 6.2 8 10 8 10Z" })],
    sparkles: [
      svgPart("path", {
        d: "m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2ZM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8ZM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8Z"
      })
    ],
    trash: [svgPart("path", { d: "M4 7h16M9 3h6l1 4H8ZM7 7l1 14h8l1-14M10 11v6M14 11v6" })],
    unlock: [
      svgPart("rect", { x: "4", y: "10", width: "16", height: "11", rx: "2" }),
      svgPart("path", { d: "M8 10V7a4 4 0 0 1 7.5-2" })
    ],
    warning: [
      svgPart("path", {
        d: "M10.3 4.2 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"
      }),
      svgPart("path", { d: "M12 9v4M12 17h.01" })
    ]
  };

  svg.append(...shapes[name]);
  return svg;
}

export function formatDuration(totalSeconds: number, compact = false): string {
  const safeSeconds = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (compact) {
    if (hours > 0) return `${hours}小时${minutes > 0 ? ` ${minutes}分` : ""}`;
    if (minutes > 0) return `${minutes}分钟`;
    return safeSeconds > 0 ? "不足1分钟" : "0分钟";
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatClockTime(value: string): string {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function toast(message: string, type: "success" | "error" = "success"): void {
  let region = document.querySelector<HTMLElement>(".toast-region");
  if (!region) {
    region = element("div", {
      className: "toast-region",
      attrs: { "aria-live": "polite", "aria-atomic": "false" }
    });
    document.body.append(region);
  }
  const item = element("div", {
    className: `toast${type === "error" ? " toast--error" : ""}`,
    attrs: { role: type === "error" ? "alert" : "status" },
    children: [icon(type === "error" ? "warning" : "check"), element("span", { text: message })]
  });
  region.append(item);
  window.setTimeout(() => item.remove(), 3500);
}

export function setButtonBusy(
  button: HTMLButtonElement,
  busy: boolean,
  busyLabel = "正在处理"
): void {
  if (busy) {
    button.dataset.originalLabel = button.textContent ?? "";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.originalLabel) button.textContent = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
  }
}

export function assertAppRoot(): HTMLElement {
  const existing = document.querySelector<HTMLElement>("#app");
  if (existing) return existing;
  const root = element("main", { attrs: { id: "app" } });
  document.body.append(root);
  return root;
}

export function describeError(error: unknown): string {
  console.debug("BiliPace interface action did not complete", error);
  return "操作失败，请重试。";
}
