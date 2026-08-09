# dkhobby.com/lol-coach — Riot Compliance Wording Fixes

## Why this matters

Riot's developer policy explicitly prohibits: "real-time data that would improve a player's performance immediately by altering player behavior (i.e. 'go here now'), versus altering it upon reflection, learning and coaching the player game over game." (Source: developer.riotgames.com/policies/general, support-developer.riotgames.com API Terms and Conditions)

The rule of thumb: **describe the situation, don't issue a command.** "Enemy jungler missing 25s" is fine. "Retreat now" is not. Static, pre-game, or post-game advice is fine even if phrased more directly, since it's not reactive to live in-match state.

This same rewording pass was already applied throughout the actual app code (alert text, live AI coaching prompt). The site's copy needs the same pass — one example on the page right now is a real problem.

## 1. Fix immediately — the sample AI tip text

**Current (red flag):**
> "Enemy bot lane has no Flash for 30s. Ping your jungler to setup dragon control or dive before dragon spawns."

This is the exact prohibited pattern — live, reactive, tells the player exactly what to do right now, and it's the single most visible example on the page (shown as the feature's showcase example).

**Replace with something descriptive, not prescriptive:**
> "Enemy bot lane is missing Flash for the next 30s — a window worth noting before Dragon spawns."

or simpler:
> "Enemy bot lane's Flash is down for 30s."

Either version shows the AI surfaces useful, timely information without telling the player what action to take.

## 2. Everything else on the page — checked, no other issues found

The rest of the current copy (feature descriptions, "Smart Alerts," "Jungle Threat: DANGER" status badges, quickstart steps, safety section, business model line) is descriptive/informational, not prescriptive. No other changes needed there.

## 3. Add: free tier / subscription / BYO-key clarity

Current business model line is accurate but vague about the built-in service having a cap. Replace it with:

> "Free to use, including a limited number of AI-coached games per day using our built-in service (funded by Overwolf ad revenue). Once you reach that limit, you can wait for it to reset, subscribe for unlimited access, or supply your own free AI API key (Claude or Gemini) for unlimited use at no cost to us."

Deliberately no specific number of free games included — that cap isn't tuned yet from real usage data, and a stale promised number on a public page is worse than a vague accurate one. Update this line to a concrete number once it's actually decided and implemented.

## 4. General principle for future copy

Before adding any new example text, feature description, or marketing tagline that shows what the AI/app says during a live game, run it through this check: **does it tell the player a specific action to take right now, in reaction to the current moment?** If yes, reword it to state the fact/observation and let the player draw their own conclusion.
