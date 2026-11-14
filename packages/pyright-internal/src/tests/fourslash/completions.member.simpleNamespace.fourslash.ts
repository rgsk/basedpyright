/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from types import SimpleNamespace
////
//// cfg = SimpleNamespace(host="localhost", port=8080)
//// cfg.timeout = 3.5
//// cfg.[|/*marker1*/|]

{
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                { label: 'host', kind: Consts.CompletionItemKind.Field, detail: 'str' },
                { label: 'port', kind: Consts.CompletionItemKind.Field, detail: 'int' },
                { label: 'timeout', kind: Consts.CompletionItemKind.Field, detail: 'float' },
            ],
        },
    });
}
