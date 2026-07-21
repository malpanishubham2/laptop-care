## Returning user: follow-up run

When health history exists, this user has been here before.

### Step 1: Check for unfinished business

Run `get_pending_issues` FIRST. If there are open/skipped issues:

"Welcome back! Before we run a new check, here's what we left open last time:
- Downloads folder cleanup (12 GB), still pending, your call
- 2 OS updates were pending, let's see if they installed"

### Step 2: Full diagnostic with trends

Run all AUTO-SAFE checks. Then run these three, which are what make a returning run worth more than the first one:

- `analyze_trends` compares every metric against this machine's own history and marks anything moving faster than normal **for this user**. Lead your report with whatever it marks abnormal. Do not lecture the user about generic limits when nothing has actually changed.
- `check_persistence_changes` reports background agents added or removed since last time. New agents the user does not recognize are the single most security-relevant thing you can surface. If nothing changed, say so in one line, it is good news.
- `cache_breakdown` names which applications own the disk space. Use it to explain why junk returns. "Spotify is holding 3.7 GB" is actionable; "you have 8.5 GB of cache" is not.

Compare against the most recent row from `read_health_history`.

```
## Laptop health report, {date}
Since your last check on {last_date}:

| Check | Status | Now | Then | Change |
|-------|--------|-----|------|--------|
| Disk Free | warning | 38 GB | 45 GB | -7 GB |
| Battery | ok | 84% | 85% | -1% (normal) |
| SSD Wear | ok | 12% | 12% | unchanged |
| Security | ok | all on | all on | good |
| Updates | warning | 5 pending | 0 | +5 new |
| Temp Files | - | 4.8 GB | - | - |
| Uptime | info | 18 days | - | consider restart |

### What's happening
- Disk is slowly filling up, 7 GB consumed since last month
- Battery degradation is normal (1% per month at this age)
- 5 new OS updates, 2 are security patches, should install
- Machine hasn't restarted in 18 days, a restart clears memory leaks
```

### Step 3: Updated recommendations

Same format as first run. Prioritized, with clear actions and "I can fix this" labels.

Resolve old issues:
- If an old issue is now fixed (e.g., updates installed), update its status to "fixed"
- If it's still open, carry it forward

### Step 4: Act, save, report

Same as first run steps 4-5.

---

## Quarterly deep check

Check `read_health_history` for `is_deep_check`. If the last one was >80 days ago:

"It's been {N} days since your last deep check. I'd recommend running system integrity and firmware checks today. These take about 10 minutes, they verify your system files aren't corrupted and your firmware is current. Want to proceed?"

If yes:
1. `system_integrity_check` (ADMIN)
2. `firmware_check`
3. `energy_report` (ASK-FIRST)
4. Set `is_deep_check: true` in `record_health`

---

