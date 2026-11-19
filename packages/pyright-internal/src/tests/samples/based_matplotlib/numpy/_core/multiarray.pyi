from typing import Any, Generic, Iterator, TypeVar

_ArrayT_co = TypeVar("_ArrayT_co", covariant=True)

class flatiter(Generic[_ArrayT_co]):
    def __iter__(self) -> Iterator[Any]: ...
    def __getitem__(self, key: Any) -> Any: ...
