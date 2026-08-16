# „Зелена Империја" — Design Spec

> **⚠️ Superseded (2026-08-02, v2):** The game was rebuilt around the Claude Design suite in
> `games/zelena-imperija/design-suite/` (light oklch theme, MK/EN i18n, 8 tabs). Game data —
> 10 strains, hybrids, rooms, lamps, staff, achievements, challenges, events — comes literally
> from `design-suite/game-data.js`; the reference logic lives in `Zelena Imperija.dc.html`.
> The drying/curing minigame from §5 of this spec survives as the Сушење/Зреење tabs; final
> cure quality now scales the *unit yield* instead of a price grade. The sections below
> describe v1 and remain as historical record of that economy.

**Date:** 2026-08-02
**Status:** Approved (Approach A)
**Deliverable:** `games/zelena-imperija/zelena-imperija.html` — one self-contained file

---

## 1. Summary

A browser farming/tycoon game in the FarmVille lineage, themed on a **licensed** cannabis
grow operation. The player buys seeds, plants them in beds, keeps them watered / fed / free
of pests, harvests, dries and cures the crop, optionally pays for lab analysis, and sells on
a fluctuating market. Profit buys more beds, better lamps, automation and premium genetics.

All player-facing text is **Macedonian Cyrillic**. All code identifiers are
**Latin-transliterated Macedonian** (`zasadiSemka()`, `parichnik`, `presmetajKvalitet()`).

Framing is deliberately a legal, licensed, lab-tested operation — not a crime game. There is
no law-enforcement mechanic and no real-world cultivation instruction; every number below is
a game-balance value chosen for pacing, not horticultural advice.

## 2. Goals / Non-goals

**Goals**
- Complete seed → sale loop playable in ~3 minutes, deep enough to replay for an hour.
- Care decisions (water, nutrients, pest treatment, cure timing) visibly change payout.
- Zero install, zero assets, zero build step. Double-click the file and play.
- Balancing is data, not logic: strains/upgrades/events/prices live in tables.

**Non-goals**
- Multiplayer, accounts, leaderboards, server-authoritative time.
- Offline progression while the tab is closed.
- Pixel art or sprite sheets (would break the single-file constraint).

## 3. Architecture

Single `index.html`-style document, three blocks:

```
<style>   design tokens, layout grid, CSS/SVG plant art, animations
<body>    static shell — header HUD, bed grid, side panels, toast rail, modal
<script>
  KONFIG      constants: tick rate, stage lengths, starting state
  SORTI       strain table
  NADGRADBI   upgrade table
  NASTANI     pest/event table
  TEKST       every Macedonian UI string, one place
  sostojba    the single mutable game-state object
  ── engine   tikni() presmetajRast() primeniNastan() presmetajPrinos() presmetajKvalitet()
  ── akcii    zasadi() polej() nahrani() tretiraj() oberi() zavrsiSushenje()
              testirajVoLaboratorija() prodaj() kupiNadgradba()
  ── prikaz   iscrtajSe() iscrtajLeja() iscrtajPaneli()   (dirty-flag patching)
  ── zapis    zachuvaj() vchitaj()
```

**Rendering.** Bed DOM nodes are created once and mutated in place — the tick handler patches
text, `class` and CSS custom properties only. Shop / inventory / market lists re-render only
when their backing data changes, guarded by a dirty flag. No innerHTML churn in the hot path.

**Plant art.** Pure CSS + inline SVG. Stem height, leaf scale and bud opacity are driven by
CSS custom properties written from state; hue rotates toward yellow-brown as health falls.
This keeps the file asset-free and makes growth animation free.

**Isolation.** Engine functions are pure where practical: `presmetajKvalitet()` and
`presmetajPrinos()` take values and return numbers, touching no globals. That makes them
testable from the console and safe for the player to re-tune.

## 4. Time model

| Constant | Value | Meaning |
|---|---|---|
| `TIK_MS` | 250 | real ms per tick |
| `CHASA_PO_TIK` | 3 | game hours advanced per tick |
| — | 8 ticks | one game day = **2 real seconds** |
| `AVTOSEJV_TIKOVI` | 40 | autosave every 10 real seconds |

Uses `setInterval` with a delta-time guard: if the tab was backgrounded and timers were
throttled, catch-up is capped at 8 ticks per invocation so returning to the tab never
fast-forwards a whole crop.

## 5. Plant lifecycle

| Faza | Macedonian | Game days | Real seconds |
|---|---|---|---|
| `NIKNENJE` | Никнење | 3 | 6 |
| `VEGETACIJA` | Вегетација | 21 | 42 |
| `CVETANJE` | Цветање | 50 | 100 |
| `ZRELO` | Зрело | 14-day window | 28 |

Total seed→ready ≈ 74 game days ≈ 148 s. Strain `brzina` multiplier scales all three stages.
Past the 14-day ripe window the plant over-ripens: quality decays 1.5 points per game day.

