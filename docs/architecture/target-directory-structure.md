
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SEATING BOWL GENERATOR — RECOMMENDED DIRECTORY STRUCTURE  (v2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Changes from v1
  ───────────────
  ① services/ no longer imports state/ — receives plain data objects
    instead. API layer stays decoupled from frontend state model.
  ② viz/ renderers no longer pull from state/ — data is passed in
    as arguments. Keeps renderers reusable and independently testable.
  ③ export/rhino/ is now a subfolder (3 focused files) rather than
    one 1,050-line monolith.
  ④ root app.js remains an approved thin bootstrap exception rather
    than forcing route bootstrapping into pages/.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

seating-bowl/
│
│
├── app.js                            # Thin bootstrap + route shell.
│                                     # Approved root exception. [existing ✅]
│
│
├── pages/                             # The two screens users navigate between
│   │
│   ├── dashboard/                     # ❶ PROJECT DASHBOARD   [existing ✅]
│   │   ├── dashboard.html             #   Landing page after login. [existing ✅]
│   │   ├── dashboard.js               #   Shows project list, opens studies, 
|   |   |                                                             [existing ✅]
│   │   └── dashboard.css              #   displays key metrics per project. 
|   |                                                                 [existing ✅]
│   │
│   └── configurator/                  # ❷ SEATING BOWL CONFIGURATOR  [existing ✅] 
│       ├── index.html                 #   The main bowl design tool. [existing ✅]
│       └── styles.css                 #   All existing UI lives here.[existing ✅]
│
│
├── core/                              # THE CALCULATION ENGINE
│   │                                  # Pure math only — no DOM, no Three.js,
│   │                                  # no imports from any other folder.
│   │                                  # Most stable layer. Rarely changes.
│   │
│   ├── profile-solver.js              #   Row positions, riser heights,
│   │                                  #   tread geometry per tier. [existing ✅]
│   │
│   ├── sightline-calc.js              #   C-value calculation and sightline
│   │                                  #   quality ratings per row. [existing ✅]
│   │
│   ├── aisle-layout.js                #   Egress, aisle positions,
│   │                                  #   vomitory geometry.       [existing ✅]
│   │
│   ├── sports-templates.js            #   Field dimension constants per
│   │                                  #   sport (Football, Soccer…) [existing ✅]
│   │
│   └── default-starting-profile.js   #   Default parameter values on
│                                      #   first launch.            [existing ✅]
│
│
├── state/                             # APPLICATION STATE
│   │                                  # The serializable memory of the app.
│   │                                  # This is the save/load target.
│   │                                  # Only imports from core/.
│   │
│   ├── app-state.js                   #   All live bowl configurator params:
│   │                                  #   sport, tier settings, focal point,
│   │                                  #   camera bookmarks, aisle config.
│   │                                  #   toJSON() / fromJSON() for persistence.
|   |                                  #                            [existing ✅]
│   │
│   └── project.js                     #   Single-study project envelope:
│                                      #   { id, name, sport, createdAt,
│                                      #     updatedAt, state } [existing ✅]
│                                      #   This is what gets stored in the DB.
│
│
├── ui/                                # CONFIGURATOR UI CONTROLLERS  
│   │                                  # Reads from state/, calls core/ solvers,
│   │                                  # passes results down to viz/.
│   │                                  # No calculations. No direct DOM data reads.
│   │
│   ├── app.js                         #   Main orchestrator.
│   │                                  #   Reads AppState → calls solvers →
│   │                                  #   passes output to renderers.
│   │                                  #   Target: 600–800 lines.  [existing ✅]
│   │
│   ├── stats-panel.js                 #   Generates sightline summary and
│   │                                  #   stats tables from solver output.
│   │                                  #   (~550 lines from app.js)  [existing ✅]
│   │
│   ├── camera-bookmarks.js            #   Save, restore, rename, delete
│   |                                  #   3D camera views.
│   |                                  #   (~200 lines from app.js)  [existing ✅]
|   |
│   ├── project-dashboard.js           # [existing ✅]
|   |                                  #
|   |                                  #
|   |
|   |
|   └── editor-shell.js                # [existing ✅]
|                                      #
|                                      #
|   
│
├── viz/                               # VISUALIZATION  [existing — rule tightened]
│   │
│   │                                  # ⚠️  REVISED RULE (v2):
│   │                                  # Renderers receive pre-computed data
│   │                                  # as arguments — they do NOT read from
│   │                                  # state/ directly. This keeps them
│   │                                  # reusable and independently testable.
│   │
│   ├── field-renderer.js              #   Draws 2D field plan on canvas.
│   │                                  #   Called as: renderer.draw(fieldData)
│   │                                  #                             [existing ✅]
│   │
│   ├── profile-renderer.js            #   Draws 2D bowl section profile.
│   │                                  #   Called as: renderer.draw(solverOutput)
│   │                                  #                             [existing ✅]
│   │
│   └── scene3d.js                     #   Three.js 3D scene — bowl mesh,
│                                      #   seats, lighting, orbit controls.
│                                      #   Called as: scene.update(solverOutput)
│                                      #                             [existing ✅]
│
│
├── export/                            # EXPORT PIPELINE  [extracted + restructured]
│   │                                  # Each exporter receives solver output
│   │                                  # as plain arguments — no DOM, no state.
│   │
│   ├── rhino/                         #   Rhino 3DM export — split into 3 files
│   │   │                              #   to prevent a new monolith.  [existing ✅]
│   │   │
│   │   ├── rhino-exporter.js          #     Entry point. Orchestrates the
│   │   │                              #     Rhino export pipeline. [existing ✅]
│   │   │
│   │   ├── rhino-geometry.js          #     Brep/mesh construction helpers:
│   │   │                              #     ruled surfaces, quad patches,
│   │   │                              #     point math utilities.  [existing ✅]
│   │   │
│   │   └── rhino-layers.js            #     Layer naming, tier categories,
│   │                                  #     layer index management.  [existing ✅]
│   │
│   ├── dxf-exporter.js                #   DXF plan + section export.
│   │                                  #   (~340 lines from app.js)  [existing ✅]
│   │
│   └── obj-csv-exporter.js            #   OBJ mesh + CSV row data table.
│                                      #                              [existing ✅]
│
│
└── services/                          # BACKEND SERVICES
    │
    │                                  # ⚠️  REVISED RULE (v2):
    │                                  # Services do NOT import from state/.
    │                                  # They accept plain serialized objects
    │                                  # as arguments (DTOs). The API layer
    │                                  # must stay decoupled from the frontend
    │                                  # state model.
    │
    ├── auth-service.js                #   Microsoft SSO via MSAL.js.
    │                                  #   Sign-in, token refresh, current user.
    │                                  #   Returns plain user object.
    |                                  #                              [existing ✅]
    │
    └── project-api.js                 #   REST API calls: ❓
                                       #   loadProjects(), saveStudy(plainObj),
                                       #   createProject(), deleteProject().
                                       #   Accepts/returns plain JSON — not
                                       #   AppState instances.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FILE COUNT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Layered JS files:             22   — pages/, core/, state/, ui/, viz/,
                                       export/, services/
  Approved root bootstrap:      +1   — root app.js thin route shell
                                       exception
  ─────────────────────────────────
  Total JS files on disk:       23   — 22 layered modules plus the
                                       approved root bootstrap


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  REVISED LAYER IMPORT RULES  (v2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  core/      →  nothing           (pure math, zero dependencies)
  state/     →  core/ only
  ui/        →  core/, state/, viz/, export/
  viz/       →  core/ only        (data passed in — does NOT read state/)  ← revised
  export/    →  core/ only        (data passed in — does NOT read state/)
  services/  →  nothing           (accepts plain DTOs — does NOT read state/) ← revised
  pages/     →  ui/, services/, state/

  Data flow:

    pages/
      └─→  services/  (plain JSON in / plain JSON out)
      └─→  state/  (load/save AppState)
             └─→  core/  (AppState feeds solvers)
    ui/
      └─→  core/  (calls solvers with AppState params)
      └─→  viz/   (passes solver output as args)
      └─→  export/ (passes solver output as args)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  WHAT CHANGED FROM v1 AND WHY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ① services/ decoupled from state/
    v1 said services/ imports state/ only.
    Problem: your API layer knowing about AppState means a frontend
    model leaks into backend communication. If AppState changes shape,
    your API calls break. Services should speak plain JSON — nothing more.

  ② viz/ renderers no longer read state/
    v1 allowed viz/ to import state/.
    Problem: a renderer that reads state directly is harder to test,
    harder to reuse, and creates an invisible coupling. Passing solver
    output in as an argument makes the data flow explicit and traceable.

  ③ export/rhino/ split into 3 files
    v1 had one rhino-exporter.js at ~1,050 lines.
    Problem: that is just moving the monolith, not fixing it. Splitting
    into entry point / geometry helpers / layer management keeps each
    file focused and prevents the export folder becoming the next app.js.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
