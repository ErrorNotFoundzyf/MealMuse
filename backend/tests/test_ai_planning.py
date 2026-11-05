from uuid import uuid4
from copy import deepcopy
from collections import Counter
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.main import create_app
from app.models import Recipe, RulePlan
from app.ai_planning import Intent, Selection
from app.errors import DomainError
from app.season import time_context

class FakeAI:
    def __init__(self):
        self.intent = None
        self.select = None
        self.failure = False
        self.calls = []
    def ask(self, schema, instruction, context, max_tokens=3000):
        self.calls.append((schema.__name__, deepcopy(context)))
        if self.failure:
            raise DomainError(504, 'AI_NETWORK', '模拟网络失败')
        if schema is Intent:
            result = self.intent(context) if callable(self.intent) else self.intent or {'action':'generate','reply':'开始搭配'}
            return schema.model_validate(result)
        if self.select:
            result = self.select(context)
            result.setdefault('eligible_ids', [r['recipe_id'] for r in context['candidate_recipes']])
            return schema.model_validate(result)
        choices=[]; chosen={d['recipe_id'] for d in context['keep_dishes']}
        for slot, category in enumerate(context['slots']):
            candidate=next((r for r in context['candidate_recipes'] if r['category_id']==category and r['recipe_id'] not in chosen),None)
            if candidate:
                chosen.add(candidate['recipe_id'])
                choices.append({'slot':slot,'candidate_id':candidate['recipe_id'],'suitability':'unknown' if context['constraints'] else 'match','reason':'搭配参考'})
            else:
                ingredient=context['allowed_ingredients'][0]['id']
                choices.append({'slot':slot,'temporary':{'name':'临时家常菜'+str(slot),'category_id':category,'ingredient_ids':[ingredient]},'suitability':'unknown','reason':'补齐候选缺口'})
        return schema.model_validate({'eligible_ids':[r['recipe_id'] for r in context['candidate_recipes']], 'choices':choices,'reply':'请看看这桌菜单'})

@pytest.fixture
def env(tmp_path):
    app=create_app(f"sqlite:///{(tmp_path/'ai.db').as_posix()}",api_token='')
    fake=FakeAI();app.state.ai_client_factory=lambda:fake
    with TestClient(app) as client:
        yield client,fake

def chat(client, plan=None, message='帮我搭配', **extra):
    return client.post('/api/v1/ai/chat',json={'request_key':str(uuid4()),'message':message,'people_count':4,'category_counts':{'meat':1,'vegetable':2,'soup':1},'allow_nonseasonal':True,**({'plan_id':plan['id'],'expected_revision':plan['revision']} if plan else {}),**extra})
def confirm(client,plan,**extra):
    return client.post('/api/v1/meal-records',json={'request_key':str(uuid4()),'meal_date':time_context()['as_of_date'],'people_count':4,'recipe_ids':[d['recipe_id'] for d in plan['dishes']],'plan_id':plan['id'],'plan_revision':plan['revision'],**extra})


@pytest.mark.parametrize(('category', 'label'), [('dessert', '甜点'), ('fruit', '水果')])
def test_extra_item_is_added_swapped_confirmed_and_then_recently_excluded(env, category, label):
    client, fake = env
    ids = []
    for name in (label + '一号', label + '二号', label + '三号'):
        response = client.post('/api/v1/recipes', json={'name': name, 'category_id': category, 'ingredients': [{'ingredient_id': 'i_egg'}]})
        assert response.status_code == 201
        ids.append(response.json()['id'])
    first = chat(client, category_counts={'meat': 1, 'vegetable': 1}).json()
    original = deepcopy(first['dishes'])
    fake.intent = {'action': 'chat', 'reply': '可以'}  # A simple explicit add is enforced even if the model merely chats.
    added = chat(client, first, '我想加一个' + label, category_counts={'meat': 1, 'vegetable': 1}).json()
    assert not added['ai']['blocked'] and added['dishes'][:2] == original
    assert added['category_counts'] == {'meat': 1, 'vegetable': 1}
    extra = next(d for d in added['dishes'] if d['category_id'] == category)
    assert extra['recipe_id'] in ids and len(added['dishes']) == 3
    forbid_model(client)
    swapped = client.post('/api/v1/recommendations/' + added['id'] + '/replace', json={'request_key': str(uuid4()), 'expected_revision': added['revision'], 'recipe_id': extra['recipe_id']})
    assert swapped.status_code == 200
    final = swapped.json()
    assert final['dishes'][:2] == original and final['dishes'][-1]['recipe_id'] != extra['recipe_id']
    assert confirm(client, final).status_code == 201
    from app.recommendations import candidates
    with Session(client.app.state.engine) as session:
        assert final['dishes'][-1]['recipe_id'] not in {d['recipe_id'] for d in candidates(session, True)}