Harvest opens a **trim choice**: „Прецизно подрежување" (−6% mass, +6 quality at the end)
or „Брзо кастрење" (no bonus). The batch then enters the **Сушара** as a two-phase,
interactive process. Drying-room time runs at **`SUSHENJE_TEMPO` = 1/3** of garden time —
deliberately ~3× slower so the phase is care, not a race (ideal hang-dry ≈ 52 real seconds,
curing ≈ 20+ more).

**Phase 1 — Сушење (hang-dry).** The batch's `vlaga` (moisture) starts at 75% and falls
~7.2 per drying day. The player watches a hygrometer readout and acts:

- **Вртење:** every 3 drying days a 1-day window opens to turn the branches; each timely
  turn is +1.5 quality (tracked, no cap in window count).
- **Влажен ден** (10%/drying day, halved by Клима): moisture falls at only 4.0/day until
  the player clicks „Проветри" (free).
- **Мувла:** while `vlaga` > 60, 10%/drying-day risk (halved by Клима). Active mold eats
  6% of the batch mass per drying day; „Отстрани мувла" stops it for a one-time 8% mass
  sacrifice. Ever having mold costs a flat −4 quality at the end.
- **Спакувај во тегли** is allowed under 40% moisture; the moisture *at packing* sets
  `tochnostPakuvanje` via `tochnostOdVlaga()`: ideal band 10–16% → 1.00 (Сушара upgrade
  widens it to 8–20%), ≤ band+9 → 0.85, above → 0.65, more than 3 under → 0.70.

**Phase 2 — Зреење (jar curing).** Minimum 3 curing days before the batch can move to the
warehouse. Each curing day offers one **„Бурпни ги теглите"** action (+1.2 quality each,
first 6 count).

Final quality = `presmetajKvalitet(...)` with `tochnostPakuvanje` as the cure input, plus
turn/burp/trim bonuses and the mold penalty, clamped 0–100. Final mass =
`gramaVlazno × (1 − izgubenoMasa) × VLAZNO_VO_SUVO`.

Each batch card shows a compact **СОП checklist** (trimmed? turns done, mold status, mass
loss) — the QC paper trail as UI.

**Selling** moved to its own **Пазар** tab: a daily „Берза" board of per-strain prices with
trend arrows, and per-batch price breakdowns (grams × price/g × grade × certification).
**Магацин** is now inventory + lab analysis only.

## 6. Plant state and care

Each bed holds `{sorta, faza, vozrast, voda, hraniva, zdravje, shtetnik, zbirZdravje, brojTikovi}`.

**Drain per game day:** `voda` −6, `hraniva` −3. Both clamp to 0–100.

**Health deltas per tick** (`zdravje` clamps 0–100):

| Condition | Δ zdravje |
|---|---|
| `voda` < 20 (drought) | −1.2 |
| `voda` > 95 (root rot) | −0.8 |
| `hraniva` < 15 (starved) | −0.9 |
| `hraniva` > 95 (nutrient burn) | −0.6 |
| active untreated `shtetnik` | −event.šteta |
| everything in optimal range | +0.4 |

Both under- and over-watering hurt, so "click water on everything constantly" is a losing
strategy — that asymmetry is what makes the care loop a skill rather than a chore.

`zbirZdravje` accumulates each tick; lifetime average health at harvest is
`zbirZdravje / brojTikovi` and is the dominant input to both yield and quality.

**Actions:** Полевање +45 `voda`, free. Ѓубриво +40 `hraniva`, 250 ден.

## 7. Pests and events

Per plant, per game day: 3% base chance, × 0.4 with the Клима-систем upgrade.

| id | Macedonian | Штета/tick | Третман | Цена | Note |
|---|---|---|---|---|---|
| `grini` | Пајакови грини | 0.9 | Акарицид | 900 | any stage |
| `muvla` | Мувла | 1.4 | Фунгицид | 1400 | only during Цветање |

(Мувла also appears independently in the drying room — see §5.)
| `voshki` | Лисни вошки | 0.6 | Инсектицид | 700 | any stage |
| `azot` | Недостаток на азот | 0.5 | — | — | cleared by `nahrani()`, not by `tretiraj()` |

`azot` is the one event with no purchasable treatment: feeding the plant clears it, which
teaches the nutrient mechanic instead of taxing it. Untreated pest-days also count against
final quality via the `pestDays` input.

## 8. Yield and quality

```
prinos_grama = sorta.prinos × (prosekZdravje / 100) ** 1.2 × lampa.prinosMult
```

`presmetajKvalitet()` returns 0–100 from: `prosekZdravje` (0–100), `tochnostSushenje` (0–1,
per §5), `sorta.genetika` (0–1), `lampa.kvalitetBonus` (0–14), `pestDays` (integer).

**This function is the player-tunable balance knob** and ships with a documented default
implementation plus a TODO block explaining the trade-off (reward patience vs. reward volume),
so the game is fully playable as delivered and the formula is a drop-in replacement.

