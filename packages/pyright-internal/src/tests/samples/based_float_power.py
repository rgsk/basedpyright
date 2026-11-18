# float ** float, int ** float and pow() of them are float, not Any (typeshed's Any is for a
# negative base with a fractional exponent, which gives a complex number).
from typing import Any, assert_type


def f(n: int, x: float, d: int, e: float, any_value: Any):
    assert_type(32**0.5, float)
    assert_type(d**-0.5, float)
    assert_type(x**e, float)
    assert_type(n**x, float)
    assert_type(x**n, float)
    assert_type(pow(x, 0.5), float)
    assert_type(pow(d, e), float)

    # Literal numbers that make a complex number give complex.
    assert_type((-8) ** 0.5, complex)
    assert_type(-8.0**0.5, float)  # -(8.0 ** 0.5)
    assert_type((-8.0) ** 0.5, complex)
    assert_type(pow(-8, 0.5), complex)
    assert_type((-8) ** 2.0, float)

    # Unchanged: int ** int depends on the exponent's sign; Any stays Any.
    assert_type(n**d, Any)
    assert_type(x**any_value, Any)

    y = x
    y **= 0.5
    assert_type(y, float)
