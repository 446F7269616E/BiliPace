# Changelog

All notable changes to BiliPace will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
