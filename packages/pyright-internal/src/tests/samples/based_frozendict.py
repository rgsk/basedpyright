# pyright: reportUnusedExpression=none, reportUnusedParameter=none

# A frozendict constructed with string literal keys remembers each key's value type.

from typing import Literal, assert_type


def keyword_arguments() -> None:
    user = frozendict(name="rahul", age=27)
    assert_type(user, frozendict[{"name": str, "age": int}])
    assert_type(user["name"], str)
    assert_type(user["age"], int)
    user["nme"]  # error


def dict_display() -> None:
    user = frozendict({"name": "rahul", "age": 27})
    assert_type(user["name"], str)
    assert_type(user["age"], int)

    # A keyword argument replaces the value of the same key.
    replaced = frozendict({"name": "rahul", "age": 27}, age="unknown")
    assert_type(replaced["age"], str)


def literal_key_union(key: Literal["name", "age"]) -> None:
    user = frozendict(name="rahul", age=27)
    assert_type(user[key], str | int)


def literal_values() -> None:
    # A literal value type is kept when it is what the value type was solved to.
    sizes: frozendict[str, Literal["s", "m"]] = frozendict({"shirt": "s", "hat": "m"})
    assert_type(sizes["shirt"], Literal["s"])


def declared_type() -> None:
    # Narrowing on assignment keeps the entries of the assigned value.
    user: frozendict[str, object] = frozendict(name="rahul", age=27)
    assert_type(user["age"], int)


def without_known_entries(key: str, data: dict[str, int]) -> None:
    user = frozendict(name="rahul", age=27)
    assert_type(user[key], str | int)

    from_dict = frozendict(data)
    assert_type(from_dict["anything"], int)

    from_kwargs = frozendict(**data)
    assert_type(from_kwargs["anything"], int)

    from_variable_key = frozendict({key: 1})
    assert_type(from_variable_key["anything"], int)

    merged = user | {"extra": 1.5}
    assert_type(merged["name"], str | int | float)


def branches(flag: bool) -> None:
    either = frozendict(a=1) if flag else frozendict(b="x")
    either["a"]  # error


def takes_frozendict(value: frozendict[str, int]) -> None: ...


def assignability() -> None:
    takes_frozendict(frozendict(a=1, b=2))


# The entries of an inferred return type are specialized at each call.
def pair[T](first: T, second: T):
    return frozendict(first=first, second=second)


def generic() -> None:
    assert_type(pair(1, 2)["first"], int)
    assert_type(pair("x", "y")["second"], str)


def tuple_values() -> None:
    # literals inside a tuple are widened like the value type itself
    cfg = frozendict({"lr": 1e-3, "layers": (64, 64)})
    assert_type(cfg, frozendict[{"lr": float, "layers": tuple[int, int]}])
    assert_type(cfg["layers"], tuple[int, int])
    nested = frozendict({"shape": ((1, 2), "x")})
    assert_type(nested["shape"], tuple[tuple[int, int], str])
    # as far as the value type allows: for keyword arguments it keeps them
    by_kwarg = frozendict(size=(1, 2))
    assert_type(by_kwarg, frozendict[{"size": tuple[Literal[1], Literal[2]]}])
    assert_type(by_kwarg["size"], tuple[Literal[1], Literal[2]])
    # unless the declared value type needs the literals
    pinned: frozendict[str, tuple[Literal[1], int]] = frozendict({"p": (1, 2)})
    assert_type(pinned["p"], tuple[Literal[1], Literal[2]])


# The known entries can be spelled in a type expression.
type User = frozendict[{"name": str, "age": int}]


def load() -> User:
    return frozendict(name="rahul", age=27)


def annotations(plain: frozendict[str, str | int]) -> None:
    user = load()
    assert_type(user["age"], int)
    assert_type(user, frozendict[{"name": str, "age": int}])
    inline: frozendict[{"a-b": int, "pair": tuple[int, int]}] = frozendict({"a-b": 1, "pair": (1, 2)})
    assert_type(inline["pair"], tuple[int, int])
    missing: User = frozendict(name="rahul")
    extra: User = frozendict(name="rahul", age=27, city="delhi")
    wrong_type: User = frozendict(name="rahul", age="27")
    unknown_keys: User = plain
    widened: frozendict[str, str | int] = user
    print(missing, extra, wrong_type, unknown_keys, widened)


def invalid_annotations(
    non_literal_key: frozendict[{1: int}],
    too_many: frozendict[{"a": int}, int],
) -> None: ...


def widened_entries() -> None:
    # each entry is checked on its own, as a frozendict can't change
    user = frozendict(name="rahul", age=27)
    optional_age: frozendict[{"name": str, "age": int | None}] = user
    built: frozendict[{"name": str, "age": int | None}] = frozendict(name="rahul", age=27)
    users = [user]
    still_invariant: list[frozendict[{"name": str, "age": int | None}]] = users
    print(optional_age, built, still_invariant)
