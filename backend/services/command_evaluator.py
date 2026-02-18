"""Command evaluation: evaluate assistant response against success criteria; retry logic is in api.py."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Any, Dict, List, Optional, Tuple

from backend.services.prompt_builder import Command


def execute_task_stream(
    command: Command,
    user_instructions: str,
    system: str,
    messages_before_user: List[Dict[str, str]],
    model_id: str,
    previous_feedback: Optional[str] = None,
):
    """Execute command task and stream response.

    If previous_feedback is provided, include it in the user message for retry.
    Yields content chunks.
    """
    from backend.providers import base as providers_base

    task = command.task or ""
    guidelines = command.guidelines or ""
    parts = []
    if previous_feedback:
        parts.append(
            f"Previous attempt did not meet success criteria. Evaluation feedback: {previous_feedback}\n\nPlease try again, addressing the feedback.\n\n"
        )
    parts.append(f"## Task\n\n{task}\n\n## Guidelines\n\n{guidelines}\n\n## User message\n\n{user_instructions}")
    user_content = "".join(parts)

    messages_for_llm: List[Dict[str, Any]] = []
    if system:
        messages_for_llm.append({"role": "system", "content": system})
    messages_for_llm.extend(messages_before_user)
    messages_for_llm.append({"role": "user", "content": user_content})

    yield from providers_base.generate(messages_for_llm, model_id, stream=True)

EVALUATION_PROMPT = """You are an evaluation agent. Review the following response to determine if it meets the success criteria while following the guidelines.

Task: {task}

Success Criteria:
{success_criteria}

Guidelines:
{guidelines}

User Instructions:
{user_instructions}

Assistant Response:
{assistant_response}

Does this response meet all success criteria while following the guidelines? Reply with YES or NO, then explain your reasoning."""


def evaluate_command_response(
    task: str,
    success_criteria: str,
    guidelines: str,
    user_instructions: str,
    assistant_response: str,
    model_id: str,
    timeout: int = 60,
) -> Tuple[bool, str]:
    """Evaluate if assistant response meets success criteria.

    Args:
        timeout: Timeout in seconds (default 60).

    Returns:
        (passed: bool, feedback: str)

    Raises:
        TimeoutError: If evaluation exceeds timeout.
    """
    from backend.providers import base as providers_base

    prompt = EVALUATION_PROMPT.format(
        task=task or "(none)",
        success_criteria=success_criteria or "(none)",
        guidelines=guidelines or "(none)",
        user_instructions=user_instructions or "(none)",
        assistant_response=assistant_response or "(none)",
    )
    messages = [{"role": "user", "content": prompt}]

    def _run():
        parts = list(providers_base.generate(messages, model_id, stream=True))
        return "".join(parts).strip()

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_run)
        try:
            raw = future.result(timeout=timeout)
        except FuturesTimeoutError:
            raise TimeoutError(f"Evaluation timed out after {timeout} seconds")

    if not raw:
        return False, "Evaluation returned no response."

    raw_upper = raw.upper()
    yes_pos = raw_upper.find("YES")
    no_pos = raw_upper.find("NO")
    if yes_pos == -1 and no_pos == -1:
        passed = False
    elif yes_pos == -1:
        passed = False
    elif no_pos == -1:
        passed = True
    else:
        passed = yes_pos < no_pos
    return passed, raw.strip()
