import chalk from 'chalk'

export const out = {
  success: (msg: string) => console.log(chalk.green('✓') + ' ' + msg),
  skip: (msg: string) => console.log(chalk.gray('–') + ' ' + msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠') + ' ' + msg),
  error: (msg: string) => console.error(chalk.red('✗') + ' ' + msg),
  info: (msg: string) => console.log(chalk.cyan('ℹ') + ' ' + msg),
  step: (msg: string) => console.log(chalk.blue('→') + ' ' + msg),
  header: (msg: string) => console.log('\n' + chalk.bold(msg)),
  blank: () => console.log(),
}
