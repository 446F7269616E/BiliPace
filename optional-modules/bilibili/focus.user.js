// ==UserScript==
// @id           hourleaf.local.bilibili-focus
// @name         Bilibili 专注规则示例
// @version      1.0.0
// @description  非输入状态下按 / 聚焦站内搜索框。
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
    const search = document.querySelector(
      ".nav-search-input, #nav-searchform input, input[type='search']"
    );
    if (!(search instanceof HTMLInputElement)) return;
    event.preventDefault();
    search.focus();
  },
  true
);
