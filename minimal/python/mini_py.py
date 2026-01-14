#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path

try:
    from groq import Groq
except ModuleNotFoundError:
    print(
        "Missing dependency: groq. Install with `uv tool install .` or `pip install -r requirements.txt`.",
        file=sys.stderr,
    )
    sys.exit(1)


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


def run_bash(command: str, workspace_root: Path) -> dict[str, str | int]:
    completed = subprocess.run(
        command,
        shell=True,
        cwd=workspace_root,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
    )
    return {
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "code": completed.returncode,
    }


def prompt_approval() -> bool:
    try:
        answer = input("Run? [enter/y to run, n/esc/ctrl+c to reject] ").strip()
    except KeyboardInterrupt:
        print()
        return False
    if answer == "" or answer.lower() == "y":
        return True
    if answer.lower() == "n":
        return False
    if answer.startswith("\x1b"):
        return False
    return False


def main() -> None:
    load_env(Path(".env"))
    load_env(Path.home() / ".zshrc")

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        print("GROQ_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    model = os.environ.get("GROQ_MODEL", "moonshotai/kimi-k2-instruct")
    temperature = float(os.environ.get("GROQ_TEMPERATURE", "0.7"))
    workspace_root = Path(os.environ.get("WORKSPACE_ROOT", os.getcwd())).resolve()

    client = Groq(api_key=api_key)

    system_message = (
        "You are a helpful coding assistant.\n\n"
        "When you need to run a shell command, you must call the bash tool. "
        "Do not emit COMMAND: lines. Wait for user approval before running anything."
    )

    messages = [{"role": "system", "content": system_message}]

    tools = [
        {
            "type": "function",
            "function": {
                "name": "bash",
                "description": "Execute a shell command in the workspace. Use for ls, cat, rg, etc.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "Shell command to run.",
                        }
                    },
                    "required": ["command"],
                },
            },
        }
    ]

    print("Minimal Groq CLI. Type /exit to quit.")

    while True:
        try:
            line = input("> ").strip()
        except KeyboardInterrupt:
            print()
            break
        if not line:
            continue
        if line in ("/exit", "/quit"):
            break

        messages.append({"role": "user", "content": line})

        try:
            should_continue = True
            loop_count = 0

            while should_continue:
                loop_count += 1
                print(f"\n====={{ loop {loop_count} }}=====\n")

                response = client.chat.completions.create(
                    model=model,
                    temperature=temperature,
                    messages=messages,
                    tools=tools,
                    tool_choice="auto",
                )

                assistant = response.choices[0].message
                content = assistant.content or ""
                tool_calls = assistant.tool_calls or []

                assistant_message = {"role": "assistant", "content": content}
                if tool_calls:
                    assistant_message["tool_calls"] = tool_calls
                messages.append(assistant_message)

                if content:
                    print(content)

                if not tool_calls:
                    should_continue = False
                    break

                for call in tool_calls:
                    print("\n====={ tool execution }=====\n")
                    if call.function.name != "bash":
                        continue

                    command = ""
                    try:
                        args = json.loads(call.function.arguments or "{}")
                        command = args.get("command", "")
                    except json.JSONDecodeError:
                        command = ""

                    if not command:
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.id,
                                "content": "No command provided.",
                            }
                        )
                        continue

                    print(f"Proposed command: {command}")
                    if not prompt_approval():
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.id,
                                "content": "User rejected command.",
                            }
                        )
                        continue

                    result = run_bash(command, workspace_root)
                    if result["stdout"]:
                        print(result["stdout"].rstrip())
                    if result["stderr"]:
                        print(result["stderr"].rstrip(), file=sys.stderr)

                    tool_content = json.dumps(
                        {
                            "command": command,
                            "exitCode": result["code"],
                            "stdout": result["stdout"],
                            "stderr": result["stderr"],
                        },
                        ensure_ascii=True,
                        indent=2,
                    )

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": tool_content,
                        }
                    )
        except Exception as exc:  # noqa: BLE001
            print(f"Error: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
