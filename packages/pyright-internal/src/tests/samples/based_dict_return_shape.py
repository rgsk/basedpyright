# pyright: reportUnusedExpression=none, reportUnusedParameter=none

# A dict or frozendict return annotation bounds the inferred shape instead of
# erasing it: callers see the keys the body returns, each with the declared value
# type (or the inferred one when that is Any, object or missing).

from collections.abc import Callable
from typing import Any, assert_type


def train(lr: float) -> dict:
    return {"weights": [lr], "log": "done"}


def train_unannotated(lr: float):
    return {"weights": [lr], "log": "done"}


def bare_dict() -> None:
    run = train(0.1)
    reveal_type(run, expected_text="dict[{'weights': list[float], 'log': str}]")
    assert_type(run["weights"], list[float])
    # A key that isn't known is read as with an unannotated function: no error,
    # the dict's value type (Unknown without strictDictionaryInference).
    reveal_type(run["wieghts"], expected_text="Unknown")
    reveal_type(train_unannotated(0.1)["wieghts"], expected_text="Unknown")
    # This should generate an error.
    run["log"].append(1)


def pair(first: int, second: str) -> frozendict:
    return frozendict(first=first, second=second)


def bare_frozendict() -> None:
    reveal_type(pair(1, "a"), expected_text="frozendict[{'first': int, 'second': str}]")
    assert_type(pair(1, "a")["second"], str)
    # This should generate an error.
    pair(1, "a")["third"]


def named() -> dict[str, str]:
    return {"name": "rahul"}


def declared_key_and_value() -> None:
    reveal_type(named(), expected_text="dict[{'name': str}]")
    assert_type(named()["name"], str)
    # A key that isn't known reads as V, with no error, as for any dict.
    reveal_type(named()["nmae"], expected_text="str")


def floats() -> dict[str, float]:
    return {"a": 1}


def declared_value_wins() -> None:
    reveal_type(floats(), expected_text="dict[{'a': float}]")
    assert_type(floats()["a"], float)


class Tensor: ...


def weights(t: Tensor) -> frozendict[str, Tensor]:
    return frozendict(w=t)


def any_values() -> dict[str, Any]:
    return {"lr": 0.1, "layers": [64, 64]}


def object_values() -> dict[str, object]:
    return {"lr": 0.1}


def declared_frozendict_and_any() -> None:
    assert_type(weights(Tensor())["w"], Tensor)
    reveal_type(weights(Tensor()), expected_text="frozendict[{'w': Tensor}]")
    # This should generate an error.
    weights(Tensor())["b"]
    assert_type(any_values()["lr"], float)
    # A container value is inferred in the context of Any, as in an assignment to
    # x: dict[str, Any].
    assert_type(any_values()["layers"], list[Any])
    assert_type(object_values()["lr"], float)


def value_does_not_fit() -> dict[str, int]:
    return {"a": "x"}  # This should generate an error.


def key_does_not_fit() -> dict[int, str]:
    return {"a": "x"}  # This should generate an error.


def not_fitting() -> None:
    reveal_type(value_does_not_fit(), expected_text="dict[str, int]")
    reveal_type(key_does_not_fit(), expected_text="dict[int, str]")


def different_shapes(flag: bool) -> dict:
    if flag:
        return {"a": 1}
    return {"b": "x"}


def different_declared(flag: bool) -> dict[str, int | str]:
    if flag:
        return {"a": 1}
    return {"b": "x"}


def same_shapes(flag: bool) -> dict:
    if flag:
        return {"a": 1}
    return {"a": 2}


def no_shape(**kwargs: int) -> dict:
    return dict(**kwargs)


def data_keyed(names: list[str]) -> dict:
    return {name: len(name) for name in names}


def maybe_none(flag: bool) -> dict:
    if flag:
        return {"a": 1}
    return None  # This should generate an error.


def no_body() -> dict: ...


def fallbacks() -> None:
    reveal_type(different_shapes(True), expected_text="dict[Unknown, Unknown]")
    reveal_type(different_declared(True), expected_text="dict[str, int | str]")
    reveal_type(same_shapes(True), expected_text="dict[{'a': int}]")
    reveal_type(no_shape(a=1), expected_text="dict[Unknown, Unknown]")
    reveal_type(data_keyed([]), expected_text="dict[Unknown, Unknown]")
    reveal_type(maybe_none(True), expected_text="dict[Unknown, Unknown]")
    reveal_type(no_body(), expected_text="dict[Unknown, Unknown]")


def cache[**P, R](fn: Callable[P, R]) -> Callable[P, R]: ...


@cache
def cached_train(lr: float) -> dict:
    return {"weights": [lr], "log": "done"}


@cache
def cached_named() -> dict[str, str]:
    return {"name": "rahul"}


def through_decorator() -> None:
    assert_type(cached_train(0.1)["weights"], list[float])
    reveal_type(cached_named(), expected_text="dict[{'name': str}]")


class Trainer:
    def run(self, lr: float) -> dict[str, float]:
        return {"lr": lr, "epochs": 3}

    @classmethod
    def build(cls) -> frozendict:
        return frozendict(name="t")


def methods() -> None:
    reveal_type(Trainer().run(0.1), expected_text="dict[{'lr': float, 'epochs': float}]")
    assert_type(Trainer.build()["name"], str)


def generic[T](value: T, default: T) -> dict:
    return {"value": value, "default": default}


def generic_call() -> None:
    assert_type(generic(1, 2)["value"], int)
    assert_type(generic("a", "b")["default"], str)
