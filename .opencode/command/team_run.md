---
description: run a task through the virtual team
---

Start one team run for the current project.

Rules:

- Use the `TeamRun` tool exactly once.
- Treat `$ARGUMENTS` as the requirement string.
- If no team exists yet, tell the user to run `/team_create` first.

After the tool call:

- Summarize whether the run started, task count, and that progress will appear in the sidebar.

$ARGUMENTS
