use std::env;
use std::path::Path;

mod config;
mod core;
mod policy_bash;
mod tools;
mod types;
mod ui;

fn main() {
    load_dotenv(Path::new(".env"));

    let debug = env::args()
        .skip(1)
        .any(|arg| arg == "-d" || arg == "--debug");

    if let Err(err) = core::main::run(core::main::MainOptions { debug }) {
        eprintln!("{}", err);
        std::process::exit(1);
    }
}

fn load_dotenv(path: &Path) {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return;
    };

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"').trim_matches('\'');
        if key.is_empty() {
            continue;
        }
        if env::var_os(key).is_none() {
            env::set_var(key, value);
        }
    }
}
