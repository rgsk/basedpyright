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
//// [|/*marker15*/cfg|] = {"lr": 0.1, "model": {"kind": "last"}}
////
//// user[[|/*marker10*/"name"|]]
//// nested[[|/*marker16*/"inner"|]]
//// headers[[|/*marker11*/"content-type"|]]
//// user[[|/*marker12*/"nme"|]]
//// either[[|/*marker13*/"a"|]]
//// plain[[|/*marker14*/"a"|]]

helper.verifyHover('markdown', {
    marker1: "```python\n(variable) user: frozendict[{\n    'name': str,\n    'age': int,\n}]\n```",
    marker2: "```python\n(variable) headers: frozendict[{\n    'content-type': str,\n    'class': int,\n}]\n```",
    marker3: "```python\n(variable) nested: frozendict[{\n    'inner': frozendict[{\n        'a': int,\n    }],\n}]\n```",
    marker4: "```python\n(variable) either: frozendict[{\n    'a': int,\n}] | frozendict[{\n    'b': str,\n}]\n```",
    marker5: '```python\n(variable) plain: frozendict[str, int]\n```',
    marker6: "```python\n(function) def make() -> tuple[frozendict[{\n    'name': str,\n    'age': int,\n}], Literal[1]]\n```",
    marker7: '```python\n(function) def make_declared() -> frozendict[str, str | int]\n```',
    marker10: '```python\n(key) name: str\n```',
    marker11: '```python\n(key) content-type: str\n```',
    marker12: null,
    marker13: '```python\n(key) a: int\n```',
    marker14: null,
    marker16: "```python\n(key) inner: frozendict[{\n    'a': int,\n}]\n```",
    marker15: "```python\n(variable) cfg: dict[{\n    'lr': float,\n    'model': dict[{\n        'kind': str,\n    }],\n}]\n```",
});
