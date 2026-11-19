# plt.subplots(n, m) returns a numpy array of Axes; when the call says its shape, the fork
# gives that array the Axes type (see matplotlibAxes.ts).
from typing import Any, assert_type

import matplotlib.pyplot as plt
from matplotlib.axes import Axes
from matplotlib.figure import Figure


def sizes(n: int, flag: bool, pics: list[str]) -> None:
    fig, axes = plt.subplots(3, 1, figsize=(6, 8))
    reveal_type(axes, expected_text="ndarray[Axes, ndim=1]")
    assert_type(axes[0], Axes)
    assert_type(axes[-1], Axes)
    reveal_type(axes[1:], expected_text="ndarray[Axes, ndim=1]")
    for ax in axes:
        assert_type(ax, Axes)
    for ax, pic in zip(axes, pics):
        assert_type(ax, Axes)
    for i, ax in enumerate(axes):
        assert_type(ax, Axes)
    first, second, third = axes
    assert_type(first, Axes)
    fig, (a, b, c) = plt.subplots(3, 1)
    assert_type(a, Axes)

    _, grid = plt.subplots(2, 3)
    reveal_type(grid, expected_text="ndarray[Axes, ndim=2]")
    assert_type(grid[0, 1], Axes)
    reveal_type(grid[0], expected_text="ndarray[Axes, ndim=1]")
    reveal_type(grid[:, 0], expected_text="ndarray[Axes, ndim=1]")
    assert_type(grid[0][1], Axes)
    for row in grid:
        reveal_type(row, expected_text="ndarray[Axes, ndim=1]")
    for ax in grid.flat:
        assert_type(ax, Axes)
    reveal_type(grid.flat, expected_text="flatiter[Axes]")
    assert_type(grid.flat[0], Axes)
    reveal_type(grid.ravel(), expected_text="ndarray[Axes, ndim=1]")
    reveal_type(grid.flatten(), expected_text="ndarray[Axes, ndim=1]")
    assert_type(grid.tolist(), list[list[Axes]])
    assert_type(axes.tolist(), list[Axes])
    assert_type(plt.subplots(nrows=1, ncols=4)[1][0], Axes)
    assert_type(plt.subplots(ncols=2)[1][0], Axes)

    # squeeze=False is always 2-D, whatever the sizes.
    _, grid2 = plt.subplots(1, n, squeeze=False)
    reveal_type(grid2, expected_text="ndarray[Axes, ndim=2]")

    # fig.subplots too.
    fig = Figure()
    reveal_type(fig.subplots(2, 2), expected_text="ndarray[Axes, ndim=2]")

    # Unchanged: a 1 x 1 grid is already Axes; sizes that aren't literal numbers (1-D or 2-D
    # depends on the value) and a squeeze that isn't a literal stay Any.
    assert_type(plt.subplots()[1], Axes)
    assert_type(plt.subplots(3, n)[1], Any)
    assert_type(plt.subplots(n, 1)[1], Any)
    assert_type(plt.subplots(2, 2, squeeze=flag)[1], Any)
    reveal_type(grid.shape, expected_text="tuple[int, ...]")
    reveal_type(grid[0, 1, 2], expected_text="Any")

    axes[0].set_title(1)  # error: an int isn't a str
