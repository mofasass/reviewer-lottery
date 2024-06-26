import * as core from '@actions/core'
import {Octokit} from '@octokit/rest'
import {Config} from './config'
import {IncomingWebhook} from '@slack/webhook'

export interface Pull {
  user: {login: string} | null
  number: number
  draft?: boolean
  title: string
  url: string
}
interface Env {
  repository: string
  ref: string
}

class Lottery {
  octokit: Octokit
  config: Config
  env: Env
  pr: Pull | undefined | null
  incomingWebhook: IncomingWebhook

  constructor({
    octokit,
    config,
    env,
    incomingWebhook
  }: {
    octokit: Octokit
    config: Config
    env: Env
    incomingWebhook: IncomingWebhook
  }) {
    this.octokit = octokit
    this.config = config
    this.env = {
      repository: env.repository,
      ref: env.ref
    }
    this.pr = undefined
    this.incomingWebhook = incomingWebhook
  }

  async run(): Promise<void> {
    console.log('RUNNING LOTTERY RUN FUNCTION')
    try {
      const ready = await this.isReadyToReview()
      if (ready) {
        const reviewers = await this.selectReviewers()
        reviewers.length > 0 && (await this.setReviewers(reviewers))
        reviewers.length > 0 && (await this.alertOnSlack(reviewers))
      }
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)
    }
  }

  async isReadyToReview(): Promise<boolean> {
    try {
      const pr = await this.getPR()
      return !!pr && !pr.draft
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)
      return false
    }
  }

  async setReviewers(reviewers: string[]): Promise<object> {
    const ownerAndRepo = this.getOwnerAndRepo()
    const pr = this.getPRNumber()

    return this.octokit.pulls.requestReviewers({
      ...ownerAndRepo,
      pull_number: pr,
      reviewers: reviewers.filter((r: string | undefined) => !!r)
    })
  }

  async alertOnSlack(reviewers: string[]): Promise<void> {
    const usernameToSlackMap: Record<string, string> = {}

    for (const {usernames: usernamesIncludingSlackEmail} of this.config
      .groups) {
      for (const user of usernamesIncludingSlackEmail) {
        const [username, slackEmail] = user.split(':')
        usernameToSlackMap[username] = slackEmail
      }
    }

    console.log('usernameToSlackMap', usernameToSlackMap)

    const slackUsernames = reviewers
      .map(username => `@${usernameToSlackMap[username]}`)
      .join(', ')

    this.incomingWebhook.send({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<${slackUsernames}> Has been assigned to _${this.pr?.title}_. \n\n<${this.pr?.url}|View pull request>`
          }
        }
      ]
    })
  }

  async selectReviewers(): Promise<string[]> {
    let selected: string[] = []
    const author = await this.getPRAuthor()

    try {
      for (const {
        reviewers,
        internal_reviewers: internalReviewers,
        usernames: usernamesIncludingSlackName
      } of this.config.groups) {
        const usernames = usernamesIncludingSlackName.map(
          name => name.split(':')[0]
        )
        const reviewersToRequest =
          usernames.includes(author) && internalReviewers
            ? internalReviewers
            : reviewers

        if (reviewersToRequest) {
          selected = selected.concat(
            this.pickRandom(
              usernames,
              reviewersToRequest,
              selected.concat(author)
            )
          )
        }
      }
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)
    }

    return selected
  }

  pickRandom(items: string[], n: number, ignore: string[]): string[] {
    const picks: string[] = []

    const candidates = items.filter(item => !ignore.includes(item))

    while (picks.length < n) {
      const random = Math.floor(Math.random() * candidates.length)
      const pick = candidates.splice(random, 1)[0]

      if (!picks.includes(pick)) picks.push(pick)
    }

    return picks
  }

  async getPRAuthor(): Promise<string> {
    try {
      const pr = await this.getPR()

      return pr && pr.user ? pr.user.login : ''
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)
    }

    return ''
  }

  getOwnerAndRepo(): {owner: string; repo: string} {
    const [owner, repo] = this.env.repository.split('/')

    return {owner, repo}
  }

  getPRNumber(): number {
    return Number(this.pr?.number)
  }

  async getPR(): Promise<Pull | undefined> {
    if (this.pr) return this.pr

    try {
      const {data} = await this.octokit.pulls.list({
        ...this.getOwnerAndRepo()
      })

      this.pr = data.find(({head: {ref}}) => ref === this.env.ref)

      if (!this.pr) {
        throw new Error(`PR matching ref not found: ${this.env.ref}`)
      }

      return this.pr
    } catch (error: any) {
      core.error(error)
      core.setFailed(error)

      return undefined
    }
  }
}

export const runLottery = async (
  octokit: Octokit,
  config: Config,
  incomingWebhook: IncomingWebhook,
  env = {
    repository: process.env.GITHUB_REPOSITORY || '',
    ref: process.env.GITHUB_HEAD_REF || ''
  }
): Promise<void> => {
  console.log('RUNNING LOTTERY FUNCTION')
  const lottery = new Lottery({octokit, config, env, incomingWebhook})

  await lottery.run()
}
