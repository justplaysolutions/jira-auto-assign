import * as core from "@actions/core";
import * as github from "@actions/github";
import { exec } from "child_process";
import { ActionInputs, JIRA } from "./types";

import { getJIRAClient } from "./utils";

const getInputs = (): ActionInputs => {
  const JIRA_TOKEN: string = core.getInput("jira-token", { required: true });
  const GITHUB_TOKEN: string = core.getInput("github-token", {
    required: true,
  });
  const JIRA_DOMAIN: string = core.getInput("jira-domain", {
    required: true,
  });
  const ISSUE_KEY: string = core.getInput("issue-key", {
    required: true,
  });
  const USERNAME: string = core.getInput("username", {
    required: true,
  });
  const JIRA_EMAIL: string = core.getInput("jira-email", {
    required: true,
  });

  return {
    ISSUE_KEY,
    JIRA_TOKEN,
    GITHUB_TOKEN,
    USERNAME,
    JIRA_EMAIL,
    JIRA_DOMAIN: JIRA_DOMAIN.endsWith("/")
      ? JIRA_DOMAIN.replace(/\/$/, "")
      : JIRA_DOMAIN,
  };
};

async function run() {
  try {
    const inputs = getInputs();
    core.debug(`inputs: ${JSON.stringify(inputs, null, 2)}`);
    const { JIRA_TOKEN, GITHUB_TOKEN, JIRA_DOMAIN, ISSUE_KEY, USERNAME, JIRA_EMAIL } = inputs;

    const productsInFile = [
      { path: "services/app/", apps: ["app"] },
      { path: "services/recruit/", apps: ["recruit"] },
      { path: "services/superadmin/", apps: ["superadmin"] },
      { path: "services/teamadmin/", apps: ["teamadmin"] },
      { path: "services/stats-spots-advanced/", apps: ["stats-spots-advanced"] },
      { path: "services/stats-spots/", apps: ["stats-spots"] },
      { path: "linked_modules/justplay-stats/", apps: ["justplay-stats"] },
      { path: "linked_modules/justplay-video/", apps: ["justplay-video"] },
      { path: "shared_packages/justplay-common/", apps: ["teamadmin", "recruit"] },
    ];

    const diff = await new Promise<string>((resolve, reject) => {
      exec(`git diff --name-only origin/master...${github.context.sha}`, (error, stdout, stderr) => {
        if (error || stderr) {
          reject(error || new Error(stderr));
          return;
        }
        resolve(stdout);
      });
    });
    const changedFiles = diff.split(/\r?\n/).filter(Boolean);
    const apps = productsInFile.reduce<string[]>((result, product) => {
      if (changedFiles.some((file) => file.startsWith(product.path))) {
        product.apps.forEach((app) => {
          if (!result.includes(app)) result.push(app);
        });
      }
      return result;
    }, []);

    // github octokit client with given token
    const octokit = github.getOctokit(GITHUB_TOKEN);

    const username = USERNAME;
    if (!username) throw new Error("Cannot find PR owner");

    const { data: user } = await octokit.users.getByUsername({
      username,
    });

    if (!user?.name) throw new Error(`User not found: ${USERNAME} ${user?.name}`);

    const jira = getJIRAClient(JIRA_DOMAIN, JIRA_EMAIL, JIRA_TOKEN);

    const jiraUser = await jira.findUser({
      displayName: user.name,
      issueKey: ISSUE_KEY,
    });
    if (!jiraUser?.displayName)
      throw new Error(`JIRA account not found for ${user.name}`);


    const { reviewers } = await jira.getTicketDetails(ISSUE_KEY);
    if (apps.length) {
      await jira.setApps({ apps, issueKey: ISSUE_KEY });
      console.log(`JIRA apps updated: ${apps.join(", ")}`);
    }
    /* if (assignee?.name === jiraUser.displayName) {
      console.log(`${ISSUE_KEY} is already assigned to ${assignee.name}`);
      return;
    }
    await jira.assignUser({ userId: jiraUser.accountId, issueKey: ISSUE_KEY });
    console.log(`${ISSUE_KEY} assigned to ${jiraUser.displayName}`);*/
    console.log(jiraUser);
    const obj: JIRA.PartialUserObj = {};
    if (reviewers) {
      reviewers.forEach((reviewer) => obj[reviewer.accountId] = reviewer);
    }
    obj[jiraUser.accountId] = {
      self: jiraUser.self,
      accountId: jiraUser.accountId,
      accountType: jiraUser.accountType,
      displayName: jiraUser.displayName,
      avatarUrls: jiraUser.avatarUrls,
      active: jiraUser.active,
      timeZone: jiraUser.timeZone
    };
    const users = Object.values(obj);
    await jira.setReviewer({
      users,
      issueKey: ISSUE_KEY
    });
  } catch (error) {
    console.log({ error });
    core.setFailed(error.message);
    process.exit(1);
  }
}

run();
