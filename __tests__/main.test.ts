import * as core from '@actions/core'
import * as github from '@actions/github'
import { run } from '../src/main'

// Mock dependencies
jest.mock('@actions/core')
jest.mock('@actions/github')
jest.mock('jira-client')

// Import jira-client after mocking
import JiraApi from 'jira-client'

const mockedCore = jest.mocked(core)
const mockedGithub = jest.mocked(github)

// Helper to set up core.getInput mock
function mockInputs(overrides: Record<string, string> = {}): void {
  const defaults: Record<string, string> = {
    token: 'gh-token-123',
    github_issue_id: '',
    github_project_field: 'Jira',
    github_label_prefix: 'jira:',
    github_issue_field: 'Jira Key',
    jira_issue_keys: '',
    jira_server_protocol: 'https',
    jira_server_host: 'jira.example.com',
    jira_server_username: 'user',
    jira_server_password: 'pass',
    jira_server_api_version: '2',
    jira_server_strict_ssl: 'true',
    jira_intermediate_path: '',
    jira_link_relationship: 'is tracked by',
    jira_link_status_in_title: 'true',
    jira_link_icon_prefix: 'https://github.com/favicon.ico',
    jira_link_icon_closed: 'https://example.com/closed.png',
    jira_link_icon_open: 'https://example.com/open.png'
  }
  const merged = { ...defaults, ...overrides }
  mockedCore.getInput.mockImplementation((name: string) => merged[name] || '')
}

// Helper to create a mock GitHub issue
function createMockGitHubIssue(
  overrides: Partial<GitHubIssue> = {}
): GitHubIssue {
  return {
    id: 'issue-node-id',
    number: '42',
    url: 'https://github.com/owner/repo/issues/42',
    title: 'Test Issue',
    state: 'OPEN',
    updatedAt: '2024-01-01T00:00:00Z',
    repository: {
      name: 'repo',
      owner: { login: 'owner' }
    },
    issueFieldValues: { nodes: [] },
    projectItems: { totalCount: 0, nodes: [] },
    labels: { totalCount: 0, nodes: [] },
    ...overrides
  }
}

// Helper to set up GitHub context and octokit mocks
function setupGitHubMocks(issuePayload: GitHubIssue): {
  graphql: jest.Mock
} {
  const graphqlMock = jest.fn().mockResolvedValue({ node: issuePayload })
  const octokitMock = {
    rest: {
      users: {
        getAuthenticated: jest
          .fn()
          .mockResolvedValue({ data: { login: 'bot-user' } })
      }
    },
    graphql: graphqlMock
  }
  ;(mockedGithub.getOctokit as jest.Mock).mockReturnValue(octokitMock)
  return { graphql: graphqlMock }
}