def test_missing_extra_keeps_existing_menu_and_explains_shortage(env):
    client, fake = env
    first = chat(client, category_counts={'vegetable': 1}).json()
    fake.intent = {'action': 'add', 'extra_add': {'dessert': 1}, 'reply': '添加甜点'}
    failed = chat(client, first, '加一个甜点', category_counts={'vegetable': 1}).json()
    assert failed['ai']['blocked'] and failed['dishes'] == first['dishes']
    assert '甜点菜谱不足' in failed['ai']['messages'][-1]['content']


def test_add_dessert_accepts_model_pool_containing_only_new_choices(env):
    client, fake = env
    dessert = client.post('/api/v1/recipes', json={'name': '甜点测试', 'category_id': 'dessert', 'ingredients': [{'ingredient_id': 'i_egg'}]}).json()
    first = chat(client, category_counts={'meat': 1, 'vegetable': 1}).json()
    fake.intent = {'action': 'add', 'extra_add': {'dessert': 1}, 'reply': '加甜点'}
    fake.select = lambda c: {'eligible_ids': [dessert['id']], 'choices': [{'slot': 0, 'candidate_id': dessert['id'], 'suitability': 'match', 'reason': '甜点'}], 'reply': '加好甜点'}
    added = chat(client, first, '加一个甜点', category_counts={'meat': 1, 'vegetable': 1}).json()
    assert not added['ai']['blocked']
    assert added['dishes'][:2] == first['dishes'] and added['dishes'][-1]['recipe_id'] == dessert['id']
    assert confirm(client, added).status_code == 201


def test_add_does_not_skip_model_check_when_new_preference_changes(env):
    client, fake = env
    dessert = client.post('/api/v1/recipes', json={'name': '甜点测试', 'category_id': 'dessert', 'ingredients': [{'ingredient_id': 'i_egg'}]}).json()
    first = chat(client, category_counts={'meat': 1}).json()
    fake.intent = {'action': 'add', 'extra_add': {'dessert': 1}, 'preferences': ['清淡'], 'reply': '加甜点'}
    fake.select = lambda c: {'eligible_ids': [dessert['id']], 'choices': [{'slot': 0, 'candidate_id': dessert['id'], 'suitability': 'match', 'reason': '甜点'}], 'reply': '加好甜点'}
    blocked = chat(client, first, '加一个甜点，整桌清淡一点', category_counts={'meat': 1}).json()
    assert blocked['ai']['blocked'] and blocked['dishes'] == first['dishes']


def test_repeating_unfinished_dessert_request_adds_only_one(env):
    client, fake = env
    dessert = client.post('/api/v1/recipes', json={'name': '甜点测试', 'category_id': 'dessert', 'ingredients': [{'ingredient_id': 'i_egg'}]}).json()
    first = chat(client, category_counts={'meat': 1}).json()
    fake.intent = {'action': 'add', 'extra_add': {'dessert': 1}, 'reply': '加甜点'}
    fake.select = lambda c: {'eligible_ids': [], 'choices': [], 'reply': '未完成'}
    failed = chat(client, first, '加一个甜点', category_counts={'meat': 1}).json()
    assert failed['ai']['blocked']
    fake.select = lambda c: {'eligible_ids': [dessert['id']], 'choices': [{'slot': 0, 'candidate_id': dessert['id'], 'suitability': 'match', 'reason': '甜点'}], 'reply': '加好甜点'}
    result = chat(client, failed, '加一个甜点', category_counts={'meat': 1}).json()
    assert not result['ai']['blocked'] and len(result['dishes']) == 2
    assert sum(d['category_id'] == 'dessert' for d in result['dishes']) == 1
    assert fake.calls[-2][1]['pending_user_messages'] == ['加一个甜点']


