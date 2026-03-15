---
name: import-boundary-audit
description: Use when reviewing imports, dependencies, cross-folder references, or suspected layer violations. Do not use for styling or copy changes.
---

Audit imports against the approved layer rules and AGENTS.md scope rules.

Before doing anything:
1. Read all applicable AGENTS.md files for the files in scope.
2. Follow the deepest scoped AGENTS.md if instructions conflict.
3. Use AGENTS.md as the source of truth for folder boundaries when repo docs disagree.
4. For larger rewrites, start in Ask mode and produce:
   - files with forbidden imports
   - the smallest compliant rewrite
   - verification commands

Allowed directions by default:
- core/ -> no ui/, no viz/, no browser-only APIs
- state/ -> core/ only when needed, no ui/, no viz/
- ui/ -> core/, state/, viz/, export/
- viz/ -> core/ only if needed for render support
- export/ -> core/ only unless AGENTS.md explicitly allows more
- services/ -> no state/
- pages/ -> ui/, state/, services/

Additional architecture checks:
- flag reverse imports
- flag callback reach-through that recreates hidden coupling
- flag when ui/app.js learns more state shape, solver setup, project normalization, or renderer geometry than before
- prefer passing plain data or a narrow interface over broad reach-through callbacks

Tasks:
1. list each forbidden import by file
2. explain why it violates the architecture
3. identify hidden coupling even if imports are technically legal
4. propose the smallest compliant rewrite
5. prefer existing modules over new files

Required checks:
- repo architecture or forbidden-import checks if present
- lint
- tests if dependency wiring changed

Output:
1. forbidden imports
2. hidden coupling risks
3. cause
4. smallest compliant rewrite
5. patch strategy
6. verification checklist

Completion criteria:
- no reverse imports
- no AGENTS.md boundary violations
- no hidden reach-through that recreates a central controller
- ui/app.js does not gain new knowledge that belongs in another layer