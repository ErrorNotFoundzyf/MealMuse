from copy import deepcopy
from app.rule_fallback import RuleFallback
from app.ai_planning import Intent, Selection, model_dish


def test_offline_recognizes_only_unambiguous_commands():
    client=RuleFallback({})
    context={'pending_user_messages':['换掉清炒菠菜'], 'current_dishes':[{'name':'清炒菠菜','recipe_id':'r1'}], 'ingredients':[{'name':'牛肉','aliases':[]}]}
    assert client.ask(Intent,'',context).target_recipe_ids==['r1']
    context['pending_user_messages']=['不吃牛肉']
    assert client.ask(Intent,'',context).action=='generate'
    context['pending_user_messages']=['今天想吃一道硬菜']
    assert client.ask(Intent,'',context).action=='generate'
    context['pending_user_messages']=['不要辣，换一道']
    assert client.ask(Intent,'',context).action=='clarify'


def test_semantic_preferences_never_expand_beyond_previously_checked_candidates():
    dish={'recipe_id':'r1','name':'青菜','category_id':'vegetable','is_hearty':False,'ingredients':[{'ingredient_id':'i1','name':'青菜','is_main':True}], 'steps':None,'notes':None,'cook_time_minutes':None}
    current=model_dish(dish)
    other=deepcopy(current);other['recipe_id']='r2'
    client=RuleFallback({'preferences':['清淡'],'candidate_pool':[dish]})
    result=client.ask(Selection,'',{'candidate_recipes':[current,other], 'keep_dishes':[], 'slots':['vegetable'], 'constraints':[], 'hearty_count':None})
    assert result.eligible_ids==['r1'] and result.choices[0].candidate_id=='r1'
