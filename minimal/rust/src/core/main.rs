use crate::config::{ensure_minimal_dir, load_config, load_system_prompt, skills_dir};
use crate::core::agent::{Agent, AgentCallbacks, AgentOptions};
use crate::policy_bash::{format_command_result, run_bash};
use crate::ui;
use std::io::{self, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

pub struct MainOptions {
    pub debug: bool,
}

pub fn run(options: MainOptions) -> Result<(), String> {
    let debug = options.debug;

    let debug_log = move |label: &str, data: serde_json::Value| {
        if !debug {
            return;
        }
        println!("{}", ui::magenta(&format!("[DEBUG] {}", label)));
        let payload = serde_json::to_string_pretty(&data).unwrap_or_else(|_| data.to_string());
        println!("{}", ui::magenta(&payload));
    };

    if let Err(err) = ensure_minimal_dir() {
        println!("{}", ui::red("Error: ~/.minimal directory not found."));
        println!("{}", ui::gray("Run the following to initialize:"));
        println!("{}", ui::gray("  mkdir -p ~/.minimal/skills"));
        println!("{}", ui::gray("  echo \"You are a helpful coding assistant.\" > ~/.minimal/system.md"));
        return Err(err);
    }

    let config = load_config().map_err(|err| ui::red(&format!("Error: {}", err)))?;
    let system_prompt = match load_system_prompt() {
        Ok(prompt) => prompt,
        Err(err) => {
            println!("{}", ui::red("Error: ~/.minimal/system.md not found or empty."));
            println!("{}", ui::gray("Run: mkdir -p ~/.minimal && touch ~/.minimal/system.md"));
            return Err(err);
        }
    };

    let workspace_root_raw = std::env::var("WORKSPACE_ROOT")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| std::env::current_dir().unwrap().to_string_lossy().to_string());
    let workspace_root = std::path::Path::new(&workspace_root_raw)
        .canonicalize()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or(workspace_root_raw);

    let (sig_tx, sig_rx) = mpsc::channel();
    let sig_rx = Arc::new(Mutex::new(sig_rx));
    let _ = ctrlc::set_handler(move || {
        let _ = sig_tx.send(());
    });

    let sig_rx_for_approval = Arc::clone(&sig_rx);
    let prompt_approval = move |command: &str| -> Result<bool, String> {
        println!("");
        println!("{}", ui::yellow("Command:"));
        println!("{}", ui::bold(&format!("  {}", command)));
        println!("");
        println!("{}", ui::gray("  [enter/y] Run"));
        println!("{}", ui::gray("  [n]       Reject"));
        println!("{}", ui::gray("  [ctrl+c]  Cancel"));
        println!("");

        let prompt = ui::cyan("> ");
        let (line, cancelled) = read_line(&prompt, &sig_rx_for_approval)?;
        if cancelled {
            println!("{}", ui::yellow("\nCancelled"));
            return Ok(false);
        }

        let answer = line.trim().to_lowercase();
        if answer.is_empty() || answer == "y" {
            println!("{}", ui::green("OK Running..."));
            return Ok(true);
        }
        println!("{}", ui::yellow("Rejected"));
        Ok(false)
    };

    let mut agent = Agent::new(AgentOptions {
        config: config.clone(),
        system_prompt,
        workspace_root: workspace_root.clone(),
        debug,
        callbacks: AgentCallbacks {
            prompt_approval: Box::new(prompt_approval),
            on_auto_approved: Some(Box::new(|command| {
                println!("{}", ui::green(&format!("OK {}", command)));
            })),
            on_denied: Some(Box::new(|command| {
                println!("");
                println!("{}", ui::bold(&ui::red("X Denied by policy:")));
                println!("{}", ui::gray(&format!("  {}", command)));
                println!("");
            })),
            on_debug_log: Some(Box::new(debug_log)),
        },
    })
    .map_err(|err| ui::red(&format!("Error: {}", err)))?;

    println!(
        "{}{}",
        ui::bold("Minimal Agent"),
        ui::gray(&format!(" ({})", agent.get_model()))
    );
    if debug {
        println!("{}", ui::magenta("[DEBUG MODE ENABLED]"));
    }
    println!("{}", ui::gray("Type /help for commands, /exit to quit."));
    println!("");

    let mut buffered_shell_output = String::new();

    loop {
        let tokens = agent.get_tokens();
        if tokens.total > 0 {
            println!("{}", ui::gray(&format!("[session] {} tokens", tokens.total)));
        }

        let prompt = ui::cyan("> ");
        let (line, cancelled) = read_line(&prompt, &sig_rx)?;
        if cancelled {
            return Ok(());
        }

        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        if let Some(command) = line.strip_prefix('!') {
            let command = command.trim();
            if command.is_empty() {
                continue;
            }
            let result = run_bash(command, &workspace_root);
            if !result.stdout.trim().is_empty() {
                println!("{}", result.stdout.trim_end());
            }
            if !result.stderr.trim().is_empty() {
                if result.code != 0 {
                    println!("{}", ui::red(result.stderr.trim_end()));
                } else {
                    println!("{}", result.stderr.trim_end());
                }
            }

            let formatted = format_command_result(command, &result);
            if buffered_shell_output.is_empty() {
                buffered_shell_output = formatted;
            } else {
                buffered_shell_output = format!("{}\n\n{}", buffered_shell_output, formatted);
            }
            continue;
        }

        if line.starts_with('/') {
            let should_continue = handle_slash_command(
                &line,
                &mut agent,
                &mut buffered_shell_output,
                &sig_rx,
            )?;
            if !should_continue {
                break;
            }
            continue;
        }

        let mut user_content = line.clone();
        if !buffered_shell_output.is_empty() {
            user_content = format!("{}\n\n{}", buffered_shell_output, line);
            buffered_shell_output.clear();
        }

        agent.add_user_message(user_content);
        if let Err(err) = agent.run_agent_turn() {
            println!("{}", ui::red(&format!("Error: {}", err)));
        }
    }

    Ok(())
}

