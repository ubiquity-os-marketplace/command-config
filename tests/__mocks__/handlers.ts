import { http, HttpResponse } from "msw";
import { db } from "./db";
import issueTemplate from "./issue-template";
/**
 * Intercepts the routes and returns a custom payload
 */
export const handlers = [
  // Handle OpenRouter API request
  http.post("https://openrouter.ai/api/v1/chat/completions", () => {
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
  http.get("https://api.github.com/repos/:owner/:repo/git/ref/:ref", ({ params }) => {
    const ref = db.git_refs.findFirst({
      where: {
        owner: { equals: params.owner as string },
        repo: { equals: params.repo as string },
        ref: { equals: (params.ref as string).replace("heads/", "") },
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
  http.get("https://api.github.com/repos/:owner/:repo/contents/:path", ({ params }) => {
    const file = db.git_files.findFirst({
      where: {
        owner: { equals: params.owner as string },
        repo: { equals: params.repo as string },
        path: { equals: params.path as string },
      },
    });
    if (!file) {
      return new HttpResponse(null, { status: 404 });
    }

    return HttpResponse.json({
      sha: file.sha,
      content: file.content,
      size: file.content.length,
      path: params.path,
      type: "file",
    });
  }),
  // Create or update file
  http.put("https://api.github.com/repos/:owner/:repo/contents/:path", async ({ params, request }) => {
    const { content, sha } = await getValue(request.body);
    const newFile = db.git_files.create({
      id: Date.now(),
      owner: params.owner as string,
      repo: params.repo as string,
      path: params.path as string,
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
    });
    return HttpResponse.json(newPull);
  }),
];

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
