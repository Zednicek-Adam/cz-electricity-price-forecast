"""The suite is empty of behaviour on purpose — there is no behaviour yet.

This one test exists so `pytest` exits 0 rather than exit code 5 ("no tests
collected"), which the pull request gate of ADR-0010 would read as a failure.
Delete it once the loader arrives with tests of its own.
"""

import forecast


def test_the_package_imports() -> None:
    assert forecast.__doc__
