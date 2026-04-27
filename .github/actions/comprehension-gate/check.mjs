import fs from "fs";

// --- Helpers ---

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const str = String(value);
  if (str.includes("\n")) {
    const delim = `ghadelimiter_${name}`;
    fs.appendFileSync(outputFile, `${name}<<${delim}\n${str}\n${delim}\n`);
  } else {
    fs.appendFileSync(outputFile, `${name}=${str}\n`);
  }
}

async function githubApi(method, path, body) {
  const repo = process.env.GITHUB_REPOSITORY;
  const url = `https://api.github.com/repos/${repo}${path}`;
  const options = {
    method,
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

function parseAnswers(commentBody) {
  const body = commentBody.trim();

  // Numbered format: 1. B / Q1: B / 1) B / 1 - B
  const numbered = [...body.matchAll(/(?:Q\s*)?(\d+)[.):\-\s]+([A-Da-d])\b/gi)];
  if (numbered.length >= 3) {
    const sorted = numbered.slice(0, 3).sort((a, b) => parseInt(a[1]) - parseInt(b[1]));
    return sorted.map((m) => m[2].toUpperCase());
  }

  // Fallback: any 3 standalone letters A-D
  const letters = [...body.matchAll(/\b([A-Da-d])\b/g)];
  if (letters.length >= 3) {
    return letters.slice(0, 3).map((m) => m[1].toUpperCase());
  }

  return null;
}

function checkAnswers(questions, submitted) {
  const results = [];
  let passedCount = 0;

  for (let i = 0; i < questions.length; i++) {
    const correct = questions[i].correct.toUpperCase();
    const given = submitted[i].toUpperCase();
    const isCorrect = given === correct;
    if (isCorrect) passedCount++;
    results.push({
      id: questions[i].id,
      given,
      correct,
      passed: isCorrect,
    });
  }

  const total = questions.length;
  const passed = passedCount === total;
  const wrongIds = results.filter((r) => !r.passed).map((r) => r.id);

  let feedback;
  if (passed) {
    feedback = "All correct — comprehension gate passed.";
  } else if (passedCount === 0) {
    feedback = "All answers incorrect. Please re-read the changes and try again.";
  } else {
    const qs = wrongIds.map((id) => `Q${id}`).join(", ");
    feedback = `${qs} ${wrongIds.length === 1 ? "was" : "were"} incorrect. Please review those parts of the diff.`;
  }

  return { passed, score: `${passedCount}/${total}`, results, feedback };
}

// --- Main ---

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const comment = event.comment;
  const issue = event.issue;

  // Only process PR comments
  if (!issue?.pull_request) {
    console.log("Not a PR comment — skipping.");
    setOutput("result", "skipped");
    return;
  }

  const prNumber = issue.number;
  const commenter = comment.user.login;

  // Fetch PR to check author
  const pr = await githubApi("GET", `/pulls/${prNumber}`);

  if (commenter !== pr.user.login) {
    console.log(`Commenter ${commenter} is not PR author ${pr.user.login} — skipping.`);
    setOutput("result", "skipped");
    return;
  }

  // Find the gate comment
  let page = 1;
  let gateComment = null;
  while (true) {
    const comments = await githubApi("GET", `/issues/${prNumber}/comments?per_page=100&page=${page}`);
    if (!comments.length) break;
    const match = comments
      .filter((c) => c.user.type === "Bot" && c.body.includes("<!-- comprehension-gate:"))
      .pop();
    if (match) gateComment = match;
    if (comments.length < 100) break;
    page++;
  }

  if (!gateComment) {
    console.log("No comprehension gate comment found — skipping.");
    setOutput("result", "skipped");
    return;
  }

  // Extract answer key
  const keyMatch = gateComment.body.match(/<!-- comprehension-gate: (.+?) -->/s);
  if (!keyMatch) {
    console.log("Could not extract gate data — skipping.");
    setOutput("result", "skipped");
    return;
  }

  const gateData = JSON.parse(Buffer.from(keyMatch[1].trim(), "base64").toString());
  const questions = gateData.questions;
  const headSha = pr.head.sha;

  // Skip if questions are stale (new commits pushed after questions were generated)
  if (gateData.sha && gateData.sha !== headSha) {
    console.log(
      `Questions are for ${gateData.sha.substring(0, 7)} but HEAD is now ${headSha.substring(0, 7)} — waiting for regenerated questions.`
    );
    await githubApi("POST", `/issues/${prNumber}/comments`, {
      body: "**Comprehension Gate** — these questions are outdated. New questions will be generated for the latest push.",
    });
    setOutput("result", "skipped");
    return;
  }

  // Parse answers from comment
  const answers = parseAnswers(comment.body);

  if (!answers) {
    // Unrecognized format — post help message
    await githubApi("POST", `/issues/${prNumber}/comments`, {
      body: [
        "**Comprehension Gate** — couldn't read your answers.",
        "",
        "Please use this format:",
        "```",
        "1. A",
        "2. C",
        "3. B",
        "```",
      ].join("\n"),
    });
    setOutput("result", "skipped");
    return;
  }

  // Check answers
  const result = checkAnswers(questions, answers);

  // Post result comment
  const breakdown = result.results
    .map((r) => `Q${r.id}: ${r.passed ? "PASS" : `FAIL (you answered ${r.given})`}`)
    .join("  |  ");

  const nextSteps = result.passed
    ? "Comprehension gate passed — this PR is cleared to merge."
    : "Please re-read the flagged parts of the diff and submit a new comment with corrected answers.";

  await githubApi("POST", `/issues/${prNumber}/comments`, {
    body: [
      `## Comprehension Gate — ${result.passed ? "PASSED" : "INCORRECT"}`,
      "",
      `**Score:** ${result.score}  |  ${breakdown}`,
      "",
      nextSteps,
    ].join("\n"),
  });

  // Set commit status
  await githubApi("POST", `/statuses/${headSha}`, {
    state: result.passed ? "success" : "failure",
    description: `${result.score} — ${result.feedback}`.substring(0, 140),
    context: "Comprehension Gate",
  });
  console.log(`Set ${result.passed ? "success" : "failure"} status on ${headSha.substring(0, 7)}`);

  setOutput("result", result.passed ? "passed" : "failed");
  setOutput("score", result.score);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