def test_replace_vegetable_with_dessert_changes_only_current_menu(env):
    client, fake = env
    dessert = client.post('/api/v1/recipes', json={'name': '甜点测试', 'category_id': 'dessert', 'ingredients': [{'ingredient_id': 'i_egg'}]}).json()
    first = chat(client, category_counts={'meat': 1, 'vegetable': 1}).json()
    target = next(d for d in first['dishes'] if d['category_id'] == 'vegetable')
    fake.intent = {'action': 'replace', 'target_recipe_ids': [target['recipe_id']], 'replace_with_extra': {target['recipe_id']: 'dessert'}, 'reply': '好的'}
    result = chat(client, first, '把' + target['name'] + '换成甜点', category_counts={'meat': 1, 'vegetable': 1}).json()
    assert not result['ai']['blocked']
    assert result['category_counts'] == {'meat': 1, 'vegetable': 0}
    assert {d['recipe_id'] for d in result['dishes']} == {first['dishes'][0]['recipe_id'], dessert['id']}
    assert confirm(client, result).status_code == 201


def test_offline_explicit_add_keeps_menu(env):
    client, fake = env
    client.post('/api/v1/recipes', json={'name': '水果测试', 'category_id': 'fruit', 'ingredients': [{'ingredient_id': 'i_egg'}]})
    first = chat(client, category_counts={'meat': 1}).json()
    fake.failure = True
    result = chat(client, first, '加一个水果', category_counts={'meat': 1}).json()
    assert not result['ai']['blocked'] and result['dishes'][0] == first['dishes'][0]
    assert result['dishes'][1]['category_id'] == 'fruit'


def test_extra_survives_settings_change_and_rule_regeneration(env):
    client, fake = env
    for name in ('甜点甲', '甜点乙', '甜点丙'):
        assert client.post('/api/v1/recipes', json={'name': name, 'category_id': 'dessert', 'ingredients': [{'ingredient_id': 'i_egg'}]}).status_code == 201
    first = chat(client, category_counts={'meat': 1}).json()
    fake.intent = {'action': 'add', 'extra_add': {'dessert': 1}, 'reply': '添加甜点'}
    added = chat(client, first, '加一个甜点', category_counts={'meat': 1}).json()
    fake.intent = {'action': 'generate', 'reply': '更新配置'}
    updated = chat(client, added, '按新配置搭配', category_counts={'meat': 1, 'vegetable': 1}, settings_change=True).json()
    assert not updated['ai']['blocked']
    assert Counter(d['category_id'] for d in updated['dishes']) == {'meat': 1, 'vegetable': 1, 'dessert': 1}
    forbid_model(client)
    regenerated = swap(client, updated, regenerate=True)
    assert regenerated.status_code == 200
    assert Counter(d['category_id'] for d in regenerated.json()['dishes']) == {'meat': 1, 'vegetable': 1, 'dessert': 1}


def test_failed_cross_category_replacement_preserves_original_counts(env):
    client, fake = env
    first = chat(client, category_counts={'meat': 1, 'vegetable': 1}).json()
    target = next(d for d in first['dishes'] if d['category_id'] == 'vegetable')
    fake.intent = {'action': 'replace', 'target_recipe_ids': [target['recipe_id']], 'replace_with_extra': {target['recipe_id']: 'dessert'}, 'reply': '好的'}
    result = chat(client, first, '把' + target['name'] + '换成甜点', category_counts={'meat': 1, 'vegetable': 1}).json()
    assert result['ai']['blocked'] and result['dishes'] == first['dishes']
    assert result['category_counts'] == first['category_counts']

def test_ai_selects_and_two_target_replacement_freezes_other_two(env):
    client,fake=env
    first=chat(client).json()
    assert first['mode']=='chat' and len(first['dishes'])==4
    assert not first['ai']['blocked']
    targets=[first['dishes'][0]['recipe_id'],first['dishes'][-1]['recipe_id']]
    fake.intent={'action':'replace','target_recipe_ids':targets,'reply':'换两道'}
    updated=chat(client,first,'换第一道和汤，其他保留').json()
    assert not updated['ai']['blocked']
    assert [d for d in first['dishes'] if d['recipe_id'] not in targets] == [d for d in updated['dishes'] if d['recipe_id'] in {x['recipe_id'] for x in first['dishes'] if x['recipe_id'] not in targets}]
    assert not set(targets)&{d['recipe_id'] for d in updated['dishes']}
    assert len(updated['ai']['messages'])==4

