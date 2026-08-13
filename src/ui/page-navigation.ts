import { element, icon, type IconName } from "../styles/dom";
import { t, type MessageKey } from "../shared/i18n";

export type AppPageId = "home" | "plan" | "dashboard" | "options";

export interface AppPageItem {
  id: AppPageId;
  href: string;
  labelKey: MessageKey;
  icon: IconName;
}

export const APP_PAGE_ITEMS: ReadonlyArray<AppPageItem> = [
  { id: "dashboard", href: "dashboard.html", labelKey: "nav.dashboard", icon: "bar-chart" },
  { id: "plan", href: "plan.html", labelKey: "nav.plan", icon: "calendar" },
  { id: "options", href: "options.html", labelKey: "nav.configuration", icon: "clock" },
  { id: "home", href: "home.html", labelKey: "nav.settings", icon: "settings" }
];

export interface PageNavigationOptions {
  currentPage: AppPageId;
  actions?: ReadonlyArray<HTMLElement | null | undefined>;
}

/** Shared, centered top bar for every full extension page. */
export function createPageNavigation({
  currentPage,
  actions = []
}: PageNavigationOptions): HTMLElement {
  const pageLinks = APP_PAGE_ITEMS.map((item) => {
    const label = t(item.labelKey);
    return element("a", {
      className: "app-navigation__link",
      attrs: {
        href: item.href,
        ...(item.id === currentPage ? { "aria-current": "page" } : {}),
        "aria-label": label
      },
      children: [
        icon(item.icon),
        element("span", { className: "app-navigation__label", text: label })
      ]
    });
  });
  const actionNodes = actions.filter(
    (action): action is HTMLElement => action instanceof HTMLElement
  );

  return element("header", {
    className: "app-navigation",
    children: [
      createBrand(),
      element("nav", {
        className: "app-navigation__pages",
        attrs: { "aria-label": t("nav.mainLabel") },
        children: pageLinks
      }),
      actionNodes.length > 0
        ? element("div", {
            className: "app-navigation__actions",
            attrs: { "aria-label": t("nav.pageActions") },
            children: actionNodes
          })
        : null
    ]
  });
}

function createBrand(): HTMLAnchorElement {
  return element("a", {
    className: "brand app-navigation__brand",
    attrs: { href: "dashboard.html", "aria-label": `Hourleaf ${t("nav.dashboard")}` },
    children: [
      element("span", { className: "brand__mark", children: [icon("leaf")] }),
      element("span", {
        className: "brand__meta",
        children: [
          element("span", { text: "Hourleaf" }),
          element("small", { text: t("brand.tagline") })
        ]
      })
    ]
  });
}
