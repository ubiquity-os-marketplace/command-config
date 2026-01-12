import { Buffer } from "node:buffer";
import { http, HttpResponse } from "msw";
import { db } from "./db";
import issueTemplate from "./issue-template";
/**
 * Intercepts the routes and returns a custom payload
 */
export const handlers = [
  // GitHub GraphQL (Octokit plugins and some SDK helpers may use this)
  http.post("https://api.github.com/graphql", async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      query?: string;
      operationName?: string;
      variables?: Record<string, unknown>;
    } | null;

    const query = body?.query ?? "";

    if (/mergePullRequest|enablePullRequestAutoMerge/i.test(query)) {
      const pull = db.pulls.getAll()[0];
      if (pull) {
        db.pulls.update({ where: { id: { equals: pull.id } }, data: { merged: true } });
      }

      return HttpResponse.json({
        data: {
          mergePullRequest: pull ? { pullRequest: { number: pull.number, merged: true } } : null,
          enablePullRequestAutoMerge: pull ? { pullRequest: { number: pull.number } } : null,
        },
      });
    }

    if (/rateLimit/i.test(query)) {
      return HttpResponse.json({
        data: {
          rateLimit: {
            remaining: 5000,
            used: 0,
            resetAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      });
    }

    return HttpResponse.json({ data: {} });
  }),

  // Handle LLM request
  http.post("https://ai.ubq.fi/v1/chat/completions", () => {
    return HttpResponse.json({
      choices: [
        {
          message: {
            content: "test: value",
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    });
  }),
  http.post("https://ai-ubq-fi.deno.dev/v1/chat/completions", () => {
    return HttpResponse.json({
      choices: [
        {
          message: {
            content: "test: value",
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    });
  }),
  // get org repos
  http.get("https://api.github.com/orgs/:org/repos", ({ params: { org } }: { params: { org: string } }) =>
    HttpResponse.json(db.repo.findMany({ where: { owner: { login: { equals: org } } } }))
  ),
  // get org repo issues
  http.get("https://api.github.com/repos/:owner/:repo/issues", ({ params: { owner, repo } }) =>
    HttpResponse.json(db.issue.findMany({ where: { owner: { equals: owner as string }, repo: { equals: repo as string } } }))
  ),
  // get issue
  http.get("https://api.github.com/repos/:owner/:repo/issues/:issue_number", ({ params: { owner, repo, issue_number: issueNumber } }) =>
    HttpResponse.json(
      db.issue.findFirst({ where: { owner: { equals: owner as string }, repo: { equals: repo as string }, number: { equals: Number(issueNumber) } } })
    )
  ),
  // get user
  http.get("https://api.github.com/users/:username", ({ params: { username } }) =>
    HttpResponse.json(db.users.findFirst({ where: { login: { equals: username as string } } }))
  ),
  // get repo and default branch
  http.get("https://api.github.com/repos/:owner/:repo", ({ params: { owner, repo } }: { params: { owner: string; repo: string } }) => {
    const item = db.repo.findFirst({ where: { name: { equals: repo }, owner: { login: { equals: owner } } } });
    if (!item) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json({
      ...item,
      default_branch: item.default_branch,
    });
  }),
  // Get collaborator permission level
  http.get("https://api.github.com/repos/:owner/:repo/collaborators/:username/permission", ({ params }) => {
    const user = db.users.findFirst({ where: { login: { equals: params.username as string } } });
    // Deny access to bot users
    if (user?.type === "Bot") {
      return new HttpResponse(null, { status: 404 });
    }
    // Grant write access to non-bot users
    return HttpResponse.json({ permission: "write" });
  }),
  // Check org membership
  http.get("https://api.github.com/orgs/:org/members/:username", ({ params }) => {
    const user = db.users.findFirst({ where: { login: { equals: params.username as string } } });
    // Deny access to bot users
    if (user?.type === "Bot") {
      return new HttpResponse(null, { status: 404 });
    }
    // Grant org membership to non-bot users
    return new HttpResponse(null, {
      status: 204,
      headers: {
        status: "204",
      },
    });
  }),
  // create issue
  http.post("https://api.github.com/repos/:owner/:repo/issues", () => {
    const id = db.issue.count() + 1;
    const newItem = { ...issueTemplate, id };
    db.issue.create(newItem);
    return HttpResponse.json(newItem);
  }),
  // create comment
  http.post("https://api.github.com/repos/:owner/:repo/issues/:issue_number/comments", async ({ params: { issue_number: issueNumber }, request }) => {
    const { body } = await getValue(request.body);
    const id = db.issueComments.count() + 1;
    const user =
      db.users.findFirst({
        where: {
          login: { equals: "bot-user" },
          type: { equals: "Bot" },
        },
      }) || db.users.getAll()[0];
    const newItem = { id, body, issue_number: Number(issueNumber), user };
    db.issueComments.create(newItem);
    return HttpResponse.json(newItem);
  }),
  // update comment
  http.patch("https://api.github.com/repos/:owner/:repo/issues/comments/:id", async ({ params: { issue_number: issueNumber }, request }) => {
    const { body } = await getValue(request.body);
    const id = db.issueComments.count();
    const user =
      db.users.findFirst({
        where: {
          login: { equals: "bot-user" },
          type: { equals: "Bot" },
        },
      }) || db.users.getAll()[0];
    const newItem = { id, body, issue_number: Number(issueNumber), user };
    db.issueComments.update({ where: { id: { equals: id } }, data: newItem });
    return HttpResponse.json(newItem);
  }),
  // Get git ref
  http.get("https://api.github.com/repos/:owner/:repo/git/ref/:ref*", ({ params }) => {
    const refParam = normalizePathParam(params.ref);
    const ref = db.git_refs.findFirst({
      where: {
        owner: { equals: params.owner as string },
        repo: { equals: params.repo as string },
        ref: { equals: refParam.replace("heads/", "") },
      },
    });
    return HttpResponse.json({ object: { sha: ref?.sha } });
  }),
  // Create git ref
  http.post("https://api.github.com/repos/:owner/:repo/git/refs", async ({ params, request }) => {
    const { ref, sha } = await getValue(request.body);
    const newRef = db.git_refs.create({
      id: Date.now(),
      owner: params.owner as string,
      repo: params.repo as string,
      ref: ref.replace("refs/heads/", ""),
      sha,
    });
    return HttpResponse.json(newRef);
  }),
  // Get file content
  http.get("https://api.github.com/repos/:owner/:repo/contents/:path*", ({ params, request }) => {
    const path = normalizePathParam(params.path);
    const file = db.git_files.findFirst({
      where: {
        owner: { equals: params.owner as string },
        repo: { equals: params.repo as string },
        path: { equals: path },
      },
    });
    if (!file) {
      return new HttpResponse(null, { status: 404 });
    }

    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("application/vnd.github.v3.raw") || accept.includes("application/vnd.github.raw")) {
      const decoded = Buffer.from(file.content, "base64").toString("utf-8");
      return new HttpResponse(decoded);
    }

    return HttpResponse.json({
      sha: file.sha,
      content: file.content,
      size: file.content.length,
      path,
      type: "file",
    });
  }),
  // Create or update file
  http.put("https://api.github.com/repos/:owner/:repo/contents/:path*", async ({ params, request }) => {
    const { content, sha } = await getValue(request.body);
    const path = normalizePathParam(params.path);
    const newFile = db.git_files.create({
      id: Date.now(),
      owner: params.owner as string,
      repo: params.repo as string,
      path,
      sha: sha || `${Date.now()}`,
      content,
    });
    return HttpResponse.json(newFile);
  }),
  // Create pull request
  http.post("https://api.github.com/repos/:owner/:repo/pulls", async ({ params, request }) => {
    await getValue(request.body);

    const prNumber = db.pulls.count() + 1;
    const newPull = db.pulls.create({
      id: Date.now(),
      owner: params.owner as string,
      repo: params.repo as string,
      number: prNumber,
      html_url: `https://github.com/${params.owner}/${params.repo}/pull/${prNumber}`,
      merged: false,
    });
    return HttpResponse.json(newPull);
  }),
  // Merge pull request
  http.put("https://api.github.com/repos/:owner/:repo/pulls/:pull_number/merge", ({ params }) => {
    const pullNumber = Number(params.pull_number);
    const existing = db.pulls.findFirst({
      where: {
        owner: { equals: params.owner as string },
        repo: { equals: params.repo as string },
        number: { equals: pullNumber },
      },
    });
    if (!existing) {
      return new HttpResponse(null, { status: 404 });
    }
    db.pulls.update({
      where: { id: { equals: existing.id } },
      data: { merged: true },
    });
    return HttpResponse.json({
      merged: true,
      message: "Pull Request successfully merged",
      sha: "merged-sha",
    });
  }),
];

function normalizePathParam(param: string | string[] | undefined) {
  const raw = Array.isArray(param) ? param.join("/") : param ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function getValue(body: ReadableStream<Uint8Array> | null) {
  if (body) {
    const reader = body.getReader();
    const streamResult = await reader.read();
    if (!streamResult.done) {
      const text = new TextDecoder().decode(streamResult.value);
      try {
        return JSON.parse(text);
      } catch (error) {
        console.error("Failed to parse body as JSON", error);
      }
    }
  }
}
