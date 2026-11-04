/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "pythonVersion": "3.15"
//// }

// @filename: test.py
//// user = frozendict(name="rahul", age=27)
//// user[[|/*marker1*/|]]
//// user[[|"/*marker2*/"|]]
////
//// merged = frozendict({"id": 1}, active=True)
//// merged[[|/*marker3*/|]]

{
    const marker1Range = helper.getPositionRange('marker1');
    const marker2Range = helper.getPositionRange('marker2');
    const marker3Range = helper.getPositionRange('marker3');

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: '"name"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'str',
                    textEdit: { range: marker1Range, newText: '"name"' },
                },
                {
                    label: '"age"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'int',
                    textEdit: { range: marker1Range, newText: '"age"' },
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: '"name"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'str',
                    textEdit: { range: marker2Range, newText: '"name"' },
                },
                {
                    label: '"age"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'int',
                    textEdit: { range: marker2Range, newText: '"age"' },
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: '"id"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'int',
                    textEdit: { range: marker3Range, newText: '"id"' },
                },
                {
                    label: '"active"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'bool',
                    textEdit: { range: marker3Range, newText: '"active"' },
                },
            ],
        },
    });
}