def test_constraints_persist_and_require_explicit_unknown_ack(env):
    client,fake=env
    fake.intent={'action':'generate','constraints':[{'kind':'ingredient','ingredient_id':'i_beef','text':'不吃牛肉','evidence':'不要牛肉'}],'reply':'会避开牛肉'}
    plan=chat(client,message='不要牛肉').json()
    assert not plan['ai']['blocked']
    assert all(i['ingredient_id']!='i_beef' for d in plan['dishes'] for i in d['ingredients'])
    assert confirm(client,plan).status_code==422
    assert confirm(client,plan,acknowledge_unknown=True).status_code==201

def test_model_failure_keeps_menu_and_unresolved_text_then_retry(env):
    client,fake=env
    first=chat(client).json()
    fake.failure=True
    failed=chat(client,first,'不能吃牛肉，还想适合老人').json()
    assert failed['dishes']==first['dishes'] and failed['ai']['blocked']
    assert failed['ai']['pending']==['不能吃牛肉，还想适合老人']
    assert confirm(client,failed).status_code==409
    fake.failure=False
    restored=chat(client,failed,message='',retry=True).json()
    assert not restored['ai']['blocked'] and not restored['ai']['pending']
    assert any(c['ingredient_id']=='i_beef' for c in restored['ai']['constraints'])


def test_network_failure_degrades_to_rule_dialogue_and_keeps_ingredient_exclusion(env):
    client,fake=env
    fake.failure=True
    plan=chat(client,message='不吃牛肉').json()
    assert not plan['ai']['blocked'] and len(plan['dishes'])==4
    assert any(c['ingredient_id']=='i_beef' for c in plan['ai']['constraints'])
    assert all(i['ingredient_id']!='i_beef' for d in plan['dishes'] for i in d['ingredients'])
    assert '规则模式' in plan['ai']['messages'][-1]['content']


def test_network_failure_does_not_guess_complex_preference(env):
    client,fake=env
    first=chat(client).json()
    fake.failure=True
    result=chat(client,first,message='换成适合老人的清淡菜').json()
    assert result['ai']['blocked'] and result['dishes']==first['dishes']
    assert '复杂要求' in result['ai']['messages'][-1]['content']

def test_temporary_dishes_confirm_without_polluting_recipe_library(env):
    client,fake=env
    initial=client.get('/api/v1/recipes').json()['total']
    fake.select=lambda c:{'choices':[{'slot':slot,'temporary':{'name':'临时菜'+str(slot),'category_id':category,'ingredient_ids':['i_tofu']},'suitability':'match','reason':'候选不足补充'} for slot,category in enumerate(c['slots'])],'reply':'新菜仅本次使用'}
    plan=chat(client).json()
    assert not plan['ai']['blocked']
    assert all(d['recipe_id'].startswith('tmp_') for d in plan['dishes'])
    assert client.get('/api/v1/recipes').json()['total']==initial
    groceries=client.post('/api/v1/shopping-list',json={'recipe_ids':[d['recipe_id'] for d in plan['dishes']],'plan_id':plan['id'],'plan_revision':plan['revision']})
    assert groceries.status_code==200 and len(groceries.json()['items'])==1
    saved=confirm(client,plan)
    assert saved.status_code==201 and saved.json()['dishes']==plan['dishes']
    assert client.get('/api/v1/recipes').json()['total']==initial

def test_explicit_save_temporary_and_confirm(env):
    client,fake=env
    fake.select=lambda c:{'choices':[{'slot':0,'temporary':{'name':'清炖豆腐','category_id':'vegetable','ingredient_ids':['i_tofu']},'suitability':'match','reason':'建议'}],'reply':'建议试试'}
    plan=chat(client,category_counts={'vegetable':1}).json()
    response=client.post('/api/v1/ai/plans/'+plan['id']+'/save-temporary',json={'recipe_id':plan['dishes'][0]['recipe_id'],'expected_revision':plan['revision']})
    assert response.status_code==200
    updated=response.json()
    assert not updated['dishes'][0]['recipe_id'].startswith('tmp_')
    assert client.get('/api/v1/recipes?q=清炖豆腐').json()['total']==1
    assert confirm(client,updated).status_code==201

def test_invalid_candidate_does_not_replace_menu_or_erase_constraints(env):
    client,fake=env
    first=chat(client).json()
    fake.select=lambda c:{'choices':[{'slot':i,'candidate_id':'invented','suitability':'match','reason':'invalid'} for i in range(len(c['slots']))],'reply':'invalid'}
    failed=chat(client,first).json()
    assert failed['ai']['blocked'] and failed['dishes']==first['dishes']
    assert failed['ai']['pending']

