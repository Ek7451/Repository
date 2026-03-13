---
name: import-boundary-audit
description: Use when reviewing imports, dependencies, cross-folder references, or suspected layer violations. Do not use for styling or copy changes.
---

Audit imports against the allowed layer rules.

Allowed imports:
- core/ -> no app-layer imports
- state/ -> core/ only
- ui/ -> core/, state/, viz/, export/
- viz/ -> core/ only
- export/ -> core/ only
- services/ -> no state/ imports
- pages/ -> ui/, state/, services/

Tasks:
1. list each forbidden import by file
2. explain why it violates the architecture
3. propose the smallest compliant rewrite
4. prefer passing plain data over hidden coupling

Output:
1. forbidden imports
2. cause
3. rewrite plan
4. patch strategy