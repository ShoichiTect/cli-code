/**
 * 学習用デバッグログユーティリティ
 *
 * 使い方:
 *   LEARN=1 cli  # 学習ログを有効にして実行
 *
 * メソッド:
 *   learn.log('メッセージ')     - 基本ログ (cyan)
 *   learn.value('名前', 値)     - 値の表示 (gray)
 *   learn.success('メッセージ') - 成功 (green)
 *   learn.warn('メッセージ')    - 警告 (yellow)
 *   learn.error('メッセージ')   - エラー (red)
 *   learn.divider('ラベル')     - 区切り線 (cyan)
 */
import chalk from 'chalk';

const isEnabled = (): boolean => process.env.LEARN === '1';
const PREFIX = '[LEARN]';

export const learn = {
  /** 基本ログ - 関数呼び出しや処理開始に使用 */
  log: (msg: string): void => {
    if (!isEnabled()) return;
    console.log(chalk.cyan(`${PREFIX} ${msg}`));
  },

  /** 値ログ - 変数の値を表示 */
  value: (name: string, val: unknown): void => {
    if (!isEnabled()) return;
    const formatted =
      typeof val === 'object' ? JSON.stringify(val) : String(val);
    console.log(chalk.gray(`  ${name}: ${formatted}`));
  },

  /** 成功ログ */
  success: (msg: string): void => {
    if (!isEnabled()) return;
    console.log(chalk.green(`${PREFIX} ✓ ${msg}`));
  },

  /** 警告ログ */
  warn: (msg: string): void => {
    if (!isEnabled()) return;
    console.log(chalk.yellow(`${PREFIX} ${msg}`));
  },

  /** エラーログ */
  error: (msg: string): void => {
    if (!isEnabled()) return;
    console.log(chalk.red(`${PREFIX} ⚠️ ${msg}`));
  },

  /** 区切り線 - ループの区切りなどに使用 */
  divider: (label: string): void => {
    if (!isEnabled()) return;
    console.log(chalk.cyan(`\n${PREFIX} --- ${label} ---`));
  },
};
