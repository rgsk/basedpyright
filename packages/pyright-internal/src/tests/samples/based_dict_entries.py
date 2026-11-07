# This sample tests the known entries of a dict constructed with string literal
# keys. Writes the checker can follow update them; wherever it can't follow the
# dict, it's a plain dict. Known entries never cause errors by themselves.

from typing import TypedDict, assert_type


def literal() -> None:
    user = {"name": "rahul", "age": 27, "details": {"sex": "male"}}
    reveal_type(user, expected_text="dict[{'name': str, 'age': int, 'details': dict[{'sex': str}]}]")
    assert_type(user["name"], str)
    assert_type(user["age"], int)
    assert_type(user["details"]["sex"], str)

    # This should generate an error.
    user["age"].upper()


def constructor() -> None:
    cfg = dict(lr=1e-3, layers=(64, 64))
    reveal_type(cfg, expected_text="dict[{'lr': float, 'layers': tuple[int, int]}]")
    merged = dict({"a": 1}, b="x")
    reveal_type(merged, expected_text="dict[{'a': int, 'b': str}]")
    keys = dict.fromkeys(["lr", "momentum"], 0.0)
    reveal_type(keys, expected_text="dict[{'lr': float, 'momentum': float}]")


def not_literal_keys(key: str) -> None:
    reveal_type({}, expected_text="dict[Unknown, Unknown]")
    reveal_type({key: 1}, expected_text="dict[str, int]")
    reveal_type({1: "a"}, expected_text="dict[int, str]")


def starts_empty(a: bool) -> None:
    prb = {}
    reveal_type(prb, expected_text="dict[Unknown, Unknown]")
    prb["env"] = 22
    prb["env"] += 1
    prb["name"] = "probe"
    reveal_type(prb, expected_text="dict[{'env': int, 'name': str}]")
    assert_type(prb["env"], int)

    # A declared type is kept, as for a non-empty dict (see expected_types).
    declared: dict[str, int] = {}
    reveal_type(declared, expected_text="dict[str, int]")

    # Empty in one branch, filled in the other: the empty one is dropped, as for
    # any empty container.
    branches = {}
    if a:
        branches = {"a": 2}
    reveal_type(branches, expected_text="dict[{'a': int}]")


def unknown_key() -> None:
    user = {"name": "rahul", "age": 27}
    # No error: code the checker can't follow may have added the key.
    reveal_type(user["nme"], expected_text="str | int")
    reveal_type(user.get("nme"), expected_text="str | int | None")
    assert_type(user.get("name"), str)


def writes() -> None:
    user = {"name": "rahul", "age": 27}
    user["name"] = 2
    reveal_type(user, expected_text="dict[{'name': int, 'age': int}]")
    user["joker"] = 3
    reveal_type(user, expected_text="dict[{'name': int, 'age': int, 'joker': int}]")
    del user["age"]
    reveal_type(user, expected_text="dict[{'name': int, 'joker': int}]")
    user["name"] += 1
    reveal_type(user, expected_text="dict[{'name': int, 'joker': int}]")

    scores = {"math": 90}
    # This should generate an error: writes are still checked against the value type.
    scores["math"] = "A"


def writes_with_unknown_keys(key: str) -> None:
    scores = {"math": 90, "art": 75}
    scores[key] = 100
    reveal_type(scores, expected_text="dict[str, int]")

    marks = {"math": 90, "art": 75}
    del marks[key]
    reveal_type(marks, expected_text="dict[str, int]")

    totals = {"math": 90, "art": 75}
    for totals["math"] in [1, 2]:
        pass
    reveal_type(totals, expected_text="dict[{'art': int}]")


