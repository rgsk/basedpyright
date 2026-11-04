# The frozendict package from PyPI gets the same treatment as the builtin.
from typing import assert_type

from frozendict import frozendict

user = frozendict(name="rahul", age=27)
reveal_type(user, expected_text="frozendict[{'name': str, 'age': int}]")
assert_type(user["age"], int)
# This should generate an error.
user["nme"]

reveal_type(user | {"age": "x"}, expected_text="frozendict[{'name': str, 'age': str}]")
# A dict on the left makes a dict, printed as dict even though the stub says typing.Dict.
reveal_type({"age": "x"} | user, expected_text="dict[{'age': int, 'name': str}]")
assert_type(user.get("age"), int)
assert_type(user.get("nme"), None)
reveal_type(user.copy(), expected_text="frozendict[{'name': str, 'age': int}]")

# Methods the builtin doesn't have keep the stub's types.
assert_type(user.set("city", "delhi"), frozendict[str, str | int])
assert_type(user.delete("age"), frozendict[str, str | int])

# Its fromkeys() leaves the value type unsolved: the given value's type is used.
reveal_type(frozendict.fromkeys(["lr", "momentum"], 0.0), expected_text="frozendict[{'lr': float, 'momentum': float}]")
