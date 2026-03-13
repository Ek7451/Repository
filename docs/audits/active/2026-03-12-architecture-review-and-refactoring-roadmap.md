\*\*Seating Bowl Generator\*\*



Architecture Review \& Refactoring Roadmap



\_Prepared for: Elliott\_



March 2026



\# Executive Summary



The Seating Bowl Generator is a well-conceived engineering tool that has been executing effectively as a prototype. The core calculation engine is genuinely good - the separation of ProfileSolver, SightlineAnalyzer, and AisleLayout into discrete modules reflects sound engineering instincts.



The primary structural problem is that app.js has become a 4,328-line God Object containing seven distinct responsibilities that need to be separated. This is the single highest-risk file in the codebase. Everything else is manageable.



The good news: this is a clean, fixable problem. The calculation layer is already well-isolated. The refactoring work is largely about extracting the export pipeline and stats rendering out of the App controller - not rebuilding the engine.



\_Critical finding: 33 methods in app.js are Rhino 3DM geometry helpers (lines 2284-3340). These ~1,050 lines belong in a dedicated RhinoExporter module and have nothing to do with UI control or application orchestration.\_



\# 1\\. Codebase File Inventory



Total source: approximately 16,400 lines across 10 JavaScript modules, 1 HTML file, and 1 CSS file.



| \*\*File\*\*                        | \*\*Lines\*\* | \*\*Assessment\*\*                                                            |

| ------------------------------- | --------- | ------------------------------------------------------------------------- |

| \*\*app.js\*\*                      | 4,328     | ⚠️ God Object - 7+ responsibilities crammed into one class. Biggest risk. |

| \*\*field-renderer.js\*\*           | 1,953     | ⚠️ Large but coherent. Handles 2D canvas rendering. Acceptable as-is.     |

| \*\*aisle-layout.js\*\*             | 1,586     | ✅ Well-scoped calculation module. Keep as-is.                            |

| \*\*scene3d.js\*\*                  | 1,443     | ✅ Reasonable Three.js wrapper. Could slim down slightly.                 |

| \*\*profile-renderer.js\*\*         | 968       | ✅ Well-scoped 2D profile renderer. Keep as-is.                           |

| \*\*profile-solver.js\*\*           | 470       | ✅ Core calculation engine - clean, well-isolated.                        |

| \*\*sports-templates.js\*\*         | 183       | ✅ Pure data constants. Perfect.                                          |

| \*\*sightline-calc.js\*\*           | 129       | ✅ Clean utility module. Perfect.                                         |

| \*\*default-starting-profile.js\*\* | 119       | ✅ Pure data constants. Acceptable.                                       |

| \*\*index.html\*\*                  | 2,662     | ⚠️ Very large. All UI markup in one file - manageable for now.            |

| \*\*styles.css\*\*                  | 2,542     | ✅ Large but single-responsibility. Acceptable.                           |



\# 2\\. Architectural Critique



\## 2.1 The God Object Problem in app.js



The App class currently holds these distinct responsibilities simultaneously:



\- UI event wiring (~320 lines) - \\\_wireEvents, tooltip setup, slider sync

\- Theme management (~60 lines) - \\\_initTheme, \\\_applyTheme, \\\_toggleTheme

\- Sport state management (~150 lines) - \\\_saveSportState, \\\_loadSportState

\- Application orchestration (~200 lines) - update(), \\\_scheduleUpdate, \\\_getBowlConfig

\- Statistics rendering (~550 lines, lines 1294-1837) - \\\_updateStats and all its HTML generation

\- Rhino 3DM export pipeline (~1,050 lines, lines 2203-3340) - 33 geometry helper methods

\- DXF export (~340 lines) - \\\_exportDXF, \\\_exportPlanDXF, \\\_addDXFShape

\- Config/session management (~200 lines) - \\\_exportConfig, \\\_loadConfig, \\\_applyStartupProfile, \\\_applyConfigObject

