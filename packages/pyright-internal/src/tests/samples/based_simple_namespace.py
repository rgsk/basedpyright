# This sample tests the known attributes of a types.SimpleNamespace. Writes the
# checker can follow update them; wherever it can't follow the namespace, it's a
# plain SimpleNamespace whose attributes are Any. Reading an attribute it doesn't
# have is an error.

from types import SimpleNamespace
from types import SimpleNamespace as namespace
from typing import Any, Literal, Protocol, assert_type


def constructor() -> None:
    cfg = SimpleNamespace(host="localhost", port=8080, debug=False)
    reveal_type(cfg, expected_text="SimpleNamespace[{host: str, port: int, debug: bool}]")
    assert_type(cfg.port, int)
    assert_type(cfg.__dict__, dict[str, Any])

    # This should generate an error.
    cfg.prot

    # This should generate an error.
    cfg.port.upper()

    short = namespace(a=1)
    reveal_type(short, expected_text="SimpleNamespace[{a: int}]")

    empty = SimpleNamespace()
    reveal_type(empty, expected_text="SimpleNamespace[{}]")


def from_dicts() -> None:
    row = {"id": 1, "name": "ada"}
    user = SimpleNamespace(row)
    reveal_type(user, expected_text="SimpleNamespace[{id: int, name: str}]")
    user2 = SimpleNamespace(**row, admin=True)
    reveal_type(user2, expected_text="SimpleNamespace[{id: int, name: str, admin: bool}]")
    odd = SimpleNamespace({"a-b": 1})
    reveal_type(odd, expected_text="SimpleNamespace[{'a-b': int}]")


def unknown_keys(d: dict[str, int]) -> None:
    ns = SimpleNamespace(d)
    reveal_type(ns, expected_text="SimpleNamespace")
    assert_type(ns.anything, Any)


def writes(flag: bool) -> None:
    cfg = SimpleNamespace(host="localhost", port=8080, debug=False)
    cfg.timeout = 3.5
    cfg.port += 1
    del cfg.debug
    reveal_type(cfg, expected_text="SimpleNamespace[{host: str, port: int, timeout: float}]")

    # This should generate an error.
    cfg.debug

    cfg.port = "8080"
    assert_type(cfg.port, Literal["8080"])

    ns = SimpleNamespace()
    ns.a = 1
    ns.b = "x"
    reveal_type(ns, expected_text="SimpleNamespace[{a: int, b: str}]")

    if flag:
        ns.c = 1.0
        ns.a = "one"
    reveal_type(ns, expected_text="SimpleNamespace[{a: str | int, b: str}]")


def nested() -> None:
    app = SimpleNamespace(name="shop", db=SimpleNamespace(host="db", port=5432), flags={"beta": True})
    reveal_type(
        app,
        expected_text="SimpleNamespace[{name: str, db: SimpleNamespace[{host: str, port: int}], flags: dict[{'beta': bool}]}]",
    )
    assert_type(app.db.port, int)
    assert_type(app.flags["beta"], bool)

    rows = [SimpleNamespace(id=1), SimpleNamespace(id=2)]
    assert_type(rows[0].id, int)


class HasName(Protocol):
    id: int
    name: str


def greet(u: HasName) -> str:
    return u.name


def protocols() -> None:
    greet(SimpleNamespace(id=1, name="ada"))
    greet(SimpleNamespace(id=1, name="ada", extra=None))

    # This should generate an error.
    greet(SimpleNamespace(id=1))

    # This should generate an error.
    greet(SimpleNamespace(id="1", name="ada"))


def to_dict() -> None:
    user = SimpleNamespace(id=1, name="ada")
    reveal_type(vars(user), expected_text="dict[{'id': int, 'name': str}]")


def passed_on(ns: SimpleNamespace) -> None:
    assert_type(ns.anything, Any)
    ns.added = 1
    assert_type(ns.added, Literal[1])


glob = SimpleNamespace(a=1)


def reads_global() -> None:
    assert_type(glob.a, int)
    glob.b


def adds_extra(ns: SimpleNamespace) -> None:
    ns.extra = 1


def unseen_writes() -> None:
    cfg = SimpleNamespace(a=1)
    # A function that adds attributes isn't followed (like other narrowing).
    adds_extra(cfg)
    reveal_type(cfg, expected_text="SimpleNamespace[{a: int}]")

    setattr(cfg, "other", "x")
    reveal_type(cfg, expected_text="SimpleNamespace[{a: int, other: str}]")
    delattr(cfg, "a")
    reveal_type(cfg, expected_text="SimpleNamespace[{other: str}]")


def setattr_unknown_name(name: str) -> None:
    cfg = SimpleNamespace(a=1)
    setattr(cfg, name, 2)
    reveal_type(cfg, expected_text="SimpleNamespace")
    assert_type(cfg.anything, Any)


class Holder:
    def __init__(self) -> None:
        self.cfg = SimpleNamespace(a=1)
        reveal_type(self.cfg, expected_text="SimpleNamespace[{a: int}]")
        self.d = {"a": 1}

    def method(self) -> None:
        reveal_type(self.cfg, expected_text="SimpleNamespace")
        reveal_type(self.d, expected_text="dict[str, int]")


def containers() -> None:
    # SimpleNamespace's **kwargs are Any; the values keep their own types.
    app = SimpleNamespace(version=(1, 4), tags=["web", "api"], opts={"a": 1})
    reveal_type(app, expected_text="SimpleNamespace[{version: tuple[int, int], tags: list[str], opts: dict[{'a': int}]}]")


nested_glob = SimpleNamespace(db=SimpleNamespace(host="h"))


def reads_nested_global() -> None:
    # Code that ran before the call may have added attributes to the inner namespace too.
    db = nested_glob.db
    assert_type(db.host, str)
    db.users
    nested_glob.db.users


def returns_namespace() -> SimpleNamespace:
    return SimpleNamespace(name="ada", age=3)


def returns_either(flag: bool) -> SimpleNamespace:
    if flag:
        return SimpleNamespace(a=1)
    return SimpleNamespace(b=2)


def return_annotation() -> None:
    # The annotation keeps the shape the body returns, as -> dict does.
    reveal_type(returns_namespace(), expected_text="SimpleNamespace[{name: str, age: int}]")
    reveal_type(returns_either(True), expected_text="SimpleNamespace")
