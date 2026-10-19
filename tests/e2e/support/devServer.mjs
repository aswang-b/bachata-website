// Starts the e2e suite's own dev server (port 4322) next to any dev server
// you already have running. Astro allows a second server only in the
// foreground with --ignore-lock, and refuses that when it thinks an AI agent
// launched it (it detects agents from environment variables), so those are
// left out of the child's environment. Playwright stops this process when the
// run ends.
import { spawn } from 'node:child_process';

const AGENT_VARS = /^(AGENT|AI_AGENT|CLAUDECODE|CLAUDE_CODE_.*|CURSOR_TRACE_ID|CODEX_THREAD_ID|GEMINI_CLI|QWEN_CODE|OPENCODE.*|AIDER_API_KEY|AMP_CURRENT_THREAD_ID|AUGMENT_AGENT|ANTIGRAVITY_.*|CRUSH|REPL_ID|REPLIT_MODE)$/;
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !AGENT_VARS.test(k)));

const port = process.env.E2E_PORT ?? '4322';
const child = spawn('npx', ['astro', 'dev', '--port', port, '--host', 'localhost', '--ignore-lock'], {
  env: childEnv,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
