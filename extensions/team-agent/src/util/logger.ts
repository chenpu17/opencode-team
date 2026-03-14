import { appendFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DEBUG = process.env.DEBUG_TEAM_AGENT === 'true'
const LOG_FILE = join(homedir(), '.local/share/opencode/log/team-agent.log')

function writeLog(level: string, component: string, message: string, data?: any) {
  if (!DEBUG) return
  const timestamp = new Date().toISOString()
  const dataStr = data ? ` ${JSON.stringify(data)}` : ''
  const line = `${level} ${timestamp} [${component}] ${message}${dataStr}\n`
  try {
    appendFileSync(LOG_FILE, line)
  } catch {}
}

export function log(component: string, message: string, data?: any) {
  writeLog('INFO ', component, message, data)
}

export function error(component: string, message: string, err?: any) {
  writeLog('ERROR', component, message, err)
}
