#!/usr/bin/env node
import 'dotenv/config';
import Groq from 'groq-sdk';
import type {
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
	ChatCompletionTool,
} from 'groq-sdk/resources/chat/completions';
import {spawn} from 'node:child_process';
import readline from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import path from 'node:path';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error('GROQ_API_KEY is not set.');
  process.exit(1);
}

const model = process.env.GROQ_MODEL || 'moonshotai/kimi-k2-instruct';
const temperature = Number(process.env.GROQ_TEMPERATURE || '0.7');
const workspaceRoot = path.resolve(
	process.env.WORKSPACE_ROOT || process.cwd(),
);

const groq = new Groq({apiKey});
const rl = readline.createInterface({input, output});
let approvalAbort: AbortController | null = null;

const systemMessage = `You are a helpful coding assistant.\n\nWhen you need to run a shell command, you must call the bash tool. Do not emit COMMAND: lines. Wait for user approval before running anything.`;

const messages: ChatCompletionMessageParam[] = [
	{
		role: 'system',
		content: systemMessage,
	},
];

console.log('Minimal Groq CLI. Type /exit to quit.');

rl.on('SIGINT', () => {
	if (approvalAbort) {
		approvalAbort.abort();
		return;
	}
	rl.close();
	process.exit(0);
});

function runBash(command: string): Promise<{stdout: string; stderr: string; code: number}> {
	return new Promise(resolve => {
		const child = spawn(command, {
			shell: true,
			cwd: workspaceRoot,
			env: process.env,
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', data => {
			stdout += String(data);
		});
		child.stderr.on('data', data => {
			stderr += String(data);
		});
		child.on('close', code => {
			resolve({stdout, stderr, code: code ?? 0});
		});
	});
}

async function promptApproval(): Promise<boolean> {
	const controller = new AbortController();
	approvalAbort = controller;
	try {
		const answer = (
			await rl.question('Run? [enter/y to run, n/esc/ctrl+c to reject] ', {
				signal: controller.signal,
			})
		).trim();
		if (answer === '' || answer.toLowerCase() === 'y') {
			return true;
		}
		if (answer.toLowerCase() === 'n') {
			return false;
		}
		if (answer.startsWith('\u001b')) {
			return false;
		}
		return false;
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			return false;
		}
		throw error;
	} finally {
		approvalAbort = null;
	}
}

const tools: ChatCompletionTool[] = [
	{
		type: 'function',
		function: {
			name: 'bash',
			description:
				'Execute a shell command in the workspace. Use for ls, cat, rg, etc.',
			parameters: {
				type: 'object',
				properties: {
					command: {type: 'string', description: 'Shell command to run.'},
				},
				required: ['command'],
			},
		},
	},
];

while (true) {
	const line = (await rl.question('> ')).trim();
	if (!line) continue;
	if (line === '/exit' || line === '/quit') break;

	messages.push({role: 'user', content: line});

	try {
		let shouldContinue = true;
		let loopCount = 0;

		while (shouldContinue) {
			loopCount += 1;
			console.log(`\n====={ loop ${loopCount} }=====\n`);
			const response = await groq.chat.completions.create({
				model,
				temperature,
				messages,
				tools,
				tool_choice: 'auto',
			});

			const assistant = response.choices?.[0]?.message;
			const content = assistant?.content ?? '';
			const toolCalls: ChatCompletionMessageToolCall[] =
				assistant?.tool_calls ?? [];

			messages.push({
				role: 'assistant',
				content: content || '',
				tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
			});

			if (content) {
				console.log(content);
			}

			if (toolCalls.length === 0) {
				shouldContinue = false;
				break;
			}

			for (const call of toolCalls) {
				console.log('\n====={ tool execution }=====\n');
				if (call.function?.name !== 'bash') {
					continue;
				}

				let command = '';
				try {
					const args = JSON.parse(call.function.arguments || '{}') as {
						command?: string;
					};
					command = args.command || '';
				} catch {
					command = '';
				}

				if (!command) {
					messages.push({
						role: 'tool',
						tool_call_id: call.id,
						content: 'No command provided.',
					});
					continue;
				}

				console.log(`Proposed command: ${command}`);
				const approved = await promptApproval();
				if (!approved) {
					messages.push({
						role: 'tool',
						tool_call_id: call.id,
						content: 'User rejected command.',
					});
					continue;
				}

				const result = await runBash(command);
				if (result.stdout) {
					console.log(result.stdout.trimEnd());
				}
				if (result.stderr) {
					console.error(result.stderr.trimEnd());
				}

				const toolContent = JSON.stringify(
					{
						command,
						exitCode: result.code,
						stdout: result.stdout,
						stderr: result.stderr,
					},
					null,
					2,
				);

				messages.push({
					role: 'tool',
					tool_call_id: call.id,
					content: toolContent,
				});
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
	}
}

rl.close();
