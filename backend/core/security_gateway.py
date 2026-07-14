# backend/core/security_gateway.py
import re
import logging
import hashlib
from typing import Optional, Dict, Tuple
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class SecurityAction(Enum):
    PASS = "PASS"  # 安全，允许通过
    BLOCK_INJECTION = "BLOCK_INJECTION"  # 检测到 Prompt 注入，拦截
    SANITIZE_PII = "SANITIZE_PII"  # 检测到 PII，已脱敏替换


@dataclass
class SecurityCheckResult:
    """安全检查结果封装"""
    action: SecurityAction
    sanitized_text: str
    pii_mapping: Dict[str, str]  # 占位符 -> 原始值映射 (仅用于审计或受控还原)
    block_reason: Optional[str] = None


class SecurityGateway:
    """
    企业级安全护栏网关。
    核心原则：所有检查均为确定性正则/规则匹配，绝不使用 LLM 进行安全判断。
    """

    # === Prompt 注入特征库 (可根据业务持续扩充) ===
    INJECTION_PATTERNS = [
        r"(?i)ignore\s+(all\s+)?previous\s+instructions",
        r"(?i)forget\s+(everything|all)\s+(above|before)",
        r"(?i)you\s+are\s+now\s+a\s+(jailbroken|unrestricted)\s+ai",
        r"(?i)system\s*:\s*new\s+role",
        r"(?i)do\s+not\s+follow\s+(the\s+)?rules",
        r"(?i)reveal\s+your\s+(system\s+)?prompt",
        r"(?i)act\s+as\s+if\s+you\s+have\s+no\s+restrictions",
    ]

    # === PII 正则表达式 (中国大陆企业常用) ===
    PII_PATTERNS = {
        "PHONE": r"(?<!\d)(?:(?:\+?86)?1[3-9]\d{9})(?!\d)",
        "ID_CARD": r"(?<!\d)(?:\d{17}[\dXx])(?!\d)",
        "EMAIL": r"(?<![a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?![a-zA-Z])",
        "BANK_CARD": r"(?<!\d)(?:62\d{14,17})(?!\d)",
    }

    def __init__(self):
        # 预编译正则，避免运行时重复编译带来的性能损耗
        self._injection_regexes = [re.compile(p) for p in self.INJECTION_PATTERNS]
        self._pii_regexes = {k: re.compile(v) for k, v in self.PII_PATTERNS.items()}
        logger.info(
            f"🛡️ SecurityGateway 初始化完成 | 注入规则: {len(self._injection_regexes)}条 | PII类型: {list(self._pii_regexes.keys())}")

    def check_prompt_injection(self, text: str) -> Tuple[bool, Optional[str]]:
        """
        检测 Prompt 注入攻击。
        Returns: (is_safe, block_reason)
        """
        for regex in self._injection_regexes:
            match = regex.search(text)
            if match:
                reason = f"命中注入规则: '{match.group()[:50]}...'"
                logger.warning(f"🚫 [SecurityGateway] Prompt注入拦截 | Reason: {reason}")
                return False, reason
        return True, None

    def sanitize_pii(self, text: str) -> Tuple[str, Dict[str, str]]:
        """
        非对称 PII 脱敏：将敏感信息替换为带类型的占位符。
        返回脱敏后文本与映射表（映射表仅供审计日志使用，严禁回传给 LLM）。
        """
        mapping: Dict[str, str] = {}
        result = text

        for pii_type, regex in self._pii_regexes.items():
            matches = list(regex.finditer(result))
            # 从后向前替换，避免索引偏移
            for match in reversed(matches):
                original = match.group()
                placeholder = f"<{pii_type}_{hashlib.md5(original.encode()).hexdigest()[:8].upper()}>"
                mapping[placeholder] = original
                result = result[:match.start()] + placeholder + result[match.end():]

        if mapping:
            logger.info(
                f"🔒 [SecurityGateway] PII脱敏完成 | 替换数量: {len(mapping)} | 类型分布: {dict((k.split('_')[0], v) for k, v in ((k, 1) for k in mapping.keys()))}")

        return result, mapping

    def inspect(self, text: str) -> SecurityCheckResult:
        """
        统一安全入口：先查注入，再脱敏 PII。
        调用方只需关心此方法，无需了解内部检查顺序。
        """
        # Step 1: 注入检测 (优先级最高，命中即阻断)
        is_safe, block_reason = self.check_prompt_injection(text)
        if not is_safe:
            return SecurityCheckResult(
                action=SecurityAction.BLOCK_INJECTION,
                sanitized_text="",
                pii_mapping={},
                block_reason=block_reason
            )

        # Step 2: PII 脱敏
        sanitized, mapping = self.sanitize_pii(text)
        action = SecurityAction.SANITIZE_PII if mapping else SecurityAction.PASS

        return SecurityCheckResult(
            action=action,
            sanitized_text=sanitized,
            pii_mapping=mapping
        )

    def restore_pii(self, text: str, mapping: Dict[str, str]) -> str:
        """
        受控还原：仅在最终输出给用户时使用，严禁在 LLM 交互链路中调用。
        """
        result = text
        for placeholder, original in mapping.items():
            result = result.replace(placeholder, original)
        return result


# 导出全局单例
security_gateway = SecurityGateway()