def test_non_target_conflict_clarifies_instead_of_silent_change(env):
    client,fake=env
    first=chat(client).json()
    target=first['dishes'][0]['recipe_id']
    kept=first['dishes'][-1]
    ingredient=kept['ingredients'][0]
    text='不要'+ingredient['name']
    fake.intent={'action':'replace','target_recipe_ids':[target],'constraints':[{'kind':'ingredient','ingredient_id':ingredient['ingredient_id'],'text':text,'evidence':text}],'reply':'调整'}
    failed=chat(client,first,text).json()
    assert failed['ai']['blocked'] and failed['dishes']==first['dishes']

def test_request_replay_stale_revision_and_confirm_recheck(env):
    client,fake=env
    key=str(uuid4())
    plan=chat(client,request_key=key).json()
    count=len(fake.calls)
    assert chat(client,request_key=key).json()==plan
    assert len(fake.calls)==count
    newer=chat(client,plan).json()
    assert chat(client,plan).status_code==409
    assert confirm(client,plan).status_code==409
    recipe=newer['dishes'][0]['recipe_id']
    manual=client.post('/api/v1/meal-records',json={'request_key':str(uuid4()),'meal_date':time_context()['as_of_date'],'people_count':2,'recipe_ids':[recipe]})
    assert manual.status_code==201
    assert confirm(client,newer).status_code==409

def test_ai_calls_do_not_hold_write_lock_and_publish_rechecks(env):
    client,fake=env
    def race(context):
        with Session(client.app.state.engine) as session:
            recipe=session.get(Recipe,context['candidate_recipes'][0]['recipe_id']);recipe.name='并发修改';session.commit()
        return {'choices':[{'slot':0,'candidate_id':context['candidate_recipes'][0]['recipe_id'],'suitability':'match','reason':'test'}],'reply':'test'}
    fake.select=race
    response=chat(client,category_counts={'meat':1})
    assert response.status_code==409

def test_manual_selection_and_config_change_preserve_hard_memory(env):
    client,fake=env
    first=chat(client,message='不要牛肉').json()
    # Deterministic ingredient exclusion remains even when the model omitted it.
    assert first['ai']['constraints']
    second=chat(client,first,selected_recipe_ids=[],replace_selection=True,people_count=2,category_counts={'vegetable':1}).json()
    assert second['people_count']==2 and len(second['dishes'])==1
    assert second['ai']['constraints']==first['ai']['constraints']


def test_settings_change_automatically_regenerates_with_existing_constraints(env):
    client,fake=env
    first=chat(client,message='不要牛肉').json()
    fake.intent={'action':'replace','target_recipe_ids':[first['dishes'][0]['recipe_id']], 'people_count':7,'category_counts':{'meat':1},'reply':'调整'}
    second=chat(client,first,message='请按新配置重新搭配',people_count=3,category_counts={'meat':1,'vegetable':1,'soup':1},settings_change=True).json()
    assert not second['ai']['blocked'] and len(second['dishes'])==3
    assert second['people_count']==3 and second['category_counts']=={'meat':1,'vegetable':1,'soup':1}
    assert second['ai']['constraints']==first['ai']['constraints']


def test_settings_change_failure_preserves_menu_and_pending_request(env):
    client,fake=env
    first=chat(client,message='不要牛肉').json()
    with Session(client.app.state.engine) as session:
        for recipe in session.query(Recipe).all():
            recipe.is_hidden=True
        session.commit()
    fake.failure=True
    failed=chat(client,first,message='按新配置重新搭配',category_counts={'meat':1,'vegetable':1,'soup':1},settings_change=True).json()
    assert failed['ai']['blocked'] and failed['dishes']==first['dishes']
    assert failed['ai']['constraints']==first['ai']['constraints'] and failed['ai']['pending']


def test_settings_change_respects_unresolved_clarification(env):
    client,fake=env
    first=chat(client).json()
    fake.intent={'action':'clarify','reply':'请说明本餐限制'}
    result=chat(client,first,message='按新配置重新搭配',category_counts={'meat':1,'vegetable':1},settings_change=True).json()
    assert result['ai']['blocked'] and result['dishes']==first['dishes']


def swap(client, plan, regenerate=False, key=None):
    return client.post('/api/v1/recommendations/'+plan['id']+('/regenerate' if regenerate else '/replace'), json={
        'request_key': key or str(uuid4()), 'expected_revision': plan['revision'],
        **({} if regenerate else {'recipe_id':plan['dishes'][0]['recipe_id']})})