\- Camera bookmark management (~200 lines) - \\\_saveCameraBookmark, \\\_renderCameraBookmarks



\_A class with 9 discrete responsibilities violates the Single Responsibility Principle in a way that has real, practical consequences: any engineer modifying the Rhino exporter risks accidentally touching stats rendering. An AI agent refactoring the DXF export can easily corrupt event wiring. The file is too large to reason about as a whole.\_



\## 2.2 What Is Actually Working Well



Before focusing on problems it is worth acknowledging what is genuinely solid:



\- The calculation layer is well-isolated. ProfileSolver, SightlineAnalyzer, AisleLayout, and the sports templates are independent, stateless modules with clear inputs and outputs. This is the hardest architectural decision to get right and it was made correctly.

\- The renderer/solver separation is clean. The renderers consume solver output rather than running calculations themselves.

\- scene3d.js is a reasonable Three.js abstraction that does not reach back into application state inappropriately.

\- The debounced update pattern in \\\_scheduleUpdate is correct and efficient.



\## 2.3 Hidden Technical Debt



\### DOM-as-state-store



The application reads form values directly from the DOM on every update cycle (via \\\_getInputValue). This means the DOM is the source of truth for application state. While this works for a single-page prototype, it becomes unmaintainable when adding project persistence - you cannot serialize or restore state without traversing every input element. This is the primary blocker for the project dashboard feature.



\### No state layer



There is no explicit AppState object. State is fragmented across: the DOM itself, private properties on the App class (\\\_sportStates, \\\_cameraBookmarks, \\\_tierAisleLayouts), and the ProfileSolver instances. Adding project save/load requires extracting all of this into a coherent state object first.



\### Update function complexity



The update() method (lines 1031-1223) orchestrates all rendering. At ~200 lines it is doing too much. It directly reads from DOM, invokes solvers, triggers all renderers, and manages 3D sync. Any change to the render pipeline requires modifying this method.



\### Export code tightly coupled to app.js



All export methods access this.scene3D, this.\\\_solver, this.\\\_tierAisleLayouts, and DOM elements directly. They are untestable in isolation. Rhino geometry helper methods (\\\_rhinoPointDistance, \\\_rhinoTriangleArea, \\\_toRhinoPointFromThree, etc.) are pure functions that have no business being instance methods of the App class.



\# 3\\. Ideal Architecture



\## 3.1 Layer Model



For a parametric engineering tool of this type, the layers should be:



| \*\*Layer\*\*              | \*\*Responsibility\*\*                                                                                                       | \*\*Current State\*\*                     |

| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |

| \*\*UI Layer\*\*           | HTML templates, event binding, DOM updates only. No calculations, no business logic.                                     | Mixed into App class and index.html   |

| \*\*Application State\*\*  | Single serializable AppState object: sport, tiers, focal point, bookmarks, session config. The save/load target.         | Fragmented across DOM + private props |

| \*\*Calculation Engine\*\* | Pure functions: profile solving, sightline analysis, aisle layout, bowl geometry. No DOM, no Three.js, no exports.       | Already well-isolated ✅              |

| \*\*Visualization\*\*      | 2D canvas renderers (field, profile) and 3D Three.js scene. Consume solver output only.                                  | Mostly good ✅                        |

| \*\*Export Services\*\*    | Self-contained modules: DXFExporter, RhinoExporter, OBJExporter, CSVExporter. Accept solver output, return file content. | Embedded inside App class ⚠️          |



\# 4\\. Recommended Directory Structure



This structure maps to the future-state architecture without over-engineering the current prototype. File count stays manageable.



\*\*seating-bowl/\*\*



index.html # Entry point (slim - just shell + import)



styles.css



\*\*core/ # Pure calculation engine - no DOM, no Three.js\*\*



profile-solver.js # (existing) ✅



sightline-calc.js # (existing) ✅



aisle-layout.js # (existing) ✅



