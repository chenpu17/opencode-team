export class Semaphore {
  private queue: (() => void)[] = []
  private current = 0

  constructor(private max: number) {
    if (max <= 0) throw new Error('Semaphore max must be positive')
  }

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++
      return
    }

    return new Promise(resolve => {
      this.queue.push(resolve)
    })
  }

  release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.current--
    }
  }
}
