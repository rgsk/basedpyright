# nn.ModuleDict built from a dict with literal keys remembers each key's module type.
from typing import assert_type

import torch
from torch import nn

D = 8
dev = torch.device()

# Built from dict(k=v, ...) or a dict display.
core = nn.ModuleDict(dict(tau=nn.Linear(1, D), pos=nn.Embedding(3, D), act=nn.ReLU()))
reveal_type(core, expected_text="ModuleDict[{'tau': Linear, 'pos': Embedding, 'act': ReLU}]")
display = nn.ModuleDict({"tau": nn.Linear(1, D), "act": nn.ReLU()})
reveal_type(display, expected_text="ModuleDict[{'tau': Linear, 'act': ReLU}]")

# Reads with a literal key give that key's type.
assert_type(core["tau"], nn.Linear)
assert_type(core["pos"].weight, torch.Tensor)
assert_type(display["act" if len(display) else "tau"], nn.ReLU | nn.Linear)
# This should generate an error.
core["tu"]


# A key that isn't a literal reads as __getitem__ declares.
def read(key: str):
    assert_type(core[key], nn.Module)


# Methods that return self (declared to return Self) keep the shape.
moved = nn.ModuleDict({"body": nn.Linear(1, D)}).to(dev)
reveal_type(moved, expected_text="ModuleDict[{'body': Linear}]")
reveal_type(moved.to(torch.float32), expected_text="ModuleDict[{'body': Linear}]")
reveal_type(moved.to(torch.Tensor()), expected_text="ModuleDict[{'body': Linear}]")
reveal_type(moved.cuda(), expected_text="ModuleDict[{'body': Linear}]")
reveal_type(moved.cpu(), expected_text="ModuleDict[{'body': Linear}]")
reveal_type(moved.train(), expected_text="ModuleDict[{'body': Linear}]")
reveal_type(moved.eval(), expected_text="ModuleDict[{'body': Linear}]")
reveal_type(moved.requires_grad_(False), expected_text="ModuleDict[{'body': Linear}]")
assert_type(moved.cuda().train(False).to(dev)["body"], nn.Linear)
# This should generate an error.
moved.eval()["bdy"]


# Any write or mutation makes it a plain ModuleDict, so reads fall back to Module.
def writes():
    a = nn.ModuleDict({"x": nn.Linear(1, D)})
    a["y"] = nn.ReLU()
    reveal_type(a, expected_text="ModuleDict")
    assert_type(a["x"], nn.Module)

    b = nn.ModuleDict({"x": nn.Linear(1, D)})
    del b["x"]
    reveal_type(b, expected_text="ModuleDict")

    c = nn.ModuleDict({"x": nn.Linear(1, D)})
    c.update({"y": nn.ReLU()})
    reveal_type(c, expected_text="ModuleDict")

    d = nn.ModuleDict({"x": nn.Linear(1, D)})
    d.pop("x")
    reveal_type(d, expected_text="ModuleDict")

    e = nn.ModuleDict({"x": nn.Linear(1, D)})
    e.clear()
    reveal_type(e, expected_text="ModuleDict")

    f = nn.ModuleDict({"x": nn.Linear(1, D)})
    f.add_module("y", nn.ReLU())
    reveal_type(f, expected_text="ModuleDict")

    g = nn.ModuleDict({"x": nn.Linear(1, D)})
    g.register_module("y", nn.ReLU())
    reveal_type(g, expected_text="ModuleDict")


# A key that only one branch may have makes it plain, so it's never a false error.
def branches(flag: bool):
    a = nn.ModuleDict({"x": nn.Linear(1, D)})
    if flag:
        a["head"] = nn.ReLU()
    reveal_type(a, expected_text="ModuleDict")

    b = nn.ModuleDict({"x": nn.Linear(1, D), "y": nn.ReLU()}) if flag else nn.ModuleDict({"x": nn.ReLU()})
    reveal_type(b, expected_text="ModuleDict")

    c = nn.ModuleDict({"x": nn.Linear(1, D)}) if flag else nn.ModuleDict({"x": nn.ReLU()})
    reveal_type(c, expected_text="ModuleDict[{'x': Linear | ReLU}]")


# Where code it can't follow may change it, it's plain, as for a dict: a global read
# in a function, an attribute.
def elsewhere():
    reveal_type(core, expected_text="ModuleDict")


class Net(nn.Module):
    def __init__(self) -> None:
        self.core = nn.ModuleDict({"x": nn.Linear(1, D)})

    def forward(self):
        reveal_type(self.core, expected_text="ModuleDict")


# An inferred return type keeps it.
def make():
    return nn.ModuleDict({"x": nn.Linear(1, D)})


assert_type(make()["x"], nn.Linear)


# Nothing changes for a ModuleDict that isn't built from a dict with literal keys.
def unchanged(mapping: dict[str, nn.Module], name: str):
    reveal_type(nn.ModuleDict(), expected_text="ModuleDict")
    reveal_type(nn.ModuleDict(None), expected_text="ModuleDict")
    reveal_type(nn.ModuleDict({}), expected_text="ModuleDict")
    reveal_type(nn.ModuleDict(mapping), expected_text="ModuleDict")
    reveal_type(nn.ModuleDict({name: nn.ReLU()}), expected_text="ModuleDict")
    reveal_type(nn.ModuleDict({k: nn.ReLU() for k in ["a", "b"]}), expected_text="ModuleDict")
    assert_type(nn.ModuleDict(mapping)["anything"], nn.Module)


class MyDict(nn.ModuleDict): ...


reveal_type(MyDict({"x": nn.Linear(1, D)}), expected_text="MyDict")

# ParameterDict is not handled.
reveal_type(nn.ParameterDict({"w": torch.Tensor()}), expected_text="ParameterDict")
