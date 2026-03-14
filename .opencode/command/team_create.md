---
description: initialize the virtual team for the current project
---

Initialize the team for the current project.

Rules:

- Use the `TeamCreate` tool exactly once.
- If a team already exists, do not guess. Explain that `/team_sync` or `/team_rebuild` should be used instead.
- If the user passed arguments, interpret them as optional tuning for parallelism or module sizing when reasonable.

After the tool call:

- Summarize team id, module count, member count, and max parallel.
- Do not ask the user to create the team manually.

$ARGUMENTS
