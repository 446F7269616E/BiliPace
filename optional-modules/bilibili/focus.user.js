// ==UserScript==
// @format       hourleaf.local-module
// @id           hourleaf.local.bilibili-focus
// @name         Bilibili 专注模块
// @author       Hourleaf contributors
// @version      1.1.0
// @description  非输入状态下按 / 聚焦原生或 Bewly 页面中的站内搜索框。
// @match        https://www.bilibili.com/*
// @match        https://search.bilibili.com/*
// ==/UserScript==

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement ||
      active?.getAttribute("contenteditable") === "true"
    ) {
      return;
    }
    const selectors = ".nav-search-input, #nav-searchform input, input[type='search']";
    const nativeSearch = document.querySelector(selectors);
    const bewlyHost = document.querySelector("#bewly");
    const bewlySearch = bewlyHost?.shadowRoot?.querySelector("#search-wrap input");
    const search = nativeSearch ?? bewlySearch;
    if (!(search instanceof HTMLInputElement)) return;
    event.preventDefault();
    search.focus();
  },
  true
);