def methods() -> None:
    user = {"name": "rahul", "age": 27}
    user.update(city="delhi")
    user.update({"pin": 110001})
    reveal_type(user, expected_text="dict[{'name': str, 'age': int, 'city': str, 'pin': int}]")
    user |= {"age": 28}
    reveal_type(user, expected_text="dict[{'name': str, 'age': int, 'city': str, 'pin': int}]")
    user.pop("pin")
    user.setdefault("zone", "north")
    user.setdefault("name", "ignored")
    reveal_type(user, expected_text="dict[{'name': str, 'age': int, 'city': str, 'zone': str}]")
    reveal_type(user.copy(), expected_text="dict[{'name': str, 'age': int, 'city': str, 'zone': str}]")

    cleared = {"a": 1}
    cleared.clear()
    reveal_type(cleared, expected_text="dict[{}]")
    cleared["b"] = 2
    reveal_type(cleared, expected_text="dict[{'b': int}]")

    popped = {"a": 1}
    popped.popitem()
    reveal_type(popped, expected_text="dict[str, int]")


def update_unknown(other: dict[str, int]) -> None:
    user = {"a": 1, "b": 2}
    user.update(other)
    reveal_type(user, expected_text="dict[str, int]")


# x.update(...) is applied as x |= ... would be, so values of a new type widen the
# value type of a dict without a declared type rather than being an error.
def update_like_ior() -> None:
    user = {"name": "rahul"}
    user.update({"b": 20, "c": 3})
    reveal_type(user, expected_text="dict[{'name': str, 'b': int, 'c': int}]")
    assert_type(user["b"], int)
    reveal_type(user.get("zzz"), expected_text="str | int | None")

    built = {"name": "rahul"}
    built.update(dict(b=20, c=3.5))
    reveal_type(built, expected_text="dict[{'name': str, 'b': int, 'c': float}]")

    kw = {"name": "rahul"}
    kw.update(b=20, c=[1])
    reveal_type(kw, expected_text="dict[{'name': str, 'b': int, 'c': list[int]}]")

    # A key given again gets the new value's type, not a union.
    over = {"name": "rahul", "age": "27"}
    over.update({"age": 27})
    reveal_type(over, expected_text="dict[{'name': str, 'age': int}]")
    over.update(name=None)
    reveal_type(over, expected_text="dict[{'name': None, 'age': int}]")

    # From another dict with known entries.
    extra = {"x": 1.5}
    merged = {"name": "rahul"}
    merged.update(extra)
    reveal_type(merged, expected_text="dict[{'name': str, 'x': float}]")


def update_unknown_shape(other: dict[str, int]) -> None:
    user = {"name": "rahul"}
    # This should generate an error.
    user.update(other)
    reveal_type(user, expected_text="dict[str, str]")


def update_declared(other: dict[str, str]) -> None:
    user: dict[str, str] = {"name": "rahul"}
    # This should generate an error.
    user.update({"b": 20})
    reveal_type(user, expected_text="dict[str, str]")
    other.update({"x": "y"})
    reveal_type(other, expected_text="dict[str, str]")


def update_alias() -> None:
    user = {"name": "rahul"}
    alias = user
    alias.update({"b": "x"})
    reveal_type(alias, expected_text="dict[{'name': str, 'b': str}]")
    reveal_type(user, expected_text="dict[{'name': str}]")


def update_ends_narrowing() -> None:
    user = {"name": "rahul", "age": 27}
    user["name"] = "mehak"
    user.update(name=5)
    assert_type(user["name"], int)
    # A call that doesn't change the key keeps its narrowed type.
    user["age"] = 28
    user.update(city="delhi")
    reveal_type(user["age"], expected_text="Literal[28]")


def merging() -> None:
    user = {"name": "rahul", "age": 27}
    reveal_type({**user, "age": "27"}, expected_text="dict[{'name': str, 'age': str}]")
    reveal_type(user | {"age": 28.5}, expected_text="dict[{'name': str, 'age': float}]")


def branches(flag: bool) -> None:
    point = {"x": 0, "y": 0, "label": "origin"}
    if flag:
        point["x"] = "far"
        point["color"] = "red"
    reveal_type(point, expected_text="dict[{'x': str | int, 'y': int, 'label': str}]")

    either = {"a": 1} if flag else {"b": 2}
    reveal_type(either, expected_text="dict[str, int]")


