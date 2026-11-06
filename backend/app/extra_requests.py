"""Deterministic quantities for the two optional menu categories."""
import re

LABELS = {'dessert': r'甜点|甜品', 'fruit': r'水果|果盘'}
NUMBERS = {'一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}


def mentions_extra(category, text):
    return bool(re.search(LABELS[category], text))


def extra_additions(messages):
    result, cancelled = {}, set()
    for message in messages:
        for category, labels in LABELS.items():
            for clause in re.split(r'[，,。；;！!\n]', message):
                if not mentions_extra(category, clause):
                    continue
                if re.search(r'(?:不要|不加|不用|别加|不需要|不想吃|不想要|不吃).{0,6}(?:' + labels + ')', clause):
                    result.pop(category, None)
                    cancelled.add(category)
                    continue
                if re.search(r'(?:换成|换为|替换成|换作).{0,6}(?:' + labels + ')', clause):
                    continue
                match = re.search(r'(?:添加|增加|加|来|推荐|想吃|想要|要|和|再)(?:上|点|一些)?\s*(?P<number>\d+|[一二两三四五六七八九十])?\s*(?:个|份|道|盘|碗|款)?\s*(?:' + labels + ')', clause)
                if match:
                    number = match.group('number')
                    result[category] = int(number) if number and number.isdigit() else NUMBERS.get(number, 1)
                    cancelled.discard(category)
    return result, cancelled
