import chalk from 'chalk';

export class Logger {
  private verbose: boolean;
  private readonly stdout: NodeJS.WriteStream;
  private readonly stderr: NodeJS.WriteStream;

  constructor(options: {
    verbose?: boolean;
    stdout?: NodeJS.WriteStream;
    stderr?: NodeJS.WriteStream;
  }) {
    this.verbose = options.verbose ?? false;
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
  }

  info(message: string): void {
    this.stdout.write(`${chalk.blue('info')}  ${message}\n`);
  }

  success(message: string): void {
    this.stdout.write(`${chalk.green('ok')}    ${message}\n`);
  }

  error(message: string): void {
    this.stderr.write(`${chalk.red('error')} ${message}\n`);
  }

  warning(message: string): void {
    this.stdout.write(`${chalk.yellow('warn')}  ${message}\n`);
  }

  debug(message: string): void {
    if (this.verbose) {
      this.stdout.write(`${chalk.gray('debug')} ${message}\n`);
    }
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }
}
