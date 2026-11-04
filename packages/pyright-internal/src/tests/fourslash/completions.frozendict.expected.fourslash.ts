/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "pythonVersion": "3.15"
//// }

// @filename: test.py
//// type User = frozendict[{"name": str, "age": int}]
////
//// from_display: User = frozendict({[|/*marker1*/|]})
//// rest_of_display: User = frozendict({"name": "rahul", [|/*marker2*/|]})
//// from_kwargs: User = frozendict([|/*marker3*/|])
//// rest_of_kwargs: User = frozendict(name="rahul", [|/*marker4*/|])
//// plain = frozendict([|/*marker5*/|])

{
    helper.openFile(helper.getMarkerByName('marker1').fileName);

    const marker1Range = helper.getPositionRange('marker1');
    const marker2Range = helper.getPositionRange('marker2');

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
                    label: '"age"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'int',
                    textEdit: { range: marker2Range, newText: '"age"' },
                },
            ],
        },
        marker3: {
            completions: [
                { label: 'name=', kind: Consts.CompletionItemKind.Variable },
                { label: 'age=', kind: Consts.CompletionItemKind.Variable },
            ],
        },
        marker4: {
            completions: [{ label: 'age=', kind: Consts.CompletionItemKind.Variable }],
        },
    });

    // Keys already given aren't offered again, and a frozendict without an
    // expected type has no keys to offer.
    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        marker2: { completions: [{ label: '"name"', kind: undefined }] },
        marker4: { completions: [{ label: 'name=', kind: undefined }] },
        marker5: { completions: [{ label: 'name=', kind: undefined }] },
    });
}
