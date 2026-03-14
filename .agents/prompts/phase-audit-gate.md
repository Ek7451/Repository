before closing out this phase,audit this refactor phase as if you are blocking the next phase.

Use this phase contract:
[paste contract]

Instructions:
- Do not edit code
- Review only whether this phase is fully complete
- Be strict about out-of-scope changes
- Identify missing call sites, dead transitional code, broken invariants, test gaps, and compatibility risks
- For each acceptance criterion, mark:
  - PASS with evidence
  - FAIL with exact reason
  - UNPROVEN with the command or inspection needed
- End with:
  1. Can we safely move to the next phase: yes or no
  2. Remaining work before phase close
  3. Files that need re-checking