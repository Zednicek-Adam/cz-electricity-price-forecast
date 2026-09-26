"""Chronos-2: the headline model (ADR-0003).

`amazon/chronos-2`, a pretrained time-series model, called zero-shot on the
price history alone. It is not trained here: construction loads the weights
at an explicitly pinned Hugging Face revision, downloading them into the local
Hugging Face cache on first use, on CPU in float32. Pinning is what makes a
replay reproducible; downloading keeps the weights out of the repository and
out of any image. The model is public, so no token is needed.

Per forecast run it takes the last 8,192 hours of history, the model's own
context cap (about 341 days), and returns the median of its forecast for the
24 period ordinals of the target day, as the thesis's univariate Chronos-2
script did (`epf-diploma`, `models/python/chronos2.py`).

Its runtime is the optional `chronos` extra (`uv sync --extra chronos`),
imported here only at construction, so nothing that does not build this model
installs or loads it. It never runs in the pull request gate (ADR-0010).
"""

import math
from datetime import date
from typing import Any

import pandas as pd

from forecast.grid import REPAIRED_PERIODS_PER_DAY

MODEL_ID = "amazon/chronos-2"
REVISION = "29ec3766d36d6f73f0696f85560a422f50e8498c"
CONTEXT_HOURS = 8192


class Chronos2:
    slug = "chronos2"
    version = f"{MODEL_ID}@{REVISION}"
    history_days = math.ceil(CONTEXT_HOURS / REPAIRED_PERIODS_PER_DAY)

    def __init__(self) -> None:
        import torch
        from chronos import BaseChronosPipeline

        self._pipeline: Any = BaseChronosPipeline.from_pretrained(
            MODEL_ID,
            revision=REVISION,
            device_map="cpu",
            dtype=torch.float32,
        )

    def forecast(self, history: pd.Series, target_day: date) -> list[float]:
        context = history.iloc[-CONTEXT_HOURS:]
        frame = pd.DataFrame(
            {
                "item_id": "price",
                "timestamp": context.index,
                "target": context.to_numpy(dtype="float64"),
            }
        )
        predicted = self._pipeline.predict_df(
            frame,
            prediction_length=REPAIRED_PERIODS_PER_DAY,
            quantile_levels=[0.5],
        )
        return [float(price) for price in predicted["predictions"]]
