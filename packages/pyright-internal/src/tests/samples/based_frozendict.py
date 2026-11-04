# pyright: reportUnusedExpression=none, reportUnusedParameter=none

# A frozendict constructed with string literal keys remembers each key's value type.

from typing import Literal, Never, assert_type


def keyword_arguments() -> None:
    user = frozendict(name="rahul", age=27)
    reveal_type(user, expected_text="frozendict[{'name': str, 'age': int}]")
    assert_type(user["name"], str)
    assert_type(user["age"], int)
    # This should generate an error.
    user["nme"]


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

    merged = user | data
    assert_type(merged["name"], str | int)


def branches(flag: bool) -> None:
    either = frozendict(a=1) if flag else frozendict(b="x")
    # This should generate an error.
    either["a"]


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
    reveal_type(cfg, expected_text="frozendict[{'lr': float, 'layers': tuple[int, int]}]")
    assert_type(cfg["layers"], tuple[int, int])
    nested = frozendict({"shape": ((1, 2), "x")})
    assert_type(nested["shape"], tuple[tuple[int, int], str])
    # as far as the value type allows: for keyword arguments it keeps them
    by_kwarg = frozendict(size=(1, 2))
    reveal_type(by_kwarg, expected_text="frozendict[{'size': tuple[Literal[1], Literal[2]]}]")
    assert_type(by_kwarg["size"], tuple[Literal[1], Literal[2]])
    # unless the declared value type needs the literals
    pinned: frozendict[str, tuple[Literal[1], int]] = frozendict({"p": (1, 2)})
    assert_type(pinned["p"], tuple[Literal[1], Literal[2]])


# The known entries aren't a type expression: other checkers wouldn't accept one.
def annotation(
    # This should generate errors (3), as in other checkers.
    user: frozendict[{"name": str}],
) -> None: ...


# Merging keeps the known entries when both sides have them; the right side wins.
def merging(plain: frozendict[str, int]) -> None:
    defaults = frozendict(lr=1e-3, epochs=10)
    reveal_type(defaults | frozendict(epochs="all"), expected_text="frozendict[{'lr': float, 'epochs': str}]")
    reveal_type(defaults | {"batch": 32}, expected_text="frozendict[{'lr': float, 'epochs': int, 'batch': int}]")
    reveal_type(frozendict(defaults, epochs=20), expected_text="frozendict[{'lr': float, 'epochs': int}]")
    reveal_type(frozendict({**defaults, "epochs": 20}), expected_text="frozendict[{'lr': float, 'epochs': int}]")
    reveal_type(frozendict(**defaults, batch=32), expected_text="frozendict[{'lr': float, 'epochs': int, 'batch': int}]")
    updated = defaults
    updated |= {"epochs": 20}
    reveal_type(updated, expected_text="frozendict[{'lr': float, 'epochs': int}]")
    # without known entries on one side, there are none in the result
    assert_type(defaults | plain, frozendict[str, float | int])
    assert_type(frozendict(plain, extra=1), frozendict[str, int])
    # a dict on the left makes a dict, with the keys of both
    assert_type(({"epochs": 20} | defaults)["lr"], float)


# The keys are always present: .get of a known key is its value type, and .get of
# another key is the default (no error: it doesn't fail at runtime).
def get_and_copy(key: Literal["name", "age"], any_key: str, flag: bool) -> None:
    user = frozendict(name="rahul", age=27)
    assert_type(user.get("age"), int)
    assert_type(user.get("age", 0), int)
    assert_type(user.get("nme"), None)
    assert_type(user.get("nme", "x"), str)
    assert_type(user.get(key), str | int)
    assert_type(user.get(any_key), str | int | None)
    reveal_type(user.copy(), expected_text="frozendict[{'name': str, 'age': int}]")
    either = frozendict(a=1) if flag else frozendict(b="x")
    assert_type(either.get("a"), int | None)


# ** unpacking matches each known key to the parameter of the same name, as for a TypedDict.
def greet(name: str, age: int) -> None: ...


def greet_rest(name: str, **rest: int) -> None: ...


def unpacking() -> None:
    user = frozendict(name="rahul", age=27)
    greet(**user)
    greet(**frozendict(name="rahul"), age=27)
    greet_rest(**frozendict(name="rahul", age=27, height=180))
    # This should generate an error: "age" is missing.
    greet(**frozendict(name="rahul"))
    # This should generate an error: there's no parameter "city".
    greet(**frozendict(name="rahul", age=27, city="delhi"))
    # This should generate an error: "age" is a str.
    greet(**frozendict(name="rahul", age="27"))


# The value of a mapping pattern has the key's type.
def patterns() -> None:
    user = frozendict(name="rahul", age=27)
    match user:
        case {"nme": missing}:
            assert_type(missing, Never)
        case {"age": age}:
            assert_type(age, int)


# Unions of frozendicts with known entries narrow by key, as their keys are exact.
def tagged(flag: bool) -> None:
    shape = frozendict(kind="circle", radius=1.0) if flag else frozendict(kind="square", side=2.0)
    if "radius" in shape:
        assert_type(shape["radius"], float)
    else:
        assert_type(shape["side"], float)


# fromkeys with literal keys has known entries too.
def from_keys(keys: list[str]) -> None:
    reveal_type(frozendict.fromkeys(["lr", "momentum"], 0.0), expected_text="frozendict[{'lr': float, 'momentum': float}]")
    reveal_type(frozendict.fromkeys(("lr",)), expected_text="frozendict[{'lr': None}]")
    assert_type(frozendict.fromkeys(keys, 1), frozendict[str, int])
    # several keys sharing a default, merged into a known shape
    user = frozendict(name="rahul", age=27)
    reveal_type(
        frozendict(**user, **frozendict.fromkeys(["lr", "momentum"], 0.0)),
        expected_text="frozendict[{'name': str, 'age': int, 'lr': float, 'momentum': float}]",
    )
