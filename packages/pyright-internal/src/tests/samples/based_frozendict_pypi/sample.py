# The frozendict package from PyPI gets the same treatment as the builtin.
from typing import assert_type

from frozendict import frozendict

user = frozendict(name="rahul", age=27)
assert_type(user, frozendict[{"name": str, "age": int}])
assert_type(user["age"], int)
user["nme"]  # error

type User = frozendict[{"name": str, "age": int}]


def load() -> User:
    return frozendict(name="rahul", age=27)


assert_type(load()["age"], int)
missing: User = frozendict(name="rahul")  # error
assert_type(user | {"age": "x"}, frozendict[{"name": str, "age": str}])
assert_type(user.get("age"), int)
assert_type(user.get("nme"), None)
assert_type(user.copy(), frozendict[{"name": str, "age": int}])

# Methods the builtin doesn't have keep the stub's types.
assert_type(user.set("city", "delhi"), frozendict[str, str | int])
assert_type(user.delete("age"), frozendict[str, str | int])

# Its fromkeys() leaves the value type unsolved: the given value's type is used.
assert_type(frozendict.fromkeys(["lr", "momentum"], 0.0), frozendict[{"lr": float, "momentum": float}])