| Grade | Score | Macedonian | Price × |
|---|---|---|---|
| A+ | ≥ 85 | Врвен | 2.2 |
| A | ≥ 70 | Одличен | 1.6 |
| B | ≥ 50 | Среден | 1.1 |
| C | < 50 | Слаб | 0.6 |

**Лабораториска анализа:** 900 ден per batch. Reveals THC% (derived from quality + genetics)
and applies a +18% certified-product premium on sale.

## 9. Content tables

**Сорти** — `cena` = seed price, `prinos` = base grams, `traenje` = **duration** multiplier.
Note the direction: `0.85` means the strain finishes 15% *sooner*, `1.35` means it takes 35%
*longer*. Premium genetics are slower, not faster — the field is named `traenje` (duration)
rather than `brzina` (speed) precisely so the sign cannot be misread.

| id | Име | Цена | Траење | Принос | Генетика | Ден/г | Ниво |
|---|---|---|---|---|---|---|---|
| `skopsko` | Скопско Зелено | 150 | 0.85 | 60 | 0.45 | 90 | 1 |
| `vardar` | Вардар Куш | 400 | 1.00 | 85 | 0.60 | 140 | 2 |
| `pelister` | Пелистерска Магла | 900 | 1.10 | 110 | 0.72 | 200 | 4 |
| `ohrid` | Охридски Кристал | 1800 | 1.15 | 130 | 0.82 | 280 | 6 |
| `shar` | Шар Планина Хаза | 3200 | 1.25 | 155 | 0.90 | 380 | 8 |
| `dojran` | Дојранска Ноќ | 6000 | 1.35 | 185 | 0.97 | 520 | 11 |

**Надградби**

| Надградба | Цена | Ефект |
|---|---|---|
| Нова леја | 75 000 × 1.6ⁿ | +1 bed, 4 → 12. `n` = beds already purchased beyond the starting 4, so the first costs 75 000 and the eighth 75 000 × 1.6⁷ |
| Ламба: ХПС | 220 000 | принос ×1.15, квалитет +4 |
| Ламба: ЛЕД | 700 000 | принос ×1.30, квалитет +8 |
| Ламба: ЛЕД Full-Spectrum | 2 400 000 | принос ×1.50, квалитет +14 |
| Автоматско наводнување | 240 000 | holds `voda` ≥ 55 |
| Клима-систем | 360 000 | pest chance ×0.4 |
| Сушара | 300 000 | drying 40% faster, optimal band widened to 8–14 days |
| Работник | 900 000 | auto-feeds when `hraniva` < 40 |

Lamps are a single upgrade track: buying a tier replaces the previous one, and only the
highest owned tier applies.

**Пазар.** Per-strain price multiplier random-walks ±3% per game day, clamped to [0.75, 1.35].
Inventory can be held for a better price, which is the whole reason the market panel exists.

**Напредок.** XP on sale = grams × grade multiplier. Level *n* needs `500 × n^1.5` XP.
Levels gate strains and lamp tiers.

**Старт.** 8000 ден, 4 beds, 1 free Скопско Зелено seed, Флуо lamp.

**Measured pacing** (headless run, full care, starter strain): net 7 801 ден per plant per
126 s cycle; 3 cycles to the first extra bed, 8 to the HPS lamp. Endgame (Дојранска Ноќ +
ЛЕД Full-Spectrum) nets 282 629 ден per plant — a 36× curve against ~10.4 M ден of total
upgrades. With no care at all the same plant *loses* 95 ден, so neglect is a real failure state.

## 10. Persistence and error handling

Autosave to `localStorage` under `zelena-imperija-sejv` with a `verzija` field.

| Failure | Behaviour |
|---|---|
| `localStorage` unavailable or over quota | catch, Macedonian toast, continue in memory |
| Corrupt JSON | `try/catch`, start fresh, Macedonian notice |
| `verzija` mismatch | start fresh, Macedonian notice |
| Missing/renamed strain or upgrade id in save | drop that entry, keep the rest |

No offline fast-forward: with an accelerated clock it would only reward changing the system
clock. Saved state resumes exactly where it stopped.

## 11. Verification

1. Load the file in headless Chrome via Playwright; assert zero console errors on boot.
2. Drive a full cycle through the exposed `window.__test` hook — fast-forward ticks through
   plant → care → harvest → cure → sell; assert stage progression is monotonic, `zdravje`
   and `voda` stay within 0–100, and `parichnik` is finite and non-negative throughout.
3. Reload mid-grow and assert state restores.
4. Feed a deliberately corrupt save and assert graceful reset rather than a white screen.

## 12. Risks

- **Balance drift.** Numbers above are first-pass. They live in one table block precisely so
  the first playtest can retune them without touching logic.
- **File size.** A full sim in one file will run long. Mitigated by strict section ordering
  and keeping all tunables at the top; if it becomes unwieldy the natural split is
  engine / content / view, at the cost of the single-file property.
- **Cyrillic in identifiers.** Avoided — identifiers are Latin transliteration, so the file
  stays typeable on any keyboard while all visible text is Cyrillic.
