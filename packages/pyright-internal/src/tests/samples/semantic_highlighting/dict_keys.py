from typing import ReadOnly, TypedDict


class Movie(TypedDict):
    title: str
    year: ReadOnly[int]


def f(key: str, other: dict[str, int], movie: Movie) -> None:
    mixed = {"a": 1, key: 2}
    mixed["a"]
    user = {"name": "rahul"}
    user["name"]
    user["nmae"]
    user["city"] = "delhi"
    user["city"]
    user[key]
    other["anything"]
    movie["title"]
    movie["year"]
    movie["rating"]
    frozen = frozendict(name="rahul")
    frozen["name"]
    user[f"name"]
