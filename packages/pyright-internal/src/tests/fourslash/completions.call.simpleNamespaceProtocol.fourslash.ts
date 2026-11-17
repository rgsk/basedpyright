/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from types import SimpleNamespace
//// from typing import Protocol
////
//// class Base(Protocol):
////     vocab_size: int
////
//// class Config(Base, Protocol):
////     block_size: int
////     n_layer: int
////     lr: float
////     def describe(self) -> str: ...
////
//// defaults = SimpleNamespace(vocab_size=65)
//// cfg: Config = SimpleNamespace(
////     **vars(defaults),
////     block_size=8,
////     [|/*marker1*/|]
//// )
//// other = SimpleNamespace([|/*marker2*/|])
//// same_line: Config = SimpleNamespace(vocab_size=65, block_size=8, [|/*marker3*/|])
//// after_dot: Config = SimpleNamespace(lr=1.[|/*marker4*/|])

{
    // The Protocol's attributes not given yet, with their types.
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                { label: 'n_layer=', kind: Consts.CompletionItemKind.Variable, detail: 'int' },
                { label: 'lr=', kind: Consts.CompletionItemKind.Variable, detail: 'float' },
            ],
        },
    });
}

{
    // Already given (by keyword or by **vars(defaults)), and methods, aren't offered.
    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        marker1: {
            completions: [
                { label: 'block_size=', kind: Consts.CompletionItemKind.Variable },
                { label: 'vocab_size=', kind: Consts.CompletionItemKind.Variable },
                { label: 'describe=', kind: Consts.CompletionItemKind.Variable },
            ],
        },
    });
}

{
    // No expected type: nothing to offer.
    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        marker2: {
            completions: [{ label: 'n_layer=', kind: Consts.CompletionItemKind.Variable }],
        },
    });
}

{
    // **kwargs in the signature isn't offered as "kwargs=".
    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        marker1: {
            completions: [{ label: 'kwargs=', kind: Consts.CompletionItemKind.Variable }],
        },
    });
}

{
    // On the same line, right after a number argument: still offered.
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker3: {
            completions: [
                { label: 'n_layer=', kind: Consts.CompletionItemKind.Variable, detail: 'int' },
                { label: 'lr=', kind: Consts.CompletionItemKind.Variable, detail: 'float' },
            ],
        },
    });
}

{
    // Typing a number's "." still offers nothing.
    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker4: { completions: [] },
    });
}
