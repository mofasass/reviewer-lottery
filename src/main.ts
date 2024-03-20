import * as core from '@actions/core'
import {runLottery} from './lottery'
import {Octokit} from '@octokit/rest'
import {getConfig} from './config'
import {IncomingWebhook} from '@slack/webhook'

core.setCommandEcho(true)

async function run(): Promise<void> {
  try {
    if (!process.env.GITHUB_HEAD_REF) throw new Error('missing GITHUB_HEAD_REF')
    if (!process.env.GITHUB_REPOSITORY)
      throw new Error('missing GITHUB_REPOSITORY')
    //comes from {{secrets.GITHUB_TOKEN}}
    const token = core.getInput('repo-token', {required: true})
    const slackWebhookUrl = core.getInput('slack-webhook-url', {required: true})
    const config = getConfig()

    await runLottery(
      new Octokit({auth: token}),
      config,
      new IncomingWebhook(slackWebhookUrl)
    )
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

console.log('RUNNING MAIN FUNCTION')

run()
