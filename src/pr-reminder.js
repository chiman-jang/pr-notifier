import {WebClient} from "@slack/web-api";
import {Octokit} from "@octokit/rest";

const octokit = new Octokit({auth: process.env.GITHUB_TOKEN});
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const slackChannel = process.env.SLACK_CHANNEL_ID;
const repoInfo = {
    owner: process.env.OWNER_NAME,
    repo: process.env.REPO_NAME
}

async function sendSlackMessage(channel, message) {
    try {
        await slackClient.chat.postMessage({
            channel,
            ...message
        });
    } catch (error) {
        console.error(`Error sending message to Slack: ${error.message}`);
    }
}

async function getOpenPRs() {
    const {data: pullRequests} = await octokit.pulls.list({
        ...repoInfo,
        state: 'open'
    });

    return pullRequests;
}

async function getMergeableState(pullRequest) {
    const [owner, repo] = pullRequest.head.repo.full_name.split('/')
    const {data: detailedPR} = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pullRequest.number,
    });

    return detailedPR.mergeable_state;
}

async function formatSinglePR(pullRequest) {
    const link = pullRequest.html_url;
    const title = pullRequest.title;
    const author = pullRequest.user.login;
    const reviewers = pullRequest.requested_reviewers.map(reviewer => reviewer.login);
    const mergeableState = await getMergeableState(pullRequest)
    return `\n👉 <${link} | ${title}> | ${author} | *${reviewers.length} pending reviewers${reviewers.length > 1 ? `: ${reviewers.join(', ')}` : ''}* | ${mergeableState}`;
}

function formatSlackMessage(text, pullRequestCount) {
    return {
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `\n*${repoInfo.repo}* has ${pullRequestCount} PRs ready for review`,
                },
            },
            {
                type: 'divider',
            },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text,
                },
            },
            {
                type: 'divider',
            },
        ],
    };
}

function emptySlackMessage() {
    return {
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `\n*${repoInfo.repo}* has 0 PRs ready for review`,
                },
            }
        ],
    };
}


async function sendReminder() {
    const pullRequests = await getOpenPRs()
        .then(pullRequest => pullRequest.filter(pullRequest => !pullRequest.draft));

    if (pullRequests.length === 0) {
        await sendSlackMessage(slackChannel, emptySlackMessage());
        return;
    }

    let text = '';
    for (const pullRequest of pullRequests) {
        text += await formatSinglePR(pullRequest);
    }

    const message = formatSlackMessage(text, pullRequests.length);
    await sendSlackMessage(slackChannel, message);
}

sendReminder().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});
