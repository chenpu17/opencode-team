---
description: rebuild team structure and optionally reset memory
---

Rebuild the team structure for the current project.

Rules:

- Use the `TeamRebuild` tool exactly once.
- If `$ARGUMENTS` contains `--reset-memory`, pass `resetMemory=true`.
- Otherwise preserve memory by default.

After the tool call:

- Summarize module count, member count, and whether memory was reset.

$ARGUMENTS
