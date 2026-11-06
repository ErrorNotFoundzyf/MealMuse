from fastapi.testclient import TestClient

from app.family_auth import FamilyAuth, make_config
from app.main import create_app


def test_multiple_device_sessions_share_data_and_require_login(tmp_path):
    config = make_config('test-family', 'test-password')
    app = create_app(f"sqlite:///{(tmp_path / 'auth.db').as_posix()}", api_token='', auth_config=config)
    with TestClient(app) as client:
        assert client.get('/api/v1/auth/status').json() == {'configured': True}
        assert client.get('/api/v1/profile').status_code == 401
        assert client.post('/api/v1/auth/login', json={'username': 'test-family', 'password': 'wrong'}).status_code == 401
        def login():
            result = client.post('/api/v1/auth/login', json={'username': 'test-family', 'password': 'test-password'})
            assert result.status_code == 200 and result.headers['cache-control'] == 'no-store'
            return result.json()['token']
        first, second = login(), login()
        assert first != second
        assert client.get('/api/v1/profile', headers={'Authorization': 'Bearer ' + first}).status_code == 200
        assert client.get('/api/v1/auth/session', headers={'Authorization': 'Bearer ' + second}).json()['username'] == 'test-family'
        created = client.post('/api/v1/ingredients', headers={'Authorization': 'Bearer ' + first}, json={'name': '同步测试食材', 'ingredient_category': 'fruit', 'seasons': ['all_year']})
        assert created.status_code == 201
        found = client.get('/api/v1/ingredients?q=同步测试食材', headers={'Authorization': 'Bearer ' + second})
        assert found.json()['items'][0]['id'] == created.json()['id']
        assert client.get('/api/v1/profile', headers={'Authorization': 'Bearer ' + first + 'x'}).status_code == 401


def test_login_rate_limit_and_invalid_token():
    auth = FamilyAuth(make_config('family', 'test-password'))
    for _ in range(8):
        try:
            auth.login('family', 'wrong', 'test-device')
        except Exception as error:
            assert error.code == 'LOGIN_FAILED'
    try:
        auth.login('family', 'test-password', 'test-device')
        assert False, 'rate limiting expected'
    except Exception as error:
        assert error.code == 'LOGIN_LIMITED'
    assert not auth.verify('invalid.token')


def test_session_expiration_restart_and_key_rotation(monkeypatch):
    config = make_config('family', 'test-password')
    monkeypatch.setattr('app.family_auth.time', lambda: 1000)
    auth = FamilyAuth(config)
    token = auth.login('family', 'test-password', 'device')
    assert FamilyAuth(config).verify(token)  # Service restart keeps valid device sessions.
    assert not FamilyAuth(make_config('family', 'test-password')).verify(token)
    for invalid in ('', 'broken', 'a.b.c', 'a.中文', 'x' * 1025):
        assert not auth.verify(invalid)
    monkeypatch.setattr('app.family_auth.time', lambda: 1000 + 30 * 86400)
    assert not auth.verify(token)
