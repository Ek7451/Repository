---
name: monolith-split-planner
description: Use when a large file mixes responsibilities and must be split without changing behavior. Especially relevant for app.js and exporter extractions.
---

Plan a behavior-preserving split.

Method:
1. identify current responsibilities
2. group code by responsibility
3. map each group to the correct destination folder
4. define the extraction order with the lowest breakage risk
5. identify shared helpers that should stay local or move to core/

Output:
1. current responsibility map
2. proposed file split map
3. destination paths
4. extraction sequence
5. circular import risks
6. verification checklist

Rules:
- split by responsibility, not line count alone
- prefer minimal churn
- do not redesign stable core modules