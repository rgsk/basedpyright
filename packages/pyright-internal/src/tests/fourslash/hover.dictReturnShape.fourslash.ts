/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "pythonVersion": "3.15"
//// }

// @filename: test.py
//// def [|/*marker1*/train|](lr: float) -> dict:
////     return {"weights": [lr], "log": "done"}
////
//// [|/*marker2*/run|] = train(0.1)
//// run[[|/*marker3*/"log"|]]
//// run[[|/*marker4*/|]]
////
//// def named() -> dict[str, str]:
////     return {"name": "rahul"}
////
//// [|/*marker5*/person|] = named()
//// named()[[|/*marker6*/|]]

helper.verifyHover('markdown', {
    marker1: "```python\n(function) def train(lr: float) -> dict[{\n    'weights': list[float],\n    'log': str,\n}]\n```",
    marker2: "```python\n(variable) run: dict[{\n    'weights': list[float],\n    'log': str,\n}]\n```",
    marker3: '```python\n(key) log: str\n```',
    marker5: "```python\n(variable) person: dict[{\n    'name': str,\n}]\n```",
});

{
    const marker4Range = helper.getPositionRange('marker4');
    const marker6Range = helper.getPositionRange('marker6');

    // The keys of the shape, as for an unannotated function's dict.
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker4: {
            completions: [
                {
                    label: '"weights"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'Index value',
                    textEdit: { range: marker4Range, newText: '"weights"' },
                },
                {
                    label: '"log"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'Index value',
                    textEdit: { range: marker4Range, newText: '"log"' },
                },
            ],
        },
        marker6: {
            completions: [
                {
                    label: '"name"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'Index value',
                    textEdit: { range: marker6Range, newText: '"name"' },
                },
            ],
        },
    });
}
