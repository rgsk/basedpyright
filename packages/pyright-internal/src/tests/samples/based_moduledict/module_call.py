# Calling an nn.Module goes through its forward: torch declares Module.__call__ as
# Callable[..., Any], which would make every layer(x) Any.
from typing import Any, assert_type

import torch
from torch import nn

x = torch.Tensor()
layer = nn.Linear(3, 4)
assert_type(layer(x), torch.Tensor)
assert_type(nn.Linear(3, 4)(x), torch.Tensor)


class Block(nn.Module):
    def __init__(self) -> None:
        self.proj = nn.Linear(3, 4)

    def forward(self, x: torch.Tensor, scale: float = 1.0) -> tuple[torch.Tensor, float]:
        return self.proj(x), scale


block = Block()
assert_type(block(x), tuple[torch.Tensor, float])
assert_type(block(x, scale=2.0)[0], torch.Tensor)
# This should generate an error.
block(x, scal=2.0)
# This should generate an error.
layer()


# A module without its own forward still calls as torch declares it.
class NoForward(nn.Module): ...


assert_type(NoForward()(x), Any)


# A class that defines its own __call__ keeps it.
class Custom(nn.Module):
    def __call__(self, n: int) -> str: ...

    def forward(self, x: torch.Tensor) -> torch.Tensor: ...


assert_type(Custom()(1), str)


# A Sequential built from modules remembers them, and calling it runs the argument
# through each one (torch's Sequential.forward has no annotations).
mlp = nn.Sequential(nn.Linear(4, 16), nn.ReLU(), nn.Linear(16, 4))
reveal_type(mlp, expected_text="Sequential[Linear, ReLU, Linear]")
assert_type(mlp(x), torch.Tensor)
assert_type(nn.Sequential(mlp, Block())(x), tuple[torch.Tensor, float])
reveal_type(mlp.to(torch.device()), expected_text="Sequential[Linear, ReLU, Linear]")

# A module that can't take what the one before returns leaves the declared type.
reveal_type(nn.Sequential(Block(), nn.Linear(4, 4))(x), expected_text="Unknown")
reveal_type(nn.Sequential()(x), expected_text="Unknown")


# A ModuleList built from modules remembers their type: iterating it or reading an int
# index gives that type rather than Module, so their calls are typed too.
class Model(nn.Module):
    def __init__(self) -> None:
        self.blocks = nn.ModuleList([Block() for _ in range(3)])
        self.mixed = nn.ModuleList([nn.Linear(4, 4), nn.ReLU()])

    def forward(self, x: torch.Tensor) -> None:
        reveal_type(self.blocks, expected_text="ModuleList[Block]")
        for block in self.blocks:
            assert_type(block(x), tuple[torch.Tensor, float])
        assert_type(self.blocks[0], Block)
        assert_type(self.blocks[-1](x)[0], torch.Tensor)
        reveal_type(self.blocks[1:], expected_text="ModuleList[Block]")
        assert_type([m(x) for m in self.mixed], list[torch.Tensor])
        # As an Iterable of that type too: zip, enumerate, list.
        for block, n in zip(self.blocks, range(3)):
            assert_type(block, Block)
        for i, block in enumerate(self.blocks):
            assert_type(block, Block)
        assert_type(list(self.blocks), list[Block])


# From something that isn't a list of known modules, it stays as declared.
def plain(modules: list[nn.Module]):
    reveal_type(nn.ModuleList(modules), expected_text="ModuleList[Module]")
    reveal_type(nn.ModuleList(), expected_text="ModuleList")


# A `-> nn.Sequential` or `-> nn.ModuleList` annotation keeps the modules the body builds,
# as a `-> dict` annotation keeps a dict's keys.
def make_backbone() -> nn.Sequential:
    return nn.Sequential(nn.Linear(3, 8), nn.ReLU(), nn.Linear(8, 4))


reveal_type(make_backbone(), expected_text="Sequential[Linear, ReLU, Linear]")
assert_type(make_backbone().to(torch.device())(x), torch.Tensor)


def make_blocks(n: int) -> nn.ModuleList:
    return nn.ModuleList([Block() for _ in range(n)])


reveal_type(make_blocks(2), expected_text="ModuleList[Block]")


# Bodies that build different ones, or none it can see, keep the declared type.
def either(flag: bool) -> nn.Sequential:
    if flag:
        return nn.Sequential(nn.Linear(3, 8))
    return nn.Sequential(nn.ReLU())


reveal_type(either(True), expected_text="Sequential")


def from_layers(layers: list[nn.Module]) -> nn.Sequential:
    return nn.Sequential(*layers)


reveal_type(from_layers([]), expected_text="Sequential")


# Different modules are different types, so a union keeps both.
def pick(flag: bool):
    return nn.Sequential(nn.Linear(3, 8)) if flag else nn.Sequential(nn.ReLU())


reveal_type(pick(True), expected_text="Sequential[Linear] | Sequential[ReLU]")


# A `-> nn.ModuleDict` annotation keeps the keys the body builds, as `-> dict` does.
def make_heads() -> nn.ModuleDict:
    heads = nn.ModuleDict(dict(tau=nn.Linear(1, 4), act=nn.ReLU()))
    return heads


reveal_type(make_heads(), expected_text="ModuleDict[{'tau': Linear, 'act': ReLU}]")
assert_type(make_heads()["act"], nn.ReLU)
