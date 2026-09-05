# When the three series actually publish

Ticket [#14](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/14).
Measured 2026-09-05 over delivery month **August 2026** (31 days, CZ rows only),
from the ENTSO-E File Library, which carries `UpdateTime(UTC)` per row.
Reproduce with `python analysis/03_publication_lag.py --month 2026_08`.

All times below are `Europe/Prague` wall clock. **T** is the delivery day.

## Headline

| Series | Publishes | Available before the D+1 price does? |
|---|---|---|
| Day-ahead price `12.1.D` | **13:10 on T-1**, worst 14:25 | — it *is* the target |
| Day-ahead load forecast `6.1.B` | **10:05 on T-1**, 30/31 days | **Yes**, ~3 h of headroom |
| Day-ahead generation forecast `14.1.C` | by 18:00 on T-1 (regulatory) | **No** — ~5 h too late |

The forecast run for delivery day T must finish before the T prices publish at
**13:10 on T-1**. That is the clock everything else is measured against.

## Day-ahead price (12.1.D, r3.1)

First publication, as an offset from 00:00 of the delivery day:

| | median | p90 | earliest | latest |
|---|---|---|---|---|
| first publication | −10:50 | −10:05 | −10:50 | −09:35 |
| last publication | −09:55 | −09:20 | −10:10 | −04:45 |

- Typical day: published **13:10 on T-1**. Worst day in the month: 14:25 on T-1
  (2026-08-01). **No day in August failed to publish on T-1.**
- The March 2025 OTE deck's **~13:02 figure holds** — observed publication is
  13:10, eight minutes behind it, and never slipped past 14:25.
- **Revisions: 23 of 31 days are republished** 45–55 min after first publication,
  all 96 periods restated. **In every case the values are identical** — 0 periods
  changed across the whole month. These are restatements, not corrections.
  The latest restatement observed was 19:15 on T-1.

The price extract keeps **one row per publication**, so a revised day appears
twice over (5192 rows for 2976 periods). This is what makes first-vs-last
publication measurable at all.

## Day-ahead load forecast (6.1.B, r3)

- Published at **10:05 on T-1** on 30 of 31 days — the 10:00 regulatory deadline
  is met, with five minutes of slack and no observed variance.
- **One failure: delivery day 2026-08-31 carries a single `UpdateTime` of
  2026-09-03 11:25** — three days *after* delivery. The values are present and
  non-blank, so this is a late backfill, not a gap. 1 day in 31 (~3%).
- No revisions: exactly one row per period for the whole month.

Load has ~3 hours of headroom before the 13:10 price publication, so it is
usable as a T-1 regressor — the constraint that ruled it out was never timing.

## Day-ahead generation forecast (14.1.C, r3)

**The File Library cannot answer this one, and the naive reading of it is wrong.**

The extract shows a median `UpdateTime` of **17:10 on T itself** — apparently a
day late. But 14.1.C keeps only one row per period, so what is visible is the
*last* write, not the first. The rewrite is systematic: a write at ~17:10 on date
X restamps the periods from X−1 17:15 through X 17:00. Delivery day 2026-08-11
splits exactly on that seam — 68 periods stamped 08-11 17:10, the remaining 28
stamped 08-12 17:15.

Cross-checked from the other side with `analysis/04_available_now.py`, asked at
**2026-09-05 18:58**:

| Series | delivery day 2026-09-05 (T) | delivery day 2026-09-06 (T+1) |
|---|---|---|
| price 12.1.D | 192 points | 180 points |
| load 6.1.B | 95 points | 96 points |
| generation 14.1.C | 95 points | **97 points** |

So the generation forecast **is** published a day ahead; the File Library
`UpdateTime` is a rewrite artifact. Its regulatory deadline is 18:00 on T-1,
which is still **~5 hours after** the 13:10 price publication a run must beat.

**Residual unknown:** the earliest time on T-1 at which 14.1.C for T is
reachable. It could not be recovered retrospectively, because the row is
overwritten. Only forward polling (ask at 12:00 on T-1 for a few days) would
settle it. This is only worth doing if the generation regressor is ever revived —
[#13](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/13)
and [#18](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/18)
already dropped it on accuracy grounds, and this independently confirms it is
not available in time.

## Resolution and the 15-minute changeover

Measured with `analysis/01_probe_resolution.py` against the web API.

| Delivery day | Resolution | Points |
|---|---|---|
| 2024-06-12 | `PT60M` | 24 |
| 2025-09-30 | `PT60M` | 24 |
| 2025-10-01 | `PT15M` | 96 |
| 2026-06-12 | `PT15M` | 96 |
| 2025-10-25 (autumn DST) | `PT15M` | 100 |

- **After 2025-10-01 the CZ day-ahead price is PT15M only. There is no PT60M
  series.** The break falls exactly on the delivery-day boundary: 2025-09-30 is
  the last hourly day. Forcing `contract_MarketAgreement.Type=A01` on a
  post-break day returns the same PT15M document, so the hourly price is not
  hiding behind a different market agreement — it **must** be derived via the
  Average Rule.
- The autumn DST day returns **100** quarter-hours, not 96, so variable day
  length carries into the 15-minute regime unchanged.
- Every A44 document, both sides of the break, is **`curveType A03`** —
  variable-sized block, where a missing `position` means *the previous value
  continues*, not missing data. Several post-break days return 94 or 95 of 96
  positions for exactly this reason. An ingest that reads position gaps as holes
  will silently drop real periods.

## What this means for ingest

- **Read the price at ~14:30 on T-1**, not 13:05: that clears the observed worst
  case with margin, and clears the 45–55 min restatement window, so the first
  read is already the final one.
- **Idempotency is enough for the price; correction handling is not needed.**
  Zero value changes across 23 restatements in a month. An upsert keyed on
  (delivery period, series) that overwrites with identical values is correct.
- **The load forecast needs a retry, not a correction path.** One day in 31
  arrived three days late. A job that reads once and never looks back would have
  a permanent hole for 2026-08-31.
- **Parse `curveType A03` by carrying values forward**, or lose periods silently.
- **The hourly target after 2025-10-01 is derived, not observed** — this is the
  `derivation` column ADR-0005 deferred, and it is now required.

## Caveats

- One month (August 2026), post-changeover, PT15M throughout. It says nothing
  about whether publication behaviour differed before 2025-10-01.
- August has no DST transition, so the DST evidence here comes from the web-API
  probe rather than the lag measurement.
- The generation and load extracts keep only the latest write per period, so for
  those two "first publication" means "earliest surviving `UpdateTime`". For the
  price, which keeps full history, it is a true first publication.
