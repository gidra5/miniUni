import { program } from "commander";
import readline from "readline";
import { stdin as input, stdout as output } from 'process';
import fsp from 'fs/promises';
import { evaluateScriptString } from './evaluate';

program
  .command('run <file>')
  .description('Run script from a file')
  .action(async (file) => {
    console.log('Starting interpreter...');
    const code = await fsp.readFile(file, 'utf-8');
    console.log('Script is read');
    console.log(await evaluateScriptString(code));
    console.log('Exiting interpreter');
  });

program
  .command('repl [file]')
  .description(
    'Run interactive task queue environment with optional initial script/module'
  )
  .action(async (file) => {
    console.log('Starting REPL...');

    // const taskQueue = new TaskQueue();
    // const context = initialContext(taskQueue);
    const context = {};
    if (file) {
      console.log('Reading initial script...');
      const code = await fsp.readFile(file, 'utf-8');
      console.log('Running initial script...');
      console.dir(await evaluateScriptString(code, context), { depth: null });
    }
    console.log('Waiting for next input...');
    const rl = readline.createInterface({ input, output, prompt: '>> ' });
    rl.prompt();

    rl.on('line', async (_line) => {
      const line = _line.trim();
      switch (line) {
        case 'exit':
          rl.close();
          break;
        default: {
          try {
            console.dir(await evaluateScriptString(line, context), {
              depth: null,
            });
          } catch (e) {
            console.error(e);
          }
          break;
        }
      }

      rl.prompt();
    }).on('close', () => {
      console.log('Have a great day!');
      process.exit(0);
    });
  });

program.parse();
