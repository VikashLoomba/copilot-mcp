import * as fs from 'fs';
import * as path from 'path';
import * as Mocha from 'mocha';

function getAllTestFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 120_000
  });

  const testFiles = getAllTestFiles(__dirname).sort((a, b) =>
    a.localeCompare(b)
  );
  for (const file of testFiles) {
    mocha.addFile(file);
  }

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} UI test(s) failed.`));
        return;
      }
      resolve();
    });
  });
}
