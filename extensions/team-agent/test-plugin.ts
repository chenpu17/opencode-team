import plugin from './src/index'

async function test() {
  console.log('Testing team-agent plugin...')

  // Mock client and project
  const mockClient = {} as any
  const mockProject = { id: 'test-project' } as any
  const testDir = '/Users/chenpu/workspace/claude-code/opencode-team/extensions/team-agent'

  try {
    const hooks = await plugin({ client: mockClient, project: mockProject, directory: testDir })

    console.log('✓ Plugin loaded successfully')
    console.log('Available tools:', Object.keys(hooks.tool || {}))

    // Test TeamCreate
    if (hooks.tool?.TeamCreate) {
      console.log('\nTesting TeamCreate...')
      const result = await hooks.tool.TeamCreate.execute({ max: 3, maxLines: 10000 })
      console.log('Result:', result)
    }
  } catch (error) {
    console.error('✗ Error:', error)
  }
}

test()
