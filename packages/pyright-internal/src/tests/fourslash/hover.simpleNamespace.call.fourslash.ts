/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// import types
//// from types import SimpleNamespace as namespace
////
//// u = [|/*callee*/namespace|](
////     name='rahul',
////     [|/*wife*/wife|]=namespace(name='x', [|/*company*/company|]=namespace(name='matx')),
//// )
////
//// def fn():
////     return types.[|/*member*/SimpleNamespace|](w=1)
////
//// [|/*empty*/namespace|]()
//// alias = [|/*uncalled*/namespace|]
//// def g(**kwargs: object) -> None: ...
//// g([|/*other*/wife|]=1)

helper.verifyHover('markdown', {
    callee: '```python\n(class) namespace(...) -> SimpleNamespace[{\n    name: str\n    wife: SimpleNamespace[{\n        name: str\n        company: SimpleNamespace[{\n            name: str\n        }]\n    }]\n}]\n```',
    wife: '```python\n(variable) wife: SimpleNamespace[{\n    name: str\n    company: SimpleNamespace[{\n        name: str\n    }]\n}]\n```',
    company: '```python\n(variable) company: SimpleNamespace[{\n    name: str\n}]\n```',
    member: '```python\n(class) SimpleNamespace(...) -> SimpleNamespace[{\n    w: int\n}]\n```',
    // No attributes yet: still what the call builds.
    empty: '```python\n(class) namespace(...) -> SimpleNamespace[{}]\n```',
    // Not called: the constructor's signature, as before.
    uncalled:
        '```python\nclass namespace(mapping_or_iterable: Mapping[str, object] | Iterable[tuple[str, object]] = (), /, **kwargs: object)\n```',
    // A keyword of a call that doesn't build a SimpleNamespace: unchanged.
    other: '```python\n(function) wife: object\n```',
});
