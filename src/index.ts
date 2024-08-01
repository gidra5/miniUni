import { program } from 'commander';
import readline from 'readline';
import { stdin as input, stdout as output } from 'process';
import { evaluateScriptString, newContext } from './evaluate.js';
import { addFile, getModule, getScriptResult, isScript } from './files.js';
import { assert } from 'console';
import path from 'path';
import fs from 'fs/promises';

program
  .command('run <file>')
  .description('Run script from a file')
  .action(async (file) => {
    console.log('Starting interpreter...');

    const resolved = path.resolve(file);
    const stat = await fs.stat(resolved);
    const _path = stat.isDirectory()
      ? path.join(resolved, 'index.uni')
      : resolved;
    const module = await getModule(file, 'cli', _path);
    assert(isScript(module), 'expected script');
    console.dir(getScriptResult(module), { depth: null });

    console.log('Exiting interpreter');
  });

program
  .command('repl')
  .description('Run interactive REPL environment. Type "exit" to stop REPL.')
  .action(async () => {
    console.log('Starting REPL...');
    const file = '<repl>';

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
          const fileId = addFile(file, line);
          const context = newContext(fileId, file);
          const result = await evaluateScriptString(line, context);
          console.dir(result, { depth: null });
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
