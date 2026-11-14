/// <reference path="typings/fourslash.d.ts" />

// `del x.` keeps its incomplete target in the parse tree, so member completion works there.

// @filename: test.py
//// class C:
////     def __init__(self) -> None:
////         self.attr = 1
////
//// c = C()
//// del c.[|/*marker1*/|]
////
//// from types import SimpleNamespace
//// user = SimpleNamespace(name='rahul', age=26)
//// del user.[|/*marker2*/|]

{
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [{ label: 'attr', kind: Consts.CompletionItemKind.Variable }],
        },
        marker2: {
            completions: [
                { label: 'name', kind: Consts.CompletionItemKind.Field, detail: 'str' },
                { label: 'age', kind: Consts.CompletionItemKind.Field, detail: 'int' },
            ],
        },
    });
}
