interface GitHubOwner {
  login: string
}

interface GitHubRepository {
  name: string
  owner: GitHubOwner
}

interface GitHubProjectItem {
  id: string
  type: string
  project: {
    title: string
  }
  fieldValueByName: {
    text?: string
  } | null
}

interface GitHubIssue {
  id: string
  number: string
  url: string
  title: string
  state: string
  updatedAt: string
  repository: GitHubRepository
  issueFieldValues: {
    nodes: {
      __typename: string
      id: string
      value: string
      field: {
        __typename: string
        name: string
      }
    }[]
  }
  projectItems: {
    totalCount: number
    nodes: GitHubProjectItem[]
  }
  labels: {
    totalCount: number
    nodes: {
      name: string
    }[]
  }
}

interface JiraUser {
  name: string
}

interface JiraIssue {
  key: string
}

interface JiraRemoteLink {
  globalId: string
  application: {
    type: string
    name: string
  }
  relationship: string
  object: {
    url: string
    title: string
    summary: string
    icon: {
      url16x16: string
      title: string
    }
    status: {
      resolved: boolean
      icon: {
        url16x16: string
        title: string
        link: string
      }
    }
  }
}
