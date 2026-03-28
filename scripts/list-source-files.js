const { readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

function walkFiles(root, matcher, output = []) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(path, matcher, output);
      continue;
    }
    if (entry.isFile() && matcher(path, statSync(path))) {
      output.push(path);
    }
  }
  return output;
}

function listSourceFiles(root, directories, extensions) {
  const normalizedExtensions = new Set(extensions);
  return directories.flatMap((directory) =>
    walkFiles(join(root, directory), (filePath) => normalizedExtensions.has(filePath.slice(filePath.lastIndexOf("."))))
  );
}

module.exports = {
  listSourceFiles
};
