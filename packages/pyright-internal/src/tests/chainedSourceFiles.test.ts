/*
 * chainedSourceFiles.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for tokenizer ipython mode
 */

import assert from 'assert';
import * as nodeFs from 'fs';
import * as path from 'path';
import { CancellationToken } from 'vscode-jsonrpc';
import { MarkupKind } from 'vscode-languageserver-types';

import { Program } from '../analyzer/program';
import { AnalyzerService } from '../analyzer/service';
import { IPythonMode } from '../analyzer/sourceFile';
import { ConfigOptions } from '../common/configOptions';
import { DiagnosticCategory } from '../common/diagnostic';
import { NullConsole } from '../common/console';
import { normalizeSlashes } from '../common/pathUtils';
import { convertOffsetsToRange, convertOffsetToPosition } from '../common/positionUtils';
import { ServiceProvider } from '../common/serviceProvider';
import { Uri } from '../common/uri/uri';
import { UriEx } from '../common/uri/uriUtils';
import { CompletionProvider } from '../languageService/completionProvider';
import { DefinitionFilter, DefinitionProvider } from '../languageService/definitionProvider';
import { parseTestData } from './harness/fourslash/fourSlashParser';
import { TestAccessHost } from './harness/testAccessHost';
import * as host from './harness/testHost';
import { resolveSampleFilePath } from './testUtils';
import { createFromFileSystem, distlibFolder, libFolder } from './harness/vfs/factory';
import * as vfs from './harness/vfs/filesystem';

test('check chained files', () => {
    const code = `
// @filename: test1.py
//// def foo1(): pass

// @filename: test2.py
//// def foo2(): pass

// @filename: test3.py
//// def foo3(): pass

// @filename: test4.py
//// [|foo/*marker*/|]
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;

    const parseResult = service.getParseResults(markerUri)!;
    const result = new CompletionProvider(
        service.test_program,
        markerUri,
        convertOffsetToPosition(marker.position, parseResult.tokenizerOutput.lines),
        {
            format: MarkupKind.Markdown,
            lazyEdit: false,
            snippet: false,
            checkDeprecatedWhenResolving: false,
            useTypingExtensions: true,
        },
        CancellationToken.None,
        false
    ).getCompletions();

    assert(result?.items.some((i) => i.label === 'foo1'));
    assert(result?.items.some((i) => i.label === 'foo2'));
    assert(result?.items.some((i) => i.label === 'foo3'));
});

test('modify chained files', () => {
    const code = `
// @filename: test1.py
//// def foo1(): pass

// @filename: test2.py
//// [|/*delete*/|]
//// def foo2(): pass

// @filename: test3.py
//// def foo3(): pass

// @filename: test4.py
//// [|foo/*marker*/|]
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);

    // Make sure files are all realized.
    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const parseResult = service.getParseResults(markerUri)!;

    // Close file in the middle of the chain
    service.setFileClosed(data.markerPositions.get('delete')!.fileUri);

    // Make sure we don't get suggestion from auto import but from chained files.
    service.test_program.configOptions.autoImportCompletions = false;

    const result = new CompletionProvider(
        service.test_program,
        markerUri,
        convertOffsetToPosition(marker.position, parseResult.tokenizerOutput.lines),
        {
            format: MarkupKind.Markdown,
            lazyEdit: false,
            snippet: false,
            checkDeprecatedWhenResolving: false,
            useTypingExtensions: true,
        },
        CancellationToken.None,
        false
    ).getCompletions();

    assert(result);

    assert(!result.items.some((i) => i.label === 'foo1'));
    assert(!result.items.some((i) => i.label === 'foo2'));
    assert(result.items.some((i) => i.label === 'foo3'));
});

test('modify chained files', async () => {
    const code = `
// @filename: test1.py
//// [|/*changed*/|]
//// def foo1(): pass

// @filename: test2.py
//// def foo2(): pass

// @filename: test3.py
//// def foo3(): pass

// @filename: test4.py
//// [|/*marker*/foo1()|]
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    analyze(service.test_program);

    // Initially, there should be no error.
    const initialDiags = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(initialDiags.length, 0);

    // Change test1 content
    service.updateOpenFileContents(data.markerPositions.get('changed')!.fileUri, 2, 'def foo5(): pass');
    analyze(service.test_program);

    const finalDiags = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(finalDiags.length, 1);
});

function generateChainedFiles(count: number, lastFile: string) {
    let code = '';
    for (let i = 0; i < count; i++) {
        code += `
// @filename: test${i + 1}.py
//// def foo${i + 1}(): pass
`;
    }
    code += lastFile;
    return code;
}

test('chained files with 1000s of files', async () => {
    const lastFile = `
// @filename: testFinal.py
//// [|/*marker*/foo1()|]
    `;
    const code = generateChainedFiles(1000, lastFile);
    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    analyze(service.test_program);

    // There should be no error as it should find the foo1 in the first chained file.
    const initialDiags = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(initialDiags.length, 0);
});

test('imported by files', async () => {
    const code = `
// @filename: test1.py
//// import [|/*marker*/os|]

// @filename: test2.py
//// os.path.join()
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(diagnostics.length, 0);
});

