# pyright: reportUnusedExpression=none, reportUnusedParameter=none

# A dict, frozendict or SimpleNamespace inside a return annotation (list[SimpleNamespace],
# dict[str, dict], SimpleNamespace | None, tuple[dict, int]) keeps the shapes the body
# returns, as a bare annotation does.

from collections.abc import Sequence
from types import SimpleNamespace


def make(i: int):
    return SimpleNamespace(id=i, name="asha")


def many() -> list[SimpleNamespace]:
    return [make(i) for i in range(3)]


def many_appended() -> list[SimpleNamespace]:
    out: list[SimpleNamespace] = []
    for i in range(3):
        out.append(make(i))
    return out


def by_name() -> dict[str, SimpleNamespace]:
    return {"asha": make(1)}


def by_name_built(names: list[str]) -> dict[str, SimpleNamespace]:
    return {name: make(1) for name in names}


def maybe(i: int) -> SimpleNamespace | None:
    return make(i) if i else None


def pair() -> tuple[SimpleNamespace, int]:
    return make(1), 2


def rows() -> list[dict]:
    return [{"a": 1, "b": "x"}]


def nested() -> dict[str, list[SimpleNamespace]]:
    return {"people": [make(1)]}


def seq() -> Sequence[SimpleNamespace]:
    return [make(1)]


def mixed(flag: bool) -> list[SimpleNamespace]:
    if flag:
        return [make(1)]
    return [SimpleNamespace(other=1)]


def shapes_kept() -> None:
    reveal_type(many(), expected_text="list[SimpleNamespace[{id: int, name: str}]]")
    reveal_type(many()[0].name, expected_text="str")
    # This should generate an error.
    many()[0].nmae
    reveal_type(by_name(), expected_text="dict[{'asha': SimpleNamespace[{id: int, name: str}]}]")
    reveal_type(by_name_built([]), expected_text="dict[str, SimpleNamespace[{id: int, name: str}]]")
    reveal_type(maybe(1), expected_text="SimpleNamespace[{id: int, name: str}] | None")
    reveal_type(pair(), expected_text="tuple[SimpleNamespace[{id: int, name: str}], int]")
    reveal_type(rows(), expected_text="list[dict[{'a': int, 'b': str}]]")
    # A display inside the returned one is evaluated in the annotation's context only.
    reveal_type(nested(), expected_text="dict[{'people': list[SimpleNamespace]}]")


def declared_kept() -> None:
    # An abstract container keeps the annotation.
    reveal_type(seq(), expected_text="Sequence[SimpleNamespace]")
    reveal_type(mixed(True), expected_text="list[SimpleNamespace]")


def callers_unchanged() -> None:
    xs = many()
    xs.append(SimpleNamespace())
    ys: list[SimpleNamespace] = many()
    zs: dict[str, SimpleNamespace] = by_name()
