import { program } from 'commander';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import {
  evaluateEntryFile,
  compileScriptString,
  newContext,
  newCompileContext,
} from './evaluate/index.js';
import { addFile } from './files.js';

program
  .command('run <file> [args...]')
  .description('Run script from a file')
  .action(async (file, args) => {
    console.log('Starting interpreter...');

    const result = await evaluateEntryFile(file, args);
    console.dir(result, { depth: null });

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
          const compileContext = newCompileContext(fileId, file);
          const context = newContext();
          const compiled = compileScriptString(line, compileContext);
          const result = await compiled(context);
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
