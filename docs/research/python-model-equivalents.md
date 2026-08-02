# Python equivalents for the thesis model family

Research for [issue #4](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/4), part of the
[architecture map, #1](https://github.com/Zednicek-Adam/cz-electricity-price-forecast/issues/1).

**Question.** For each model in the private thesis repo `Zednicek-Adam/epf-diploma`, what is the closest Python
implementation, and how faithfully can it reproduce the R behaviour?

Sources are primary throughout: the R `stats` reference manual and the R sources at `wch/r-source`, the
statsmodels / scikit-learn / NumPy reference docs and sources, and the `jeslago/epftoolbox` repository and its
issue tracker. The R under study was read directly out of the private repo via the GitHub contents API; only
short snippets are quoted here.

---

## TL;DR

| Thesis artefact | Closest Python | Faithful? | Verdict |
|---|---|---|---|
| `ar_predict` (AR-192, Yule-Walker) | `statsmodels.regression.linear_model.yule_walker(order=192, method="mle")` + a hand-written 24-step recursion | Same estimator and same ACVF normalisation; differs only in the linear solve (LU vs Levinson-Durbin) | **Easy.** ~40 lines. `AutoReg` / `ARIMA` are *wrong* estimators here. |
| `ar_lm_predict` (AR-X + `d`/`D=168` differencing) | `statsmodels.tsa.ar_model.AutoReg(lags=list(p), exog=..., trend='c')` + `predict(..., exog_oos=...)`, wrapped in hand-written diff/diffinv | Estimator and recursion match exactly; differencing wrapper must be hand-written | **Moderate.** ~120 lines. All the risk is index bookkeeping, not statistics. |
| `exponential_smoothing.R` | — | **There is no model here.** | **Zero work.** The file computes EWMA mean/variance diagnostics and plots them. No forecast is produced, no `ets`/`HoltWinters` call exists. |
| `fourier.R` | — | **There is no deployable model here.** | **Zero work.** Exploratory manual DFT + an extrapolation that rescales using the *test period's* min/max, i.e. it peeks at the future. |
| LEAR (`bench_model.py`) | `epftoolbox`, but **vendored**, and via `LEAR.recalibrate_and_forecast_next_day` — not `evaluate_lear_in_test_dataset` | Yes, it is already Python | **Moderate**, but it is a packaging/licensing problem, not a maths one. `pip install epftoolbox` drags in TensorFlow and caps Python at 3.12. |

**Two of the four "models" in the map's inventory do not exist as models.** The map's
"Models: `ar_predict`, `ar_lm_predict`, exponential smoothing, Fourier terms" line should be corrected: the
thesis model family that produced the 13 golden-file CSVs is `ar_predict`, `ar_lm_predict`, and LEAR.

---

## 1. `ar_predict` — R's `stats::ar()` at order 192

### What the R actually does

```r
fit <- ar(ts_data, order.max = 192, aic = FALSE)
pred_vals <- predict(fit, n.ahead = 24)$pred
```

### Which estimator is that?

**Yule-Walker.** `?ar` gives the signature

```r
ar(x, aic = TRUE, order.max = NULL,
   method = c("yule-walker", "burg", "ols", "mle", "yw"), na.action, series, ...)
```

and states of `method`: *"Defaults to `"yule-walker"`."*
([`?ar`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/ar.html))

The dispatcher in [`src/library/stats/R/ar.R`](https://github.com/wch/r-source/blob/trunk/src/library/stats/R/ar.R)
routes `"yule-walker"` and `"yw"` to `ar.yw`. With `aic = FALSE` the order is pinned:

```r
order <- if (aic) (0L:order.max)[xaic == 0L] else order.max
```

so the fitted model is a full AR(192) — every lag 1..192, no selection. (`?ar`: *"If `FALSE`, the model of order
`order.max` is fitted."*)

`ar.yw.default` then does exactly three things:

1. **Demeans** (`demean = TRUE` is the default): `xm <- colMeans(x); x <- sweep(x, 2L, xm)`.
2. Estimates the **autocovariance** via
   `acf(x, type = "covariance", lag.max = order.max, plot = FALSE, demean = demean, na.action = na.pass)$acf`.
3. Solves the Yule-Walker system by **Levinson-Durbin recursion**: `.Fortran(C_eureka, ...)`.

The normalisation in step 2 is the load-bearing detail. R's `acf` is implemented in
[`src/library/stats/src/filter.c`](https://github.com/wch/r-source/blob/trunk/src/library/stats/src/filter.c),
whose inner loop is

```c
for(int i = 0; i < n-lag; i++)
    if(!ISNAN(...)) { nu++; sum += x[i + lag + n*u] * x[i + n*v]; }
acf[lag + d1*u + d2*v] = (nu > 0) ? sum/(nu + lag) : NA_REAL;
```

With no missing values `nu = n - lag`, so the divisor is `nu + lag = n` **regardless of lag**. That is the
*biased* (maximum-likelihood) autocovariance estimator, not the `n - k` one.

`predict.ar` is the plain iterated AR recursion on the demeaned series, with the mean added back
(same file):

```r
x <- c(newdata - object$x.mean, rep.int(0, n.ahead))
xint <- object$x.intercept %||% 0          # 0 for ar.yw
for(i in seq_len(n.ahead))
    x[n+i] <- sum(ar * x[n+i - seq_len(p)]) + xint
pred <- pred + rep.int(object$x.mean, n.ahead)
```

### Python counterpart

**Use `statsmodels.regression.linear_model.yule_walker` with `method="mle"`, and write the recursion by hand.**

```python
from statsmodels.regression.linear_model import yule_walker

mu  = y.mean()
phi, _ = yule_walker(y, order=192, method="mle", demean=True)   # NOT the default!
hist = list(y - mu)
for _ in range(24):
    hist.append(float(np.dot(phi, hist[-1:-193:-1])))
pred = np.array(hist[-24:]) + mu
```

The `method` argument is the whole ballgame. Per the
[statsmodels docs](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.yule_walker.html):

> `yule_walker(x, order=1, method='adjusted', df=None, inv=False, demean=True)`
> "Method can be 'adjusted' or 'mle' and this determines denominator in estimate of autocorrelation function
> (ACF) at lag k. If 'mle', the denominator is n=X.shape[0], if 'adjusted' the denominator is n-k.
> **The default is adjusted.**"

So the statsmodels **default silently disagrees with R**. Confirmed in
[`statsmodels/regression/linear_model.py`](https://github.com/statsmodels/statsmodels/blob/main/statsmodels/regression/linear_model.py):

```python
adj_needed = method == "adjusted"
r[0] = (x**2).sum() / n
for k in range(1, order + 1):
    r[k] = (x[0:-k] * x[k:]).sum() / (n - k * adj_needed)
```

With `method="mle"`, `adj_needed` is `False` and every lag divides by `n` — byte-for-byte the same estimator
as R's `acf`. At order 192 on a 730-day hourly window the `n-k` vs `n` choice is not a rounding-level
difference; it changes the coefficients materially and can push the fitted polynomial out of the stationary
region.

### Where numerical divergence creeps in

**One place, and it is real.** statsmodels forms the full Toeplitz matrix and solves it with LU:

```python
R = toeplitz(r[:-1])
rho = np.linalg.solve(R, r[1:])
```

R uses the Levinson-Durbin recursion (`C_eureka`). These are the same solution in exact arithmetic. At order
192 on an hourly electricity price series the Toeplitz matrix is severely ill-conditioned, so the two
algorithms will not agree to machine precision. Expect agreement in the coefficients to somewhere in the
6th-10th significant digit and a correspondingly small but nonzero difference in the 24 forecasts.

**If that gap turns out to matter,** implement Levinson-Durbin directly (~15 lines) against the same biased
ACVF. That reproduces R's *algorithm*, not merely R's *estimator*, and removes the last source of divergence.
There is no need for a third-party package for this.

### What NOT to use

| Candidate | Why it is wrong |
|---|---|
| `statsmodels.tsa.ar_model.AutoReg(y, lags=192)` | Conditional MLE, i.e. **OLS** on the lag matrix ([docs](https://www.statsmodels.org/stable/generated/statsmodels.tsa.ar_model.AutoReg.html): *"Conditional Maximum Likelihood (OLS)"*). A different estimator. Yule-Walker's biased ACVF shrinks the estimate toward stationarity; OLS does not. At p=192 the two disagree materially. |
| `statsmodels.tsa.arima.model.ARIMA(order=(192,0,0))` | Exact MLE via a 192-dimensional state space, filtered over ~17,500 observations, refitted once per test day. Different estimator *and* computationally out of the question. |
| `scipy.signal` | Has no AR / Yule-Walker estimator at all. |

**Verdict: faithful reproduction is straightforward.** The estimator is fully specified, statsmodels exposes it
exactly, and the only judgement call is one keyword argument. There are golden-file CSVs
(`pred-ar-192-AIC_sel_*.csv`, `pred-ar_192_diff_*.csv`, `pred-ar_192_s_diff_*.csv`, ...) covering 2023-2024 to
check against.

---

## 2. `ar_lm_predict` — OLS on selected lags + exogenous regressors, recursive 24 steps

### What the R actually does

Difference, build a lagged design, `lm`, then loop 24 times feeding forecasts back in, then invert the
differencing:

```r
df <- data.frame(y = ts_data)
lag_names <- paste0("lag", p)
for (i in 1:length(p)) df[[lag_names[i]]] <- dplyr::lag(df$y, p[i])
if (has_xreg) df <- cbind(df, features_train)
df_model <- na.omit(df)
fit <- lm(as.formula(paste("y ~", paste(setdiff(names(df_model), "y"), collapse = " + "))), data = df_model)

for (i in 1:h) {
  posledni_hodnoty <- hist_loop[length(hist_loop) + 1 - p]
  ...
  pred_vals[i] <- predict(fit, newdata = current_input)
  hist_loop <- c(hist_loop, pred)
}
```

`predict_daily` calls it with `p = 1:192`, `features` = `cbind(gen, load, 7 weekday dummies)`, and
`data_process.R` runs it with `D = 1`, `s = 168`.

### Python counterpart

**`statsmodels.tsa.ar_model.AutoReg` is a genuine drop-in for the estimator and the recursion.**

- It takes an **arbitrary list of lags** — the docs: *"lags... a list of specific lag indices"*.
- It takes **`exog`** aligned contemporaneously — *"aligned so that `endog[i]` is regressed on `exog[i]`"* —
  which is exactly what the R does (gen/load/dummies enter at time `t`, un-lagged).
- `trend='c'` supplies the intercept that R's `lm` formula adds implicitly.
- It is fitted by OLS, the same estimator as `lm`.
- Out-of-sample prediction **is** the iterated recursion, not a direct multi-step model. From
  [`statsmodels/tsa/ar_model.py`](https://github.com/statsmodels/statsmodels/blob/main/statsmodels/tsa/ar_model.py),
  `_static_oos_predict`:

  ```python
  val = self._y[loc] if loc < 0 else forecasts[loc]
  new_x[i, ar_offset + j] = np.squeeze(val)
  forecasts[i] = np.squeeze(new_x[i : i + 1] @ params)
  ```

  Actual history before the sample end, previously-produced forecasts after it — line for line the same as the
  R `for` loop.
- `exog_oos` supplies the 24 rows of day-ahead gen/load/dummies:
  [*"An array containing out-of-sample values of the exogenous variable... at least as many rows as the number
  of out-of-sample forecasts."*](https://www.statsmodels.org/stable/generated/statsmodels.tsa.ar_model.AutoRegResults.predict.html)

**What `AutoReg` does not give you:** the `d` / `D=168` differencing and the `diffinv` reconstruction. That has
to be written by hand either way (see §5b/§5c).

**Honest recommendation: hand-roll the whole thing** (design matrix + `numpy.linalg.lstsq` + explicit loop),
and keep `AutoReg` as a *cross-check* in the test suite. Reasons: the fiddly part is the differencing/trimming/
reconstruction bookkeeping, which `AutoReg` does not help with; once that wrapper exists, `AutoReg` saves about
ten lines while adding an alignment abstraction you would have to verify anyway. But having both, agreeing, is
a strong signal the port is right. `sklearn.linear_model.LinearRegression` works equally well as the solver —
it is *"just plain Ordinary Least Squares (`scipy.linalg.lstsq`)"*
([docs](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LinearRegression.html)) — but
`np.linalg.lstsq` keeps the dependency surface smaller.

**Verdict: moderate.** No statistical uncertainty at all; OLS is OLS. The entire risk is silent index errors,
and §5 enumerates them.

---

## 3. `exponential_smoothing.R` — not an exponential smoothing model

The file contains no forecasting model. It defines

```r
time_weighted_var <- function(x, lambda = 0.94) {
  w <- lambda ^ (rev(rep(1:(n/24), each = 24)) - 1)
  weighted_mean <- sum(w * x) / sum(w)
  sum(w * (x - weighted_mean)^2) / sum(w)
}
```

plus a `time_weighted_mean` twin, then loops over the test days computing those statistics on each 730-day
calibration window and plots them against the unweighted `var`/`mean`. This is RiskMetrics-style EWMA
*volatility and level diagnostics* — an EDA step justifying the variance-stabilising transforms in
`data_process.R` — not a forecast. The only forecasting code in the file is commented out (an `auto.arima`
block). No `ets()`, `HoltWinters()` or `forecast()` call survives. **Nothing to port.**

If an ETS baseline is wanted as a *new* model, the counterparts are
`statsmodels.tsa.holtwinters.ExponentialSmoothing` (Holt-Winters, the direct analogue of R's `HoltWinters`) and
`statsmodels.tsa.exponential_smoothing.ets.ETSModel` (the state-space ETS family, the analogue of
`forecast::ets`). Neither is constrained by anything in the thesis, because the thesis never used them.

If the EWMA *statistics* are wanted (e.g. as features), note that `pandas.Series.ewm(alpha=1-lambda)` will
**not** reproduce them: the R weights are constant within each 24-hour block
(`rep(1:(n/24), each = 24)`), i.e. they decay per *day*, not per hour. Reproduce with
`w = np.repeat(lam ** np.arange(n // 24)[::-1], 24)` and a weighted mean/variance with divisor `sum(w)` (the
population form, matching the R). Also guard the input length: `rep(1:(n/24), each = 24)` silently misbehaves
when `n` is not a multiple of 24.

---

## 4. `fourier.R` — not a deployable model

Exploratory spectral analysis. It evaluates an unnormalised DFT by hand,

```r
rad_x_ts <- sapply(freqs, function(freq) sum(y_ts * cos((1:hours / hours) * 2 * pi * freq)))
rad_y_ts <- sapply(freqs, function(freq) sum(y_ts * sin((1:hours / hours) * 2 * pi * freq)))
```

builds an outer-product "Fourier plane", selects frequencies by a `3*sd` threshold, reconstructs
`rowSums(series)` over `1:(calib_window+24)`, and then extrapolates. Two disqualifiers for production:

1. **It leaks the future.** The reconstruction is rescaled by
   `rang_fit <- range(data$el_price[pred_period])` and then min-max mapped into that range. `pred_period` is
   the *forecast* window. The reported fit is not obtainable at forecast time.
2. The frequency grid `freqs <- (1:hours)[1:calib_window]` and the half-frequency argument `pi * freq` (as
   against `2 * pi * freq` in the analysis step) mean the reconstruction and the analysis do not use the same
   basis. It is a sketch, not a specified model.

**Python counterparts, if the spectral EDA is to be redone:** `numpy.fft.rfft` / `numpy.fft.rfftfreq` computes
exactly the same sums at the Fourier frequencies in `O(n log n)` instead of the R loop's `O(n·k)` — note
`rad_x` corresponds to `Re(rfft)` and `rad_y` to `-Im(rfft)` (sign convention).

**Python counterpart, if "Fourier terms" means seasonal harmonic regressors** (the standard EPF usage, and
almost certainly what the map's inventory intended): `statsmodels.tsa.deterministic.Fourier(period=24, order=k)`
and `CalendarFourier`, or just `sin/cos(2*pi*k*t/period)` columns appended to the AR-X design matrix. That is
about five lines and slots straight into `ar_lm_predict`'s `features`. It is a *new* model, not a port.

---

## 5. LEAR / `epftoolbox`

### Is it maintained?

Barely, but it is alive. [`jeslago/epftoolbox`](https://github.com/jeslago/epftoolbox) — not archived, 375
stars, Apache-2.0 per the repo licence field. Master's last commit is `47d6e06`, **2025-10-25** (merging a
Python 3.12 support PR and a docstring fix). Before that: 2024-12-31, 2024-10-31, 2024-06-12. So: a handful of
merged community PRs a year, no releases, no changelog.

Open issues that matter:

- **[#10](https://github.com/jeslago/epftoolbox/issues/10) (open since Nov 2022) — `LassoLarsIC` fails on
  scikit-learn ≥ 1.1.** *"ValueError: You are using LassoLarsIC in the case where the number of samples is
  smaller than the number of features."* Whether this bites depends on the calibration window: LEAR's feature
  count is `96 + 7 + n_exogenous * 72`, which for the thesis's two exogenous inputs is **247**. At
  `calibration_window = 730` there are 730 training days > 247 features, so **the thesis configuration is not
  affected**. Short windows (the 56/84-day ones from the LEAR paper) are.
- **[#35](https://github.com/jeslago/epftoolbox/issues/35) (open) — "Which License does apply to this
  project?"** Unanswered. The repo LICENSE was changed to Apache-2.0 in Nov 2023 (commit `82900ec`), but
  `setup.py` still declares `license='GNU AGPLv3'` with the AGPLv3 classifier, and **every source file header
  still says `# License: AGPL-3.0 License`** — including the header the thesis copied into `bench_model.py`.
  For a public, deployed portfolio piece this is a live question, and it is *the* reason to decide
  vendor-vs-depend deliberately rather than by default.
- **[#36](https://github.com/jeslago/epftoolbox/issues/36) (open, May 2026) and
  [#23](https://github.com/jeslago/epftoolbox/issues/23) — Keras 3 / TensorFlow incompatibility** in the DNN
  model (`Adam(lr=...)`, `batch_input_shape` on `Dense`). DNN-only, but see the import trap below.
- **[#15](https://github.com/jeslago/epftoolbox/issues/15) (open) — a user could not reproduce the
  repository's own stored LEAR forecasts.** Bit-exactness is not guaranteed even within epftoolbox.
- **[#8](https://github.com/jeslago/epftoolbox/issues/8), fixed 2024-06-12 — "LEAR bug: exogenous used at D-2,
  should be D-7."** This changes the feature set. A LEAR run before that commit differs from one after it. The
  thesis's `predictions/LEAR_forecast_datCZ_YT4_CW730.csv` is dated Dec 2025 so was almost certainly produced
  post-fix, but **pin the epftoolbox commit before treating that CSV as a golden file.**

### Is it installable on current Python?

**Not from PyPI — it is not published there.** The official instructions
([Getting started](https://epftoolbox.readthedocs.io/en/latest/modules/started.html)) are:

> `git clone https://github.com/jeslago/epftoolbox.git` / `cd epftoolbox` / `pip install .`

From [`setup.py`](https://github.com/jeslago/epftoolbox/blob/master/setup.py):

```python
python_requires='>=3.9, <=3.13',
install_requires=['hyperopt>=0.2', 'tensorflow>=2.2', 'scikit-learn>=0.22',
                  'pandas>=1', 'numpy>=1', 'statsmodels>=0.11',
                  'matplotlib>=3', 'scipy>=1.4', 'keras>3'],
```

Four problems for a free-tier deployment:

1. **`python_requires='>=3.9, <=3.13'` does not mean what it looks like.** Under PEP 440, `<=3.13` excludes
   any `3.13.x` with `x > 0` (since `3.13.1 > 3.13`), and excludes 3.14 outright. In practice the usable range
   is **3.9-3.12**. That is a hard cap on the service's runtime if epftoolbox is a real dependency.
2. **TensorFlow is pulled in, and it is imported even for LEAR.**
   [`epftoolbox/models/__init__.py`](https://github.com/jeslago/epftoolbox/blob/master/epftoolbox/models/__init__.py)
   is `from ._lear import (...)` **and** `from ._dnn import (...)`, and `_dnn.py` does
   `import tensorflow.keras as kr` at module scope. So the thesis's own line —
   `from epftoolbox.models import evaluate_lear_in_test_dataset` — imports TensorFlow. The TF wheel is
   ~600 MB; that is over most free-tier image/slug budgets on its own, for a model that uses nothing but
   scikit-learn.
3. **`numpy<2` is effectively required.** `_lear.py` uses `np.NaN`
   (`data_available.loc[date:date + pd.Timedelta(hours=23), 'Price'] = np.NaN`), and
   [NumPy 2.0 removed the `np.NaN` alias](https://numpy.org/doc/stable/numpy_2_0_migration_guide.html)
   ("Removed: `NaN` — Use `np.nan` instead"). This is exactly why the thesis's `requirements.txt` opens with
   `numpy<2`. Pinning NumPy 1.x in 2026 drags a growing set of transitive pins with it.
4. `tensorflow>=2.2` together with `keras>3` is a self-inflicted conflict (issues #36/#23).

### What `evaluate_lear_in_test_dataset` demands on disk

From [`epftoolbox/models/_lear.py`](https://github.com/jeslago/epftoolbox/blob/master/epftoolbox/models/_lear.py)
and [`epftoolbox/data/_datasets.py`](https://github.com/jeslago/epftoolbox/blob/master/epftoolbox/data/_datasets.py):

**Input.** A single CSV at `os.path.join(path_datasets_folder, dataset + '.csv')` — for the thesis,
`./sources/CZ.csv`. Read as `pd.read_csv(file_path, index_col=0)`, index coerced with `pd.to_datetime`. Then:

```python
columns = ['Price']
n_exogeneous_inputs = len(data.columns) - 1
for n_ex in range(1, n_exogeneous_inputs + 1):
    columns.append('Exogenous ' + str(n_ex))
data.columns = columns
```

**Column names in the file are ignored and overwritten positionally.** `CZ.csv`'s `date, el_price, gen, load`
becomes index / `Price` / `Exogenous 1` / `Exogenous 2` purely by column order. Swapping two columns in
`preprocess.py` would silently change the model, not raise.

Further constraints: `begin_test_date` must land on hour 0 (else `Exception("Starting date for test dataset
should be midnight")`), `end_test_date` on hour 0 or 23; both parsed with `dayfirst=True` (hence the thesis's
`"01/01/2023 00:00"`).

**Output.** `path_recalibration_folder` is created if absent, and the function writes
`LEAR_forecast_dat<dataset>_YT<years_test>_CW<calibration_window>.csv` — rewriting the **entire** CSV inside
the daily loop, once per forecast day. The shape is one row per day × 24 columns `h0..h23`. That wide layout is
the sole reason `tf_matrix_to_series.R` exists: it pivots `h0..h23` back into a long hourly series.

**So `evaluate_lear_in_test_dataset` is a batch experiment harness, not a service entry point.** It wants the
complete price history as a local file, a writable output directory, and it loops over an entire multi-year
test period, re-serialising a growing CSV every iteration. None of that suits a daily job on a free PaaS with
an ephemeral filesystem.

### The entry point to actually use

`LEAR.recalibrate_and_forecast_next_day(df, next_day_date, calibration_window)`. It does **no disk I/O**:

```python
df_train = df.loc[:next_day_date - pd.Timedelta(hours=1)]
df_train = df_train.iloc[-calibration_window * 24:]
df_test  = df.loc[next_day_date - pd.Timedelta(weeks=2):, :]
Xtrain, Ytrain, Xtest = self._build_and_split_XYs(df_train=df_train, df_test=df_test, date_test=next_day_date)
Yp = self.recalibrate_predict(Xtrain=Xtrain, Ytrain=Ytrain, Xtest=Xtest)
```

Contract, in service terms:

- `df`: hourly `DatetimeIndex`, columns **exactly** `['Price', 'Exogenous 1', 'Exogenous 2']` in that order.
- Must cover `next_day_date - calibration_window days` through `next_day_date + 23:00`.
- The target day's `Price` rows **must be present and set to `NaN`** (that is what
  `evaluate_lear_in_test_dataset` does before calling), and the target day's exogenous rows must be filled with
  the ENTSO-E day-ahead generation and load forecasts.
- Returns a plain 24-element `numpy` array.

The model itself: 24 independent per-hour LASSOs on 247 features (price at D-1/D-2/D-3/D-7 for each of 24
hours = 96; exogenous at D/D-1/D-7 for each of 24 hours = 72 each; 7 weekday dummies), inputs and target
asinh-median/MAD scaled with the dummies excluded from scaling, `alpha` picked per hour by
`LassoLarsIC(criterion='aic', max_iter=2500)` and then refitted with `Lasso(max_iter=2500, alpha=param)`.

**Recommendation: vendor, do not depend.** Extracting `LEAR`, `epftoolbox.data.scaling` and the
`epftoolbox.evaluation` metrics is roughly 400 lines whose only runtime dependencies are numpy / pandas /
scipy / scikit-learn / statsmodels. That drops TensorFlow, drops the `keras>3` conflict, drops the Python ≤3.12
cap, and lets `np.NaN` be fixed so NumPy 2 works. Note `epftoolbox.evaluation` (`MAE`, `RMSE`, `sMAPE`, `MASE`,
`rMAE`, `DM`, `GW`) is already TensorFlow-free, and covers every metric in `predict.R` plus the Diebold-Mariano
test used in `data_process.R`. Settle the licence question (§ issue #35) before vendoring — the file headers
say AGPL-3.0.

Metrics footnote: the R `SMAPE` is `200 * mean(|a-f| / (|a|+|f|))`; epftoolbox's is
`np.mean(np.abs(p_real - p_pred) / ((np.abs(p_real) + np.abs(p_pred)) / 2))`. Identical up to the ×100 scale
factor — no trap there.

---

## 6. R-to-Python porting traps in this specific code

Ordered by how likely they are to produce *plausible but wrong* numbers.

### a. `hist_loop[length(hist_loop) + 1 - p]` — the 1-based/0-based off-by-one

```r
posledni_hodnoty <- hist_loop[length(hist_loop) + 1 - p]
```

With `p = 1:192` this is `[y_n, y_{n-1}, ..., y_{n-191}]` — lag 1 first. The literal transcription
`hist[len(hist) + 1 - p]` in Python reads **one step into the future**: for `p=1` it indexes `len(hist)` →
`IndexError` if you are lucky, and for a `p` vector it silently returns the wrong lags. The correct
translations are `hist[len(hist) - np.asarray(p)]` or, more idiomatically, `hist[-np.asarray(p)]`.

**This is the single most likely silent bug in the whole port.** It shifts every lag by one hour, which on an
hourly price series produces forecasts that look entirely reasonable and are wrong.

The rest of the 1-based conversions in the same two functions:

| R | Python |
|---|---|
| `work_data[1:d]` | `work_data[:d]` |
| `work_data[1:(s * D)]` | `work_data[:s*D]` |
| `features[(total_removed + 1):nrow(features), , drop = FALSE]` | `features[total_removed:]` |
| `tail(x, h)` | `x[-h:]` |
| `lag_names <- paste0("lag", p)` | names encode the **lag value**, not the loop position — `lag5` is `y_{t-5}`. A Python port that names by enumerate index produces `lag0..lag191`. |
| `dplyr::lag(df$y, p[i])` | `df.y.shift(p[i])`. **Not** `np.roll`, which wraps. |

### b. `diff` semantics

R's `diff(x, lag = s, differences = D)` applies the lag-`s` difference `D` times and **shortens** the vector by
`s*D`.

- `numpy.diff(a, n=D)` only does repeated **lag-1** differences — there is no `lag` argument. It equals
  `diff(a, lag=1, differences=D)` only. For `lag = 168` write the loop explicitly:
  `for _ in range(D): a = a[s:] - a[:-s]`.
- `pandas.Series.diff(periods=s)` **preserves length** and inserts `NaN` — the opposite length convention.
  Repeated application compounds the NaN block.
- **The same word means two things inside this codebase.** `ar_lm_predict` calls `as.vector(data)` first, so it
  gets `diff.default` (shortens). But `data_process.R` does `y_diff <- diff(y_xts_orig)` on an **xts**, which
  dispatches to `diff.xts` with `na.pad = TRUE` (preserves length, pads NA). Check each call site
  individually.

### c. `diffinv` semantics and the reconstruction order

`?diffinv` gives `diffinv(x, lag = 1, differences = 1, xi, ...)`, where `xi` is *"a numeric vector, matrix, or
time series containing the initial values for the integrals"* and *"if missing, zeros are used"*. The result
has `lag * differences` more elements than `x`, with `xi` as the leading values.

**Python has no equivalent.** `np.cumsum` covers only `lag=1, differences=1, xi=0`. For general `lag = s`,
integrate `s` interleaved subsequences independently:

```python
def diffinv(x, lag=1, differences=1, xi=None):
    for _ in range(differences):
        out = np.empty(len(x) + lag)
        out[:lag] = xi_slice
        for j in range(lag):
            out[j::lag] = np.cumsum(np.r_[out[j], x[j::lag]])
        x = out
    return x
```

Three things the R does that a port must copy exactly:

1. **Order.** The forward pass differences by `d` **then** by `D`; the inverse pass calls `diffinv` for `D`
   **then** for `d`. Reversing the inverse order is wrong, and — because both operations are linear — produces
   a result that is smooth, plausible, and incorrect.
2. **Where `xi` comes from.** `xi_D <- work_data[1:(s * D)]` is captured **after** the `d`-differencing has
   already been applied to `work_data`. A port that captures both `xi` vectors from the raw level series is
   wrong.
3. **Scope.** `full_reconstructed <- c(ts_data, pred_vals)` reintegrates the *entire training history plus the
   forecast*, then takes `tail(h)`. This telescopes back to the level series, so it is correct, but it means
   `cumsum` runs over ~17,500 values. In float64 the accumulated error is around 1e-11 relative — harmless, but
   worth knowing. The cheap equivalent (seed from the last `s*D + d` observed levels) is exact in theory;
   implement the cheap one and assert it matches the R-faithful one.

### d. `na.omit` row alignment after lagging

```r
df_model <- na.omit(df)
```

- `na.omit` on a data frame drops every row containing `NA` **in any column** — including the exogenous ones.
  ENTSO-E generation/load forecast gaps are real, and each one silently removes a whole training row. Python:
  `df.dropna()` matches; `df.dropna(subset=lag_cols)` does not.
- With `p = 1:192` and complete exogenous columns, exactly the first **192** rows go. The effective training
  size is `len(ts_data) - 192`, not `len(ts_data)`.
- **`lag()` means three different things in this codebase.** `dplyr::lag(x, n)` shifts forward and pads NA at
  the front (`lag(1:5)` → `NA 1 2 3 4`) and equals `pandas.Series.shift(n)`. Base `stats::lag()` on a `ts`
  shifts the *time index* and introduces no NAs at all — the opposite sign convention. And `data_process.R`
  builds the naive benchmark with `stats::lag(y_xts_orig, k = 24)`, which dispatches to `lag.xts` where
  positive `k` means *lag* (again opposite to `lag.ts`). Verify each call independently against `shift`.
- **Lags are by row position, not by timestamp.** `preprocess.py` normalises everything to UTC so row position
  equals hour offset *provided there are no missing rows*. A pandas port that reaches for
  `shift(freq='1h')` or a timestamp-aware reindex will behave differently from R at any gap — arguably better,
  but it will not reproduce the golden files. Shift by position; validate index continuity separately.

### e. R `lm` factor handling vs a Python design matrix

Three distinct issues, and the first one is not what the issue title implies.

**The weekday columns are not factors by the time `lm` sees them.** `data_process.R` does

```r
weekdays_factor <- factor(weekdays(dates, abbreviate = TRUE), levels = c("po","út","st","čt","pá","so","ne"))
weekdays_df <- xts(as.data.frame(model.matrix(~ weekdays_factor - 1)), order.by = dates)
```

`model.matrix(~ f - 1)` with the `-1` suppressing the intercept expands to **all 7** 0/1 columns — no
reference level is dropped. Those become plain numeric columns in an xts. R's contrasts machinery therefore
never runs inside `ar_lm_predict`; `lm` just sees seven numeric regressors.

**Consequence: a rank-deficient design (the dummy-variable trap).** `lm` adds its own intercept, and the seven
dummies sum to 1 on every row, so `intercept = Σ dummies` exactly. R's default `singular.ok = TRUE` handles
this by pivoting the QR, dropping the aliased column, and setting that coefficient to `NA` —
[`?predict.lm`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/predict.lm.html): *"If the fit is
rank-deficient, some of the columns of the design matrix will have been dropped during the `lm` computations,
and corresponding `coef()` components set to `NA`."*

What that means for the port:

- **Do not compare coefficients.** statsmodels `OLS` (default `method='pinv'`) and scikit-learn
  `LinearRegression` (`scipy.linalg.lstsq`) return the **minimum-norm** solution instead of dropping a column,
  so all seven dummy coefficients and the intercept come back non-`NA` and numerically different from R's. A
  test asserting coefficient equality will fail for a port that is entirely correct.
- **Do compare predictions.** Every prediction row satisfies the same aliasing relation (its dummies sum to 1),
  so it lies in the row space of the training design, and fitted values are invariant to the choice of
  generalised inverse. R and a pinv-based Python fit agree on the *forecasts* to machine precision.
- **Do not solve the normal equations.** `np.linalg.inv(X.T @ X)`, `scipy.linalg.solve`, or any explicit
  `(X'X)^{-1}` will fail or return garbage on a singular design. Use `np.linalg.lstsq` / `scipy.linalg.lstsq` /
  `numpy.linalg.pinv`, or drop one dummy. Dropping one dummy changes the coefficients but **not** the
  predictions, and is the cleaner design for new code. (epftoolbox hit exactly this;
  [issue #11](https://github.com/jeslago/epftoolbox/issues/11) is literally titled "Dummy Variable Trap". Its
  LEAR keeps all 7 dummies but fits with LASSO, which regularises the singularity away.)

**By-name vs by-position matching.** `predict(fit, newdata = current_input)` resolves columns **by name**; a
numpy design matrix resolves **by position**. `cbind(ar_data, ext_data)` happens to reproduce the training
order only because `lag_names` follows `p` and the features follow their own `cbind` order. In Python, build
the column order once, in a single function, and use that same function for both fit and predict.

**Name mangling and encoding.** `data.frame()` / `as.data.frame()` apply `make.names()`, so the columns come
out as `weekdays_factorpo`, `weekdays_factorút`, `weekdays_factorčt`, `weekdays_factorpá` — **non-ASCII, in the
session's locale encoding**. Those are different byte strings on Windows CP1250 and Linux UTF-8, and
`predict.lm`'s by-name lookup can fail across platforms. Use explicit ASCII names (`dow_0..dow_6`) in the port.

### f. `weekdays()` is locale-dependent — the biggest reproducibility hazard in the R

```r
factor(weekdays(dates, abbreviate = TRUE), levels = c("po","út","st","čt","pá","so","ne"))
```

Those are **Czech** abbreviations. On any machine not running a Czech locale, `weekdays()` returns
`"Mon"`, `"Tue"`, ..., none of which match the declared `levels`, so **every value becomes `NA`**,
`model.matrix(~ f - 1)` drops all rows, and the weekday features silently disappear. The
[`?weekdays`](https://stat.ethz.ch/R-manual/R-devel/library/base/html/weekdays.html) docs flag the names as
locale-dependent.

In Python use `idx.dayofweek` (0 = Monday) — deterministic and locale-free — and order the columns Monday
through Sunday to match the R `levels` order. Before trusting the `*_ext_dummy_*` golden files, confirm which
locale produced them.

### g. Exogenous regressors are trimmed but never differenced

In `ar_lm_predict`, when `d > 0` or `D > 0`:

```r
total_removed <- rows_lost_d + rows_lost_D
features_train <- features[(total_removed + 1):nrow(features), , drop = FALSE]
```

The features are only **re-aligned**, never differenced. So the run `data_process.R` actually performs —
`predict_daily(features = features, D = 1)` — regresses the **168-hour-differenced** price on the **levels** of
generation, load and the weekday dummies. Whether that is intentional or a slip, a faithful port must
reproduce it; a "tidier" port that differences the exogenous block too will produce different numbers and fail
against the golden files.

### h. `predict_daily`'s calibration window is 731 days, not 730

```r
subset <- paste(day - calib_window_days, day - 1, sep = "/")
calibration_set <- data[subset]
```

xts date-range subsetting is **inclusive of both endpoints**, and `day - 1` means the whole preceding *day*
(through 23:00). So `calib_window_days = 730` selects 731 calendar days ≈ 17,544 hours, not 730 × 24 = 17,520.
The faithful pandas translation is
`df.loc[day - pd.Timedelta(days=730) : day - pd.Timedelta(hours=1)]` — also inclusive on both ends.

Note that epftoolbox's LEAR means something different by the same phrase:
`df_train.iloc[-calibration_window * 24:]` is exactly 730 × 24 hours. **"730-day calibration window" is already
two different windows between the R models and LEAR** in the thesis. Worth writing down before anyone tries to
reconcile the two.

### i. `untf_norm` is not the inverse of `tf_norm`

```r
tf_norm   <- function(ts) (ts - mean(ts)) / sd(ts)
untf_norm <- function(ts) ts * sd(ts) + mean(ts)
```

`untf_norm` uses the *transformed* series' own `sd`/`mean` (which are 1 and 0), so it is a near-identity, not
an inverse. `predict_daily` defaults `tf`/`untf` to identity, and the runs that produced the golden files used
`tfx_asinh`/`untfx_asinh` and `tfx_mlog`/`untfx_mlog`, which *are* genuine inverse pairs — so this never fired
in the recorded results. Do not copy it. (`untfx_asinh(t) = (exp(2t)-1)/(2·exp(t))` is `sinh(t)`; use
`np.sinh`. `asinh`/`sinh` and the `mlog` pair are pointwise and window-independent, so applying them inside the
daily loop is safe.)

---

## 7. How hard is a faithful port, really?

**A few days of careful work, not weeks.** Three reasons it is smaller than it looks:

1. **Two of the four "models" do not exist.** `exponential_smoothing.R` and `fourier.R` are EDA scripts. The
   real inventory is `ar_predict`, `ar_lm_predict`, LEAR.
2. **The statistics are shallow.** Yule-Walker + Levinson-Durbin, and OLS. Both are fully specified, both are
   exposed by statsmodels, and the only estimator-level decision is `method="mle"` on one function call. There
   is no hidden optimiser, no convergence tolerance, no random seed anywhere in the AR family.
3. **There are 13 golden-file CSVs** in `predictions/` covering 2023-2024 across every configuration
   (`base`, `diff`, `s_diff`, `ext`, `ext_diff`, `ext_dummy_hour`, `asinh`, `asinh_diff`, `mlog`, `mlog_diff`,
   LEAR). Every trap in §6 is an alignment or indexing error, and every alignment or indexing error is caught
   by a per-configuration regression test against those files. The verification story is unusually good.

**Where the residual risk actually sits:**

- **One genuine numerical unknown:** whether statsmodels' LU solve of the order-192 Toeplitz system agrees with
  R's Levinson-Durbin closely enough. Measurable in an afternoon; if it fails, writing Levinson-Durbin directly
  (~15 lines) closes it completely.
- **One decision, not a difficulty:** the epftoolbox licence (issue #35, AGPL headers vs Apache LICENSE) and
  whether to vendor LEAR. Vendoring is ~400 lines and removes a ~600 MB TensorFlow dependency, a `numpy<2`
  pin, and a Python ≤3.12 cap. For a free-tier deployment that has to survive unattended for years, the
  dependency case for vendoring is strong; the licence question needs a human answer first.
- **One thing to verify before trusting the golden files:** which epftoolbox commit produced
  `LEAR_forecast_datCZ_YT4_CW730.csv` (issue #8 changed LEAR's feature set in June 2024), and which locale
  produced the `*_ext_dummy_*` R forecasts (§6f).

**Suggested build order for the port ticket:** `ar_predict` first (smallest, exercises the Yule-Walker
question and the `diff`/`diffinv` helpers in isolation) → the `diff`/`diffinv`/lag-matrix utilities as a tested
module → `ar_lm_predict` on top of them → LEAR last (it is already Python; the work is packaging).

---

## Sources

**R**
- [`?ar`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/ar.html)
- [`?diffinv`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/diffinv.html)
- [`?lm`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/lm.html)
- [`?predict.lm`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/predict.lm.html)
- [`?acf`](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/acf.html)
- [`?weekdays`](https://stat.ethz.ch/R-manual/R-devel/library/base/html/weekdays.html)
- [`src/library/stats/R/ar.R`](https://github.com/wch/r-source/blob/trunk/src/library/stats/R/ar.R) (`ar`, `ar.yw.default`, `predict.ar`)
- [`src/library/stats/src/filter.c`](https://github.com/wch/r-source/blob/trunk/src/library/stats/src/filter.c) (acf normalisation)
- [`dplyr::lag`](https://dplyr.tidyverse.org/reference/lead-lag.html)

**Python libraries**
- [`statsmodels.regression.linear_model.yule_walker`](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.yule_walker.html) and its [source](https://github.com/statsmodels/statsmodels/blob/main/statsmodels/regression/linear_model.py)
- [`statsmodels.tsa.ar_model.AutoReg`](https://www.statsmodels.org/stable/generated/statsmodels.tsa.ar_model.AutoReg.html), [`AutoRegResults.predict`](https://www.statsmodels.org/stable/generated/statsmodels.tsa.ar_model.AutoRegResults.predict.html) and [source](https://github.com/statsmodels/statsmodels/blob/main/statsmodels/tsa/ar_model.py)
- [`sklearn.linear_model.LinearRegression`](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LinearRegression.html)
- [NumPy 2.0 migration guide](https://numpy.org/doc/stable/numpy_2_0_migration_guide.html)

**epftoolbox**
- [Repository](https://github.com/jeslago/epftoolbox) · [`setup.py`](https://github.com/jeslago/epftoolbox/blob/master/setup.py) · [`models/_lear.py`](https://github.com/jeslago/epftoolbox/blob/master/epftoolbox/models/_lear.py) · [`data/_datasets.py`](https://github.com/jeslago/epftoolbox/blob/master/epftoolbox/data/_datasets.py) · [`models/__init__.py`](https://github.com/jeslago/epftoolbox/blob/master/epftoolbox/models/__init__.py) · [`models/_dnn.py`](https://github.com/jeslago/epftoolbox/blob/master/epftoolbox/models/_dnn.py)
- [Getting started (install instructions)](https://epftoolbox.readthedocs.io/en/latest/modules/started.html)
- Issues [#8](https://github.com/jeslago/epftoolbox/issues/8), [#10](https://github.com/jeslago/epftoolbox/issues/10), [#11](https://github.com/jeslago/epftoolbox/issues/11), [#15](https://github.com/jeslago/epftoolbox/issues/15), [#23](https://github.com/jeslago/epftoolbox/issues/23), [#30](https://github.com/jeslago/epftoolbox/issues/30), [#35](https://github.com/jeslago/epftoolbox/issues/35), [#36](https://github.com/jeslago/epftoolbox/issues/36)

**Thesis repo** (private, read via the GitHub contents API): `predict.R`, `data_process.R`,
`exponential_smoothing.R`, `fourier.R`, `tf_matrix_to_series.R`, `bench_model.py`, `preprocess.py`,
`requirements.txt`.
