"""The v1 roster (ADR-0003). `CONTEXT.md` is its authority: these slugs and no
others. Chronos-2 joins in phase 4 (ADR-0013)."""

from forecast.model import Model
from forecast.models.daylag import DayLagNaive

ROSTER: dict[str, type[Model]] = {
    DayLagNaive.slug: DayLagNaive,
}


def build(slug: str) -> Model:
    """Construct a model by its slug. Construction is where setup happens."""
    try:
        return ROSTER[slug]()
    except KeyError:
        known = sorted(ROSTER)
        raise ValueError(f"unknown model {slug!r}; the roster is {known}") from None
