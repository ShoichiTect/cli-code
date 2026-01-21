use crate::config::Config;
use regex::Regex;
use std::process::Command;
use std::time::Duration;
use wait_timeout::ChildExt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyResult {
    Auto,
    Ask,
    Deny,
}

const BASH_TIMEOUT: Duration = Duration::from_secs(30);

const DANGEROUS_FILE_PATTERNS: &[&str] = &[
    r"\.env$",
    r"\.env\.",
    r"\.dev\.vars$",
    r"credentials",
    r"secret",
    r"\.pem$",
    r"\.key$",
    r"id_rsa",
    r"id_ed25519",
    r"package-lock\.json$",
    r"yarn\.lock$",
    r"pnpm-lock\.yaml$",
    r"\.DS_Store$",
    r"node_modules",
];

const BUILTIN_DENY_PATTERNS: &[&str] = &[
    r"rm\s+(-[rf]+\s+)*\/",
    r"rm\s+-rf?\s+\*",
    r"rm\s+-rf?\s+\.\*",
    r"mkfs",
    r"dd\s+if=.*of=\/dev",
    r">\s*\/dev\/sd",
    r"gcloud\s+.*delete",
    r"gcloud\s+.*destroy",
    r"aws\s+.*delete",
    r"aws\s+.*terminate",
    r"kubectl\s+delete",
    r":\(\)\s*\{.*\|.*&.*\}",
    r"chmod\s+-R\s+777\s+\/",
    r"chown\s+-R.*\/",
    r"curl.*\|\s*(ba)?sh",
    r"wget.*\|\s*(ba)?sh",
    r"ls\s+-[^\s]*R",
    r"ls\s+-R",
    r"sed\s.*-i",
];

const BUILTIN_AUTO_COMMANDS: &[&str] = &[
    "ls",
    "ls -la",
    "ls -l",
    "ls -a",
    "pwd",
    "whoami",
    "date",
    "which",
    "cat",
    "head",
    "tail",
    "less",
    "more",
    "wc",
    "file",
    "stat",
    "tree",
    "find",
    "fd",
    "grep",
    "rg",
    "sed -n",
    "git status",
    "git diff",
    "git log",
    "git branch",
];

pub fn check_policy(command: &str, config: &Config) -> PolicyResult {
    let cmd = command.trim();

    let mut deny_patterns: Vec<Regex> = BUILTIN_DENY_PATTERNS
        .iter()
        .filter_map(|pattern| Regex::new(pattern).ok())
        .collect();
    for pattern in &config.policy.deny_patterns {
        if let Ok(re) = Regex::new(pattern) {
            deny_patterns.push(re);
        }
    }

    for pattern in deny_patterns {
        if pattern.is_match(cmd) {
            return PolicyResult::Deny;
        }
    }

    let args = cmd
        .split_whitespace()
        .skip(1)
        .collect::<Vec<_>>()
        .join(" ");
    for pattern in DANGEROUS_FILE_PATTERNS {
        if let Ok(re) = Regex::new(pattern) {
            if re.is_match(&args) {
                return PolicyResult::Deny;
            }
        }
    }

    let force_ask = Regex::new(r"[|;&`$()]").unwrap();
    if force_ask.is_match(cmd) {
        return PolicyResult::Ask;
    }

    let mut auto_commands: Vec<String> = BUILTIN_AUTO_COMMANDS
        .iter()
        .map(|value| value.to_string())
        .collect();
    auto_commands.extend(config.policy.auto_commands.iter().cloned());

    for auto_cmd in auto_commands {
        if cmd == auto_cmd || cmd.starts_with(&(auto_cmd + " ")) {
            return PolicyResult::Auto;
        }
    }

    if config.policy.default_action == "deny" {
        PolicyResult::Deny
    } else {
        PolicyResult::Ask
    }
}

#[derive(Clone, Debug)]
pub struct BashResult {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

pub fn format_command_result(command: &str, result: &BashResult) -> String {
    let mut content = format!("[command] {}", command);
    if !result.stdout.trim().is_empty() {
        content.push_str("\n[stdout]\n");
        content.push_str(result.stdout.trim_end());
    }
    if !result.stderr.trim().is_empty() {
        content.push_str("\n[stderr]\n");
        content.push_str(result.stderr.trim_end());
    }
    if result.code != 0 {
        content.push_str(&format!("\n[exit_code] {}", result.code));
    }
    content
}

pub fn run_bash(command: &str, workspace_root: &str) -> BashResult {
    let mut cmd = Command::new("bash");
    cmd.arg("-c")
        .arg(command)
        .current_dir(workspace_root)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            return BashResult {
                stdout: String::new(),
                stderr: format!("Failed to spawn bash: {}", err),
                code: 1,
            };
        }
    };

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();

    let stdout_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut out) = stdout.take() {
            let _ = std::io::Read::read_to_end(&mut out, &mut buf);
        }
        buf
    });

    let stderr_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut err) = stderr.take() {
            let _ = std::io::Read::read_to_end(&mut err, &mut buf);
        }
        buf
    });

    let mut timed_out = false;
    let code = match child.wait_timeout(BASH_TIMEOUT) {
        Ok(Some(status)) => status.code().unwrap_or(1),
        Ok(None) => {
            timed_out = true;
            let _ = child.kill();
            let _ = child.wait();
            124
        }
        Err(_) => 1,
    };

    let stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();

    let stdout = String::from_utf8_lossy(&stdout).to_string();
    let stderr = String::from_utf8_lossy(&stderr).to_string();

    if timed_out {
        return BashResult {
            stdout,
            stderr: "Command timed out (30s)".to_string(),
            code,
        };
    }

    BashResult { stdout, stderr, code }
}
