"""The v1 roster (ADR-0003). `CONTEXT.md` is its authority: these slugs and no
others.

Chronos-2 is on the roster, but building it needs the optional `chronos` extra
and downloads its weights, so the pull request gate never builds it: its tests
carry the `chronos` marker, which the gate deselects (ADR-0010)."""

from forecast.model import Model
from forecast.models.ar168 import AR168
from forecast.models.chronos2 import Chronos2
from forecast.models.daylag import DayLagNaive

ROSTER: dict[str, type[Model]] = {
    DayLagNaive.slug: DayLagNaive,
    AR168.slug: AR168,
    Chronos2.slug: Chronos2,
}

# Models whose construction downloads an artifact and needs an optional extra.
DOWNLOADED = {Chronos2.slug}


def build(slug: str) -> Model:
    """Construct a model by its slug. Construction is where setup happens."""
    try:
        return ROSTER[slug]()
    except KeyError:
        known = sorted(ROSTER)
        raise ValueError(f"unknown model {slug!r}; the roster is {known}") from None
