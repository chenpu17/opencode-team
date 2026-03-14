export interface Team {
  id: string
  projectPath: string
  maxParallel: number
  createdAt: number
  updatedAt: number
}

export interface Run {
  id: string
  teamId: string
  requirement: string
  scopeSummary: string
  status: 'running' | 'completed' | 'error' | 'interrupted'
  phase: 'scoping' | 'planning' | 'investigating' | 'executing' | 'completed' | 'error'
  round: number
  activatedMemberIds: string[]
  moduleIds: string[]
  maxParallel: number
  ownerPid: number
  createdAt: number
  startedAt: number
  heartbeatAt: number
  completedAt?: number
  error?: string
}

export interface Member {
  id: string
  teamId: string
  role: 'pm' | 'architect' | 'engineer'
  scope: 'global' | 'module'
  name: string
  taskId?: string
  sessionId?: string
  moduleId?: string
  modulePath?: string
  memory?: string
  memoryUpdatedAt?: number
  status: 'idle' | 'working' | 'completed' | 'error'
}

export interface Module {
  id: string
  teamId: string
  path: string
  files: string[]
  lineCount: number
  ownerId?: string
  imports: string[]
  exports: string[]
  summary?: string
}

export interface Task {
  id: string
  teamId: string
  runId?: string
  kind: 'investigation' | 'execution'
  round: number
  title: string
  description: string
  moduleId?: string
  assignedTo?: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  dependencies: string[]
  stepCount?: number
  createdAt: number
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
}

export interface Step {
  id: string
  taskId: string
  teamId: string
  runId?: string
  kind: 'investigation' | 'execution'
  round: number
  title: string
  description: string
  moduleId?: string
  assignedTo?: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  dependencies: string[]
  files: string[]
  createdAt: number
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
}

export interface Plan {
  kind: 'investigation' | 'execution'
  scopeSummary: string
  tasks: Task[]
  steps: Step[]
}

export interface Finding {
  moduleId?: string
  stepId: string
  taskId: string
  summary: string
}

export interface TaskResult {
  success: boolean
  filesChanged: string[]
  message: string
  error?: string
}

export interface CreateTeamOptions {
  maxParallel?: number
  maxEngineers?: number
  maxLinesPerModule?: number
  rebuild?: boolean
  resetMemory?: boolean
}

export interface Scope {
  summary: string
  moduleIds: string[]
}
