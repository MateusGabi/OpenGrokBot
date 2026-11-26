// Options for the server child process. In the packaged app the script lives inside
// app.asar, so cwd and state paths must be a real writable directory instead.
const path = require('node:path')

function childOptions(port, stateDir, baseEnv = process.env) {
  return {
    cwd: stateDir,
    env: {
      ...baseEnv,
      PORT: String(port),
      ELECTRON_RUN_AS_NODE: '1',
      OPENGROKBOT_TEAM: path.join(stateDir, 'team.json'),
      OPENGROKBOT_DATA: path.join(stateDir, 'data'),
    },
  }
}

module.exports = { childOptions }
