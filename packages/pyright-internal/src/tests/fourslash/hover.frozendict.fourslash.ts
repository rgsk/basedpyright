/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "pythonVersion": "3.15"
//// }

// @filename: test.py
//// def cond() -> bool: ...
////
//// [|/*marker1*/user|] = frozendict(name="rahul", age=27)
//// [|/*marker2*/headers|] = frozendict({"content-type": "json", "class": 1})
//// [|/*marker3*/nested|] = frozendict(inner=frozendict(a=1))
//// [|/*marker4*/either|] = frozendict(a=1) if cond() else frozendict(b="x")
//// d: dict[str, int] = {"a": 1}
//// [|/*marker5*/plain|] = frozendict(d)
////
//// def [|/*marker6*/make|]():
////     return (frozendict(name="a", age=1), 1)
////
//// def [|/*marker7*/make_declared|]() -> frozendict[str, str | int]:
////     return frozendict(name="a", age=1)
////
//// type User = frozendict[{"name": str, "age": int}]
////
//// def [|/*marker8*/load|]() -> User:
////     return frozendict(name="a", age=1)
////
//// [|/*marker9*/loaded|] = load()

helper.verifyHover('markdown', {
    marker1: "```python\n(variable) user: frozendict[{'name': str, 'age': int}]\n```",
    marker2: "```python\n(variable) headers: frozendict[{'content-type': str, 'class': int}]\n```",
    marker3: "```python\n(variable) nested: frozendict[{'inner': frozendict[{'a': int}]}]\n```",
    marker4: "```python\n(variable) either: frozendict[{'a': int}] | frozendict[{'b': str}]\n```",
    marker5: '```python\n(variable) plain: frozendict[str, int]\n```',
    marker6: "```python\n(function) def make() -> tuple[frozendict[{'name': str, 'age': int}], Literal[1]]\n```",
    marker7: '```python\n(function) def make_declared() -> frozendict[str, str | int]\n```',
    marker8: '```python\n(function) def load() -> User\n```',
    marker9: '```python\n(variable) loaded: User\n```',
});
