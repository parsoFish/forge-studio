/**
 * R2-04-F3 (ADR-041) — typed trigger payloads: external content as DATA, never
 * prompt text.
 *
 * External payloads (webhook bodies; later, feed items) enter forge as this
 * discriminated union ONLY. Structured fields are strict-charset validated at
 * extraction; free-text fields (commit messages, release bodies) are
 * length-capped + control-char-stripped and carried VERBATIM as data — they
 * reach agents solely via the `trigger-payload.json` artifact (read-as-data),
 * never interpolated into a prompt (OWASP LLM01; the known-gaps §8
 * buildAgentPrompt rider). Prompt assembly may use only the strict-validated
 * tokens (`provider`, `event`, `repo`).
 */

export const TRIGGER_FREE_TEXT_CAP = 2000;

export type CronTriggerPayload = {
  kind: 'cron';
  schedule: string;
  firedAt: string;
};

export type WebhookPushPayload = {
  kind: 'webhook';
  provider: 'github' | 'gitea' | 'gitlab';
  event: 'push';
  repo: string;
  ref: string;
  headSha: string;
  pusherLogin: string;
  commitCount: number;
  /** Free text — capped + control-char-stripped, carried verbatim AS DATA. */
  headCommitMessage: string;
  /** True when a free-text field exceeded the cap and was truncated. */
  truncated?: boolean;
};

export type WebhookReleasePayload = {
  kind: 'webhook';
  provider: 'github' | 'gitea' | 'gitlab';
  event: 'release';
  repo: string;
  tag: string;
  releaseName: string;
  publishedAt: string;
  /** Free text — capped + control-char-stripped, carried verbatim AS DATA. */
  body: string;
  truncated?: boolean;
};

export type TriggerPayload = CronTriggerPayload | WebhookPushPayload | WebhookReleasePayload;

/** Strict-charset validators for the structured fields (extraction boundary). */
export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const GIT_REF_RE = /^[\w./+-]{1,255}$/;
const LOGIN_RE = /^[\w.-]{1,80}$/;
const TAG_RE = /^[\w./+-]{1,120}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;

export class TriggerPayloadInvalidError extends Error {}

/** Cap + strip control chars (keep \n and \t) from a free-text field. */
function freeText(raw: unknown): { text: string; truncated: boolean } {
  const s = typeof raw === 'string' ? raw : '';
  const stripped = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (stripped.length > TRIGGER_FREE_TEXT_CAP) {
    return { text: stripped.slice(0, TRIGGER_FREE_TEXT_CAP), truncated: true };
  }
  return { text: stripped, truncated: false };
}

function reqMatch(value: unknown, re: RegExp, field: string): string {
  if (typeof value !== 'string' || !re.test(value)) {
    throw new TriggerPayloadInvalidError(`webhook payload field "${field}" missing or malformed`);
  }
  return value;
}

/**
 * The `owner/repo` full name across providers: github/gitea put it at
 * `repository.full_name`; gitlab puts it at `project.path_with_namespace`
 * (its `repository` object has no full name). Falls through the known
 * locations so one extractor serves all three.
 */
function repoOf(body: Record<string, unknown>): unknown {
  const repoObj = (body['repository'] ?? {}) as Record<string, unknown>;
  const projectObj = (body['project'] ?? {}) as Record<string, unknown>;
  return (
    repoObj['full_name'] ??
    repoObj['path_with_namespace'] ??
    projectObj['path_with_namespace'] ??
    projectObj['full_name']
  );
}

/**
 * Extract the typed push payload from a verified webhook body.
 * - github/gitea: `repository.full_name`, `after`, `head_commit.message`,
 *   `pusher.name`.
 * - gitlab: the repo lives at `project.path_with_namespace` (NOT under
 *   `repository`, which gitlab keeps as a minimal legacy object), the head sha
 *   at `checkout_sha`, the pusher at `user_username`, and there is no
 *   `head_commit` (use the last `commits[]` entry). `repoOf` unifies these.
 * Throws {@link TriggerPayloadInvalidError} on any malformed structured field —
 * a verified-but-weird payload is rejected, never partially trusted.
 */
export function extractPushPayload(
  provider: 'github' | 'gitea' | 'gitlab',
  body: Record<string, unknown>,
): WebhookPushPayload {
  const repo = reqMatch(repoOf(body), REPO_RE, 'repository/project');
  const ref = reqMatch(body['ref'], GIT_REF_RE, 'ref');
  const headSha = reqMatch(body['after'] ?? body['checkout_sha'], SHA_RE, 'after');
  const pusherObj = (body['pusher'] ?? {}) as Record<string, unknown>;
  const pusherLogin = reqMatch(
    pusherObj['name'] ?? pusherObj['login'] ?? body['user_username'] ?? body['user_name'],
    LOGIN_RE,
    'pusher',
  );
  const commits = Array.isArray(body['commits']) ? (body['commits'] as unknown[]) : [];
  const headCommit = (body['head_commit'] ?? commits[commits.length - 1] ?? {}) as Record<string, unknown>;
  const msg = freeText(headCommit['message']);
  return {
    kind: 'webhook',
    provider,
    event: 'push',
    repo,
    ref,
    headSha,
    pusherLogin,
    commitCount: commits.length,
    headCommitMessage: msg.text,
    ...(msg.truncated ? { truncated: true } : {}),
  };
}

/**
 * Extract the typed release payload from a verified webhook body.
 * - github/gitea: the fields live under a `release` object
 *   (`release.tag_name`, `release.name`, `release.published_at`,
 *   `release.body`), repo at `repository.full_name`.
 * - gitlab ("Release Hook"): there is NO `release` sub-object — `tag`, `name`,
 *   `description` are top-level and the repo is `project.path_with_namespace`.
 * Each lookup falls back from the release object to the top-level gitlab field.
 */
export function extractReleasePayload(
  provider: 'github' | 'gitea' | 'gitlab',
  body: Record<string, unknown>,
): WebhookReleasePayload {
  const repo = reqMatch(repoOf(body), REPO_RE, 'repository/project');
  const rel = (body['release'] ?? {}) as Record<string, unknown>;
  const tag = reqMatch(rel['tag_name'] ?? body['tag'], TAG_RE, 'release.tag_name/tag');
  const name = freeText(rel['name'] ?? body['name']);
  const publishedAt =
    typeof rel['published_at'] === 'string' && ISO_RE.test(rel['published_at'])
      ? rel['published_at']
      : new Date().toISOString();
  const relBody = freeText(rel['body'] ?? body['description']);
  return {
    kind: 'webhook',
    provider,
    event: 'release',
    repo,
    tag,
    releaseName: name.text.slice(0, 200),
    publishedAt,
    body: relBody.text,
    ...(relBody.truncated || name.truncated ? { truncated: true } : {}),
  };
}
