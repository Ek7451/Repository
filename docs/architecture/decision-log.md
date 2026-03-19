# Architecture Decision Log

## 2026-03-14: Full Alignment Phase 1 Canonical Decisions

- Root `app.js` remains an approved thin bootstrap and route shell exception. It is not the old editor monolith and does not need to move into `pages/`.
- The canonical persisted project DTO remains the single-study envelope:
  `{ id, name, sport, createdAt, updatedAt, state }`.
- `ui/editor-controls.js` is an approved configurator UI controller for AppState-driven control bindings and state-to-DOM synchronization. It remains in `ui/` and does not change the rule that `ui/app.js` is the main editor orchestrator.
- Multi-study project wrapping is deferred unless it is introduced later as a new feature with its own state and service design.
- Productized SSO and backend auth hardening are intentionally deferred. Current architecture alignment must not block on that productization track.

## 2026-03-18: Runtime Truth Sync Before Shell Extraction

- The stats view-model split is now implemented: `ui/stats-view-model.js` owns pure stats/detail shaping, `ui/stats-panel.js` renders from that DTO, and `ui/render-runtime.js` no longer depends on renderer-owned view-model code.
- `ui/app.js` remains stable as the configurator composition root and top-level runtime orchestrator; downstream shell cleanup should not use it as a new destination for feature DOM behavior.
- `ui/project-shell-controller.js` is the current pure owner of project chrome/status snapshots and save-request shaping; it is not the destination for project toolbar DOM extraction.
- `ui/editor-shell.js` is now the next highest-risk UI split target and should be thinned by preserving a narrow facade while extracting project chrome and workspace shell behavior into focused owners.

## 2026-03-18: Final Shell Split And Bootstrap Re-Audit

- `ui/editor-shell.js` remains intentionally present as a thin facade so `ui/app.js` can keep one stable shell API while direct DOM ownership lives in narrower modules.
- `ui/project-chrome-shell.js` owns project toolbar, project menu, project picker, option-manager, save-status, and export-trigger shell DOM because those behaviors form one coherent project-shell surface.
- `ui/workspace-shell.js` owns theme, tabs, canvas hookup, layout resize, tooltips, feedback, and generic collapsible shell DOM because those behaviors form one coherent workspace-shell surface.
- `ui/app.js` was intentionally not reopened as the destination for either split because that would have re-centralized feature DOM behavior in the configurator composition root.
- Root `app.js` remains the approved bootstrap and project-action-port owner after re-audit; no compliant pure-helper extraction remained that would improve architecture without just moving line count sideways.

## 2026-03-19: Aisle, Egress, And Label Truth Comes From Core Analysis

- `core/aisle-layout.js` is the authoritative owner of aisle-analysis truth. `buildTierAisleAnalysis()` and `buildConfigurationAisleSummary()` define the runtime source of truth for aisle placement results, row and section seat counts, aisle occupancies, required/governing/rendered widths, per-tier totals, and configuration totals.
- `sectionSummary` is the canonical per-tier contract. Any runtime consumer that needs aisle widths, seat counts, occupancies, compliance, or aggregate aisle/section metrics must read them from `tierLayout.sectionSummary` rather than recomputing them.
- `core/egress-policy.js` and `core/seat-math.js` remain pure helper libraries only. They may support `core/aisle-layout.js`, but non-`core` modules must not call them to derive user-facing aisle or egress truth.
- `core/profile-solver.js` is now a compatibility adapter, not a second analysis engine. Legacy metrics must be mapped from authoritative layout summaries via `buildTierMetricsByIndexFromLayouts(...)` and must not recalculate aisle, egress, or occupancy values.
- `viz/field-renderer.js`, `viz/scene3d.js`, `ui/render-runtime.js`, `ui/stats-view-model.js`, and `export/obj-csv-exporter.js` must consume authoritative analysis outputs only. They may format, label, render, or export summary data, but they must not perform fallback width math, occupancy math, seat counting, or total reductions as competing truth paths.
- When a legacy scalar field still expects one aisle width, the compatibility value is the authoritative maximum rendered or governing value from core summary data rather than a UI-, viz-, or export-side recomputation.
- This decision preserves the current layering intent: domain interpretation stays in `core/`, rendering stays in `viz/`, presentation stays in `ui/`, export shaping stays in `export/`, and `ui/app.js` remains unchanged as the thin composition root instead of becoming a coordination point for aisle or egress truth.