sports-templates.js # (existing) ✅



default-starting-profile.js # (existing) ✅



\*\*state/ # Application state (NEW - the save/load target)\*\*



app-state.js # AppState class - serializable, restorable



\*\*ui/ # UI controllers (extracted from app.js)\*\*



app.js # Slim orchestrator (~600 lines max)



stats-panel.js # \\\_updateStats and HTML generation (extracted)



camera-bookmarks.js # Bookmark management (extracted)



\*\*viz/ # Visualization (mostly existing, minor rename)\*\*



field-renderer.js # (existing) ✅



profile-renderer.js # (existing) ✅



scene3d.js # (existing) ✅



\*\*export/ # Export pipeline (extracted from app.js)\*\*



rhino-exporter.js # All 33 Rhino methods (~1,050 lines extracted)



dxf-exporter.js # \\\_exportDXF + \\\_exportPlanDXF (~340 lines)



obj-csv-exporter.js # OBJ + CSV export (smaller, can merge)



\_Total target: 17-20 files. Same as today, but with clear responsibility boundaries. This is NOT micro-modularization - it is the minimum necessary separation for the codebase to be maintainable.\_



\# 5\\. Refactoring Roadmap



Ordered by impact vs. risk. Each phase is independently shippable.



\## Phase 1 - Extract Export Pipeline (Highest Impact, Low Risk)



This is the easiest and most valuable change. The Rhino export methods are pure functions in everything but name - they do not mutate application state. They just need a reference to the scene3D object and solver output passed in, rather than accessing this.scene3D.



\- Create export/rhino-exporter.js. Move all methods from \\\_getRhinoExportOffsetCorrection through \\\_createRhinoMeshFromThreeMesh (lines 2284-3340) into a RhinoExporter class or module.

\- RhinoExporter receives (solvers, scene3D, bowlConfig) as constructor args or a single export() call argument. No App class reference needed.

\- Create export/dxf-exporter.js. Move \\\_exportDXF, \\\_exportPlanDXF, \\\_addDXFShape (lines 3343-3521) into a DXFExporter module.

\- In app.js, replace the extracted methods with single-line delegations: this.\\\_rhinoExporter.export(...)

\- app.js drops from 4,328 lines to approximately 2,900 lines.



\## Phase 2 - Extract Stats Panel (High Impact, Low Risk)



The \\\_updateStats method and all its internal HTML generation (~550 lines, 1294-1837) is pure rendering logic that reads from solver output. It does not need to be inside the App class.



\- Create ui/stats-panel.js with a StatsPanel class that holds a container element reference.

\- StatsPanel.update(solvers, aisleLayouts, bowlConfig) replaces the entire \\\_updateStats block.

\- app.js calls this.statsPanel.update(...) after each solve cycle.

\- app.js drops from ~2,900 to approximately 2,350 lines.



\## Phase 3 - Introduce AppState (Required for Project Persistence)



This phase is required before implementing the project dashboard and save/load features. It does not reduce line count significantly - it restructures data flow.



\- Create state/app-state.js. Define an AppState plain object (or class) that holds all configurable parameters: sport, tier configs (numRows, treadDepth, etc.), focalZ, customRunoff, bowlType, aisle settings, camera bookmarks.

\- Replace all direct DOM reads in update() with reads from this.state.

\- Wire all input events to write to this.state first, then call this.update().

\- AppState.toJSON() / AppState.fromJSON() become the save/load implementation. This is the foundation for project persistence.

\- \\\_applyConfigObject() and \\\_applyStartupProfile() become AppState.applyConfig() - the state object owns its own deserialization.



\## Phase 4 - Extract Camera Bookmarks (Low Impact, Low Risk)



The camera bookmark logic (~200 lines) is entirely self-contained UI state. Move it to ui/camera-bookmarks.js as a CameraBookmarks class once Phase 3 is complete, since bookmarks should serialize into AppState.



