# Changelog

All notable changes to Hourleaf will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.6.0] - 2026-08-11

### Added

- Added a bounded local-module format for exact domain policies, element hiding, self-contained CSS, safe DNR rules and browser-isolated user scripts.
- Added local file import, explicit site authorization and module enable/remove controls, with an optional source catalog kept outside store packages.
- Added store-candidate packaging assertions and SHA-256 checksums for Chromium, Firefox and Safari artifacts.

### Changed

- Reduced store builds to the generic focus core and moved website-specific examples to the manually downloaded GitHub catalog.
- Made browser target capabilities build-time constants so Safari rejects imported user scripts at the privileged service boundary.
- Updated the GitHub Actions artifact upload to publish only validated store-candidate ZIP files.

### Privacy

- Modules are never downloaded or updated by the extension; users must select local files and approve exact website access.
- Imported scripts use only the browser User Scripts API on Chromium/Firefox; Safari store builds do not import or execute them.

## [0.5.1] - 2026-08-09

### Changed

- Consolidated each browser release into one Hourleaf extension with all reviewed site modules preinstalled.
- Split module runtime code into local chunks that are registered only while the module is enabled.
- Replaced module download actions with local enable, disable, delete and restore controls.

### Privacy

- Preinstalled modules remain disabled and request no website access until the user enables them.
- Deleting a module unregisters its code chunk and removes its module-specific targets without downloading or executing remote code.

## [0.5.0] - 2026-08-09

### Added

- Added user-managed rules, limits, plans and local time insights for arbitrary HTTP and HTTPS websites.
- Added exact, on-demand website permissions and persistent dynamic content-script registration.
- Added a bounded site-module contract and Bilibili site module.
- Added site and module management to the shared Hourleaf settings experience.

### Changed

- Renamed the extension to Hourleaf while retaining legacy storage keys and the Firefox extension ID for upgrades.
- Moved Bilibili routes, selectors, content filtering and video identity into the optional `hourleaf.site.bilibili` module.
- Migrated settings, usage and temporary access to generic site/target schemas.
- Separated generic website logic from reviewed site-module code without remotely executed code.

### Privacy

- Website access is optional and requested for the exact origin selected by the user.
- Ordinary browsing stores only site/target identifiers, local dates and aggregate seconds; it does not persist page paths, titles or content.

## [0.4.0] - 2026-08-09

### Added

- Added recurring per-section allowlists and blocklists by weekday and local time, including cross-midnight ranges and morning, midday, evening and meal presets.
- Added list and horizontal drag-to-reorder mind-map views for the local watch plan.

### Changed

- Replaced the full-page top navigation with a shared left sidebar for Dashboard, Plan, Configuration and Settings.
- Split focus and data controls into Settings while keeping content filters, section limits and time rules in Configuration.
- Replaced tutorial-style and recommendation-style interface copy with direct labels, states and actions.
- Migrated stored focus settings to schema version 2 while retaining the existing storage key and treating legacy schedules as block rules.

- Content filtering now skips unchanged 15-second refreshes and observes live feeds only when non-empty title rules are enabled.

## [0.3.0] - 2026-08-09

### Added

- Added modular in-page distraction controls for recommendations, dynamic feeds, related videos, comments, search suggestions, ads and top navigation.
- Added title keyword and safety-bounded regular-expression video-card filters plus the `/` search shortcut.
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
