# ADO Browser Inspector Skill

## Purpose

Capture and analyze network traces from the Azure DevOps UI to reverse-engineer API calls that back specific UI actions. This is the primary discovery mechanism for understanding undocumented or poorly-documented API behavior.

## When to Use

- When you need to understand how a specific ADO UI feature maps to API calls
- When the REST API documentation is incomplete or unclear about request/response shapes
- When you need to discover undocumented endpoints or parameters
- When verifying that your Terraform resource implementation matches actual ADO behavior

## Workflow

### Step 1: Set Up Network Monitoring

Before navigating to the target page, enable network request capture:

1. Use `mcp__Claude_in_Chrome__read_network_requests` to start monitoring
2. Clear any existing requests for a clean trace

### Step 2: Navigate to Target ADO Page

Use the Chrome navigation tools to go to the specific ADO page:

```
https://dev.azure.com/{org}/{project}/_releaseDefinition
https://dev.azure.com/{org}/{project}/_release?definitionId={id}&view=mine
https://dev.azure.com/{org}/{project}/_release?definitionId={id}&_a=environments-editor
```

**Common ADO Release Pages:**
- Release pipelines list: `/_release`
- Release definition editor: `/_releaseDefinition?definitionId={id}&_a=environments-editor-preview`
- New release definition: `/_releaseDefinition?_a=new`
- Release instance: `/_releaseProgress?_a=release-pipeline-progress&releaseId={id}`

### Step 3: Perform the UI Action

Execute the specific action you want to trace:
- Create a new release definition
- Add an environment/stage
- Configure approvals
- Add a task
- Save the definition
- Trigger a release

### Step 4: Capture and Analyze

1. Use `mcp__Claude_in_Chrome__read_network_requests` to get all captured requests
2. Filter for API calls (look for `_apis/release/` in the URL)
3. For each relevant request, note:
   - HTTP method and full URL (including query params)
   - Request headers (especially Content-Type, api-version)
   - Request body (the JSON payload)
   - Response status and body

### Step 5: Document Findings

Save findings to `docs/api-reference/` in this format:

```markdown
## [Action Name] — Discovered [Date]

**Trigger:** [What UI action was performed]
**Endpoint:** [METHOD] [URL]
**API Version:** [version from query string]

### Request
```json
{request body}
```

### Response
```json
{key fields from response}
```

### Notes
- [Any observations about undocumented fields, required vs optional, etc.]
```

## Tips

- ADO makes multiple API calls for complex operations (e.g., saving a definition may PUT the definition then PATCH permissions)
- Look for `_apis/Contribution/` calls too — these load UI configuration and can reveal available options
- The `X-TFS-FedAuthRedirect` header indicates authenticated endpoints
- Watch for calls to `vsrm.dev.azure.com` specifically — these are release management API calls
- Some endpoints use `POST` with `_apis/release/definitions` while others use `PUT` — creation vs update
- Pay attention to the order of API calls; some operations require specific sequencing

## Example: Discovering Release Definition Create

1. Navigate to `https://dev.azure.com/{org}/{project}/_releaseDefinition?_a=new`
2. Fill in the release definition form (name, add stages, configure tasks)
3. Click "Save"
4. Capture the network trace
5. The key call will be `POST https://vsrm.dev.azure.com/{org}/{project}/_apis/release/definitions?api-version=7.1`
6. The request body reveals the exact JSON structure ADO expects
7. Compare with documented API schema — note any differences