\## Phase 5 - Backend \& Auth (Future - Post-Refactor)



Only begin this after Phases 1-3 are complete. The AppState object from Phase 3 becomes the API payload. A minimal backend needs:



\- Azure/Entra ID MSAL authentication (browser-side MSAL.js library)

\- A thin REST API (Node/Express or Python FastAPI) with endpoints: GET /projects, POST /projects, GET /projects/:id, PUT /projects/:id

\- Database: PostgreSQL with a projects table (id, user\_id, name, created\_at, state JSONB)

\- The calculation engine stays entirely browser-side - no server-side port needed



\# 6\\. AI Guardrails for Future Refactoring



These rules should be included verbatim in any system prompt given to an AI agent working on this codebase. They prevent the failure mode where AI agents over-abstract, fragment, or duplicate logic.



\## 6.1 The One Source of Truth Rules



\_RULE: There is exactly one calculation pipeline. ProfileSolver computes row geometry. SightlineAnalyzer computes C-values. AisleLayout computes egress. Never duplicate these calculations in other files. If you find yourself writing sightline or profile math outside of core/, stop and use the existing module instead.\_



\_RULE: There is exactly one AppState object. Application parameters are read from and written to AppState. Never read form values directly in calculation or export code. Never create a second state cache or parameter snapshot.\_



\## 6.2 File Count Rules



\- Target file count: 17-22 JavaScript files. If an agent creates more than 5 new files in a single session, it is over-modularizing.

\- Do not create a new file for a function under 50 lines unless it is a pure utility used by 3+ modules.

\- Do not create index.js barrel files. Named imports from specific module files are preferred.

\- Helper functions that are used only within one module stay in that module, even if they are long.



\## 6.3 Layer Violation Rules



\- core/ modules must not import from ui/, viz/, or export/. They are pure calculation - no DOM, no canvas, no Three.js.

\- export/ modules must not import from ui/. They receive solver output as arguments, not from the DOM.

\- viz/ renderers must not run calculations. They render pre-computed solver output.

\- If an agent creates a new file in core/ that imports Three.js, revert it immediately.



\## 6.4 Anti-Patterns to Reject



\- A 'useSeatingBowl hook', 'BowlContext', or any React-style abstraction in vanilla JS code. This is not a React app.

\- A EventBus, PubSub, or custom message queue. Direct method calls are correct here.

\- A ServiceLocator, DependencyContainer, or factory pattern. Pass dependencies explicitly as constructor arguments.

\- Splitting a module into a 'base' class and derived class unless there is a proven need for polymorphism.

\- Any file that re-exports all members of another file (barrel files). They create import confusion.



\# 7\\. Summary



The architecture of the Seating Bowl Generator is in better shape than it might feel from the inside. The calculation engine is genuinely clean and represents sound engineering judgment. The problem is bounded and tractable.



<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>What to Keep</strong></p></th><th><p><strong>What to Fix</strong></p></th></tr></thead><tbody><tr><td><ul><li>ProfileSolver, SightlineAnalyzer, AisleLayout - touch nothing</li><li>sports-templates.js and default-starting-profile.js</li><li>All three renderers (field, profile, scene3d)</li><li>Debounced update pattern</li></ul></td><td><ul><li>Extract Rhino exporter (~1,050 lines) from app.js</li><li>Extract DXF exporter (~340 lines) from app.js</li><li>Extract stats panel (~550 lines) from app.js</li><li>Introduce AppState to replace DOM-as-state</li></ul></td></tr></tbody></table></div>



Completing Phases 1 and 2 of the refactoring roadmap reduces app.js from 4,328 lines to roughly 1,800-2,000 lines - without adding file count, without changing any calculation logic, and without touching any of the modules that are already clean.



Phase 3 (AppState) is the prerequisite for the project dashboard. Once state is serializable, adding Microsoft SSO and a project persistence backend becomes a well-scoped, additive feature rather than a structural surgery.