describe('run', () => {
  let mockJiraInstance: {
    getCurrentUser: jest.Mock
    getIssue: jest.Mock
    createRemoteLink: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Default GitHub context with issue payload
    Object.defineProperty(mockedGithub, 'context', {
      value: {
        payload: {
          issue: { node_id: 'payload-issue-node-id' },
          pull_request: undefined
        }
      },
      writable: true
    })

    // Default Jira mock
    mockJiraInstance = {
      getCurrentUser: jest
        .fn()
        .mockResolvedValue({ name: 'jira-user' } as JiraUser),
      getIssue: jest.fn().mockResolvedValue({ key: 'PROJ-123' }),
      createRemoteLink: jest.fn().mockResolvedValue({ id: 1 })
    }
    ;(JiraApi as unknown as jest.Mock).mockImplementation(
      () => mockJiraInstance
    )

    // Default core.group just calls the function
    mockedCore.group.mockImplementation(
      async <T>(_name: string, fn: () => Promise<T>): Promise<T> => {
        return await fn()
      }
    )
  })

  describe('GitHub authentication', () => {
    it('authenticates to GitHub with the provided token', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-123' })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)

      await run()

      expect(mockedGithub.getOctokit).toHaveBeenCalledWith('gh-token-123')
      expect(mockedCore.info).toHaveBeenCalledWith(
        'Successfully authenticated to GitHub as: bot-user'
      )
    })
  })

  describe('issue resolution', () => {
    it('uses github_issue_id input when provided', async () => {
      mockInputs({
        github_issue_id: 'custom-issue-id',
        jira_issue_keys: 'PROJ-123'
      })
      const issue = createMockGitHubIssue()
      const { graphql } = setupGitHubMocks(issue)

      await run()

      expect(graphql).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ issueId: 'custom-issue-id' })
      )
    })

    it('uses payload issue node_id when github_issue_id is empty', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-123' })
      const issue = createMockGitHubIssue()
      const { graphql } = setupGitHubMocks(issue)

      await run()

      expect(graphql).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ issueId: 'payload-issue-node-id' })
      )
    })

    it('uses pull_request payload when issue payload is absent', async () => {
      Object.defineProperty(mockedGithub, 'context', {
        value: {
          payload: {
            issue: undefined,
            pull_request: { node_id: 'pr-node-id' }
          }
        },
        writable: true
      })
      mockInputs({ jira_issue_keys: 'PROJ-123' })
      const issue = createMockGitHubIssue()
      const { graphql } = setupGitHubMocks(issue)

      await run()

      expect(graphql).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ issueId: 'pr-node-id' })
      )
    })
  })

  describe('Jira key extraction', () => {
    it('extracts Jira keys from input', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-123, PROJ-456' })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.getIssue).toHaveBeenCalledWith('PROJ-123')
      expect(mockJiraInstance.getIssue).toHaveBeenCalledWith('PROJ-456')
    })

    it('extracts Jira keys from labels with prefix', async () => {
      mockInputs({ github_label_prefix: 'jira:' })
      const issue = createMockGitHubIssue({
        labels: {
          totalCount: 2,
          nodes: [{ name: 'jira:PROJ-789' }, { name: 'bug' }]
        }
      })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.getIssue).toHaveBeenCalledWith('PROJ-789')
    })

    it('extracts Jira keys from project items', async () => {
      mockInputs({ github_project_field: 'Jira' })
      const issue = createMockGitHubIssue({
        projectItems: {
          totalCount: 1,
          nodes: [
            {
              id: 'item-1',
              type: 'ISSUE',
              project: { title: 'My Project' },
              fieldValueByName: { text: 'PROJ-100, PROJ-200' }
            }
          ]
        }
      })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.getIssue).toHaveBeenCalledWith('PROJ-100')
      expect(mockJiraInstance.getIssue).toHaveBeenCalledWith('PROJ-200')
    })

    it('skips project items with null fieldValueByName', async () => {
      const issue = createMockGitHubIssue({
        projectItems: {
          totalCount: 1,
          nodes: [
            {
              id: 'item-1',
              type: 'ISSUE',
              project: { title: 'My Project' },
              fieldValueByName: null as unknown as { text: string }
            }
          ]
        }
      })
      mockInputs({ jira_issue_keys: 'PROJ-999' })
      setupGitHubMocks(issue)

      await run()

      // Should still process the input keys without error
      expect(mockJiraInstance.getIssue).toHaveBeenCalledWith('PROJ-999')
    })

    it('extracts Jira keys from issue fields', async () => {
      mockInputs({ github_issue_field: 'Jira Key' })
      const issue = createMockGitHubIssue({
        issueFieldValues: {
          nodes: [
            {
              __typename: 'IssueFieldTextValue',
              id: 'field-1',
              value: 'PROJ-300, PROJ-400',
              field: { __typename: 'IssueFieldText', name: 'Jira Key' }
            }
          ]
        }
      })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.getIssue).toHaveBeenCalledWith('PROJ-300')
      expect(mockJiraInstance.getIssue).toHaveBeenCalledWith('PROJ-400')
    })

    it('ignores issue fields with wrong typename', async () => {
      mockInputs({ github_issue_field: 'Jira Key', jira_issue_keys: 'KEY-1' })
      const issue = createMockGitHubIssue({
        issueFieldValues: {
          nodes: [
            {
              __typename: 'IssueFieldNumberValue',
              id: 'field-1',
              value: 'PROJ-SKIP',
              field: { __typename: 'IssueFieldText', name: 'Jira Key' }
            }
          ]
        }
      })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.getIssue).not.toHaveBeenCalledWith('PROJ-SKIP')
    })

    it('ignores issue fields with wrong field name', async () => {
      mockInputs({ github_issue_field: 'Jira Key', jira_issue_keys: 'KEY-1' })
      const issue = createMockGitHubIssue({
        issueFieldValues: {
          nodes: [
            {
              __typename: 'IssueFieldTextValue',
              id: 'field-1',
              value: 'PROJ-SKIP',
              field: { __typename: 'IssueFieldText', name: 'Other Field' }
            }
          ]
        }
      })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.getIssue).not.toHaveBeenCalledWith('PROJ-SKIP')
    })

    it('ignores issue fields with null value', async () => {
      mockInputs({ github_issue_field: 'Jira Key', jira_issue_keys: 'KEY-1' })
      const issue = createMockGitHubIssue({
        issueFieldValues: {
          nodes: [
            {
              __typename: 'IssueFieldTextValue',
              id: 'field-1',
              value: null as unknown as string,
              field: { __typename: 'IssueFieldText', name: 'Jira Key' }
            }
          ]
        }
      })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.getIssue).not.toHaveBeenCalledWith(null)
    })

    it('deduplicates Jira keys', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-123, PROJ-123' })
      const issue = createMockGitHubIssue({
        labels: {
          totalCount: 1,
          nodes: [{ name: 'jira:PROJ-123' }]
        }
      })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.getIssue).toHaveBeenCalledTimes(1)
    })

    it('filters out keys shorter than 3 characters', async () => {
      mockInputs({ jira_issue_keys: 'AB, PROJ-123' })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.getIssue).toHaveBeenCalledTimes(1)
      expect(mockJiraInstance.getIssue).toHaveBeenCalledWith('PROJ-123')
    })
  })

  describe('no Jira keys found', () => {
    it('exits early when no Jira keys are found', async () => {
      mockInputs({ jira_issue_keys: '' })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)

      await run()

      expect(mockedCore.info).toHaveBeenCalledWith(
        'No Jira keys found in the issue, skipping the remote link creation'
      )
      expect(JiraApi).not.toHaveBeenCalled()
    })
  })

  describe('Jira authentication', () => {
    it('creates Jira client with correct config', async () => {
      mockInputs({
        jira_issue_keys: 'PROJ-123',
        jira_server_protocol: 'https',
        jira_server_host: 'jira.example.com',
        jira_server_username: 'myuser',
        jira_server_password: 'mypass',
        jira_server_api_version: '2',
        jira_server_strict_ssl: 'true',
        jira_intermediate_path: '/custom'
      })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)

      await run()

      expect(JiraApi).toHaveBeenCalledWith({
        protocol: 'https',
        host: 'jira.example.com',
        username: 'myuser',
        password: 'mypass',
        apiVersion: '2',
        strictSSL: true,
        intermediatePath: '/custom'
      })
    })

    it('sets strictSSL to false when input is not true', async () => {
      mockInputs({
        jira_issue_keys: 'PROJ-123',
        jira_server_strict_ssl: 'false'
      })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)

      await run()

      expect(JiraApi).toHaveBeenCalledWith(
        expect.objectContaining({ strictSSL: false })
      )
    })

    it('logs success when authenticated to Jira', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-123' })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)

      await run()

      expect(mockedCore.info).toHaveBeenCalledWith(
        'Successfully authenticated to Jira as: jira-user'
      )
    })

    it('handles Jira authentication failure', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-123' })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)
      mockJiraInstance.getCurrentUser.mockRejectedValue(
        new Error('Auth failed')
      )

      await run()

      expect(mockedCore.error).toHaveBeenCalledWith(
        'Unable to connect to the server (credentials may be invalid)'
      )
    })
  })

  describe('remote link creation', () => {
    it('creates remote link for valid Jira issue', async () => {
      mockInputs({
        jira_issue_keys: 'PROJ-123',
        jira_link_relationship: 'is tracked by',
        jira_link_status_in_title: 'true',
        jira_link_icon_prefix: 'https://github.com/favicon.ico',
        jira_link_icon_closed: 'https://example.com/closed.png',
        jira_link_icon_open: 'https://example.com/open.png'
      })
      const issue = createMockGitHubIssue({ state: 'OPEN' })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.createRemoteLink).toHaveBeenCalledWith(
        'PROJ-123',
        expect.objectContaining({
          globalId: `system=${issue.url}`,
          application: { type: 'com.github', name: 'GitHub' },
          relationship: 'is tracked by',
          object: expect.objectContaining({
            url: issue.url,
            title: 'owner/repo#42',
            summary: 'Test Issue [OPEN]',
            status: expect.objectContaining({
              resolved: false
            })
          })
        })
      )
    })

    it('marks link as resolved for closed issues', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-123' })
      const issue = createMockGitHubIssue({ state: 'CLOSED' })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.createRemoteLink).toHaveBeenCalledWith(
        'PROJ-123',
        expect.objectContaining({
          object: expect.objectContaining({
            summary: 'Test Issue [CLOSED]',
            status: expect.objectContaining({
              resolved: true
            })
          })
        })
      )
    })

    it('omits status from title when jira_link_status_in_title is false', async () => {
      mockInputs({
        jira_issue_keys: 'PROJ-123',
        jira_link_status_in_title: 'false'
      })
      const issue = createMockGitHubIssue({ state: 'OPEN' })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.createRemoteLink).toHaveBeenCalledWith(
        'PROJ-123',
        expect.objectContaining({
          object: expect.objectContaining({
            summary: 'Test Issue'
          })
        })
      )
    })

    it('handles Jira issue not found', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-NOTFOUND' })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)
      mockJiraInstance.getIssue.mockRejectedValue(new Error('Issue not found'))

      await run()

      expect(mockedCore.notice).toHaveBeenCalledWith(
        'PROJ-NOTFOUND - Issue not found'
      )
      expect(mockJiraInstance.createRemoteLink).not.toHaveBeenCalled()
    })

    it('handles createRemoteLink returning undefined', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-123' })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)
      mockJiraInstance.createRemoteLink.mockResolvedValue(undefined)

      await run()

      expect(mockedCore.notice).toHaveBeenCalledWith(
        'PROJ-123 - Unable to create remote link'
      )
    })

    it('processes multiple Jira keys', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-1, PROJ-2, PROJ-3' })
      const issue = createMockGitHubIssue()
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.getIssue).toHaveBeenCalledTimes(3)
      expect(mockJiraInstance.createRemoteLink).toHaveBeenCalledTimes(3)
    })
  })

  describe('error handling', () => {
    it('fails the workflow when an unexpected error occurs', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-123' })
      ;(mockedGithub.getOctokit as jest.Mock).mockImplementation(() => {
        throw new Error('Unexpected error')
      })

      await run()

      expect(mockedCore.setFailed).toHaveBeenCalledWith('Unexpected error')
    })

    it('handles non-Error exceptions gracefully', async () => {
      mockInputs({ jira_issue_keys: 'PROJ-123' })
      ;(mockedGithub.getOctokit as jest.Mock).mockImplementation(() => {
        throw 'string-error'
      })

      await run()

      // Should not call setFailed since it's not an Error instance
      expect(mockedCore.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('icon URLs', () => {
    it('uses open icon URL for open issues', async () => {
      mockInputs({
        jira_issue_keys: 'PROJ-123',
        jira_link_icon_open: 'https://example.com/open.png'
      })
      const issue = createMockGitHubIssue({ state: 'OPEN' })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.createRemoteLink).toHaveBeenCalledWith(
        'PROJ-123',
        expect.objectContaining({
          object: expect.objectContaining({
            status: expect.objectContaining({
              icon: expect.objectContaining({
                url16x16: 'https://example.com/open.png',
                title: 'Issue Open'
              })
            })
          })
        })
      )
    })

    it('uses closed icon URL for closed issues', async () => {
      mockInputs({
        jira_issue_keys: 'PROJ-123',
        jira_link_icon_closed: 'https://example.com/closed.png'
      })
      const issue = createMockGitHubIssue({ state: 'CLOSED' })
      setupGitHubMocks(issue)

      await run()

      expect(mockJiraInstance.createRemoteLink).toHaveBeenCalledWith(
        'PROJ-123',
        expect.objectContaining({
          object: expect.objectContaining({
            status: expect.objectContaining({
              icon: expect.objectContaining({
                url16x16: 'https://example.com/closed.png',
                title: 'Issue Closed'
              })
            })
          })
        })
      )
    })
  })
})
