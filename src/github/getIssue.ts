import * as core from '@actions/core'

export const getIssue = async ({
  octokit,
  issueId,
  projectField
}: {
  octokit: any
  issueId: string
  projectField: string
}): Promise<GitHubIssue> => {
  const graphQLResponse: any = await octokit
    .graphql(
      `
    query issue($issueId: ID! $projectField: String!) {
      node(id: $issueId) {
        ... on Issue {
          id
          url
          title
          number
          state
          issueFieldValues(first: 10) {
            nodes {
              __typename
              ... on IssueFieldTextValue {
                id
                value
                field {
                  __typename
                  ... on IssueFieldText {
                    name
                  }
                }
              }					
            }
          }
          projectItems(first: 10) {
            totalCount
            nodes {
              id
              type
              project {
                title
              }
              fieldValueByName(name: $projectField) {
                ... on ProjectV2ItemFieldTextValue {
                  text
                }
              }
            }
          }
          labels(first: 20) {
            totalCount
            nodes {
              name
            }
          }
          repository {
            name
            owner {
              login
            }
          }
        }
      }
    }    
    `,
      { issueId: issueId, projectField: projectField }
    )
    .catch((error: Error) => {
      core.error(error.message)
    })

  return graphQLResponse.node
}

export default getIssue
