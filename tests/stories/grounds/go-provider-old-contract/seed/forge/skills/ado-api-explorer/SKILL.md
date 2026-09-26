# ADO API Explorer Skill

## Purpose

Systematically discover, test, and document Azure DevOps REST API endpoints. Use this skill to validate API behavior, test edge cases, and build comprehensive endpoint documentation that drives Terraform resource implementation.

## When to Use

- When you need to verify an API endpoint's behavior before implementing a Terraform resource
- When testing how the API handles create/update/delete for a specific resource type
- When you need to understand the minimal required payload for an API call
- When investigating error responses and edge cases

## Prerequisites

These environment variables must be set:
- `AZDO_ORG_SERVICE_URL` — e.g., `https://dev.azure.com/myorg`
- `AZDO_PERSONAL_ACCESS_TOKEN` — PAT with appropriate scopes
- `AZDO_TEST_PROJECT` — Project name for testing

## Workflow

### Step 1: Define What You're Exploring

Identify the API area and specific questions:
- What endpoint am I testing?
- What's the minimal payload for creation?
- What fields are computed vs user-provided?
- How does the API handle partial updates?
- What error codes does it return for common failures?

### Step 2: Use the CLI Helper

The `scripts/ado-api.sh` script provides a convenient wrapper:

```bash
# List release definitions
./scripts/ado-api.sh GET "release/definitions"

# Get a specific definition with expansion
./scripts/ado-api.sh GET "release/definitions/1?expand=environments,artifacts,triggers"

# Create a release definition
./scripts/ado-api.sh POST "release/definitions" --body @examples/minimal-definition.json

# Update a definition (PUT requires full object + revision)
./scripts/ado-api.sh PUT "release/definitions/1" --body @examples/updated-definition.json

# Delete a definition
./scripts/ado-api.sh DELETE "release/definitions/1"
```

### Step 3: Test Systematically

For each resource type, test the full CRUD lifecycle:

1. **Create** with minimal required fields → note what's required vs optional
2. **Read** the created resource → note computed fields (id, revision, urls, etc.)
3. **Read with expand** → understand what expand options return
4. **Update** a single field → determine if PUT requires full object or accepts partial
5. **Update** without correct revision → verify conflict handling
6. **Delete** → verify clean deletion
7. **Read after delete** → verify 404 response
8. **Create with full fields** → test every optional field

### Step 4: Document Findings

For each tested endpoint, record:

```markdown
## Endpoint: [METHOD] [path]

### Minimal Required Payload
```json
{ ... }
```

### Computed Fields (returned but not settable)
- id, revision, url, createdBy, createdOn, modifiedBy, modifiedOn

### Important Behaviors
- [Does PUT require full object or accept partial?]
- [What happens on revision conflict?]
- [Are there any server-side defaults?]
- [Secret handling — are secrets read-back as null?]

### Error Responses
| Status | Condition | Response |
|--------|-----------|----------|
| 400 | Missing name | {"message": "..."} |
| 404 | Invalid ID | {"message": "..."} |
| 409 | Wrong revision | {"message": "..."} |
```

### Step 5: Generate Terraform Schema Implications

Based on API behavior, determine:
- Required vs Optional vs Computed attributes
- ForceNew attributes (which changes require recreation?)
- Default values (what does the API default if not provided?)
- Sensitive attributes (secrets that aren't returned on read)
- DiffSuppressFunc needs (are there fields the API normalizes?)

## Testing Patterns

### Minimal Create Pattern
Always start with the absolute minimum payload to find true required fields:
```bash
echo '{"name": "test-def", "environments": []}' | ./scripts/ado-api.sh POST "release/definitions" --body -
```
Then add fields one at a time until the API accepts the request.

### Diff Detection Pattern
Create a resource, read it back, and diff the input vs output to find computed fields:
```bash
./scripts/ado-api.sh POST "release/definitions" --body @input.json > created.json
./scripts/ado-api.sh GET "release/definitions/$(jq .id created.json)" > read.json
diff <(jq -S . input.json) <(jq -S . read.json)
```

### Update Semantics Pattern
Test whether the API supports partial updates or requires full objects:
```bash
# Try partial - does it work or error?
echo '{"name": "updated-name", "revision": 1}' | ./scripts/ado-api.sh PUT "release/definitions/1" --body -
```

## Notes

- The release API is on `vsrm.dev.azure.com`, not `dev.azure.com`
- Always include `api-version=7.1` in query parameters
- Some fields like variables with `isSecret: true` are write-only
- Environment IDs within a definition are server-assigned on first create
- The `revision` field implements optimistic concurrency control
