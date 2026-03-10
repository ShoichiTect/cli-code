import assert from "node:assert/strict";
import { cwd } from "node:process";
import test from "node:test";
import {
    buildInitialSession,
    countConversationMessages,
    createSystemPrompt,
    detectDeniedCommand,
    formatAssistantText,
    normalizeBaseUrl,
    parseCliOptions,
    parseToolArguments,
    resetSession,
    trimOutput,
} from "./main.js";

test("normalizeBaseUrl removes trailing slash", () => {
    assert.equal(normalizeBaseUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1");
});

test("parseCliOptions reads model and cwd", () => {
    const options = parseCliOptions(["--model", "gpt-test", "--cwd", ".", "--debug"], cwd());
    assert.equal(options.model, "gpt-test");
    assert.equal(options.debug, true);
});

test("parseToolArguments validates command", () => {
    const parsed = parseToolArguments('{"command":"pwd","timeoutMs":1234,"reason":"inspect cwd"}');
    assert.equal(parsed.command, "pwd");
    assert.equal(parsed.timeoutMs, 1234);
    assert.equal(parsed.reason, "inspect cwd");
});

test("detectDeniedCommand blocks destructive rm", () => {
    assert.match(detectDeniedCommand("rm -rf ~/tmp") || "", /Blocked by deny pattern/);
});

test("detectDeniedCommand allows harmless read command", () => {
    assert.equal(detectDeniedCommand("pwd"), null);
});

test("trimOutput shortens oversized output", () => {
    assert.match(trimOutput("a".repeat(20000)), /omitted/);
});

test("session reset keeps system prompt only", () => {
    const session = buildInitialSession({
        model: "gpt-4o-mini",
        apiKey: "x",
        baseUrl: "https://api.openai.com/v1",
        workingDirectory: cwd(),
        temperature: 0.2,
        maxSteps: 8,
        timeoutMs: 30000,
        debug: false,
    });
    session.messages.push({ role: "user", content: "hello" });
    assert.equal(countConversationMessages(session), 1);
    resetSession(session, cwd());
    assert.equal(countConversationMessages(session), 0);
    assert.equal(session.messages[0]?.role, "system");
});

test("formatAssistantText prefers content", () => {
    assert.equal(formatAssistantText({ role: "assistant", content: "done" }), "done");
});

test("formatAssistantText reports tool request fallback", () => {
    assert.match(
        formatAssistantText({
            role: "assistant",
            tool_calls: [{ id: "1", type: "function", function: { name: "bash", arguments: "{}" } }],
        }),
        /tool call/,
    );
});

test("createSystemPrompt includes working directory", () => {
    assert.match(createSystemPrompt("/tmp/demo"), /\/tmp\/demo/);
});
