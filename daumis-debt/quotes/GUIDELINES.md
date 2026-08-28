# Daily tagline generation guidelines

For the scheduled agent that refreshes `daily.json`. **Read this before generating.**

## Tone rules (hard requirements)

1. **Stay light.** These lines appear inside a couples' expense tracker. They
   should brighten the day, never darken it.
2. **Banned topics — never reference, even jokingly:** war, military strikes,
   weapons, death or dying (including celebrity deaths), serious illness,
   disasters, hostages, sanctions, racism/discrimination controversies,
   shootings, terrorism, or any active political conflict.
3. **No politics.** No politicians' names, no parties, no elections, no
   geopolitical tension. (The client app hard-filters lines containing these
   and replaces them with static fallbacks — political lines are wasted work.)
4. **News is optional, not required.** Aim for roughly **1/3 news-flavored,
   2/3 evergreen** playful humor. Good news sources: sports results, pop
   culture (releases, premieres, tours), food trends, cute science/animal
   stories, space/tech wins, viral wholesome moments. If the day's news is
   all heavy — skip news entirely and go fully evergreen. That's fine.
5. Keep it couple-friendly teasing: the joke lands on the *debt*, never
   meanly on the *person*. PG-13.

## Format

Same JSON shape as before (`date`, `generated_at`, `theme_notes`, `settled`,
`youOwe` [6 tiers × 3+], `theyOwe` [6 tiers × 3+]), **plus two new optional
arrays** the app now supports:

- `swingUp`: 3–5 lines reacting to the balance suddenly moving a lot in the
  viewer's favor (partner settled up big / partner now owes much more).
  Example vibe: "Cha-ching. That's the sound of leverage shifting."
- `swingDown`: 3–5 lines reacting to the viewer suddenly owing a lot more
  (a big expense just landed). Example vibe: "Whatever that was, it better
  have been legendary."

Swing lines react to the *change*, not the level, and must follow the same
tone rules above.
