/// <reference path="typings/fourslash.d.ts" />

// @filename: torch/__init__.pyi
//// class Tensor: ...

// @filename: torch/nn/__init__.pyi
//// from .modules.container import Sequential as Sequential
//// from .modules.module import Linear as Linear, Module as Module, ReLU as ReLU

// @filename: torch/nn/modules/__init__.pyi
////

// @filename: torch/nn/modules/module.pyi
//// from collections.abc import Callable
//// from typing import Any
//// from torch import Tensor
//// class Module:
////     forward: Callable[..., Any]
////     __call__: Callable[..., Any]
//// class Linear(Module):
////     def __init__(self, in_features: int, out_features: int) -> None: ...
////     def forward(self, input: Tensor) -> Tensor: ...
//// class ReLU(Module):
////     def forward(self, input: Tensor) -> Tensor: ...

// @filename: torch/nn/modules/container.pyi
//// from .module import Module
//// class Sequential(Module):
////     def __init__(self, *args: Module) -> None: ...
////     def forward(self, input): ...

// @filename: test.py
//// import torch
//// from torch import nn
//// layer = nn.Linear(3, 4)
//// mlp = nn.Sequential(nn.Linear(4, 16), nn.ReLU())
//// [|/*marker1*/layer|](torch.Tensor())
//// [|/*marker2*/mlp|](torch.Tensor())

// Calling a module shows its forward, not torch's Module.__call__ (Callable[..., Any]).
// A Sequential takes what its first module takes and returns what its modules give.
helper.verifyHover('markdown', {
    marker1: '```python\n(variable) def layer(input: Tensor) -> Tensor\n```',
    marker2: '```python\n(variable) def mlp(input: Tensor) -> Tensor\n```',
});
