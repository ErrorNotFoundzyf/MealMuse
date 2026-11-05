import io
import json
from urllib.error import HTTPError

import pytest
from pydantic import BaseModel

from app import llm
from app.errors import DomainError


class Result(BaseModel):
    ok: bool


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(llm, 'config', lambda: {'api_key': 'test-only-secret', 'base_url': 'https://api.deepseek.com', 'model': 'deepseek-flash'})


def reply(content, finish='stop'):
    return io.BytesIO(json.dumps({'choices': [{'message': {'content': content}, 'finish_reason': finish}]}).encode())


def test_blank_json_repaired_with_budget(configured, monkeypatch):
    results = [reply('    '), reply('{"ok":true}')]
    requests = []
    def send(request, timeout):
        requests.append(json.loads(request.data))
        return results.pop(0)
    monkeypatch.setattr(llm, 'urlopen', send)
    client = llm.JsonClient()
    assert client.ask(Result, '只输出JSON', {'test': True}).ok
    assert client.calls == 2
    assert requests[0]['thinking']['type'] == 'disabled'
    assert requests[0]['response_format'] == {'type': 'json_object'}


def test_direct_connection_failure_uses_system_proxy(configured, monkeypatch):
    def fail(*_args, **_kwargs):
        raise TimeoutError('direct unavailable')
    monkeypatch.setattr(llm, 'urlopen', fail)
    monkeypatch.setattr(llm, 'system_urlopen', lambda *_args, **_kwargs: reply('{"ok":true}'))
    assert llm.JsonClient().ask(Result, 'json', {}).ok


def test_invalid_schema_and_truncation_fail_closed(configured, monkeypatch):
    monkeypatch.setattr(llm, 'urlopen', lambda *_args, **_kwargs: reply('{"bad":true}', 'length'))
    with pytest.raises(DomainError) as error:
        llm.JsonClient().ask(Result, 'json', {})
    assert error.value.code == 'AI_INVALID_JSON'


@pytest.mark.parametrize('code', [401, 402, 403, 429, 500])
def test_upstream_errors_do_not_echo_response_or_secret(configured, monkeypatch, code):
    def send(*_args, **_kwargs):
        raise HTTPError('https://api.deepseek.com/chat/completions', code, 'test-only-secret', {}, None)
    monkeypatch.setattr(llm, 'urlopen', send)
    with pytest.raises(DomainError) as error:
        llm.JsonClient().ask(Result, 'json', {})
    assert 'test-only-secret' not in error.value.message


def test_missing_key_and_network_failure(monkeypatch, configured):
    def timeout(*_args, **_kwargs):
        raise TimeoutError('secret should never appear')
    monkeypatch.setattr(llm, 'urlopen', timeout)
    monkeypatch.setattr(llm, 'system_urlopen', timeout)
    with pytest.raises(DomainError) as error:
        llm.JsonClient().ask(Result, 'json', {})
    assert error.value.code == 'AI_NETWORK' and 'secret' not in error.value.message
    monkeypatch.setattr(llm, 'config', lambda: {'api_key': '', 'base_url': 'https://api.deepseek.com', 'model': 'deepseek-flash'})
    assert not llm.status()['configured']
    with pytest.raises(DomainError) as error:
        llm.JsonClient()
    assert error.value.code == 'AI_NOT_CONFIGURED'
