import { element, icon, type IconName } from "../styles/dom";

export type AppPageId = "home" | "plan" | "dashboard" | "options";

export interface AppPageItem {
  id: AppPageId;
  href: string;
  label: string;
  shortLabel: string;
  icon: IconName;
}

const HOME_PAGE_ITEM: AppPageItem = {
  id: "home",
  href: "home.html",
  label: "专注中心",
  shortLabel: "中心",
  icon: "home"
};

export const APP_PAGE_ITEMS: ReadonlyArray<AppPageItem> = [
  HOME_PAGE_ITEM,
  { id: "plan", href: "plan.html", label: "观看清单", shortLabel: "清单", icon: "calendar" },
  {
    id: "dashboard",
    href: "dashboard.html",
    label: "使用洞察",
    shortLabel: "洞察",
    icon: "bar-chart"
  },
  { id: "options", href: "options.html", label: "专注设置", shortLabel: "设置", icon: "settings" }
];

export interface PageNavigationOptions {
  currentPage: AppPageId;
  /** Optional controls placed after the primary page links. */
  actions?: ReadonlyArray<HTMLElement | null | undefined>;
}

/**
 * Shared top-level navigation for extension pages.
 *
 * Links intentionally use normal same-tab navigation: every full page has a
 * predictable route back to the focus center, without relying on browser
 * history or opening a trail of extension tabs.
 */
export function createPageNavigation({
  currentPage,
  actions = []
}: PageNavigationOptions): HTMLElement {
  const currentItem = getPageItem(currentPage);
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
        element("span", { className: "app-navigation__label", text: item.label }),
        element("span", { className: "app-navigation__short-label", text: item.shortLabel })
      ]
    })
  );

  const actionNodes = actions.filter(
    (action): action is HTMLElement => action instanceof HTMLElement
  );

  return element("header", {
    className: "app-navigation",
    children: [
      element("div", {
        className: "app-navigation__bar",
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
      }),
      element("nav", {
        className: "app-breadcrumbs",
        attrs: { "aria-label": "面包屑导航" },
        children: [
          currentPage === "home"
            ? null
            : element("a", {
                className: "app-breadcrumbs__back",
                attrs: { href: "home.html", "aria-label": "返回专注中心" },
                children: [icon("chevron"), element("span", { text: "返回专注中心" })]
              }),
          element("ol", {
            className: "app-breadcrumbs__list",
            children:
              currentPage === "home"
                ? [
                    element("li", {
                      text: currentItem.label,
                      attrs: { "aria-current": "page" }
                    })
                  ]
                : [
                    element("li", {
                      children: [element("a", { text: "专注中心", attrs: { href: "home.html" } })]
                    }),
                    element("li", { attrs: { "aria-hidden": "true" }, text: "/" }),
                    element("li", {
                      text: currentItem.label,
                      attrs: { "aria-current": "page" }
                    })
                  ]
          })
        ]
      })
    ]
  });
}

function createBrand(): HTMLAnchorElement {
  return element("a", {
    className: "brand app-navigation__brand",
    attrs: { href: "home.html", "aria-label": "BiliPace 专注中心" },
    children: [
      element("span", { className: "brand__mark", children: [icon("focus")] }),
      element("span", {
        className: "brand__meta",
        children: [element("span", { text: "BiliPace" }), element("small", { text: "哔哩节拍" })]
      })
    ]
  });
}

function getPageItem(id: AppPageId): AppPageItem {
  return APP_PAGE_ITEMS.find((item) => item.id === id) ?? HOME_PAGE_ITEM;
}