def loop() -> None:
    counts = {"a": 0, "b": ""}
    for _ in range(3):
        counts["a"] = "x"
    reveal_type(counts, expected_text="dict[{'a': int | str, 'b': str}]")


def make():
    d = {"name": "rahul", "age": 27}
    d["admin"] = False
    return d


def return_type() -> None:
    reveal_type(make(), expected_text="dict[{'name': str, 'age': int, 'admin': bool}]")


class Settings:
    def __init__(self) -> None:
        self.cfg = {"debug": False, "level": "info"}
        reveal_type(self.cfg, expected_text="dict[{'debug': bool, 'level': str}]")

    def show(self) -> None:
        # Another method may have changed it.
        reveal_type(self.cfg, expected_text="dict[str, bool | str]")


counters = {"hits": 0}


# A global read in a function has the keys of the code above the function. A missing
# key is no error, as for any dict.
def read_global() -> None:
    reveal_type(counters, expected_text="dict[{'hits': int}]")
    assert_type(counters["hits"], int)
    reveal_type(counters.get("misses"), expected_text="int | None")
    counters["misses"] = 1
    reveal_type(counters, expected_text="dict[{'hits': int, 'misses': int}]")


class Reader:
    def read(self) -> None:
        reveal_type(counters, expected_text="dict[{'hits': int}]")


twice = {"a": 1}
twice = {"b": 2}


def read_twice() -> None:
    # The last assignment above the function.
    reveal_type(twice, expected_text="dict[{'b': int}]")


later = {"a": 1}


def read_later() -> None:
    # Read top to bottom: an assignment below the function doesn't change it.
    reveal_type(later, expected_text="dict[{'a': int}]")


later = {"b": 2}
other_type = {"a": 1}


def read_other_type() -> None:
    reveal_type(other_type, expected_text="dict[{'a': int}]")


other_type = {"b": "x"}


def containers() -> None:
    user = {"name": "rahul", "age": 27}
    reveal_type([user], expected_text="list[dict[str, str | int]]")
    reveal_type((user, 1), expected_text="tuple[dict[str, str | int], Literal[1]]")
    reveal_type([{"a": "b"}, {"c": "d"}], expected_text="list[dict[str, str]]")


def membership() -> None:
    point = {"x": 0}
    if "y" in point:
        reveal_type(point, expected_text="dict[{'x': int}]")


def greet(name: str, age: int) -> None: ...


def measure(age: int, height: int) -> None: ...


def unpacking() -> None:
    user = {"name": "rahul", "age": 27}
    greet(**user)

    wrong = {"name": "rahul", "age": "27"}
    # This should generate an error.
    greet(**wrong)

    # A parameter none of the known keys matches may come from a key the checker
    # hasn't seen.
    partial = {"age": 27}
    measure(**partial)


def frozendict_from_dict() -> None:
    # A frozendict's entries are exact, so they can't come from a dict's.
    user = {"name": "rahul", "age": 27}
    reveal_type(frozendict(user), expected_text="frozendict[str, str | int]")
    reveal_type(frozendict(**user), expected_text="frozendict[str, str | int]")
    reveal_type(user | frozendict(city="delhi"), expected_text="dict[{'name': str, 'age': int, 'city': str}]")


class UserTD(TypedDict):
    name: str


def expected_types() -> None:
    td: UserTD = {"name": "rahul"}
    reveal_type(td, expected_text="UserTD")

    # A declared type is kept.
    declared: dict[str, object] = {"name": "rahul", "age": 27}
    reveal_type(declared, expected_text="dict[str, object]")
    declared["anything"] = [1]
    reveal_type(declared["anything"], expected_text="list[int]")

    keyed: dict[object, int] = {"a": 1}
    reveal_type(keyed, expected_text="dict[object, int]")
    assert_type(keyed["a"], int)
