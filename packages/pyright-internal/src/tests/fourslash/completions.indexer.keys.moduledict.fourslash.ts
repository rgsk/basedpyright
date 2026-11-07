/// <reference path="typings/fourslash.d.ts" />

// @filename: torch/__init__.pyi
//// class device: ...

// @filename: torch/nn/__init__.pyi
//// from .modules.container import ModuleDict as ModuleDict
//// from .modules.module import Linear as Linear, Module as Module, ReLU as ReLU

// @filename: torch/nn/modules/__init__.pyi
////

// @filename: torch/nn/modules/module.pyi
//// from typing import Self
//// from torch import device
//// class Module:
////     def to(self, device: device | str | None = ...) -> Self: ...
//// class Linear(Module):
////     def __init__(self, in_features: int, out_features: int) -> None: ...
//// class ReLU(Module): ...

// @filename: torch/nn/modules/container.pyi
//// from collections.abc import Mapping
//// from .module import Module
//// class ModuleDict(Module):
////     def __init__(self, modules: Mapping[str, Module] | None = None) -> None: ...
////     def __getitem__(self, key: str) -> Module: ...
////     def __setitem__(self, key: str, module: Module) -> None: ...

// @filename: test.py
//// from torch import nn
//// [|/*marker1*/core|] = nn.ModuleDict(dict(tau=nn.Linear(1, 2), act=nn.ReLU())).to("cpu")
//// core[[|/*marker2*/|]]
//// core[[|/*marker3*/"tau"|]]
//// core[[|/*marker4*/"tu"|]]

{
    const marker2Range = helper.getPositionRange('marker2');

    // A ModuleDict's keys are offered like a dict's.
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker2: {
            completions: [
                {
                    label: '"tau"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'Index value',
                    textEdit: { range: marker2Range, newText: '"tau"' },
                },
                {
                    label: '"act"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: 'Index value',
                    textEdit: { range: marker2Range, newText: '"act"' },
                },
            ],
        },
    });

    helper.verifyHover('markdown', {
        marker1: "```python\n(variable) core: ModuleDict[{\n    'tau': Linear,\n    'act': ReLU,\n}]\n```",
        marker3: '```python\n(key) tau: Linear\n```',
        marker4: null,
    });
}
