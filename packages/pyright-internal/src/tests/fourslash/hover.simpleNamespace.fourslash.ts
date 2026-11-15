/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from types import SimpleNamespace
////
//// def f() -> None:
////     cfg = SimpleNamespace(host="h", port=1)
////     cfg.[|/*marker1*/port|]
////     cfg.[|/*marker2*/users|]
////     cfg[[|/*marker3*/"port"|]]
////     [|/*marker4*/cfg|]

helper.verifyHover('markdown', {
    marker1: '```python\n(variable) port: int\n```',
    marker2: '```python\n(variable) users: Unknown\n```',
    // Not a key: a namespace can't be indexed.
    marker3: null,
    // One attribute per line with no comma, so the lines paste as a class body.
    marker4: '```python\n(variable) cfg: SimpleNamespace[{\n    host: str\n    port: int\n}]\n```',
});
