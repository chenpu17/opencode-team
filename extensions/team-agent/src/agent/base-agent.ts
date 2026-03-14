import type { createOpencodeClient, TextPart } from "@opencode-ai/sdk"
import type { Member } from "../types"
import { log, error as logError } from "../util/logger"

export abstract class BaseAgent<TInput = unknown, TOutput = unknown> {
  protected abort?: AbortSignal
  protected sessionId?: string
  private stop?: () => void

  constructor(
    protected client: ReturnType<typeof createOpencodeClient>,
    protected member: Member,
    abort?: AbortSignal,
  ) {
    this.abort = abort
    this.stop = () => {
      void this.cancel()
    }
    this.abort?.addEventListener("abort", this.stop, { once: true })
  }

  abstract execute(input: TInput): Promise<TOutput>

  async cleanup() {
    if (this.abort && this.stop) this.abort.removeEventListener("abort", this.stop)
    if (this.sessionId) {
      try {
        log('BaseAgent', 'Cleaning up session', { member: this.member.name, sessionId: this.sessionId })
        await this.client.session.delete({ path: { id: this.sessionId } })
        log('BaseAgent', 'Session cleaned up', { member: this.member.name })
      } catch (error) {
        logError('BaseAgent', 'Failed to cleanup session', { member: this.member.name, error })
      }
      this.sessionId = undefined
    }
  }

  async cancel() {
    if (!this.sessionId) return
    try {
      await (this.client as any).session?.abort?.({ sessionID: this.sessionId })
    } catch (error) {
      logError('BaseAgent', 'Failed to abort session', { member: this.member.name, error })
    }
  }

  protected async createSession() {
    this.check()
    log('BaseAgent', 'Creating session', { member: this.member.name })
    const response = await this.client.session.create({
      body: {
        title: `${this.member.name} - ${this.member.role}`,
      },
    })

    if (!response.data) {
      throw new Error('Failed to create session')
    }

    this.sessionId = response.data.id
    this.check()
    log('BaseAgent', 'Session created', { member: this.member.name, sessionId: this.sessionId })
    return this.sessionId
  }

  protected async sendContext(message: string) {
    this.check()
    if (!this.sessionId) {
      throw new Error('No active session')
    }

    await this.client.session.prompt({
      path: { id: this.sessionId },
      body: {
        noReply: true,
        parts: [{ type: 'text', text: message }],
      },
    })
    this.check()
  }

  protected async sendMessage(message: string): Promise<string> {
    this.check()
    if (!this.sessionId) {
      throw new Error('No active session')
    }

    log('BaseAgent', 'Sending message to session', { member: this.member.name, sessionId: this.sessionId })
    const response = await this.client.session.prompt({
      path: { id: this.sessionId },
      body: {
        parts: [{ type: 'text', text: message }],
      },
    })

    if (!response.data) {
      throw new Error('Failed to get response')
    }
    this.check()

    const result = response.data.parts
      .map(part => part.type === 'text' ? (part as TextPart).text : '')
      .filter(Boolean)
      .join('\n')
    log('BaseAgent', 'Received response', { member: this.member.name, responseLength: result.length })
    return result
  }

  updateStatus(status: Member['status']) {
    this.member.status = status
  }

  getStatus() {
    return this.member.status
  }

  protected check() {
    if (this.abort?.aborted) {
      throw new Error("Interrupted by user")
    }
  }
}
