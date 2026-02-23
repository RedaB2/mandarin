"""Command evaluation: evaluate assistant response against success criteria; retry logic is in api.py."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Any, Dict, List, Optional, Tuple

from backend.services.prompt_builder import Command
from backend.services.prompt_loader import load_prompt


def execute_task_stream(
    command: Command,
    user_instructions: str,
    system: str,
    messages_before_user: List[Dict[str, str]],
    model_id: str,
    previous_feedback: Optional[str] = None,
    use_web_search: bool = False,
):
    """Execute command task and stream response.

    If previous_feedback is provided, include it in the user message for retry.
    When use_web_search is False, yields string chunks. When True, yields
    ("status", str), ("chunk", str), ("meta", list) for the API to forward.
    """
    from backend.providers import base as providers_base

    task = command.task or ""
    guidelines = command.guidelines or ""
    previous_feedback_block = ""
    if previous_feedback:
        previous_feedback_block = (
            f"Previous attempt did not meet success criteria. Evaluation feedback: {previous_feedback}\n\n"
            "Please try again, addressing the feedback.\n\n"
        )
    template = load_prompt("command_task")
    if template:
        user_content = (
            template.replace("{{PREVIOUS_FEEDBACK}}", previous_feedback_block)
            .replace("{{TASK}}", task)
            .replace("{{GUIDELINES}}", guidelines)
            .replace("{{USER_INSTRUCTIONS}}", user_instructions)
        )
    else:
        user_content = f"## Task\n\n{task}\n\n## Guidelines\n\n{guidelines}\n\n## User message\n\n{user_instructions}"
        if previous_feedback_block:
            user_content = previous_feedback_block + user_content

    messages_for_llm: List[Dict[str, Any]] = []
    if system:
        messages_for_llm.append({"role": "system", "content": system})
    messages_for_llm.extend(messages_before_user)
    messages_for_llm.append({"role": "user", "content": user_content})

    if not use_web_search:
        yield from providers_base.generate(messages_for_llm, model_id, stream=True)
        return

    # use_web_search: yield ("status", msg), then ("chunk", full_content), then ("meta", web_search_meta)
    for event in providers_base.generate_with_web_search(messages_for_llm, model_id):
        if event[0] == "status":
            yield ("status", event[1])
        elif event[0] == "result":
            full_content, web_search_meta = event[1]
            if full_content:
                yield ("chunk", full_content)
            yield ("meta", web_search_meta or [])
            return

def _get_evaluation_prompt():
    """Load evaluation prompt from prompts/command_evaluation.md; fallback to inline if missing."""
    prompt = load_prompt("command_evaluation")
    if prompt:
        return prompt
    return (
        "Task: {task}\nSuccess Criteria:\n{success_criteria}\nGuidelines:\n{guidelines}\n"
        "User Instructions:\n{user_instructions}\nAssistant Response:\n{assistant_response}\n"
        "Does this response meet all success criteria? Reply with YES or NO, then explain."
    )


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

    prompt = _get_evaluation_prompt().format(
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
