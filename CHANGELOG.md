# Changelog

All notable changes to BiliPace will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-08-09

### Changed

- Narrowed BewlyBewly! Ave Mujica support to core timing, focus blocking, plan mode and stable Shadow DOM search/card helpers.
- Content filtering now skips unchanged 15-second refreshes and observes live feeds only when non-empty title rules are enabled.

### Removed

- Removed iframe URL inspection, unused experience detection, broad fallback scans and selectors that could hide an entire Ave Mujica page.

### Fixed

- ShadowRoot remounts are now compared by root identity, and unknown Ave Mujica virtual routes safely remain unmanaged instead of being attributed to the homepage.

## [0.3.0] - 2026-08-09

### Added

- Added modular in-page distraction controls for recommendations, dynamic feeds, related videos, comments, search suggestions, ads and top navigation.
- Added title keyword and safety-bounded regular-expression video-card filters plus the `/` search shortcut.
- Added a Shadow DOM-aware BewlyBewly! Ave Mujica adapter, virtual-route classification and visible drawer URL attribution.
- Added a first-level Focus Center with live timing, today usage, focus status, plan status and clear routes to every full page.
- Added a normative UX writing standard for user-facing text, errors, empty states and terminology.

### Changed

- Unified full-page navigation, breadcrumbs, current-page state and same-tab transitions across the Focus Center, Watch List, Usage Insights and Focus Settings.
- Split “content quieting” from whole-page focus blocking, and collapsed detailed page rules to reduce settings-page density.
- Usage summaries now settle the active interval before display; popup and insights expose a live tracking state.
- Rewrote high-priority interface text around user outcomes and alternatives instead of provider, schema or service configuration.

### Privacy

- Content rules and title patterns remain local; matching does not create a history of titles or URLs and adds no new permission or network request.

## [0.2.0] - 2026-08-09

### Changed

- Renamed the extension from BiliFocus to BiliPace（哔哩节拍）while retaining legacy storage keys and the Firefox extension ID for upgrade compatibility.
- Added a prominent plan-mode switch and watch-list entry directly to the toolbar popup.
- Added release-first installation and plan-mode activation instructions.

### Added

- Initial privacy-first Bilibili focus controls, schedules, daily limits and temporary access.
- Optional plan mode that routes Bilibili navigation through a local watch queue and grants only the explicitly started BVID for a bounded window.
- Local watch-plan todo workflow with add, edit, reorder, complete, restore and safe batch URL/BVID import.
- A reviewed official Open Platform provider boundary for future watch-later/favorites import, with a clear not-configured fallback and no Cookie/private-API access.
- Local day, week and month usage insights grouped by Bilibili section.
- Chromium, Firefox and Safari Web Extension build targets.
- Automated type, lint, unit, build and browser UI quality gates.

### Fixed

- Extension pages opened in a browser tab were no longer misclassified as Bilibili content scripts, preventing closed Chrome message ports and “data unavailable” screens.
