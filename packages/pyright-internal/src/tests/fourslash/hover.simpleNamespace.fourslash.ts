/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from types import SimpleNamespace
////
//// def f() -> None:
////     cfg = SimpleNamespace(host="h", port=1)
////     cfg.[|/*marker1*/port|]
////     cfg.[|/*marker2*/users|]
////     cfg[[|/*marker3*/"port"|]]

helper.verifyHover('markdown', {
    marker1: '```python\n(variable) port: int\n```',
    marker2: '```python\n(variable) users: Unknown\n```',
    // Not a key: a namespace can't be indexed.
    marker3: null,
});
