// Build the Windows installer from an isolated staging directory.
//
// electron-builder unpacks Electron into <output>/win-unpacked.tmp and then replaces
// <output>/win-unpacked via rename. On Windows, anything holding a handle to a file
// inside that tree (editor file watchers, search indexers, antivirus, a file preview)
// makes the rename fail with EPERM/EBUSY and the copy+delete fallback fail on unlink
// of resources/default_app.asar. Staging in a fresh temp dir keeps those files out of
// watched folders; only the finished installer is copied back into release/.

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { build } = require('electron-builder');

const projectDir = path.resolve(__dirname, '..');
const finalOutput = path.join(projectDir, 'release');
const stagingOutput = path.join(
  os.tmpdir(),
  `opengrokbot-build-${process.pid}-${Date.now().toString(36)}`,
);

async function publishArtifacts() {
  const entries = await fs.readdir(stagingOutput, { withFileTypes: true });
  const artifacts = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('win-unpacked'),
    )
    .map((entry) => entry.name);

  if (artifacts.length === 0) {
    throw new Error(`electron-builder produced no artifacts in ${stagingOutput}`);
  }

  await fs.mkdir(finalOutput, { recursive: true });
  for (const name of artifacts) {
    const destination = path.join(finalOutput, name);
    await fs.copyFile(path.join(stagingOutput, name), destination);
    console.log(`artifact: ${destination}`);
  }
}

async function main() {
  try {
    await build({
      win: ['nsis'],
      projectDir,
      // CI sets CI=true, which makes electron-builder try to publish to GitHub on
      // its own. That needs a token and aborts before publishArtifacts() runs;
      // the release workflow owns publishing via `gh release create`.
      publish: 'never',
      config: { directories: { output: stagingOutput } },
    });
    await publishArtifacts();
  } finally {
    // Best effort: a leftover temp dir is harmless and must not fail the build.
    await fs.rm(stagingOutput, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
