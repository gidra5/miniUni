import { program } from 'commander';
import readline from 'readline';
import { stdin as input, stdout as output } from 'process';
import {
  evaluateScript,
  evaluateScriptString,
  newContext,
} from './evaluate.js';
import { parseFile } from './parser.js';
import { SystemError } from './error.js';

program
  .command('run <file>')
  .description('Run script from a file')
  .action(async (file) => {
    console.log('Starting interpreter...');
    const code = await parseFile(file);
    try {
      console.dir(await evaluateScript(code), { depth: null });
    } catch (e) {
      if (e instanceof SystemError) e.withFileId(code.data.fileId).print();
      else console.error(e);
    }
    console.log('Exiting interpreter');
  });

program
  .command('repl [file]')
  .description(
    'Run interactive REPL environment with optional initial script/module'
  )
  .action(async (file) => {
    console.log('Starting REPL...');

    const context = newContext();

    if (file) {
      console.log('Running initial script...');
      const code = await parseFile(file);
      console.dir(await evaluateScript(code, context), { depth: null });
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
