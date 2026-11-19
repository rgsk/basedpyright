from typing import Any, Literal, overload

import numpy as np
from matplotlib.axes import Axes

class FigureBase:
    @overload
    def subplots(self, nrows: Literal[1] = ..., ncols: Literal[1] = ..., *, squeeze: Literal[True] = ...) -> Axes: ...
    @overload
    def subplots(self, nrows: int = ..., ncols: int = ..., *, squeeze: Literal[False]) -> np.ndarray: ...
    @overload
    def subplots(self, nrows: int = ..., ncols: int = ..., *, squeeze: bool = ...) -> Any: ...

class Figure(FigureBase): ...