test('re ordering cells', async () => {
    const code = `
// @filename: test1.py
//// import [|/*marker*/os|]

// @filename: test2.py
//// /*bottom*/os.path.join()
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const bottom = data.markerPositions.get('bottom')!;
    const bottomUri = bottom.fileUri;

    service.updateChainedUri(bottomUri, undefined);
    service.updateChainedUri(markerUri, bottomUri);
    analyze(service.test_program);

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(diagnostics.length, 1);
});

test('later chained-file globals resolved in function body', async () => {
    const code = `
// @filename: test1.py
//// def use_x():
////     [|/*marker*/return x + 1|]

// @filename: test2.py
//// x = 42
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(diagnostics.length, 0);
});

test('later chained-file globals resolved in lambda body', async () => {
    const code = `
// @filename: test1.py
//// [|/*marker*/f = lambda: x * 2|]

// @filename: test2.py
//// x = 10
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(diagnostics.length, 0);
});

test('later chained-file globals resolved in class header', async () => {
    const code = `
// @filename: test1.py
//// [|/*marker*/class MyClass(Base):|]
////     pass

// @filename: test2.py
//// class Base:
////     pass
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(diagnostics.length, 0);
});

test('later chained-file globals resolved in comprehension inside function', async () => {
    const code = `
// @filename: test1.py
//// def build_list():
////     [|/*marker*/return [i * x for i in [1, 2, 3]]|]

// @filename: test2.py
//// x = 5
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(diagnostics.length, 0);
});

test('later chained-file globals resolved in nested function', async () => {
    const code = `
// @filename: test1.py
//// def outer():
////     def inner():
////         [|/*marker*/return x|]
////     return inner

// @filename: test2.py
//// x = 99
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(diagnostics.length, 0);
});

test('later chained-file globals not visible without chaining', async () => {
    // Verify that the same code produces errors without chained files
    // (i.e. our test scenarios actually catch a real bug).
    const code = `
// @filename: test1.py
//// def use_x():
////     [|/*marker*/return x + 1|]
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    // Should have an error because x is not defined anywhere
    assert(diagnostics.length > 0);
});

test('later chained-file globals with multiple files and mixed scopes', async () => {
    const code = `
// @filename: test1.py
//// def use_both():
////     [|/*marker*/return x + y|]

// @filename: test2.py
//// x = 42

// @filename: test3.py
//// y = 100
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(diagnostics.length, 0);
});

test('dict known entries carry over to later cells', async () => {
    const code = `
// @filename: test1.py
//// user = {"name": "rahul", "age": 27}
//// user["joker"] = 1
//// x = 1

// @filename: test2.py
//// user["age"] = "unknown"
//// user.update(city="delhi")

// @filename: test3.py
//// reveal_type(user, expected_text="dict[{'name': str, 'age': str, 'joker': int, 'city': str}]")
//// reveal_type(user["age"], expected_text="str")
//// del user["joker"]
//// reveal_type(user, expected_text="dict[{'name': str, 'age': str, 'city': str}]")

// @filename: test4.py
//// reveal_type(user, expected_text="dict[{'name': str, 'age': str, 'city': str}]")
//// # Other narrowing isn't carried over, as in stock pyright.
//// reveal_type(x, expected_text="int")
//// # Inside a function, it's a global read: a plain dict.
//// def f():
////     reveal_type(user, expected_text="dict[str, str | int]")
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    service.test_program.configOptions.diagnosticRuleSet.strictDictionaryInference = true;
    analyze(service.test_program);

    for (const file of data.files) {
        const parseResults = service.getParseResults(file.fileUri)!;
        const diagnostics = await service.getDiagnosticsForRange(
            file.fileUri,
            convertOffsetsToRange(0, file.content.length, parseResults.tokenizerOutput.lines),
            CancellationToken.None
        );
        assert.deepStrictEqual(
            diagnostics.filter((d) => d.category === DiagnosticCategory.Error).map((d) => d.message),
            [],
            file.fileName
        );
    }
});

test('dict known entries complete in later cells', () => {
    const code = `
// @filename: test1.py
//// user = dict(name="rahul", age=27)
//// user["city"] = "delhi"

// @filename: test2.py
//// user[[|/*marker*/|]]
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    service.test_program.configOptions.autoImportCompletions = false;

    const marker = data.markerPositions.get('marker')!;
    const parseResult = service.getParseResults(marker.fileUri)!;
    const result = new CompletionProvider(
        service.test_program,
        marker.fileUri,
        convertOffsetToPosition(marker.position, parseResult.tokenizerOutput.lines),
        {
            format: MarkupKind.Markdown,
            lazyEdit: false,
            snippet: false,
            checkDeprecatedWhenResolving: false,
            useTypingExtensions: true,
        },
        CancellationToken.None,
        false
    ).getCompletions();

    const labels = result?.items.map((i) => i.label) ?? [];
    for (const key of ['name', 'age', 'city']) {
        assert(
            labels.includes(`'${key}'`) || labels.includes(`"${key}"`),
            `${key} in ${JSON.stringify(labels.slice(0, 20))}`
        );
    }
});

