import * as core from '@actions/core'
import { getIssue } from '../src/github/getIssue'

jest.mock('@actions/core')

const mockedCore = jest.mocked(core)

describe('getIssue', () => {
  let mockOctokit: { graphql: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()
    mockOctokit = {
      graphql: jest.fn()
    }
  })

  it('calls graphql with the correct issueId and projectField', async () => {
    const mockIssue: GitHubIssue = {
      id: 'node-123',
      number: '10',
      url: 'https://github.com/owner/repo/issues/10',
      title: 'Test',
      state: 'OPEN',
      updatedAt: '2024-01-01T00:00:00Z',
      repository: { name: 'repo', owner: { login: 'owner' } },
      issueFieldValues: { nodes: [] },
      projectItems: { totalCount: 0, nodes: [] },
      labels: { totalCount: 0, nodes: [] }
    }
    mockOctokit.graphql.mockResolvedValue({ node: mockIssue })

    const result = await getIssue({
      octokit: mockOctokit,
      issueId: 'node-123',
      projectField: 'Jira'
    })

    expect(mockOctokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining('query issue($issueId: ID!'),
      { issueId: 'node-123', projectField: 'Jira' }
    )
    expect(result).toEqual(mockIssue)
  })

  it('returns the node from graphql response', async () => {
    const mockNode = {
      id: 'abc',
      number: '5',
      url: 'https://github.com/o/r/issues/5',
      title: 'Another issue',
      state: 'CLOSED',
      updatedAt: '2024-06-01T00:00:00Z',
      repository: { name: 'r', owner: { login: 'o' } },
      issueFieldValues: { nodes: [] },
      projectItems: { totalCount: 0, nodes: [] },
      labels: { totalCount: 0, nodes: [] }
    }
    mockOctokit.graphql.mockResolvedValue({ node: mockNode })

    const result = await getIssue({
      octokit: mockOctokit,
      issueId: 'abc',
      projectField: 'Field'
    })

    expect(result).toEqual(mockNode)
  })

  it('queries for issue fields, project items, and labels', async () => {
    mockOctokit.graphql.mockResolvedValue({ node: {} })

    await getIssue({
      octokit: mockOctokit,
      issueId: 'id-1',
      projectField: 'Status'
    })

    const query = mockOctokit.graphql.mock.calls[0][0]
    expect(query).toContain('issueFieldValues')
    expect(query).toContain('projectItems')
    expect(query).toContain('labels')
    expect(query).toContain('repository')
  })

  it('logs error when graphql call fails', async () => {
    mockOctokit.graphql.mockRejectedValue(new Error('GraphQL error'))

    // The function catches the error internally but the response will be undefined
    // which will cause accessing .node to throw
    await expect(
      getIssue({
        octokit: mockOctokit,
        issueId: 'bad-id',
        projectField: 'Field'
      })
    ).rejects.toThrow()

    expect(mockedCore.error).toHaveBeenCalledWith('GraphQL error')
  })

  it('passes projectField variable for fieldValueByName', async () => {
    mockOctokit.graphql.mockResolvedValue({ node: {} })

    await getIssue({
      octokit: mockOctokit,
      issueId: 'id-1',
      projectField: 'MyCustomField'
    })

    expect(mockOctokit.graphql).toHaveBeenCalledWith(
      expect.stringContaining('$projectField: String!'),
      expect.objectContaining({ projectField: 'MyCustomField' })
    )
  })
})
