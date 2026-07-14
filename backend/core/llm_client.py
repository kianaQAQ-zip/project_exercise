# backend/core/llm_client.py
import logging
import asyncio
from typing import AsyncGenerator, List, Dict, Any, Optional, Type, TypeVar

from pydantic import BaseModel

from openai import AsyncOpenAI, APIError, APITimeoutError, RateLimitError, APIConnectionError
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log
)

from backend.core.config import settings, LLMConfig

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class LLMServiceError(Exception):
    """大模型服务统一自定义异常"""
    pass


class LLMRouter:
    """
    企业级大模型路由网关。
    核心能力：主备自动降级、超时控制、指数退避重试、流式连接保护。

    OpenAI 客户端采用惰性初始化，仅在各业务方法首次调用时才创建连接，
    避免导入时因缺少 API Key 而崩溃。
    """

    def __init__(self):
        self._primary_client: Optional[AsyncOpenAI] = None
        self._fallback_client: Optional[AsyncOpenAI] = None
        self.primary_model: Optional[str] = None
        self.fallback_model: Optional[str] = None
        self._initialized = False

    def _ensure_clients(self):
        """惰性初始化：仅首次调用时创建 OpenAI 客户端"""
        if self._initialized:
            return

        self._primary_client = self._init_client(settings.PRIMARY_LLM)
        self.primary_model = settings.PRIMARY_LLM.model_name

        self.fallback_model = None
        if settings.FALLBACK_LLM and settings.FALLBACK_LLM.api_key:
            self._fallback_client = self._init_client(settings.FALLBACK_LLM)
            self.fallback_model = settings.FALLBACK_LLM.model_name
            logger.info(f"🛡️ LLM 网关已启用主备双链路: 主[{self.primary_model}] / 备[{self.fallback_model}]")
        else:
            logger.warning("⚠️ LLM 网关仅配置了主链路，未配置 Fallback 降级模型。")
        self._initialized = True

    def _init_client(self, config: LLMConfig) -> AsyncOpenAI:
        """初始化 OpenAI 兼容客户端"""
        return AsyncOpenAI(
            api_key=config.api_key,
            base_url=str(config.base_url),
            timeout=config.timeout,
            max_retries=0  # 禁用 SDK 内置重试，统一由 tenacity 接管
        )

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((APITimeoutError, RateLimitError, APIConnectionError)),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True
    )
    async def _call_single_model(
            self,
            client: AsyncOpenAI,
            model: str,
            messages: List[Dict[str, str]],
            temperature: float,
            response_format: Optional[Dict] = None
    ) -> Any:
        """
        单模型调用核心逻辑（包含 tenacity 重试机制）。
        仅针对网络超时、限流(429)、连接异常进行重试。400/401/403/404 等客户端错误直接抛出。
        """
        kwargs = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if response_format:
            kwargs["response_format"] = response_format

        response = await client.chat.completions.create(**kwargs)

        # 监控预留：记录 Token 消耗
        if response.usage:
            logger.debug(
                f"[TokenMonitor] Model: {model} | Prompt: {response.usage.prompt_tokens} | Completion: {response.usage.completion_tokens}")

        return response

    async def _execute_with_fallback(self, messages: List[Dict[str, str]], temperature: float,
                                     response_format: Optional[Dict] = None) -> Any:
        """主备降级执行器，仅对服务端/网络异常触发降级，客户端错误（4xx）直接抛出"""
        self._ensure_clients()
        try:
            return await self._call_single_model(self._primary_client, self.primary_model, messages, temperature,
                                                 response_format)
        except (APITimeoutError, RateLimitError, APIConnectionError) as e:
            logger.error(f"🚨 主模型 [{self.primary_model}] 调用失败: {type(e).__name__} - {e}")

            if self._fallback_client:
                logger.warning(f"🔄 触发降级策略，切换至备用模型 [{self.fallback_model}]...")
                try:
                    # 备用模型同样享有重试机制
                    return await self._call_single_model(self._fallback_client, self.fallback_model, messages,
                                                         temperature, response_format)
                except Exception as fallback_e:
                    logger.critical(f"❌ 备用模型 [{self.fallback_model}] 同样失败: {fallback_e}")
                    raise LLMServiceError("主备模型均不可用，请稍后重试") from fallback_e
            else:
                raise LLMServiceError(f"主模型调用失败且未配置备用模型: {e}") from e

    async def chat_completion(
            self,
            messages: List[Dict[str, str]],
            temperature: float = 0.7
    ) -> str:
        """普通文本对话（非流式）"""
        response = await self._execute_with_fallback(messages, temperature)
        return response.choices[0].message.content or ""

    async def chat_completion_structured(
            self,
            messages: List[Dict[str, str]],
            response_model: Type[T],
            temperature: float = 0.1
    ) -> T:
        """
        结构化输出（强制 LLM 返回符合 Pydantic 模型的 JSON）。
        适用于邮件分类、实体提取等需要严格数据格式的场景。
        """
        # 利用 OpenAI 的 response_format 强制输出 JSON
        response = await self._execute_with_fallback(
            messages,
            temperature,
            response_format={"type": "json_object"}
        )
        raw_content = response.choices[0].message.content or "{}"

        try:
            # 使用传入的 Pydantic 模型进行二次校验和解析
            return response_model.model_validate_json(raw_content)
        except Exception as e:
            logger.error(f"[StructuredOutput] JSON 解析或 Pydantic 校验失败: {e}\nRaw: {raw_content}")
            raise LLMServiceError("大模型返回的数据格式不符合预期规范") from e

    async def chat_completion_stream(
            self,
            messages: List[Dict[str, str]],
            temperature: float = 0.7
    ) -> AsyncGenerator[str, None]:
        """
        SSE 流式对话生成器。
        防御性设计：仅在“建立连接阶段”进行主备降级。一旦开始吐出 Token，则不再重试，防止前端收到重复数据。
        """
        self._ensure_clients()
        client = self._primary_client
        model = self.primary_model

        try:
            stream = await client.chat.completions.create(
                model=model, messages=messages, temperature=temperature, stream=True
            )
        except (APITimeoutError, RateLimitError, APIConnectionError) as e:
            logger.error(f"🚨 主模型流式连接失败: {e}")
            if self._fallback_client:
                logger.warning(f"🔄 流式连接降级至 [{self.fallback_model}]")
                client = self._fallback_client
                model = self.fallback_model
                stream = await client.chat.completions.create(
                    model=model, messages=messages, temperature=temperature, stream=True
                )
            else:
                raise LLMServiceError("流式连接失败且无备用模型") from e

        # 连接建立成功，开始 yield token（此阶段若断开直接抛出异常，由 API 层捕获并终止 SSE）
        try:
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            logger.error(f"❌ 流式传输中途断开: {e}")
            raise LLMServiceError("流式传输中途异常断开") from e

    async def get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        获取文本向量（用于 RAG 入库与检索）。
        使用配置化的 Embedding 模型，支持主备降级。
        DashScope 限制单次最多 10 条，此处自动分批处理。
        """
        self._ensure_clients()
        emb_model = settings.EMBEDDING_MODEL_NAME
        batch_size = 10  # DashScope embedding API 限制

        async def _embed_batch(batch: List[str]) -> List[List[float]]:
            try:
                response = await self._primary_client.embeddings.create(model=emb_model, input=batch)
                return [data.embedding for data in response.data]
            except (APITimeoutError, RateLimitError, APIConnectionError) as e:
                if self._fallback_client:
                    logger.warning(f"[Embedding] 主模型异常，尝试备模型: {e}")
                    try:
                        response = await self._fallback_client.embeddings.create(model=emb_model, input=batch)
                        return [data.embedding for data in response.data]
                    except Exception as fallback_e:
                        logger.error(f"[Embedding] 备模型同样失败: {fallback_e}")
                        raise LLMServiceError("文本向量化服务异常，主备均不可用") from fallback_e
                raise LLMServiceError(f"文本向量化服务异常: {e}") from e
            except Exception as e:
                logger.error(f"[Embedding] 向量化失败: {e}")
                raise LLMServiceError("文本向量化服务异常") from e

        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            batch_embeddings = await _embed_batch(batch)
            all_embeddings.extend(batch_embeddings)
            if i + batch_size < len(texts):
                logger.debug(f"[Embedding] 已处理 {i + len(batch)}/{len(texts)} 条")

        return all_embeddings


# 导出全局单例
llm_router = LLMRouter()