def forbid_model(client):
    def forbidden():
        raise AssertionError('Button must not create a model client')
    client.app.state.ai_client_factory = forbidden


def test_buttons_use_only_candidate_two_without_model_or_chat_messages(env):
    client,fake=env
    approved=[]
    def select_two(context):
        approved[:] = [d['recipe_id'] for d in context['candidate_recipes'] if d['category_id']=='meat'][:2]
        assert len(approved)==2
        return {'eligible_ids':approved,'choices':[{'slot':0,'candidate_id':approved[0],'suitability':'match','reason':'家常'}],'reply':'已筛选两道'}
    fake.select=select_two
    first=chat(client,category_counts={'meat':1}).json()
    assert first['ai']['candidate_counts']=={'meat':2}
    messages=deepcopy(first['ai']['messages']);calls=len(fake.calls)
    forbid_model(client)
    key=str(uuid4())
    response=swap(client,first,key=key)
    assert response.status_code==200
    second=response.json()
    assert second['dishes'][0]['recipe_id']==approved[1]
    assert second['ai']['messages']==messages and len(fake.calls)==calls
    assert second['ai']['pool_version']==first['ai']['pool_version']
    assert swap(client,first,key=key).json()==second
    assert swap(client,first).status_code==409
    exhausted=swap(client,second)
    assert exhausted.status_code==409 and exhausted.json()['error']['code']=='CANDIDATE_POOL_EXHAUSTED'
    assert client.get('/api/v1/recommendations/'+second['id']).json()==second


def test_whole_table_button_preserves_conditions_and_only_uses_filtered_pool(env):
    client,fake=env
    first=chat(client,message='不要牛肉，家常清淡',category_counts={'meat':1,'vegetable':1}).json()
    assert not first['ai']['blocked']
    with Session(client.app.state.engine) as session:
        approved={d['recipe_id'] for d in session.get(RulePlan,first['id']).ai_memory['candidate_pool']}
    forbid_model(client)
    response=swap(client,first,regenerate=True)
    assert response.status_code==200
    second=response.json()
    ids={d['recipe_id'] for d in second['dishes']}
    assert ids <= approved and not ids.intersection(d['recipe_id'] for d in first['dishes'])
    assert second['ai']['constraints']==first['ai']['constraints']
    assert second['ai']['messages']==first['ai']['messages']


def test_new_dialogue_replaces_candidate_two_and_failure_does_not_publish_partial_pool(env):
    client,fake=env
    first=chat(client,category_counts={'meat':1}).json()
    def only_one(context):
        chosen=next(d['recipe_id'] for d in reversed(context['candidate_recipes']) if d['category_id']=='meat')
        return {'eligible_ids':[chosen],'choices':[{'slot':0,'candidate_id':chosen,'suitability':'match','reason':'符合新偏好'}],'reply':'重新筛选'}
    fake.select=only_one
    second=chat(client,first,'换成更清淡的',category_counts={'meat':1}).json()
    assert second['ai']['candidate_counts']=={'meat':1}
    assert second['ai']['pool_version']==first['ai']['pool_version']+1
    fake.select=lambda context:{'eligible_ids':['invented'],'choices':[],'reply':'invalid'}
    failed=chat(client,second,'再筛选',category_counts={'meat':1}).json()
    assert failed['ai']['blocked'] and failed['ai']['pool_version']==second['ai']['pool_version']
    assert failed['dishes']==second['dishes']
    forbid_model(client)
    assert swap(client,failed).json()['error']['code']=='AI_PENDING'


