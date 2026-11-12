export type Mode = { isOn: boolean; source: 'folder' | 'switch' | 'off' }

export type RoleStatus = 'running' | 'done' | 'waiting' | 'blocked' | 'idle'

export type Role = { name: string; state: string; status: RoleStatus }

export type Task = {
  id: string
  title: string
  branch?: string
  stage: number
  round?: number
  candidate?: string
  blocking?: number
  followup?: number
  roles: Role[]
}

export type Decision = {
  id: string
  kind?: string
  text: string
  meta?: string
  options: string[]
}

export type Status = {
  updatedAt?: string
  lead?: string
  paused: boolean
  limits?: { fiveHourPct?: number; weeklyPct?: number }
  decisions: Decision[]
  tasks: Task[]
}

export type StatusView = {
  file: string
  mtime: number
  data: Status | null
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-team': { mode: Shaped<Mode>; status: Shaped<StatusView> }
  }
}
