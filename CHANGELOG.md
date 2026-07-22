# Changelog

Versions marked (npm) were published to the registry. Unmarked versions were
folded into the next published release.

## 0.12.0 (npm)
- inspect_folder now works on Windows too (PowerShell folder-size breakdown), not just macOS. Fixed the injection guard so it stops blocking legitimate Windows paths, which contain backslashes.
- disable_startup_item and re_enable_startup_item now return an honest "not on Windows yet" message pointing the user to Task Manager > Startup, instead of failing silently. Windows startup lives in the registry, and auto-editing it needs a proper reversible mechanism before it ships.

## 0.11.1 (npm)
- inspect_folder now works anywhere on the machine, not just the home directory. A disk-space problem often lives in /Applications or /Library, and the user has every right to see what is using space on their own machine. Still read-only, and now rejects shell metacharacters in the path so du stays injection-safe.

## 0.11.0
- inspect_folder: drill into any folder under the home directory and break it down by size, largest first. Read-only. Lets the agent dig deeper than the top-level cache_breakdown (e.g. "what is inside the 8 GB of caches", then keep drilling into Spotify's cache a level at a time). Confined to the home directory; rejects path traversal and anything outside it.
- Prompt now tells the agent to act when the user says yes rather than re-explaining or handing back manual steps for something it has a tool for, and to use inspect_folder when the user wants to dig deeper.
- disable_startup_item now requires startup_items to have run first (sequencing gate).

## 0.10.0
- Agent can disable a startup item itself instead of telling the user how. Moves the launch agent to a reversible quarantine folder and unloads it.
- Refuses to disable corporate, security, or device-management agents. The guard is enforced in code, not just asked of the model.
- `re_enable_startup_item` and `list_disabled_startup_items` to undo and review.
- Hard ban on em dashes in agent output, holds on weaker models like Sonnet.

## 0.9.1 (npm)
- Inspection card renders as a markdown table so columns align.

## 0.9.0 (npm)
- Split the playbook by lifecycle stage. Connect cost dropped from ~5,405 to ~438 tokens; a returning run loads ~2,811 instead of the full file.
- Rewrote the README for evaluators, with a flow diagram and the agent-vs-script comparison.

## 0.8.0
- Moved safety and coverage from prompt into enforced code: sequencing gates, an execution log, and a server-built report card that cannot claim checks that did not run.

## 0.7.0
- 15-point inspection report for first runs, a plain-language verdict before the recommendations, and a closing habits note.

## 0.6.0
- Report judgment and tone: removed bracket tags from user-facing text, backup now asks rather than concluding data loss, updates reported by security relevance instead of a count, startup items reframed as a security finding.

## 0.5.1 (npm)
- Same-day reports no longer overwrite each other.

## 0.5.0
- Code-enforced consent lock, personal baselines instead of global thresholds, persistence monitoring.

## 0.4.0
- Consent gate added to first-run onboarding.

## 0.3.1 (npm)
- Removed osascript calls that triggered a macOS permission dialog and froze the run mid-scan.

## 0.3.0 (npm)
- Push agent instructions to the client on connect instead of waiting to be asked, which is what made onboarding reliably fire.

## 0.2.0 (npm)
- Issue tracking, report storage, MCP prompts, plain-tone docs, npm packaging, and a fix for a command-chaining bug in the temp scan and trash tools.

## 0.1.0
- Initial release: cross-platform laptop maintenance MCP server.
