"""Small DeepSeek JSON client. Secrets never leave the backend configuration."""
import json
import os
from pathlib import Path
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .errors import DomainError


def config():
    path = Path(__file__).resolve().parents[1] / "llm.local.json"
    try:
        saved = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}
        result = {"api_key": os.getenv("DEEPSEEK_API_KEY") or saved.get("api_key", ""),
                  "base_url": os.getenv("DEEPSEEK_BASE_URL") or saved.get("base_url", "https://api.deepseek.com"),
                  "model": os.getenv("DEEPSEEK_MODEL") or saved.get("model", "deepseek-flash")}
        if result["base_url"].rstrip("/") not in {"https://api.deepseek.com", "https://api.deepseek.com/v1"}:
            raise ValueError()
        if not all(isinstance(v, str) for v in result.values()):
            raise ValueError()
        return {k: v.strip() for k, v in result.items()}
    except (ValueError, OSError, TypeError, AttributeError):
        raise DomainError(503, "AI_CONFIG", "请检查后端 llm.local.json 配置格式") from None


def status():
    settings = config()
    return {"configured": bool(settings["api_key"]), "provider": "DeepSeek", "model": settings["model"]}


class JsonClient:
    def __init__(self):
        self.settings = config()
        if not self.settings["api_key"]:
            raise DomainError(503, "AI_NOT_CONFIGURED", "请先在后端本地配置 DeepSeek 密钥")
        self.deadline = monotonic() + 42
        self.calls = 0
        self.usage = {"prompt_tokens": 0, "completion_tokens": 0, "prompt_cache_hit_tokens": 0, "requests": 0}

    def ask(self, schema, instruction, context, max_tokens=3000):
        messages = [{"role": "system", "content": instruction + "\n只输出 JSON，严格遵循此 schema：" + json.dumps(schema.model_json_schema(), ensure_ascii=False)},
                    {"role": "user", "content": json.dumps(context, ensure_ascii=False)}]
        for repair in range(2):
            if self.calls >= 4 or self.deadline - monotonic() < 2:
                raise DomainError(504, "AI_BUDGET", "本轮模型响应超时，请重试；当前菜单未被自动确认")
            self.calls += 1
            body = {"model": self.settings["model"], "messages": messages, "stream": False,
                    "thinking": {"type": "disabled"}, "temperature": 0.3,
                    "response_format": {"type": "json_object"}, "max_tokens": max_tokens}
            request = Request(self.settings["base_url"].rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                              headers={"Content-Type": "application/json", "Authorization": "Bearer " + self.settings["api_key"]})
            try:
                with urlopen(request, timeout=min(18, self.deadline - monotonic())) as response:
                    raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise ValueError()
                result = json.loads(raw)
                self.usage["requests"] += 1
                for key in ("prompt_tokens", "completion_tokens", "prompt_cache_hit_tokens"):
                    value = result.get("usage", {}).get(key, 0)
                    if type(value) is int and value >= 0:
                        self.usage[key] += value
                choice = result["choices"][0]
                content = choice["message"]["content"]
                if choice.get("finish_reason") != "stop" or not isinstance(content, str) or not content.strip():
                    raise ValueError()
                return schema.model_validate_json(content)
            except HTTPError as exc:
                code = exc.code
                message = "DeepSeek 密钥无效，请检查后端配置" if code in {401, 403} else "DeepSeek 余额不足，请检查账户" if code == 402 else "DeepSeek 请求限流，请稍后重试" if code == 429 else "DeepSeek 服务暂不可用，请稍后重试"
                raise DomainError(503, "AI_UPSTREAM", message) from None
            except (URLError, TimeoutError, OSError):
                raise DomainError(504, "AI_NETWORK", "连接 DeepSeek 超时或网络中断，请重试") from None
            except (ValueError, KeyError, IndexError, TypeError):
                if repair:
                    raise DomainError(502, "AI_INVALID_JSON", "模型输出未通过结构校验，请重试") from None
                messages.append({"role": "user", "content": "上次输出为空、被截断或不符合 schema。请重新输出完整合法 JSON，不要添加任何其他文字。"})
