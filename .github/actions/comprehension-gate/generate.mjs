import fs from "fs";

const MAX_DIFF_CHARS = 12_000;
const GEMINI_MODEL = "gemini-2.5-flash";

// --- Helpers ---

function truncateDiff(diff) {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  let truncated = diff.slice(0, MAX_DIFF_CHARS);
  const lastNewline = truncated.lastIndexOf("\n");
  if (lastNewline > MAX_DIFF_CHARS * 0.85) {
    truncated = truncated.slice(0, lastNewline);
  }
  return (
    truncated +
    `\n\n[...diff truncated: showing first ${MAX_DIFF_CHARS.toLocaleString()} of ${diff.length.toLocaleString()} characters...]`
  );
}

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (fenced) return fenced[1].trim();
  const raw = trimmed.match(/\{[\s\S]*\}/);
  if (raw) return raw[0];
  return trimmed;
}

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

// --- GitHub API helpers (using fetch with GITHUB_TOKEN) ---

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

// --- Gemini API helper ---

async function callGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const parts = data.candidates[0].content.parts;
  const textPart = parts.findLast((p) => !p.thought) ?? parts[parts.length - 1];
  return textPart.text;
}

// --- Main ---

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const pr = event.pull_request;

  if (!pr) {
    console.log("No pull_request in event payload — skipping.");
    setOutput("result", "skipped");
    return;
  }

  // Skip draft PRs
  if (pr.draft) {
    console.log("Draft PR — skipping.");
    setOutput("result", "skipped");
    return;
  }

  // Skip bot authors
  const botLogins = ["dependabot[bot]", "release-please[bot]", "github-actions[bot]"];
  if (botLogins.includes(pr.user.login) || pr.user.type === "Bot") {
    console.log(`Bot author (${pr.user.login}) — skipping.`);
    setOutput("result", "skipped");
    return;
  }

  // Skip if no API key configured
  if (!process.env.GEMINI_API_KEY) {
    console.log("GEMINI_API_KEY not set — skipping question generation.");
    setOutput("result", "skipped");
    return;
  }

  // Get the diff
  const repo = process.env.GITHUB_REPOSITORY;
  const diffRes = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${pr.number}`,
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3.diff",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!diffRes.ok) {
    throw new Error(`Failed to fetch diff: ${diffRes.status}`);
  }
  const diff = await diffRes.text();

  if (!diff.trim()) {
    console.log("Empty diff — skipping.");
    setOutput("result", "skipped");
    return;
  }

  // Generate questions via Gemini
  const systemPrompt =
    "You are a senior code reviewer generating multiple choice questions to verify developers understand their own code changes.";

  const userPrompt = `Analyze this code diff and generate exactly 3 multiple choice questions.

Requirements:
- Each question tests understanding of the actual logic, design decisions, or edge cases in the changes
- Provide exactly 4 options (A, B, C, D) per question
- Exactly one option must be clearly correct; the other three should be plausible distractors that reflect common misunderstandings
- Questions must not be answerable without understanding the code — not just re-reading the diff
- Randomize which letter (A, B, C, or D) is the correct answer for each question — do NOT default to a fixed pattern

Return ONLY valid JSON — no markdown, no explanation:
{
    "questions": [
        {
            "id": 1,
            "question": "...",
            "choices": {"A": "...", "B": "...", "C": "...", "D": "..."},
            "correct": "C"
        }
    ]
}

Code diff:
\`\`\`diff
${truncateDiff(diff)}
\`\`\``;

  const responseText = await callGemini(systemPrompt, userPrompt);

  const jsonText = extractJson(responseText);
  const questionsData = JSON.parse(jsonText);
  const questions = questionsData.questions;

  // Validate structure
  if (!Array.isArray(questions) || questions.length !== 3) {
    throw new Error(`Expected 3 questions, got ${questions?.length}`);
  }
  for (const q of questions) {
    if (!q.id || !q.question || !q.choices || !q.correct) {
      throw new Error(`Invalid question structure: ${JSON.stringify(q)}`);
    }
  }

  // Format comment body
  const qBlocks = questions
    .map((q) => {
      const choiceLines = Object.entries(q.choices)
        .map(([letter, text]) => `- **${letter})** ${text}`)
        .join("\n");
      return `**Q${q.id}.** ${q.question}\n${choiceLines}`;
    })
    .join("\n\n");

  const sha = pr.head.sha;
  const hiddenData = Buffer.from(
    JSON.stringify({
      questions,
      sha,
      generated_at: new Date().toISOString(),
    })
  ).toString("base64");

  const body = [
    "## Comprehension Gate",
    "",
    "Answer the questions below in order to merge.",
    "",
    qBlocks,
    "",
    "***",
    "",
    "**Reply in a format like this:**",
    "",
    "```",
    "1. A",
    "2. C",
    "3. B",
    "```",
    "",
    `> Questions are based on commit \`${sha.substring(0, 7)}\`. Pushing new commits regenerates the questions.`,
    "",
    `<!-- comprehension-gate: ${hiddenData} -->`,
  ].join("\n");

  // Upsert: find existing gate comment or create new
  let page = 1;
  let existing = null;
  while (true) {
    const comments = await githubApi("GET", `/issues/${pr.number}/comments?per_page=100&page=${page}`);
    if (!comments.length) break;
    const match = comments
      .filter((c) => c.user.type === "Bot" && c.body.includes("<!-- comprehension-gate:"))
      .pop();
    if (match) existing = match;
    if (comments.length < 100) break;
    page++;
  }

  if (existing) {
    await githubApi("PATCH", `/issues/comments/${existing.id}`, { body });
    console.log(`Updated gate comment #${existing.id}`);
  } else {
    await githubApi("POST", `/issues/${pr.number}/comments`, { body });
    console.log("Created new gate comment");
  }

  // Set pending commit status
  await githubApi("POST", `/statuses/${sha}`, {
    state: "pending",
    description: "Answer the 3 comprehension questions in the PR comments",
    context: "Comprehension Gate",
  });
  console.log(`Set pending status on ${sha.substring(0, 7)}`);

  setOutput("result", "generated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