fn handle_slash_command(
    line: &str,
    agent: &mut Agent,
    buffered_shell_output: &mut String,
    sig_rx: &Arc<Mutex<mpsc::Receiver<()>>>,
) -> Result<bool, String> {
    let parts: Vec<&str> = line.trim_start_matches('/').split_whitespace().collect();
    if parts.is_empty() {
        return Ok(true);
    }

    let cmd = parts[0];
    let args = parts[1..].join(" ");

    match cmd {
        "exit" | "quit" => Ok(false),
        "clear" | "new" => {
            agent.clear();
            buffered_shell_output.clear();
            println!("{}", ui::green("OK Conversation cleared."));
            Ok(true)
        }
        "help" => {
            print_help();
            Ok(true)
        }
        "skill" => {
            if args.is_empty() {
                print_skill_list(list_skills());
                return Ok(true);
            }

            let skill_content = match load_skill(&args) {
                Some(content) => content,
                None => {
                    println!("{}", ui::red(&format!("Error: Skill not found: {}", args)));
                    print_skill_list(list_skills());
                    return Ok(true);
                }
            };

            print_skill_loaded(&args, &skill_content);
            print!("{}", ui::gray("Additional input (optional): "));
            let _ = io::stdout().flush();
            let (extra, _cancelled) = read_line("", sig_rx)?;
            let extra = extra.trim().to_string();

            let mut base_content = skill_content;
            if !extra.is_empty() {
                base_content = format!("{}\n\n{}", base_content, extra);
            }

            let mut user_content = base_content;
            if !buffered_shell_output.is_empty() {
                user_content = format!("{}\n\n{}", buffered_shell_output, user_content);
                buffered_shell_output.clear();
            }

            agent.add_user_message(user_content);
            if let Err(err) = agent.run_agent_turn() {
                println!("{}", ui::red(&format!("Error: {}", err)));
            }

            Ok(true)
        }
        _ => {
            println!("{}", ui::red(&format!("Error: Unknown command: /{}", cmd)));
            print_help();
            Ok(true)
        }
    }
}

fn read_line(prompt: &str, sig_rx: &Arc<Mutex<mpsc::Receiver<()>>>) -> Result<(String, bool), String> {
    if !prompt.is_empty() {
        print!("{}", prompt);
        let _ = io::stdout().flush();
    }

    let (line_tx, line_rx) = mpsc::channel();
    let (err_tx, err_rx) = mpsc::channel();

    std::thread::spawn(move || {
        let mut input = String::new();
        match io::stdin().read_line(&mut input) {
            Ok(_) => {
                let _ = line_tx.send(input);
            }
            Err(err) => {
                let _ = err_tx.send(err.to_string());
            }
        }
    });

    loop {
        if let Ok(err) = err_rx.try_recv() {
            return Err(err);
        }
        if let Ok(line) = line_rx.recv_timeout(Duration::from_millis(50)) {
            return Ok((line, false));
        }
        if let Ok(guard) = sig_rx.lock() {
            if guard.try_recv().is_ok() {
                return Ok((String::new(), true));
            }
        }
    }
}

fn list_skills() -> Vec<String> {
    let path = skills_dir();
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut skills = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(stripped) = name.strip_suffix(".md") {
            skills.push(stripped.to_string());
        }
    }
    skills
}

fn load_skill(name: &str) -> Option<String> {
    let path = skills_dir().join(format!("{}.md", name));
    std::fs::read_to_string(path).ok()
}

fn print_help() {
    println!("");
    println!("{}", ui::bold("Commands:"));
    println!(
        "{}{}",
        ui::cyan("  /skill <name>"),
        ui::gray("   Load skill from ~/.minimal/skills/")
    );
    println!(
        "{}{}",
        ui::cyan("  /clear, /new"),
        ui::gray("    Reset conversation")
    );
    println!("{}{}", ui::cyan("  /help"), ui::gray("           Show this help"));
    println!("{}{}", ui::cyan("  /exit, /quit"), ui::gray("    Exit"));
    println!("");
    println!("{}{}", ui::cyan("  !<command>"), ui::gray("      Execute shell command directly"));
    println!("");
}

fn print_skill_list(skills: Vec<String>) {
    println!("");
    println!("{}", ui::bold("Available skills:"));
    if skills.is_empty() {
        println!("{}", ui::gray("  (none)"));
    } else {
        for (index, skill) in skills.iter().enumerate() {
            println!("{} {}", ui::cyan(&format!("  {}.", index + 1)), skill);
        }
    }
    println!("{}", ui::gray("\nUsage: /skill <name>"));
    println!("");
}

fn print_skill_loaded(name: &str, content: &str) {
    println!("{}", ui::green(&format!("OK Loaded: {}", name)));
    println!("{}", ui::gray("----------------------------------------"));
    let mut preview = content.to_string();
    if preview.len() > 200 {
        preview.truncate(200);
        preview.push_str("...");
    }
    println!("{}", ui::gray(&preview));
    println!("{}", ui::gray("----------------------------------------"));
}