@pytest.mark.parametrize('change', ['recipe_edit','recent','season','deleted'])
def test_cached_pool_rechecks_library_season_and_recent_history(env, change):
    client,fake=env
    approved=[]
    def two(context):
        approved[:]=[d['recipe_id'] for d in context['candidate_recipes'] if d['category_id']=='meat'][:2]
        return {'eligible_ids':approved,'choices':[{'slot':0,'candidate_id':approved[0],'suitability':'match','reason':'符合'}],'reply':'已筛选'}
    fake.select=two
    first=chat(client,category_counts={'meat':1},allow_nonseasonal=False).json()
    assert not first['ai']['blocked']
    alternative=approved[1]
    if change=='recent':
        response=client.post('/api/v1/meal-records',json={'request_key':str(uuid4()),'meal_date':time_context()['as_of_date'],'people_count':2,'recipe_ids':[alternative]})
        assert response.status_code==201
    else:
        from app.models import Ingredient
        with Session(client.app.state.engine) as session:
            recipe=session.get(Recipe,alternative)
            if change=='recipe_edit': recipe.steps='更改后的做法'
            elif change=='deleted': recipe.is_hidden=True
            else:
                pool=session.get(RulePlan,first['id']).ai_memory['candidate_pool']
                other=next(d for d in pool if d['recipe_id']==alternative)
                current=first['dishes'][0]
                ingredient=next(i['ingredient_id'] for i in other['ingredients'] if i['ingredient_id'] not in {x['ingredient_id'] for x in current['ingredients']})
                session.get(Ingredient,ingredient).seasons=[]
            session.commit()
    forbid_model(client)
    response=swap(client,first)
    assert response.status_code==409
    assert client.get('/api/v1/recommendations/'+first['id']).json()['dishes']==first['dishes']


def test_old_ai_plan_requires_explicit_chat_to_create_pool(env):
    client,fake=env
    first=chat(client,category_counts={'meat':1}).json()
    with Session(client.app.state.engine) as session:
        plan=session.get(RulePlan,first['id']);memory=deepcopy(plan.ai_memory);memory.pop('candidate_pool');plan.ai_memory=memory;session.commit()
    forbid_model(client)
    assert swap(client,first).json()['error']['code']=='POOL_REFRESH_REQUIRED'


def mark_hearty(client, ids):
    with Session(client.app.state.engine) as session:
        for recipe_id in ids:
            session.get(Recipe,recipe_id).is_hearty=True
        session.commit()


def hearty_selection(context):
    choices=[];used={d['recipe_id'] for d in context['keep_dishes']}
    need=context['hearty_count']-sum(d['is_hearty'] for d in context['keep_dishes'])
    for slot,category in enumerate(context['slots']):
        available=[d for d in context['candidate_recipes'] if d['recipe_id'] not in used and d['category_id']==category]
        preferred=next((d for d in available if d['is_hearty'] and need>0),None)
        chosen=preferred or next(d for d in available if not d['is_hearty'])
        used.add(chosen['recipe_id']);need-=int(chosen['is_hearty'])
        choices.append({'slot':slot,'candidate_id':chosen['recipe_id'],'suitability':'match','reason':'按库内标签搭配'})
    return {'eligible_ids':[d['recipe_id'] for d in context['candidate_recipes']],'choices':choices,'reply':'已按菜谱标签搭配'}


def test_direct_chat_hearty_is_an_extra_label_inside_existing_counts(env):
    client,fake=env
    mark_hearty(client,['r_shiitake_chicken','r_radish_ribs'])
    # Even if parsing mistakes one hearty dish for one meat dish, preserve the configured meal.
    fake.intent={'action':'generate','category_counts':{'meat':1},'reply':'搭配'}
    fake.select=hearty_selection
    counts={'meat':2,'vegetable':1,'soup':1}
    first=chat(client,message='今天想吃一道硬菜',category_counts=counts).json()
    assert not first['ai']['blocked']
    assert first['ai']['hearty_count']==1 and first['category_counts']==counts
    assert len(first['dishes'])==4 and sum(d['is_hearty'] for d in first['dishes'])==1
    assert '硬菜' in first['ai']['messages'][-1]['content'] or first['ai']['messages'][-1]['content']=='已按菜谱标签搭配'
    assert all('is_hearty' in d for d in fake.calls[-1][1]['candidate_recipes'])
    assert confirm(client,first).status_code==201


def test_model_cannot_call_ordinary_meat_a_hearty_dish(env):
    client,fake=env
    mark_hearty(client,['r_radish_ribs'])
    fake.select=lambda c:{'eligible_ids':[d['recipe_id'] for d in c['candidate_recipes']],
        'choices':[{'slot':0,'candidate_id':'r_shiitake_chicken','suitability':'match','reason':'这是硬菜'}], 'reply':'普通荤菜也算硬菜'}
    first=chat(client,message='我想吃一道硬菜',category_counts={'meat':1}).json()
    assert first['ai']['blocked'] and first['dishes']==[]
    assert 'candidate_pool' not in first['ai']
    assert not first['ai']['has_candidate_pool']


def test_no_tagged_hearty_reports_shortage_without_generating_fake_tag(env):
    client,fake=env
    first=chat(client,message='想吃一道硬菜').json()
    assert first['ai']['blocked'] and not first['dishes']
    assert len(fake.calls)==1
    assert '硬菜标签' in first['ai']['messages'][-1]['content']


