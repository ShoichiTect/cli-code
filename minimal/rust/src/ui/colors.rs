const COLOR_RESET: &str = "\u{001b}[0m";
const COLOR_BOLD: &str = "\u{001b}[1m";
const COLOR_RED: &str = "\u{001b}[31m";
const COLOR_GREEN: &str = "\u{001b}[32m";
const COLOR_YELLOW: &str = "\u{001b}[33m";
const COLOR_MAGENTA: &str = "\u{001b}[35m";
const COLOR_CYAN: &str = "\u{001b}[36m";
const COLOR_GRAY: &str = "\u{001b}[90m";

pub fn red(text: &str) -> String {
    format!("{}{}{}", COLOR_RED, text, COLOR_RESET)
}

pub fn green(text: &str) -> String {
    format!("{}{}{}", COLOR_GREEN, text, COLOR_RESET)
}

pub fn yellow(text: &str) -> String {
    format!("{}{}{}", COLOR_YELLOW, text, COLOR_RESET)
}

pub fn magenta(text: &str) -> String {
    format!("{}{}{}", COLOR_MAGENTA, text, COLOR_RESET)
}

pub fn cyan(text: &str) -> String {
    format!("{}{}{}", COLOR_CYAN, text, COLOR_RESET)
}

pub fn gray(text: &str) -> String {
    format!("{}{}{}", COLOR_GRAY, text, COLOR_RESET)
}

pub fn bold(text: &str) -> String {
    format!("{}{}{}", COLOR_BOLD, text, COLOR_RESET)
}
