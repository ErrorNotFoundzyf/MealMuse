"""Single household credentials and independently signed device sessions."""
import base64
from collections import defaultdict, deque
import hashlib
import hmac
import json
import secrets
from pathlib import Path
from threading import Lock
from time import time

from pydantic import BaseModel, Field

from .errors import DomainError

CONFIG = Path(__file__).resolve().parents[1] / 'auth.local.json'
ITERATIONS = 600_000


def make_config(username, password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), ITERATIONS).hex()
    return {'username': username, 'salt': salt, 'password_hash': digest, 'iterations': ITERATIONS, 'signing_key': secrets.token_hex(32)}


class LoginInput(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class FamilyAuth:
    def __init__(self, config=None):
        self.config = config
        self.attempts = defaultdict(deque)
        self.lock = Lock()

    @classmethod
    def load(cls):
        if not CONFIG.exists():
            return cls()
        try:
            config = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
            if not isinstance(config['username'], str) or not config['username'] or len(bytes.fromhex(config['salt'])) < 16 or len(bytes.fromhex(config['password_hash'])) != 32 or len(bytes.fromhex(config['signing_key'])) < 32 or not 600_000 <= config['iterations'] <= 2_000_000:
                raise ValueError('Invalid authentication configuration')
            return cls(config)
        except (OSError, ValueError, KeyError, TypeError):
            raise RuntimeError('家庭账号配置无效，请检查本地配置') from None

    def login(self, username, password, remote):
        if not self.config:
            raise DomainError(503, 'AUTH_NOT_CONFIGURED', '家庭账号尚未配置')
        now = time()
        with self.lock:
            attempts = self.attempts[remote]
            while attempts and attempts[0] < now - 900:
                attempts.popleft()
            if len(attempts) >= 8:
                raise DomainError(429, 'LOGIN_LIMITED', '尝试次数过多，请15分钟后再试')
            attempts.append(now)
        value = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(self.config['salt']), self.config['iterations']).hex()
        if not (hmac.compare_digest(username.encode(), self.config['username'].encode()) and hmac.compare_digest(value, self.config['password_hash'])):
            raise DomainError(401, 'LOGIN_FAILED', '账号或密码不正确')
        with self.lock:
            self.attempts.pop(remote, None)
        payload = base64.urlsafe_b64encode(json.dumps({'exp': int(now) + 30 * 86400, 'nonce': secrets.token_hex(16)}, separators=(',', ':')).encode()).decode().rstrip('=')
        signature = hmac.new(bytes.fromhex(self.config['signing_key']), payload.encode(), hashlib.sha256).hexdigest()
        return payload + '.' + signature

    def verify(self, token):
        if not self.config or not isinstance(token, str) or len(token) > 1024:
            return False
        try:
            payload, supplied = token.split('.')
            expected = hmac.new(bytes.fromhex(self.config['signing_key']), payload.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, supplied):
                return False
            data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
            return type(data.get('exp')) is int and data['exp'] > time()
        except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
            return False
