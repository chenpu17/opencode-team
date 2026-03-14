import plugin from './src/index'

async function test() {
  console.log('=== Testing Team Agent Plugin ===\n')

  // Mock client with session API
  const mockClient = {
    session: {
      create: async (opts: any) => {
        console.log('Mock: Creating session...')
        return {
          data: {
            id: `session_${Date.now()}`,
            title: opts.body?.title || 'Test Session',
          }
        }
      },
      prompt: async (opts: any) => {
        console.log('Mock: Sending prompt...')
        const message = opts.body?.parts?.[0]?.text || ''
        return {
          data: {
            info: {},
            parts: [
              {
                type: 'text',
                text: `分析结果：${message.substring(0, 50)}... 的模块存在以下问题：\n1. 代码质量需要改进\n2. 缺少错误处理\n3. 测试覆盖率不足`
              }
            ]
          }
        }
      }
    }
  } as any

  const mockProject = { id: 'test-project' } as any
  const testDir = '/Users/chenpu/workspace/claude-code/opencode-team'

  try {
    console.log('1. Loading plugin...')
    const hooks = await plugin({ client: mockClient, project: mockProject, directory: testDir })
    console.log('✓ Plugin loaded\n')

    console.log('2. Creating team...')
    const createResult = await hooks.tool!.TeamCreate.execute({ max: 3, maxLines: 10000 })
    console.log('Result:', createResult, '\n')

    console.log('3. Assigning task...')
    const assignResult = await hooks.tool!.TeamAssign.execute({
      requirement: '分析代码质量问题'
    })
    console.log('Result:', assignResult, '\n')

    console.log('4. Checking status...')
    const statusResult = await hooks.tool!.TeamStatus.execute({})
    const status = JSON.parse(statusResult)
    console.log('Status:', JSON.stringify(status, null, 2))

    if (status.tasks && status.tasks.length > 0) {
      console.log('\n=== Task Results ===')
      status.tasks.forEach((task: any, i: number) => {
        console.log(`\nTask ${i + 1}: ${task.title}`)
        console.log(`Status: ${task.status}`)
        if (task.result) {
          console.log(`Result: ${task.result.substring(0, 200)}...`)
        }
        if (task.error) {
          console.log(`Error: ${task.error}`)
        }
      })
    }

  } catch (error) {
    console.error('✗ Error:', error)
  }
}

test()
