# CZ day-ahead price and day-ahead exogenous forecasts: where the data actually comes from

Research for [issue #2](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/2) (part of the
map in #1). Investigated 2 August 2026.

Every claim below is tagged:

- **[P]** — confirmed from a primary source (the regulation, the platform's own documentation or terms, the
  market operator's own publication), cited inline.
- **[E]** — established empirically by me, by calling the public endpoint during this research. Commands are
  given so the check is repeatable.
- **[S]** — secondary source only (a widely-used client library, a third-party report). Treat as a strong hint,
  not as fact.
- **[?]** — could not be confirmed. Listed explicitly in [§12](#12-what-i-could-not-confirm).

---

## 1. Executive summary — the four things that change the plan

1. **The Czech day-ahead market stopped being hourly on delivery day 1 October 2025.** SDAC moved to a
   15-minute market time unit on trading day 30 September 2025 **[P]**, and OTE's own published results
   go from 24 points on delivery day 30/09/2025 to 96 points on 01/10/2025 **[E]**. The thesis models are
   hourly and the thesis data ends in 2024, so **the models were trained on a market that no longer exists in
   that form**. This is not a future risk; it already happened ten months ago.
   *Mitigation, and it is a clean one:* the 60-minute price survives as an official **reference price**, defined
   by the "Average Rule" as the arithmetic mean of the four rounded 15-minute prices, rounded to two decimals
   **[P]**. OTE publishes it as a separate series next to the 15-minute one **[E]**. So an hourly model remains
   well-defined and its target remains an officially published number — it is just no longer the settlement price.

2. **The day-ahead *generation* forecast is not available in the morning window, and may not even be a
   legitimate predictor.** Its regulatory publication deadline is **18:00 Brussels time on D-1** **[P]** —
   i.e. roughly five hours *after* the day-ahead price for the same delivery day is published (~13:02) **[P]**.
   The load forecast, by contrast, is due **two hours before gate closure**, i.e. by **10:00 on D-1** **[P]**,
   comfortably inside the window. So of the thesis's two exogenous regressors, one fits the product and one
   does not. Worse: the item is "an estimate of the total *scheduled* generation", and its deadline sitting
   after the auction raises a live look-ahead-bias question about the thesis model itself. **This needs an
   empirical measurement before any model design is locked** (see [§13](#13-recommended-follow-ups)).

3. **OTE-ČR is legally unusable as the source for a public dashboard.** OTE's Terms of Use state that
   "*Users have no right to reproduce, copy or duplicate the content of the website in any way without the
   prior written consent of the Operator*" **[P]**. There is no open-data carve-out. ENTSO-E, by contrast,
   publishes an explicit CC-BY-4.0 free-re-use list — **but the day-ahead price (TR 12.1.d) and the generation
   forecast (TR 14.1.c) are *not on it*; only the day-ahead load forecast (TR 6.1.b) is** **[P]**. Attribution
   to the ENTSO-E Transparency Platform is mandatory for all TP data in any case **[P]**.

4. **A third source exists that nobody in the map has considered: ČEPS, the Czech TSO, publishes load and
   generation-plan data through a completely open, unauthenticated SOAP endpoint** with explicit
   ISO-8601-with-offset timestamps, native 15-minute *and* hourly aggregation, history back to at least 2012,
   and no observed rate limit (six years of quarter-hourly data returned in a single call) **[E]**. For the
   exogenous inputs it is technically far better than either candidate in the ticket. Its licence terms were
   not established **[?]**.

---

## 2. Who publishes what — the three series are not from one place

Under Commission Regulation (EU) No 543/2013 (the "Transparency Regulation", TR) the three series have
different owners **[P]**:

| Series | TR article | Primary owner / data provider | Natural CZ source |
|---|---|---|---|
| Day-ahead price | 12.1.d | "Power Exchanges or TSOs" | OTE (NEMO) → ENTSO-E TP |
| Day-ahead total load forecast | 6.1.b | "TSO and DSOs", provided by TSO | ČEPS → ENTSO-E TP |
| Day-ahead aggregated generation forecast | 14.1.c | "Owners of generation units and/or DSOs", provided by TSO | ČEPS → ENTSO-E TP |

Sources: TR Articles 6, 12, 14 (EUR-Lex CELEX:32013R0543) and ENTSO-E's *Detailed Data Descriptions* v3r4
(MoP Ref. 2), which restates each item's owner and publication deadline **[P]**.

**Consequence:** the opening sketch's "scrape OTE" plan cannot work even in principle. OTE is a power exchange;
it publishes prices and traded volumes, not TSO load or generation forecasts. Only ENTSO-E (as aggregator) or
ČEPS (as originator) can supply the two exogenous inputs. OTE would at best be a price-only source.

---

## 3. Access mechanism and authentication

### 3.1 ENTSO-E Transparency Platform — REST API

- **Endpoint:** `https://web-api.tp.entsoe.eu/api`, GET with query parameters, XML response **[P]**
  (ENTSO-E KB, *Request Methods*). Verified live: an unauthenticated call returns an IEC 62325
  `Acknowledgement_MarketDocument` with `<code>999</code> Authentication failed` **[E]**.
- **Auth:** `securityToken` query parameter (GET) or `SECURITY_TOKEN` HTTP header (POST). To obtain it:
  register on `transparency.entsoe.eu`, verify the email, then **email `transparency@entsoe.eu` with
  "RESTful API access" in the subject and the registered address in the body**; access is granted within
  **3 working days**, after which the token is generated under *My Account* **[P]** (ENTSO-E KB,
  *How to get security token*). **This is a manual, human-in-the-loop step with a multi-day lead time — start
  it now, it is on the critical path for any ingest work.**
- **Request timeout:** 5 minutes (300 s); HTTPS only, HTTP not allowed **[P]**.
- **Document types** (as used by the `entsoe-py` client **[S]**, consistent with the KB article names **[P]**):
  - day-ahead price: `documentType=A44`, `in_Domain=out_Domain=10YCZ-CEPS-----N`,
    `contract_MarketAgreement.type=A01`
  - day-ahead load forecast: `documentType=A65&processType=A01&outBiddingZone_Domain=10YCZ-CEPS-----N`
  - day-ahead generation forecast: `documentType=A71&processType=A01&in_Domain=10YCZ-CEPS-----N`
  - The CZ bidding-zone EIC `10YCZ-CEPS-----N` is confirmed by ENTSO-E's own worked example in the
    *Response Time Zone* KB article **[P]**.

### 3.2 ENTSO-E Transparency Platform — File Library (bulk CSV)

For backfill, ENTSO-E provides bulk **tab-delimited UTF-8 CSV extracts** (`.csv` extension), one folder per
data item, **monthly** files for all three series we need **[P]** (*File Library Guide*):

- `EnergyPrices_12.1.D_r3.1`, `DayAheadTotalLoadForecast_6.1.B_r3`, `DayAheadAggregatedGeneration_14.1.C_r3`.
- Naming convention `YYYY_MM_DataItemName_DataItemNo.csv`.
- Refreshed roughly hourly, with an export log at `/TP_export/Export_log_r3.csv` **[P]**.
- **Auth is different and worse:** OAuth via Keycloak
  (`https://keycloak.tp.entsoe.eu/realms/tp/protocol/openid-connect/token`) using your **TP account username
  and password**, exchanged for a short-lived bearer token, then FMS at `https://fms.tp.entsoe.eu/` **[P]**.
- **⚠ The guide states: "The Transparency Platform password must be updated every 183 days."** **[P]**
  For a project whose stated constraint is "must stay up unattended for years", a credential that expires
  every six months in the *backfill* path is acceptable; in the *daily* path it would be a guaranteed outage.
  **Use the REST API security token for the daily job and the File Library only for one-off backfill.**
- The old **SFTP server was decommissioned on 20 November 2025** **[P]** — any tutorial referencing it is stale.

### 3.3 OTE-ČR

- **No documented public API.** The public route is the web site plus two undocumented-but-stable artefacts:
  - a JSON chart endpoint,
    `https://www.ote-cr.cz/en/short-term-markets/electricity/day-ahead-market/@@chart-data?report_date=YYYY-MM-DD`,
    unauthenticated, returns volume, 15-min price and 60-min reference price **[E]**;
  - a per-delivery-day spreadsheet at a predictable path,
    `https://www.ote-cr.cz/pubweb/attachments/01/<YYYY>/month<MM>/day<DD>/DM_15MIN_<DD_MM_YYYY>_EN.xlsx`
    **[E]**, containing period index, `Time interval` string, 15-min price, volumes, saldo/export/import and
    the 60-min reference price.
- Both are scraping, not an interface with a contract. Neither is documented, versioned, or covered by an SLA,
  and the JSON schema has demonstrably changed over the history window (see [§7](#7-history-depth-and-backfill)).
- Anything richer requires a **CS OTE registered account** (market participant), which this project cannot get.

### 3.4 ČEPS (the bonus candidate)

- **SOAP 1.1/1.2 web service at `https://www.ceps.cz/_layouts/CepsData.asmx`, no authentication at all** **[E]**.
- Operations relevant here: `GenerationPlan`, `Load`, `Generation`, `GenerationRES`, `PowerBalance`,
  `CrossborderPowerFlows`, plus ~15 others **[E]**.
- Parameters: `dateFrom`, `dateTo` (xsd:dateTime), `agregation` (`QH` = quarter-hour, `HR` = hour),
  `function` (`AVG`), `version` (`RT`) **[P]** (the service's own WSDL/help page).
- Documented on `https://www.ceps.cz/en/web-services` (a `.docx` interface description plus a test client) **[P]**.
- **Caveat:** `Load` is *actual* metered load, not a day-ahead forecast — a query for D+1 returns zero rows
  **[E]**. So ČEPS covers the generation plan but does **not** obviously expose a day-ahead load forecast
  through this endpoint. The day-ahead load forecast may be a publication ČEPS makes only into ENTSO-E **[?]**.

---

## 4. Publication timing — the core of the ticket

All times below are **CET/CEST**. The Transparency Regulation defines "time" as "the local time in Brussels"
**[P]**, and Brussels and Prague share a timezone year-round, so Brussels time and Czech local time are the
same clock throughout.

### 4.1 The SDAC / OTE day-ahead auction schedule

From OTE's own webinar *"Introduction of 15-minute Products on the Day-Ahead Electricity Market in 2025"*
(5 March 2025), slide 15, which tabulates the process before and after the 15-minute go-live **[P]**:

| Process step | Before 15-min | After 15-min go-live |
|---|---|---|
| NEMO order book gate closure | 12:00 | **12:00** |
| PMB gate closure, start of calculation | 12:10 | 12:10 |
| End of calculation | 12:27 | **12:40** |
| Preliminary results to TSOs | 12:45 | 12:52 |
| **Publication of final results** | 12:57 | **13:02** |
| Deadline to send "Risk of Full Decoupling" message | 13:50 | 13:50 |
| Deadline to declare SDAC full decoupling / publish coupled results | 14:20 | 14:20 |

OTE's *Parameters of short-term markets* page independently confirms **gate opening 12:00 D-10, gate closure
12:00 D-1**, price limits **-600 / +4 000 EUR/MWh**, tick 0.01 EUR/MWh **[P]**.

The 13:02 figure was footnoted in the March 2025 deck as "subject to final confirmation after central tests"
**[P]**; the go-live itself was subsequently confirmed and executed on trading day 30 September 2025 **[P]**
(OTE news; also EPEX SPOT, APG, NEMO Committee press release). **I could not find a post-go-live OTE or NEMO
document restating 13:02 as the confirmed steady-state time** **[?]** — treat 13:02 as the planned target,
not as a verified observed median.

**Publication is best-effort, not guaranteed.** Nord Pool's operational message list carries a recurring
message type *"DAY-AHEAD: New publication time — market coupling results expected at HH:MM CET"*, with
instances at 12:57 (13 Oct 2025), 13:45 (30 Dec 2025) and 13:43 (31 Mar 2026), alongside messages titled
*"SDAC_EXC_02 — Delay in market coupling results publication"* **[P]**. The 13:50 / 14:20 decoupling deadlines
in the table above exist precisely because the auction can fail. **Design the ingest for "the price for D+1
usually lands around 13:02 but may land at 14:20, or not at all", not for a fixed clock time.**

**Weekends and holidays: the day-ahead auction runs every calendar day.** Verified by pulling OTE results for
1 Jan 2026, 25 Dec 2025, Easter Monday 6 Apr 2026 and two Sundays — all return a complete 96-interval day
**[E]**. There is no weekend gap to design around.

### 4.2 Regulatory publication deadlines on ENTSO-E TP

Verbatim from the Transparency Regulation and restated in ENTSO-E's *Detailed Data Descriptions* v3r4 and in
the corresponding TP knowledge-base articles **[P]**:

| Series | TR deadline | For delivery day D, that is |
|---|---|---|
| Day-ahead **price** (12.1.d) | "no later than one hour after gate closure", where "gate closure time of the day-ahead market shall be understood as **the output time of the matching algorithms**" | ≈ **14:02 on D-1** (one hour after the ~13:02 publication) |
| Day-ahead **total load forecast** (6.1.b) | "no later than **two hours before the gate closure** of the day-ahead market in the bidding zone", updated on ≥10 % changes | **10:00 on D-1** |
| Day-ahead **aggregated generation** (14.1.c) | "no later than **18.00 Brussels time, one day before actual delivery** takes place"; DDD adds *"Because of the limited time, no update"* | **18:00 on D-1** |
| (For reference) wind & solar forecast (14.1.d) | 18:00 Brussels on D-1, plus at least one intraday update at 08:00 on D | 18:00 on D-1 |

Note the redefinition of "gate closure" for 12.1.d: it is **not** 12:00, it is the algorithm's output time.
So the price deadline tracks the auction, wherever the auction actually lands.

### 4.3 The morning window — the honest picture

At, say, **09:00–11:00 CET on day D-1**, forecasting delivery day D:

| Input | Available? |
|---|---|
| Historical prices up to and including delivery day D-1 | ✅ yes |
| Day-ahead **load forecast** for D | ✅ **yes** — guaranteed by 10:00 on D-1 **[P]** |
| Day-ahead **generation forecast** for D | ❌ **no guarantee** — deadline is 18:00 on D-1 **[P]** |
| Day-ahead **price** for D | ✅ correctly absent — not published until ~13:02 **[P]** |

**The product's core premise holds — there genuinely is a morning window in which the D+1 exogenous *load*
forecast exists and the D+1 price does not.** But it holds for one of the thesis's two exogenous regressors,
not both. The generation forecast is the problem, and it is a two-headed problem:

- *Availability:* its deadline is after the auction, so a 09:00 run cannot rely on it.
- *Validity:* it is "an estimate of the total **scheduled** generation" whose deadline sits after the market
  clears. If in CZ practice it is produced from the cleared day-ahead schedules, then a model that uses it to
  predict that same day's prices has **look-ahead bias** — and the thesis's reported accuracy would be
  optimistic. I have no evidence either way **[?]**; this is a hypothesis with a cheap test attached
  (see [§13](#13-recommended-follow-ups)).

---

## 5. Time resolution, and the change since 2018

### 5.1 What changed and when

- 1 July 2024 — 15-minute settlement and trading period introduced in the Czech Republic **except** on the
  day-ahead market, under Regulation (EU) 2019/943 and Czech Decree 408/2015 Coll. **[P]**
- 30 September 2025 (trading day) / **1 October 2025 (delivery day)** — 15-minute MTU went live in SDAC in all
  European bidding zones and across bidding-zone borders, including CZ **[P]**.
- Verified directly against OTE's published results **[E]**:

  | Delivery day | Series returned |
  |---|---|
  | 2025-09-30 | `Volume`, `Price (EUR/MWh)` — **24 points** |
  | 2025-10-01 | `Volume`, `15min price (EUR/MWh)`, `60min price reference (EUR/MWh)` — **96 points** |

  Reproduce with:
  `curl "https://www.ote-cr.cz/en/short-term-markets/electricity/day-ahead-market/@@chart-data?report_date=2025-10-01"`

- Before that, CZ day-ahead was hourly throughout the thesis window. OTE returns 24 hourly points for
  2009, 2012 and 2018 sample days **[E]**. **No resolution change inside 2018–2024** — the thesis dataset is
  internally consistent; the break is entirely after it.

### 5.2 Why this is survivable

Both 60-minute and 15-minute *orders* continue to be tradable in CZ (unlike Ireland's SEMOpx and Spain/Portugal's
OMIE, which dropped 60-minute products) **[P]**. Settlement uses the 15-minute price, but:

> "The 60-minute price will continue to be determined by the algorithm as the reference price for a subsequent
> use … calculated by EUPHEMIA as the arithmetic average of the corresponding **rounded** 15-minute prices …
> rounded to two decimal places — so-called **Average Rule**." **[P]**

So an hourly series is still officially defined, still published (OTE emits it as `60min price reference`
**[E]**), and **exactly reconstructible** from the 15-minute series by averaging four rounded values and
rounding to 2 dp. An hourly model is therefore still buildable and still verifiable against an official number.
Two caveats worth writing into the ADR:

- The Average Rule creates a genuine market artefact: because the hourly price must equal the average, 60-minute
  standard orders can be **paradoxically rejected** in the CZ bidding zone, and OTE explicitly warns that
  quarter-hour price volatility rises when volume is concentrated in 60-minute products **[P]**. The hourly
  series after Oct 2025 is a different statistical object from the hourly series before it. Any model trained
  across the boundary is training on a regime change.
- ENTSO-E's TP data model carries `ResolutionCode ∈ {PT15M, PT30M, PT60M}` per row for all three of our series
  **[P]**, so a resolution column must exist in the schema from day one. The `entsoe-py` client hard-codes
  `QUARTER_MTU_SDAC_GOLIVE = 2025-10-01 Europe/Amsterdam` and switches its parsing at that timestamp **[S]** —
  a useful confirmation of how the rest of the ecosystem handles it.

### 5.3 Resolution of the exogenous series

ČEPS serves both `QH` and `HR` aggregation on request for generation plan and load **[E]** — a genuinely nice
property, since it moves resampling to the source. The ENTSO-E items carry whatever resolution the TSO
submitted; CZ's current values were not checked (needs a token) **[?]**.

---

## 6. Units and currency

- **ENTSO-E**: prices in `Price[Currency/MWh]` with an explicit ISO-4217 `Currency` column — EUR for CZ **[P]**.
  Load and generation forecasts in **MW** (`TotalLoad[MW]`, `GenerationForecast[MW]`) **[P]**. Note MW, not MWh —
  with a 15-minute MTU, MW × 0.25 h is the energy; getting this wrong silently quadruples or quarters volumes.
- **OTE**: the day-ahead market is quoted and cleared in **EUR/MWh** natively — the daily spreadsheet and the
  JSON both carry EUR only, with no CZK column **[E]**. The `Parameters of short-term markets` page lists
  currency EUR **[P]**.
- **CZK is a conversion, not a publication.** OTE publishes the Czech National Bank daily EUR rate alongside the
  results as `https://www.ote-cr.cz/pubweb/attachments/01/<YYYY>/Exchange_rate_CNB_<YYYY>.xlsx`, a simple
  (Date, Rate, Currency) table **[E]**. If the dashboard shows CZK it needs this (or CNB's own API) as a fourth
  data source, with its own staleness and weekend/holiday-carry-forward semantics.

**This settles the conflict flagged in the map:** the models eat EUR/MWh, the market clears in EUR/MWh, and
CZK is a presentation-layer conversion requiring an extra source. Store EUR; convert at render time if at all.

---

## 7. History depth and backfill

| Source | Depth | Per-request limit |
|---|---|---|
| ENTSO-E REST API | **[?]** not confirmed; TP began publishing under TR 543/2013 in early 2015, but I could not verify the CZ start date without a token | **One-year date range** for 12.1.D, 6.1.B and 14.1.C **[P]** |
| ENTSO-E File Library | Monthly extracts; "full extracts (containing all available years)" exist for some items but not these three **[P]** | 100 files per download request **[P]** |
| OTE JSON | ≥ **2009** — a 2009-06-15 query returns a full 24-point day **[E]** | one delivery day per call **[E]** |
| ČEPS SOAP | `Load` ≥ 2010; `GenerationPlan` ≥ 2012 (2010 returns empty) **[E]** | none observed — a single call for 2019-01-01→2024-12-31 returned **52 608** quarter-hourly rows (2.9 MB) **[E]** |

**Backfill hazards found:**

- **OTE's JSON schema is not stable across history.** A 2012 query returns series `Purchase (MWh)` /
  `Sale (MWh)` / `Price (EUR/MWh)`; 2018 returns `Volume (MWh)` / `Price (EUR/MWh)`; post-Oct-2025 returns
  `Volume (MWh)` / `15min price (EUR/MWh)` / `60min price reference (EUR/MWh)` **[E]**. A backfill script must
  match on series title, not on array position.
- **ENTSO-E extract schemas are actively churning right now.** The File Library guide lists
  `EnergyPrices_12.1.D_r3` as *"[REMOVED on 01/10/2026]"* and `EnergyPrices_12.1.D_r3.1` as
  *"[NEW from 06/07/2026]"*, with the same pattern across a dozen other items **[P]**. The R2 generation of
  data items was discontinued on 11 December 2025 and archived under `TP_Legacy_Publications` **[P]**.
- **The TP itself is mid-migration.** `transparency.entsoe.eu` now serves a new single-page application
  (last modified June 2026) **[E]**; the old static documentation pages, including the widely-linked
  `.../web api/Guide.html`, return HTTP 400 and the content has moved to a Zendesk knowledge base **[E]**.
  Every tutorial and blog post about this API older than ~2025 links to a dead page. Cite the knowledge base.

---

## 8. Rate limits and quotas

- **REST API: 400 requests per minute, per user account (API token)** — explicitly *not* per IP under the
  current R3 API. Exceeding it temporarily bans the **token** for ≈10 minutes, returning HTTP 429
  ("Max allowed requests per minute exceeded"). ENTSO-E recommends client-side throttling to ~6–7 req/s
  average **[P]**. Distributed callers sharing one token aggregate against the same counter **[P]**.
- **Request timeout: 5 minutes** **[P]**.
- **File Library / FMS: 100 requests per minute**, counted separately from the Web API, same 10-minute ban,
  HTTP 429 **[P]**. "No limitation on the download" volume, but fair-use expected **[P]**.
- **OTE:** no published limit **[?]**. It is a public web site being scraped; assume nothing and be polite.
- **ČEPS:** no published limit **[?]**; empirically a six-year single query succeeded without throttling **[E]**.

For this project's shape (one daily price pull + one daily forecast pull, plus a one-off backfill of ~8 years
in ~8–24 calls) **none of these limits bind**. Rate limiting is a non-issue; do not over-engineer for it.

---

## 9. Licence and terms for public redisplay

### 9.1 ENTSO-E — permitted, with a real caveat

The General Terms and Conditions of Use (version 29/03/2023, in force since 1 November 2023) require a Data
User, for **any** use of TP data, to **[P]**:

- use it in good faith and in line with good practice for re-use of public data;
- **"mention the ENTSO-E Transparency Platform as the source of publication of the data"**, and comply with
  reasonable ENTSO-E requests about the visibility of that attribution;
- refer to ENTSO-E **only** as the source of publication — using the ENTSO-E name in a way suggesting
  sponsorship or endorsement is expressly prohibited;
- not prejudice any copyright or related right held by the Primary Owner of Data; **where there is a risk of
  doing so, seek the Primary Owner's prior agreement.**

Clause 2.5 then provides the escape hatch: ENTSO-E maintains a **List of Data Available for Free Re-Use**,
licensed **CC-BY 4.0**, for which no prior agreement is needed. The current version (18 October 2023) says
**[P]**:

> "Data Users may freely copy, redistribute, and adapt the listed data for any purpose, by giving appropriate
> credit (attribution) to its source and indicating if they have made any changes, with no need to seek for the
> prior agreement of the respective Primary Owner of Data."

**What is on that list, of our three series:**

| Series | On the CC-BY-4.0 free-re-use list? |
|---|---|
| Day-ahead forecast of total load per MTU (6.1.b) | ✅ **yes — item #1** |
| Day-ahead prices (12.1.d) | ❌ **no** |
| Day-ahead aggregated generation (14.1.c) | ❌ **no** |

I verified this by reading the list end to end: it covers 6.1.b–e, 9.1, 10.1.a–b, 11.1.a–b, 11.4, 12.1.a,
12.1.b, 12.1.c, 12.1.g, 13.1.a–c, 17.1.b–j and several EB/SO GL items. **Article 14 does not appear at all,
and 12.1.d/e/f/h do not appear** **[P]**. Exclusions by country are Moldova and Turkey (plus partial Ukraine
and some interconnectors) — **the Czech Republic is not excluded** **[P]**.

**Reading this honestly:** the terms do not flatly prohibit re-use of non-listed data. They require you not to
prejudice the Primary Owner's rights and to seek agreement *where there is a risk of doing so*. For day-ahead
prices the Primary Owner is "Power Exchanges or TSOs" — for CZ, OTE, whose own terms (below) are restrictive.
This is a genuine legal question, not a formality, and it is the single most product-shaping finding after the
15-minute change. Options, in increasing order of caution:

1. Republish prices with prominent ENTSO-E TP attribution and accept the residual risk (this is what a large
   number of public energy dashboards visibly do — but "everyone does it" is not a licence).
2. Email `transparency@entsoe.eu` and/or OTE asking for written confirmation for a non-commercial portfolio
   dashboard. Cheap, slow, and definitive.
3. Publish only the *forecast* prominently and the actual price as a comparison series — legally identical,
   so this buys nothing. Not recommended as a fix.

**Recommendation: do (2) in parallel with building, and design the dashboard so the price series is a
configurable display component.** Do not let this block implementation.

### 9.2 OTE — effectively prohibited

OTE's Terms of Use, Copyright section **[P]**:

> "OTE, a.s. … is the owner and operator of the website. All content of the website (texts, images, graphical
> representations, charts, HTML code, and others) is governed by Act No. 121/2000 Coll. … **The Operator has
> exclusive access to all data published on the Website.**
>
> **Users have no right to reproduce, copy or duplicate the content of the website in any way without the prior
> written consent of the Operator** unless the Operator agrees otherwise with the Users."

There is no open-data list, no CC licence, and no attribution-based permission. The same page disclaims all
liability and states data is "published for information purposes only". **Scraping OTE and republishing on a
public dashboard is not covered by any permission OTE grants.** Written consent could be sought, but for a
portfolio project the effort/return is poor when ENTSO-E is at worst ambiguous and at best explicitly CC-BY.

### 9.3 ČEPS — unknown

Not established **[?]**. ČEPS publishes an "All data" section and a documented web-services interface with no
authentication, which is strongly suggestive of intended public re-use, but I found no licence statement.
Worth a single email if ČEPS is adopted for the exogenous inputs.

---

## 10. Timezone and DST handling

This is where the three sources differ most, and it directly answers the map's note about `preprocess.py`
being "manual and fragile".

### 10.1 ENTSO-E — UTC everywhere, day boundaries in local time

- **"For all data items, time is expressed in UTC"** in requests **[P]**, using `periodStart`/`periodEnd`
  (`yyyyMMddHHmm`) or `timeInterval` (`yyyy-MM-ddTHH:mmZ/...`).
- **"In response, time is always expressed in UTC"** **[P]**. The bulk extracts carry an explicit
  `DateTime(UTC)` column plus `ResolutionCode` and `UpdateTime(UTC)` **[P]**.
- ENTSO-E's own worked CZ example spells out the DST behaviour **[P]**:
  > "A query for article 12.1.D Energy Prices (Day-ahead) for April 6 2016, in the Czech Republic will yield a
  > response with a time interval starting at 2016-04-05T22:00Z and ending at 2016-04-06T22:00Z … For
  > December 6 2016, the response will start at 2016-12-05T23:00Z and end at 2016-12-06T23:00Z."
- **Warning in the same article:** "for some articles (e.g. 12.1.d), there are exceptions to this rule due to
  regional arrangements for capacity allocations" **[P]**. So the price series' day boundary is *not*
  guaranteed to follow the CZ local day. Verify empirically once a token exists.

**This is the strongest engineering argument for ENTSO-E**: store UTC instants natively, derive the local
delivery day, and the 23/25-hour days need no special-casing at all. The thesis's manual DST handling can be
deleted rather than ported.

### 10.2 ČEPS — ISO-8601 with explicit offset, verified across both transitions

Verified live **[E]**:

| Query | Result |
|---|---|
| `Load`, 2025-10-26, `HR` | **25 items**, first `2025-10-26T00:00:00+02:00`, last `2025-10-26T23:00:00+01:00` |
| `Load`, 2026-03-29, `HR` | **23 items**, first `2026-03-29T00:00:00+01:00`, last `2026-03-29T23:00:00+02:00` |
| `GenerationPlan`, 2026-08-03, `QH` | 96 items, `+02:00` throughout |

Every timestamp carries its own UTC offset, and the offset flips mid-response on transition days. This is the
cleanest DST representation of the three — genuinely unambiguous, no convention to memorise.

### 10.3 OTE — positional, no timestamps at all

The JSON returns points indexed `x = "1" … "N"` with **no date or time on any point**, and the axis is
misleadingly labelled "Hour" even when N = 96 **[E]**. The count varies: 96 normally, **100** on 2025-10-26,
**92** on 2026-03-29 **[E]**. The spreadsheet is slightly better — it carries a `Time interval` string like
`"00:00-00:15"` — but those are local wall-clock labels, so on the autumn long day the 02:00–03:00 labels
simply repeat, with nothing to distinguish the CEST hour from the CET hour **[E]**.

**Any OTE consumer must reconstruct instants from the requested delivery date plus the Europe/Prague calendar,
and cross-check the interval count against the expected 92/96/100.** That is exactly the fragility the map
already noticed in `preprocess.py`, and choosing OTE would bake it in permanently.

---

## 11. Side-by-side

| | **ENTSO-E TP** | **OTE-ČR** | **ČEPS** |
|---|---|---|---|
| Covers price | ✅ | ✅ | ❌ |
| Covers DA load forecast | ✅ | ❌ | ❌ (actuals only) |
| Covers DA generation forecast | ✅ | ❌ | ✅ (`GenerationPlan`) |
| Documented API | ✅ REST + bulk CSV | ❌ scraping only | ✅ SOAP (documented) |
| Auth | token, 3-day manual grant | none | none |
| Timestamps | UTC, explicit | none (positional) | ISO-8601 + offset |
| DST safety | high | low | highest |
| History | ~2015 **[?]** | ≥2009 | ≥2010 / ≥2012 |
| Rate limit | 400/min (API), 100/min (files) | undocumented | none observed |
| Redisplay licence | CC-BY 4.0 for load forecast; **unlisted** for price & generation; attribution always required | **prohibited without written consent** | unknown |
| Stability risk | mid-migration, schema churn, r3→r3.1 | undocumented endpoints, schema drift | stable-looking legacy SOAP |

---

## 12. What I could not confirm

Listed explicitly so nobody mistakes these for established facts.

1. **The confirmed post-go-live steady-state publication clock time.** 13:02 is from a March 2025 planning deck
   with a "subject to final confirmation" footnote. No post-October-2025 primary restatement found.
2. **Observed distribution of actual publication times.** Nord Pool's messages prove delays happen; I have no
   basis for a median or a p99. Needed to choose a safe forecast-run time.
3. **When ČEPS/ENTSO-E actually publish the CZ day-ahead generation forecast**, as opposed to the 18:00
   regulatory deadline. Decisive for whether the thesis's generation regressor is usable — and for whether it
   was legitimate in the thesis.
4. **Whether ENTSO-E TP publishes a PT60M day-ahead price for CZ after 1 Oct 2025**, or only PT15M. `entsoe-py`
   assumes PT15M only **[S]**. If PT60M is absent, hourly targets must be computed via the Average Rule.
5. **ENTSO-E history start date for the three CZ series.** Requires a token.
6. **Whether ČEPS exposes a day-ahead load forecast anywhere** (the `Load` operation is actuals only; the
   `PowerBalance` and `Generation` operations returned HTTP 500 for the parameter combinations I tried).
7. **ČEPS licence terms** for re-publication.
8. **Whether OTE would grant written consent** for a non-commercial dashboard.
9. **Whether the "unlisted on the CC-BY list" status of 12.1.d in practice blocks a public dashboard**, or is
   a formality that ENTSO-E resolves by email. This is a question for ENTSO-E, not for further reading.

---

## 13. Recommended follow-ups

Small, cheap, and each one closes a named gap above.

1. **Request an ENTSO-E API token today** (`transparency@entsoe.eu`, subject "RESTful API access"). Three
   working days' lead time, and every other verification below depends on it. This is the single highest-value
   action from this ticket.
2. **Measure real publication times from `UpdateTime(UTC)`.** All three File Library extracts carry an
   `UpdateTime(UTC)` column **[P]**. One month of CZ data for 12.1.D, 6.1.B and 14.1.C gives the empirical
   distribution of publication lag per series — closing gaps 2 and 3 with a single download, no polling needed.
   **Do this before choosing the daily run time and before deciding the model's feature set.**
3. **Decide the generation-forecast question on that evidence.** If 14.1.C for CZ lands after the auction,
   drop it, replace it with ČEPS `GenerationPlan` (if *that* lands early), or replace it with the wind & solar
   forecast (14.1.d, same 18:00 deadline but with an 08:00 intraday update) or with plain weather data. Any of
   these is a model-input change, which the map has already declared a last-phase concern — but the *interface*
   must not assume the regressor exists.
4. **Write the ADR as "ENTSO-E TP REST API as the single source, EUR/MWh, UTC instants, resolution column
   mandatory."** OTE is ruled out on licence; ČEPS is a documented fallback for the exogenous inputs only.
5. **Email ENTSO-E about redisplay of 12.1.d** on a public non-commercial dashboard, in parallel. Attach the
   attribution wording you intend to use.
6. **Treat 1 October 2025 as a hard regime boundary in the data model**, not as a resolution detail. Store
   both the 15-minute series and the derived/published 60-minute reference; make the hourly derivation
   implement the Average Rule (mean of four 2-dp-rounded values, rounded to 2 dp) so it reproduces the official
   number exactly.

---

## Sources

Primary:

- Commission Regulation (EU) No 543/2013 — Articles 3, 6, 12, 14.
  <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32013R0543>
- ENTSO-E, *Detailed Data Descriptions*, v3 r4, 15 December 2023 (Manual of Procedures Ref. 2).
  <https://eepublicdownloads.entsoe.eu/clean-documents/Transparency/MoP_Ref2_DDD_v3r4.pdf>
- ENTSO-E, *General Terms and Conditions for the Use of the ENTSO-E Transparency Platform*, 29 March 2023.
  <https://transparencyplatform.zendesk.com/hc/en-us/articles/40921911218961-Legal-Terms-and-Conditions>
- ENTSO-E, *List of Data Available for Free Re-Use*, last modified 18 October 2023 (CC-BY 4.0).
  <https://transparencyplatform.zendesk.com/hc/article_attachments/40921869379729>
- ENTSO-E Transparency Platform knowledge base: *How to get security token*; *Request Methods*;
  *API Rate Limit Part 1 & 2*; *API Query Size Limit*; *Request Parameters — Time Interval*;
  *Response Time Zone*; *Response Time Period 1 & 2*; *File Library Guide*;
  *Migration of Transparency Platform data items to a newer technology*;
  *Energy Prices [12.1.D]*; *Actual Total Load & Day-ahead Per Bidding Zone [6.1.A] & [6.1.B]*;
  *Generation Forecast - Day ahead [14.1.C]*; and the `_r3`/`_r3.1` extract specifications.
  <https://transparencyplatform.zendesk.com/hc/en-us>
- OTE-ČR, *Webinar on the Introduction of 15-minute Products on the Day-Ahead Electricity Market in 2025*,
  5 March 2025 (process-timing table, slide 15; Average Rule, slide 11).
  <https://www.ote-cr.cz/en/documentation/electricity-documentation/202501_dam_15min_ote_eng.pdf>
- OTE-ČR news, *Market Coupling Steering Committee confirms go-live of 15-Minute MTU in SDAC on trading day
  30 September 2025 for delivery day 1 October 2025*.
  <https://www.ote-cr.cz/en/about-ote/ote-news/market-coupling-steering-committee-confirms-go-live-of-15-minute-mtu-in-sdac-on-trading-day-30-september-2025-for-delivery-day-1-october-2025>
- OTE-ČR, *Terms of Use*. <https://www.ote-cr.cz/en/documentation/term-of-use>
- OTE-ČR, *Parameters of short-term markets*.
  <https://www.ote-cr.cz/en/short-term-markets/electricity/parameters-of-short-term-markets>
- OTE-ČR, *Day-Ahead Market*. <https://www.ote-cr.cz/en/short-term-markets/electricity/day-ahead-market>
- NEMO Committee / EPEX SPOT / APG press releases on the SDAC 15-minute MTU go-live.
  <https://www.nemo-committee.eu/> · <https://www.epexspot.com/en/news/successful-implementation-15-minute-market-time-unit-mtu-sdac>
- Nord Pool operational message list (evidence of day-ahead publication-time slippage).
  <https://www.nordpoolgroup.com/en/trading/Operational-Message-List/>
- ČEPS, *Web services* and the `CepsData` SOAP service description.
  <https://www.ceps.cz/en/web-services> · <https://www.ceps.cz/_layouts/CepsData.asmx>

Secondary:

- `EnergieID/entsoe-py` (Python ENTSO-E client) — `QUARTER_MTU_SDAC_GOLIVE`, per-item query limits, resolution
  switching. <https://github.com/EnergieID/entsoe-py>
