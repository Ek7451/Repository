# export/AGENTS.md

Export modules accept solver output and required inputs as arguments.

Rules:
- no imports from ui/
- no direct DOM reads
- no hidden reads from AppState
- keep exporter helpers inside the exporter unless reused broadly
- prefer pure functions or small focused classes