test('dict key go-to-definition jumps to an earlier cell', () => {
    const code = `
// @filename: test1.py
//// user = {[|'name'|]: "rahul"}

// @filename: test2.py
//// user[[|'city'|]] = "delhi"

// @filename: test3.py
//// user[/*name*/'name']
//// user[/*city*/'city']
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    for (const [markerName, rangeIndex] of [
        ['name', 0],
        ['city', 1],
    ] as const) {
        const marker = data.markerPositions.get(markerName)!;
        const parseResult = service.getParseResults(marker.fileUri)!;
        const definitions = new DefinitionProvider(
            service.test_program,
            marker.fileUri,
            convertOffsetToPosition(marker.position + 1, parseResult.tokenizerOutput.lines),
            DefinitionFilter.PreferSource,
            CancellationToken.None
        ).getDefinitions();

        const expected = data.ranges[rangeIndex];
        const expectedLines = service.getParseResults(expected.fileUri)!.tokenizerOutput.lines;
        assert.deepStrictEqual(
            definitions?.map((d) => ({ uri: d.uri.key, range: d.range })),
            [
                {
                    uri: expected.fileUri.key,
                    range: convertOffsetsToRange(expected.pos, expected.end, expectedLines),
                },
            ],
            markerName
        );
    }
});

test('ModuleDict known entries carry over to later cells', async () => {
    const code = `
// @filename: test1.py
//// from torch import nn
//// core = nn.ModuleDict(dict(tau=nn.Linear(1, 2), act=nn.ReLU())).to("cpu")

// @filename: test2.py
//// reveal_type(core, expected_text="ModuleDict[{'tau': Linear, 'act': ReLU}]")
//// reveal_type(core["act"], expected_text="ReLU")
//// later = nn.ModuleDict({"x": nn.ReLU()})
//// later["y"] = nn.ReLU()

// @filename: test3.py
//// reveal_type(core.eval()["tau"], expected_text="Linear")
//// # A write in an earlier cell made it plain.
//// reveal_type(later, expected_text="ModuleDict")
//// core["tu"]
    `;

    // The torch stub of the based_moduledict sample.
    const stubRoot = resolveSampleFilePath('based_moduledict');
    const libFiles = new Map<string, string>();
    for (const relativePath of [
        'torch/__init__.pyi',
        'torch/nn/__init__.pyi',
        'torch/nn/modules/__init__.pyi',
        'torch/nn/modules/module.pyi',
        'torch/nn/modules/container.pyi',
    ]) {
        libFiles.set(relativePath, nodeFs.readFileSync(path.join(stubRoot, relativePath), 'utf8'));
    }

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code, libFiles);
    analyze(service.test_program);

    const errors: string[] = [];
    for (const file of data.files) {
        const parseResults = service.getParseResults(file.fileUri)!;
        const diagnostics = await service.getDiagnosticsForRange(
            file.fileUri,
            convertOffsetsToRange(0, file.content.length, parseResults.tokenizerOutput.lines),
            CancellationToken.None
        );
        diagnostics
            .filter((d) => d.category === DiagnosticCategory.Error)
            .forEach((d) => errors.push(`${file.fileName}: ${d.message}`));
    }

    // Only the missing key of the last cell.
    assert.strictEqual(errors.length, 1, errors.join('\n'));
    assert.match(errors[0], /test3\.py: Could not access item in ModuleDict/);
});

// libFiles: files to add to the file system (not opened as cells), keyed by their path
// relative to basePath.
function createServiceWithChainedSourceFiles(basePath: Uri, code: string, libFiles?: Map<string, string>) {
    const fs = createFromFileSystem(host.HOST, /*ignoreCase*/ false, { cwd: basePath.getFilePath() });
    libFiles?.forEach((content, relativePath) => {
        const fileUri = basePath.combinePaths(relativePath);
        fs.mkdirpSync(fileUri.getDirectory().getFilePath());
        fs.writeFileSync(fileUri, content);
    });
    const service = new AnalyzerService('test service', new ServiceProvider(), {
        console: new NullConsole(),
        hostFactory: () => new TestAccessHost(UriEx.file(vfs.MODULE_PATH), [libFolder, distlibFolder]),
        importResolverFactory: AnalyzerService.createImportResolver,
        configOptions: new ConfigOptions(basePath),
        fileSystem: fs,
        shouldRunAnalysis: () => true,
    });

    const data = parseTestData(basePath.getFilePath(), code, '');

    let chainedFilePath: Uri | undefined;
    for (const file of data.files) {
        const uri = file.fileUri;
        service.setFileOpened(uri, 1, file.content, IPythonMode.CellDocs, chainedFilePath);
        chainedFilePath = uri;
    }
    return { data, service };
}

function analyze(program: Program) {
    while (program.analyze()) {
        // Process all queued items
    }
}
