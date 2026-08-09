import { element, icon, type IconName } from "../styles/dom";

export type AppPageId = "home" | "plan" | "dashboard" | "options";

export interface AppPageItem {
  id: AppPageId;
  href: string;
  label: string;
  icon: IconName;
}

export const APP_PAGE_ITEMS: ReadonlyArray<AppPageItem> = [
  { id: "dashboard", href: "dashboard.html", label: "仪表盘", icon: "bar-chart" },
  { id: "plan", href: "plan.html", label: "计划", icon: "calendar" },
  { id: "options", href: "options.html", label: "配置", icon: "settings" },
  { id: "home", href: "home.html", label: "设置", icon: "home" }
];

export interface PageNavigationOptions {
  currentPage: AppPageId;
  actions?: ReadonlyArray<HTMLElement | null | undefined>;
}

/** Shared sidebar for every full extension page. */
export function createPageNavigation({
  currentPage,
  actions = []
}: PageNavigationOptions): HTMLElement {
  const pageLinks = APP_PAGE_ITEMS.map((item) =>
    element("a", {
      className: "app-navigation__link",
      attrs: {
        href: item.href,
        ...(item.id === currentPage ? { "aria-current": "page" } : {}),
        "aria-label": item.label
      },
      children: [
        icon(item.icon),
        element("span", { className: "app-navigation__label", text: item.label })
      ]
    })
  );
  const actionNodes = actions.filter(
    (action): action is HTMLElement => action instanceof HTMLElement
  );

  return element("aside", {
    className: "app-navigation",
    children: [
      createBrand(),
      element("nav", {
        className: "app-navigation__pages",
        attrs: { "aria-label": "BiliPace 主导航" },
        children: pageLinks
      }),
      actionNodes.length > 0
        ? element("div", {
            className: "app-navigation__actions",
            attrs: { "aria-label": "页面操作" },
            children: actionNodes
          })
        : null
    ]
  });
}

function createBrand(): HTMLAnchorElement {
  return element("a", {
    className: "brand app-navigation__brand",
    attrs: { href: "dashboard.html", "aria-label": "BiliPace 仪表盘" },
    children: [
      element("span", { className: "brand__mark", children: [icon("focus")] }),
      element("span", {
        className: "brand__meta",
        children: [element("span", { text: "BiliPace" }), element("small", { text: "哔哩节拍" })]
      })
    ]
  });
}
