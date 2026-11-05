"""Conservative offline dialogue: only handle requests whose meaning is explicit."""
import re
from collections import Counter
from .errors import DomainError
from .recommendations import select_menu


class RuleFallback:
    def __init__(self, memory, settings_change=False):
        self.memory = memory
        self.settings_change = settings_change
        self.usage = {}

    def ask(self, schema, instruction, context, max_tokens=3000):
        from .ai_planning import Intent, Selection, model_dish
        if schema is Intent:
            pending = context['pending_user_messages']
            message = pending[0].strip() if len(pending) == 1 else ''
            if self.settings_change and len(pending) == 1:
                return Intent(action='generate', reply='模型暂不可用，正在按规则重新搭配')
            if re.fullmatch(r'(帮我|请|重新|再)?(搭配|推荐|生成)(一餐|一桌|菜单|菜)?[。！! ]*', message):
                return Intent(action='generate', reply='模型暂不可用，正在按规则搭配')
            if re.fullmatch(r'(?:今天|我|想|要|吃|来|请|帮我|推荐|搭配|一道|一份|一个|\s)+硬菜[。！! ]*', message):
                return Intent(action='generate', reply='模型暂不可用，正在按硬菜标签搭配')
            extra = re.fullmatch(r'(?:今天|我|想|要|请|帮我|再|也|\s)*(?:加|来|推荐)(?:上|个|一份|一个|一道|一些|点|一盘|一碗|一款|一)?(?:个|份|道|盘|碗|款)?\s*(甜点|水果)[。！! ]*', message)
            if extra:
                return Intent(action='add', extra_add={('dessert' if extra.group(1) == '甜点' else 'fruit'): 1}, reply='正在按规则添加')
            for ingredient in context['ingredients']:
                for name in [ingredient['name'], *ingredient.get('aliases', [])]:
                    if re.fullmatch(r'(我|家里人)?(不吃|不要|不能吃|忌口)\s*' + re.escape(name) + r'[。！! ]*', message) or re.fullmatch(re.escape(name) + r'过敏[。！! ]*', message):
                        return Intent(action='generate', reply='模型暂不可用，将按已识别的食材限制搭配')
            ordinal = re.fullmatch(r'(请|帮我)?换(掉)?第([1-9一二三四五六七八九十])道[。！! ]*', message)
            if ordinal:
                token=ordinal.group(3)
                index=int(token) if token.isdigit() else '一二三四五六七八九十'.index(token)+1
                if index <= len(context['current_dishes']):
                    return Intent(action='replace', target_recipe_ids=[context['current_dishes'][index-1]['recipe_id']], reply='模型暂不可用，正在按规则换菜')
            for dish in context['current_dishes']:
                if re.fullmatch(r'(请|帮我)?(把|将)?[【\[]?' + re.escape(dish['name']) + r'[】\]]?(换掉|换一个|换一道)[。！! ]*', message) or re.fullmatch(r'(请|帮我)?换掉[【\[]?' + re.escape(dish['name']) + r'[】\]]?[。！! ]*', message):
                    return Intent(action='replace', target_recipe_ids=[dish['recipe_id']], reply='模型暂不可用，正在按规则换菜')
            return Intent(action='clarify', reply='网络暂不可用。现在可以说“帮我搭配”“换掉菜名”或“不吃牛肉”；复杂要求请等网络恢复后再说明。当前菜单已保留。')
        if schema is Selection:
            candidates = context['candidate_recipes']
            # Existing semantic preferences are only safe for recipes already assessed
            # under those preferences, and only while their facts remain unchanged.
            if self.memory.get('preferences') or any(c.get('kind') == 'dietary' for c in self.memory.get('constraints', [])):
                cached = {d['recipe_id']: model_dish(d) for d in self.memory.get('candidate_pool', [])}
                candidates = [d for d in candidates if cached.get(d['recipe_id']) == d]
            kept = {d['recipe_id'] for d in context['keep_dishes']}
            approved = [d['recipe_id'] for d in candidates]
            available = []
            for d in candidates:
                if d['recipe_id'] in kept:
                    continue
                available.append({'recipe_id': d['recipe_id'], 'name': d['name'], 'category_id': d['category_id'],
                    'is_hearty': d['is_hearty'], 'season_coverage': 1,
                    'ingredients': [{'ingredient_id': i['id'], 'is_main': i['main']} for i in d['ingredients']]})
            required = context.get('hearty_count')
            if required is not None:
                required -= sum(d['is_hearty'] for d in context['keep_dishes'])
            selected = select_menu(available, dict(Counter(context['slots'])), hearty_count=required) if context['slots'] else []
            choices=[]
            for slot, category in enumerate(context['slots']):
                dish=next(d for d in selected if d['category_id']==category)
                selected.remove(dish)
                choices.append({'slot':slot,'candidate_id':dish['recipe_id'],'suitability':'unknown' if context['constraints'] else 'match','reason':'按本餐规则筛选'})
            return Selection(eligible_ids=approved, choices=choices, reply='网络暂不可用，已按规则搭配，请查看菜单。')
        raise DomainError(502, 'RULE_UNSUPPORTED', '规则模式暂不能处理这个要求')
