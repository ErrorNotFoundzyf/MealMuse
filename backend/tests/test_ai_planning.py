from uuid import uuid4
from copy import deepcopy
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
            return schema.model_validate(self.select(context))
        choices=[]; chosen=set()
        for slot, category in enumerate(context['slots']):
            candidate=next((r for r in context['candidate_recipes'] if r['category_id']==category and r['recipe_id'] not in chosen),None)
            if candidate:
                chosen.add(candidate['recipe_id'])
                choices.append({'slot':slot,'candidate_id':candidate['recipe_id'],'suitability':'unknown' if context['constraints'] else 'match','reason':'搭配参考'})
            else:
                ingredient=context['allowed_ingredients'][0]['id']
                choices.append({'slot':slot,'temporary':{'name':'临时家常菜'+str(slot),'category_id':category,'ingredient_ids':[ingredient]},'suitability':'unknown','reason':'补齐候选缺口'})
        return schema.model_validate({'choices':choices,'reply':'请看看这桌菜单'})

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
    failed=chat(client,first,'不能吃牛肉').json()
    assert failed['dishes']==first['dishes'] and failed['ai']['blocked']
    assert failed['ai']['pending']==['不能吃牛肉']
    assert confirm(client,failed).status_code==409
    fake.failure=False
    restored=chat(client,failed,message='',retry=True).json()
    assert not restored['ai']['blocked'] and not restored['ai']['pending']
    assert any(c['ingredient_id']=='i_beef' for c in restored['ai']['constraints'])

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
