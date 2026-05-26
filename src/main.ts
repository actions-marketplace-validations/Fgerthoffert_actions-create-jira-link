import * as core from '@actions/core'
import * as github from '@actions/github'

import { getIssue } from './github'
import JiraApi, { JsonResponse } from 'jira-client'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const inputGithubToken = core.getInput('token')
    const inputGithubIssueId = core.getInput('github_issue_id')

    const octokit = github.getOctokit(inputGithubToken)
    const {
      data: { login }
    } = await octokit.rest.users.getAuthenticated()
    core.info(`Successfully authenticated to GitHub as: ${login}`)

    const githubIssuePayload =
      github.context.payload.issue ?? github.context.payload.pull_request

    // Even though we are receiving data from the issue event
    // we're still going to rely on an API call to collect data about the issue.
    const githubIssue: GitHubIssue = await getIssue({
      octokit,
      issueId:
        inputGithubIssueId !== ''
          ? inputGithubIssueId
          : githubIssuePayload?.node_id,
      projectField: core.getInput('github_project_field')
    })

    core.info(
      `Processing GitHub issue: ${githubIssue.repository.owner.login}/${githubIssue.repository.name}#${githubIssue.number}`
    )

    core.debug(JSON.stringify(githubIssue))

    let jiraKeys: string[] = []
    // Get the list of jira keys from the input, the issue projects and the issue labels
    const inputJiraKeys = core
      .getInput('jira_issue_keys')
      .split(',')
      .map(key => key.trim())

    jiraKeys = [...jiraKeys, ...inputJiraKeys]

    const labelsJiraKeys = githubIssue.labels.nodes.reduce(
      (acc: string[], label) => {
        if (label.name.includes(core.getInput('github_label_prefix'))) {
          core.info(`Found Jira key in label: ${label.name}`)
          acc.push(label.name.replace(core.getInput('github_label_prefix'), ''))
        }
        return acc
      },
      []
    )
    jiraKeys = [...jiraKeys, ...labelsJiraKeys]

    const labelsJiraProjects = githubIssue.projectItems.nodes.reduce(
      (acc: string[], item) => {
        if (item.fieldValueByName !== null) {
          core.info(
            `Found Jira keys in project: ${item.project.title} for field: ${core.getInput('github_project_field')}`
          )
          acc = [
            ...acc,
            ...item.fieldValueByName.text.split(',').map(key => key.trim())
          ]
        }
        return acc
      },
      []
    )
    jiraKeys = [...jiraKeys, ...labelsJiraProjects]

    // Get the list of Jira keys from the issue fields
    const fieldsJiraKeys = githubIssue.issueFieldValues.nodes.reduce(
      (acc: string[], field) => {
        if (
          field.__typename === 'IssueFieldTextValue' &&
          field.field.__typename === 'IssueFieldText' &&
          field.field.name === core.getInput('github_issue_field') &&
          field.value !== null
        ) {
          core.info(`Found Jira key in issue field: ${field.field.name}`)
          acc.push(...field.value.split(',').map(key => key.trim()))
        }
        return acc
      },
      []
    )
    jiraKeys = [...jiraKeys, ...fieldsJiraKeys]

    const uniqueJiraKeys = Array.from(new Set(jiraKeys)).filter(
      k => k.length >= 3
    )
    core.debug(
      `Unique Jira keys found: ${Array.from(uniqueJiraKeys).join(', ')}`
    )

    core.info(
      `Identified a total of Jira keys: ${uniqueJiraKeys.length} (turn on debug to see the list)`
    )

    if (uniqueJiraKeys.length === 0) {
      core.info(
        `No Jira keys found in the issue, skipping the remote link creation`
      )
      return
    }

    const jira = new JiraApi({
      protocol: core.getInput('jira_server_protocol'),
      host: core.getInput('jira_server_host'),
      username: core.getInput('jira_server_username'),
      password: core.getInput('jira_server_password'),
      apiVersion: core.getInput('jira_server_api_version'),
      strictSSL: core.getInput('jira_server_strict_ssl') === 'true',
      intermediatePath: core.getInput('jira_intermediate_path')
    })
    const currentUserResponse: JsonResponse | void = await jira
      .getCurrentUser()
      .catch((error: Error) => {
        console.log(error)
        core.error(
          'Unable to connect to the server (credentials may be invalid)'
        )
      })
    if (!currentUserResponse) {
      core.error('Failed to get current user from Jira')
    }
    const currentUser: JiraUser = currentUserResponse as JiraUser
    core.info(`Successfully authenticated to Jira as: ${currentUser.name}`)

    for (const [idx, jiraKey] of uniqueJiraKeys.entries()) {
      await core.group(`Processing Jira Ticket: ${idx}`, async () => {
        core.debug(`Ticket key: ${jiraKey}`)
        const jiraIssue = await jira.getIssue(jiraKey).catch((error: Error) => {
          core.notice(`${jiraKey} - ${error.message}`)
        })
        if (jiraIssue !== undefined) {
          core.info(`Confirmed the presence of a Jira ticket in remote server`)
          // Construct remote link object
          const remoteLink: JiraRemoteLink = {
            globalId: `system=${githubIssue.url}`,
            application: {
              type: 'com.github',
              name: 'GitHub'
            },
            relationship: core.getInput('jira_link_relationship'),
            object: {
              url: githubIssue.url,
              title: `${githubIssue.repository.owner.login}/${githubIssue.repository.name}#${githubIssue.number}`,
              summary: `${githubIssue.title}${core.getInput('jira_link_status_in_title') === 'true' ? ` [${githubIssue.state}]` : ''}`,
              icon: {
                url16x16: core.getInput('jira_link_icon_prefix'),
                title: 'GitHub'
              },
              status: {
                resolved: githubIssue.state === 'CLOSED',
                icon: {
                  url16x16:
                    githubIssue.state === 'CLOSED'
                      ? core.getInput('jira_link_icon_closed')
                      : core.getInput('jira_link_icon_open'),
                  title: `Issue ${githubIssue.state === 'CLOSED' ? 'Closed' : 'Open'}`,
                  link: githubIssue.url
                }
              }
            }
          }
          const createRemoteLink = await jira.createRemoteLink(
            jiraIssue.key,
            remoteLink
          )
          if (createRemoteLink !== undefined) {
            core.info(`Remote link created/updated in the Jira ticket`)
          } else {
            core.notice(`${jiraKey} - Unable to create remote link`)
          }
        } else {
          core.info(
            `Unable to find issue, continuing with other jira tickets, if provided`
          )
        }
      })
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