def test_hearty_can_be_a_vegetable_and_need_not_increase_meat_count(env):
    client,fake=env
    mark_hearty(client,['r_cabbage_tofu'])
    fake.select=hearty_selection
    first=chat(client,message='来一道硬菜，其他照旧').json()
    assert not first['ai']['blocked'] and first['category_counts']=={'meat':1,'vegetable':2,'soup':1}
    assert next(d for d in first['dishes'] if d['is_hearty'])['category_id']=='vegetable'


def test_hearty_requirement_survives_rule_swap_regenerate_and_dialogue(env):
    client,fake=env
    mark_hearty(client,['r_shiitake_chicken','r_radish_ribs','r_potato_beef'])
    fake.select=hearty_selection
    counts={'meat':1,'vegetable':1,'soup':1}
    first=chat(client,message='想吃一道硬菜',category_counts=counts).json()
    second=chat(client,first,message='口味家常一点',category_counts=counts).json()
    assert not second['ai']['blocked'] and second['ai']['hearty_count']==1
    forbid_model(client)
    changed=swap(client,second)
    assert changed.status_code==200
    third=changed.json()
    assert third['dishes'][0]['is_hearty'] and third['ai']['hearty_count']==1
    regenerated=swap(client,third,regenerate=True)
    assert regenerated.status_code==200
    assert sum(d['is_hearty'] for d in regenerated.json()['dishes'])==1


@pytest.mark.parametrize('required', [0, 1])
def test_hearty_memory_does_not_replace_normal_dialogue_reply(env, required):
    client,fake=env
    mark_hearty(client,['r_shiitake_chicken','r_radish_ribs'])
    fake.select=hearty_selection
    initial='想吃一道硬菜' if required else '不要硬菜'
    first=chat(client,message=initial,category_counts={'meat':1}).json()
    assert not first['ai']['blocked'] and first['ai']['hearty_count']==required
    fake.intent={'action':'replace','target_recipe_ids':[first['dishes'][0]['recipe_id']],'reply':'好的'}
    def choose(context):
        result=hearty_selection(context)
        result['reply']='这道已经换好，请看看新菜是否合适。'
        return result
    fake.select=choose
    second=chat(client,first,message='换掉这道菜',category_counts={'meat':1}).json()
    assert not second['ai']['blocked']
    assert second['ai']['messages'][-1]['content']=='这道已经换好，请看看新菜是否合适。'
    assert second['ai']['hearty_count']==required


def test_false_hearty_claim_is_corrected_but_valid_model_reply_is_preserved(env):
    client,fake=env
    fake.select=lambda c:{'eligible_ids':[d['recipe_id'] for d in c['candidate_recipes']],
        'choices':[{'slot':0,'candidate_id':'r_shiitake_chicken','suitability':'match','reason':'家常'}], 'reply':'香菇炖鸡是硬菜。'}
    result=chat(client,message='帮我搭配',category_counts={'meat':1}).json()
    assert not result['ai']['blocked']
    assert '没有选用硬菜' in result['ai']['messages'][-1]['content']


def test_hearty_count_checked_again_for_manual_confirmation_and_label_edits(env):
    client,fake=env
    mark_hearty(client,['r_shiitake_chicken'])
    fake.select=hearty_selection
    first=chat(client,message='想吃一道硬菜',category_counts={'meat':1}).json()
    manual=confirm(client,first,manual_adjustment=True,recipe_ids=['r_tomato_egg'])
    assert manual.status_code==409 and manual.json()['error']['code']=='HEARTY_COUNT_MISMATCH'
    with Session(client.app.state.engine) as session:
        session.get(Recipe,first['dishes'][0]['recipe_id']).is_hearty=False
        session.commit()
    assert confirm(client,first).status_code==409


def test_hearty_quota_can_be_changed_and_removed_explicitly(env):
    from app.ai_planning import merge_hearty_requirement
    memory={'hearty_count':1}
    intent=Intent(action='generate',reply='test')
    merge_hearty_requirement(memory,intent,['来两道硬菜'])
    assert memory['hearty_count']==2
    merge_hearty_requirement(memory,intent,['先来一道硬菜','不要硬菜'])
    assert memory['hearty_count']==0
    merge_hearty_requirement(memory,intent,['硬菜数量不限'])
    assert 'hearty_count' not in memory
