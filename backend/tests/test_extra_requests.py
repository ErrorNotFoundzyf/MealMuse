import pytest
from app.extra_requests import extra_additions


@pytest.mark.parametrize(('messages', 'expected'), [
    (['加一份甜品和两份水果'], {'dessert': 1, 'fruit': 2}),
    (['加一个甜点', '加一份甜品'], {'dessert': 1}),
    (['加一份甜品', '不加甜品'], {}),
    (['不要水果，再加一份甜品'], {'dessert': 1}),
    (['把素菜换成甜品'], {}),
    (['把甜点换成水果'], {}),
    (['我不想吃甜品'], {}),
    (['不需要加一份水果'], {}),
    (['想吃两份甜点'], {'dessert': 2}),
    (['再来一些水果'], {'fruit': 1}),
])
def test_unambiguous_extra_requests(messages, expected):
    assert extra_additions(messages)[0] == expected
