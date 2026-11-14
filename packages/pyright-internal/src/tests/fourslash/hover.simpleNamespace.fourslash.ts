/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from types import SimpleNamespace
////
//// def f() -> None:
////     cfg = SimpleNamespace(host="h", port=1)
////     cfg.[|/*marker1*/port|]
////     cfg.[|/*marker2*/users|]

helper.verifyHover('markdown', {
    marker1: '```python\n(variable) port: int\n```',
    marker2: '```python\n(variable) users: Unknown\n```',
});
