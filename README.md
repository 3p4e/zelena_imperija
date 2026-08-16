# Зелена Империја — Green Empire

A browser farming/tycoon game in the FarmVille lineage, themed on a **licensed**
cannabis grow operation. Buy seeds, plant them, keep them watered / fed / pest-free,
harvest, dry and cure the crop, optionally pay for lab analysis, and sell into a
fluctuating market. Profit buys more beds, better lamps, automation and premium
genetics.

All player-facing text is **Macedonian Cyrillic**. Code identifiers are
Latin-transliterated Macedonian (`zasadiSemka()`, `parichnik`, `presmetajKvalitet()`).

## Run it

Open **`zelena-imperija.html`** in any modern browser. Double-click it — no server,
no build step, no install. The whole game is one self-contained 119 KB file: markup,
oklch theme, SVG iconography and all game logic inline.

The only external reference is Google Fonts (Outfit + Inter). Offline it falls back
to system fonts and still plays fine. Progress saves to browser `localStorage`.

## Layout

| Path | What it is |
|---|---|
| `zelena-imperija.html` | **The game.** Self-contained, playable. |
| `design-suite/Zelena Imperija.dc.html` | Claude Design suite doc — the reference logic behind the v2 rebuild |
| `design-suite/Zelena Imperija Directions.dc.html` | Visual-direction exploration |
| `design-suite/game-data.js` | Game content: 10 strains, hybrids, rooms, lamps, staff, achievements, challenges, events |
| `design-suite/support.js` | Supporting logic from the design suite |
| `docs/` | The original design spec (superseded by v2, kept as historical record) |
| `history/` | Raw agent transcripts from the build session — see below |

## Development history

Built in a single session on **2026-08-02**, seven commits:

| Commit | Change |
|---|---|
| `8909c23` | Add Zelena Imperija: Macedonian cannabis-grow browser game |
| `488a089` | Make drying an interactive two-phase minigame with its own market tab |
| `237647a` | Validate every numeric batch field on save load |
| `0b099df` | Split drying and curing into separate tabs; fuller plant silhouette |
| `0162652` | Rebuild game around the Claude Design suite (v2) |
| `e5fcf2e` | Patch panel values in place instead of rebuilding DOM every second |
| `320a1eb` | Add dark theme with a header toggle |

The v2 rebuild (`0162652`) is the significant one: the game was re-founded on the
Claude Design suite — light oklch theme, MK/EN i18n, 8 tabs. The drying/curing
minigame survives as the Сушење/Зреење tabs, but final cure quality now scales
*unit yield* rather than a price grade.

These commits were extracted with `git subtree split` from the workspace repo they
were originally developed in, so authorship and dates are the originals.

### `history/`

Raw, unedited agent transcripts from the build session, preserved as a record of how
the game was actually made:

- `session-d5482bcd.jsonl` — the main session transcript (17.6 MB, includes 18
  embedded screenshots as base64)
- `workflow-wf_53a3492a-96e/` — a 14-subagent design workflow plus its `journal.jsonl`

These are machine logs, not documentation. They were scanned for credentials before
publishing (no API keys, tokens or private keys present).
