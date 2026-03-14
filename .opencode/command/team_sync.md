---
description: sync team structure while preserving owners and memory
---

Sync the existing team structure for the current project.

Rules:

- Use the `TeamSync` tool exactly once.
- Preserve owner and memory continuity by default.
- If no team exists yet, explain that `/team_create` should be used first.

After the tool call:

- Summarize how many modules and members were synced.
- Mention that owner and memory were preserved.

$ARGUMENTS
