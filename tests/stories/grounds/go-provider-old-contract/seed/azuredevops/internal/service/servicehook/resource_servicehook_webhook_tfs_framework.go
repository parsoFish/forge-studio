package servicehook

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/hashicorp/terraform-plugin-framework-validators/resourcevalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/booldefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringdefault"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/servicehooks"
	"github.com/parsoFish/terraform-provider-betterado/azuredevops/internal/client"
	"github.com/parsoFish/terraform-provider-betterado/azuredevops/internal/utils"
	"github.com/parsoFish/terraform-provider-betterado/azuredevops/internal/utils/converter"
)

// Ensure interface compliance.
var (
	_ resource.Resource                     = &servicehookWebhookTfsResource{}
	_ resource.ResourceWithImportState      = &servicehookWebhookTfsResource{}
	_ resource.ResourceWithConfigValidators = &servicehookWebhookTfsResource{}
)

// servicehookWebhookTfsResource is the terraform-plugin-framework implementation
// of betterado_servicehook_webhook_tfs.
type servicehookWebhookTfsResource struct {
	client *client.AggregatedClient
}

// NewServicehookWebhookTfsResource returns a new framework resource.
func NewServicehookWebhookTfsResource() resource.Resource {
	return &servicehookWebhookTfsResource{}
}

// ── Models ─────────────────────────────────────────────────────────────────────

// buildCompletedModel holds the optional build_completed event block.
type buildCompletedModel struct {
	DefinitionName types.String `tfsdk:"definition_name"`
	BuildStatus    types.String `tfsdk:"build_status"`
}

// gitPullRequestCommentedModel holds the optional git_pull_request_commented event block.
type gitPullRequestCommentedModel struct {
	RepositoryID types.String `tfsdk:"repository_id"`
	Branch       types.String `tfsdk:"branch"`
}

// gitPullRequestCreatedModel holds the optional git_pull_request_created event block.
type gitPullRequestCreatedModel struct {
	RepositoryID                 types.String `tfsdk:"repository_id"`
	PullRequestCreatedBy         types.String `tfsdk:"pull_request_created_by"`
	PullRequestReviewersContains types.String `tfsdk:"pull_request_reviewers_contains"`
	Branch                       types.String `tfsdk:"branch"`
}

// gitPullRequestMergeAttemptedModel holds the optional git_pull_request_merge_attempted event block.
type gitPullRequestMergeAttemptedModel struct {
	RepositoryID                 types.String `tfsdk:"repository_id"`
	PullRequestCreatedBy         types.String `tfsdk:"pull_request_created_by"`
	PullRequestReviewersContains types.String `tfsdk:"pull_request_reviewers_contains"`
	Branch                       types.String `tfsdk:"branch"`
	MergeResult                  types.String `tfsdk:"merge_result"`
}

// gitPullRequestUpdatedModel holds the optional git_pull_request_updated event block.
type gitPullRequestUpdatedModel struct {
	NotificationType             types.String `tfsdk:"notification_type"`
	RepositoryID                 types.String `tfsdk:"repository_id"`
	PullRequestCreatedBy         types.String `tfsdk:"pull_request_created_by"`
	PullRequestReviewersContains types.String `tfsdk:"pull_request_reviewers_contains"`
	Branch                       types.String `tfsdk:"branch"`
}

// gitPushModel holds the optional git_push event block.
type gitPushModel struct {
	Branch       types.String `tfsdk:"branch"`
	PushedBy     types.String `tfsdk:"pushed_by"`
	RepositoryID types.String `tfsdk:"repository_id"`
}

// repositoryCreatedModel holds the optional repository_created event block.
type repositoryCreatedModel struct {
	ProjectID types.String `tfsdk:"project_id"`
}

// repositoryDeletedModel holds the optional repository_deleted event block.
type repositoryDeletedModel struct {
	RepositoryID types.String `tfsdk:"repository_id"`
}

// repositoryForkedModel holds the optional repository_forked event block.
type repositoryForkedModel struct {
	RepositoryID types.String `tfsdk:"repository_id"`
}

// repositoryRenamedModel holds the optional repository_renamed event block.
type repositoryRenamedModel struct {
	RepositoryID types.String `tfsdk:"repository_id"`
}

// repositoryStatusChangedModel holds the optional repository_status_changed event block.
type repositoryStatusChangedModel struct {
	RepositoryID types.String `tfsdk:"repository_id"`
}

// serviceConnectionCreatedModel holds the optional service_connection_created event block.
type serviceConnectionCreatedModel struct {
	ProjectID types.String `tfsdk:"project_id"`
}

// serviceConnectionUpdatedModel holds the optional service_connection_updated event block.
type serviceConnectionUpdatedModel struct {
	ProjectID types.String `tfsdk:"project_id"`
}

// tfvcCheckinModel holds the optional tfvc_checkin event block.
type tfvcCheckinModel struct {
	Path types.String `tfsdk:"path"`
}

// workItemCommentedModel holds the optional work_item_commented event block.
type workItemCommentedModel struct {
	AreaPath       types.String `tfsdk:"area_path"`
	CommentPattern types.String `tfsdk:"comment_pattern"`
	WorkItemType   types.String `tfsdk:"work_item_type"`
	Tag            types.String `tfsdk:"tag"`
}

// workItemCreatedModel holds the optional work_item_created event block.
type workItemCreatedModel struct {
	AreaPath     types.String `tfsdk:"area_path"`
	WorkItemType types.String `tfsdk:"work_item_type"`
	LinksChanged types.Bool   `tfsdk:"links_changed"`
	Tag          types.String `tfsdk:"tag"`
}

// workItemDeletedModel holds the optional work_item_deleted event block.
type workItemDeletedModel struct {
	AreaPath     types.String `tfsdk:"area_path"`
	WorkItemType types.String `tfsdk:"work_item_type"`
	Tag          types.String `tfsdk:"tag"`
}

// workItemRestoredModel holds the optional work_item_restored event block.
type workItemRestoredModel struct {
	AreaPath     types.String `tfsdk:"area_path"`
	WorkItemType types.String `tfsdk:"work_item_type"`
	Tag          types.String `tfsdk:"tag"`
}

// workItemUpdatedModel holds the optional work_item_updated event block.
type workItemUpdatedModel struct {
	AreaPath      types.String `tfsdk:"area_path"`
	ChangedFields types.String `tfsdk:"changed_fields"`
	WorkItemType  types.String `tfsdk:"work_item_type"`
	LinksChanged  types.Bool   `tfsdk:"links_changed"`
	Tag           types.String `tfsdk:"tag"`
}

// servicehookWebhookTfsModel is the tfsdk model.
type servicehookWebhookTfsModel struct {
	ID                           types.String                        `tfsdk:"id"`
	ProjectID                    types.String                        `tfsdk:"project_id"`
	URL                          types.String                        `tfsdk:"url"`
	AcceptUntrustedCerts         types.Bool                          `tfsdk:"accept_untrusted_certs"`
	BasicAuthUsername            types.String                        `tfsdk:"basic_auth_username"`
	BasicAuthPassword            types.String                        `tfsdk:"basic_auth_password"`
	HttpHeaders                  types.Map                           `tfsdk:"http_headers"`
	ResourceDetailsToSend        types.String                        `tfsdk:"resource_details_to_send"`
	MessagesToSend               types.String                        `tfsdk:"messages_to_send"`
	DetailedMessagesToSend       types.String                        `tfsdk:"detailed_messages_to_send"`
	ResourceVersion              types.String                        `tfsdk:"resource_version"`
	BuildCompleted               []buildCompletedModel               `tfsdk:"build_completed"`
	GitPullRequestCommented      []gitPullRequestCommentedModel      `tfsdk:"git_pull_request_commented"`
	GitPullRequestCreated        []gitPullRequestCreatedModel        `tfsdk:"git_pull_request_created"`
	GitPullRequestMergeAttempted []gitPullRequestMergeAttemptedModel `tfsdk:"git_pull_request_merge_attempted"`
	GitPullRequestUpdated        []gitPullRequestUpdatedModel        `tfsdk:"git_pull_request_updated"`
	GitPush                      []gitPushModel                      `tfsdk:"git_push"`
	RepositoryCreated            []repositoryCreatedModel            `tfsdk:"repository_created"`
	RepositoryDeleted            []repositoryDeletedModel            `tfsdk:"repository_deleted"`
	RepositoryForked             []repositoryForkedModel             `tfsdk:"repository_forked"`
	RepositoryRenamed            []repositoryRenamedModel            `tfsdk:"repository_renamed"`
	RepositoryStatusChanged      []repositoryStatusChangedModel      `tfsdk:"repository_status_changed"`
	ServiceConnectionCreated     []serviceConnectionCreatedModel     `tfsdk:"service_connection_created"`
	ServiceConnectionUpdated     []serviceConnectionUpdatedModel     `tfsdk:"service_connection_updated"`
	TfvcCheckin                  []tfvcCheckinModel                  `tfsdk:"tfvc_checkin"`
	WorkItemCommented            []workItemCommentedModel            `tfsdk:"work_item_commented"`
	WorkItemCreated              []workItemCreatedModel              `tfsdk:"work_item_created"`
	WorkItemDeleted              []workItemDeletedModel              `tfsdk:"work_item_deleted"`
	WorkItemRestored             []workItemRestoredModel             `tfsdk:"work_item_restored"`
	WorkItemUpdated              []workItemUpdatedModel              `tfsdk:"work_item_updated"`
}

// ── Metadata / Schema ──────────────────────────────────────────────────────────

func (r *servicehookWebhookTfsResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_servicehook_webhook_tfs"
}

// httpOrHTTPSRegexp matches URLs that start with http:// or https://.
var httpOrHTTPSRegexp = regexp.MustCompile(`^https?://`)

func (r *servicehookWebhookTfsResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages a TFS/Azure DevOps service hook subscription that sends events to an HTTP endpoint (webhook).",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed:    true,
				Description: "The subscription ID.",
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
			"project_id": schema.StringAttribute{
				Required:    true,
				Description: "The ID of the project.",
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.RegexMatches(uuidRegexp, "project_id must be a valid UUID (e.g. 00000000-0000-0000-0000-000000000000)"),
				},
			},
			"url": schema.StringAttribute{
				Required:    true,
				Description: "The URL to send HTTP POST to.",
				Validators: []validator.String{
					stringvalidator.RegexMatches(httpOrHTTPSRegexp, "url must start with http:// or https://"),
				},
			},
			"accept_untrusted_certs": schema.BoolAttribute{
				Optional:    true,
				Computed:    true,
				Description: "Accept untrusted SSL certificates.",
				Default:     booldefault.StaticBool(false),
			},
			"basic_auth_username": schema.StringAttribute{
				Optional:    true,
				Computed:    true,
				Description: "Basic authentication username.",
				Default:     stringdefault.StaticString(""),
			},
			"basic_auth_password": schema.StringAttribute{
				Optional:    true,
				Computed:    true,
				Sensitive:   true,
				Description: "Basic authentication password.",
				Default:     stringdefault.StaticString(""),
			},
			"http_headers": schema.MapAttribute{
				Optional:    true,
				ElementType: types.StringType,
				Description: "HTTP headers as key-value pairs.",
			},
			"resource_details_to_send": schema.StringAttribute{
				Optional:    true,
				Computed:    true,
				Description: "Resource details to send - all, minimal, or none.",
				Default:     stringdefault.StaticString("all"),
				Validators: []validator.String{
					stringvalidator.OneOf("all", "minimal", "none"),
				},
			},
			"messages_to_send": schema.StringAttribute{
				Optional:    true,
				Computed:    true,
				Description: "Resource details to send - all, text, html, markdown or none.",
				Default:     stringdefault.StaticString("all"),
				Validators: []validator.String{
					stringvalidator.OneOf("all", "text", "html", "markdown", "none"),
				},
			},
			"detailed_messages_to_send": schema.StringAttribute{
				Optional:    true,
				Computed:    true,
				Description: "Detailed messages to send - all, text, html, markdown or none.",
				Default:     stringdefault.StaticString("all"),
				Validators: []validator.String{
					stringvalidator.OneOf("all", "text", "html", "markdown", "none"),
				},
			},
			"resource_version": schema.StringAttribute{
				Optional:    true,
				Computed:    true,
				Description: "The resource version for the webhook subscription.",
				Default:     stringdefault.StaticString("latest"),
			},
		},
		Blocks: map[string]schema.Block{
			"build_completed": schema.ListNestedBlock{
				Description: "Triggers the subscription on build completion events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"definition_name": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for completed builds for a specific pipeline.",
						},
						"build_status": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for completed builds that have a specific completion status.",
						},
					},
				},
			},
			"git_pull_request_commented": schema.ListNestedBlock{
				Description: "Triggers the subscription on git pull request comment events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"repository_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests in a specific repository (repository ID). If not specified, all repositories in the project will trigger the event.",
						},
						"branch": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests in a specific branch.",
						},
					},
				},
			},
			"git_pull_request_created": schema.ListNestedBlock{
				Description: "Triggers the subscription on git pull request created events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"repository_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests in a specific repository (repository ID). If not specified, all repositories in the project will trigger the event.",
						},
						"pull_request_created_by": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests created by users in a specific group.",
						},
						"pull_request_reviewers_contains": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests with reviewers in a specific group.",
						},
						"branch": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests in a specific branch.",
						},
					},
				},
			},
			"git_pull_request_merge_attempted": schema.ListNestedBlock{
				Description: "Triggers the subscription on git pull request merge attempted events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"repository_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests in a specific repository (repository ID). If not specified, all repositories in the project will trigger the event.",
						},
						"pull_request_created_by": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests created by users in a specific group.",
						},
						"pull_request_reviewers_contains": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests with reviewers in a specific group.",
						},
						"branch": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests in a specific branch.",
						},
						"merge_result": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests with a specific merge result.",
						},
					},
				},
			},
			"git_pull_request_updated": schema.ListNestedBlock{
				Description: "Triggers the subscription on git pull request updated events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"notification_type": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests with a specific change.",
						},
						"repository_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests in a specific repository (repository ID). If not specified, all repositories in the project will trigger the event.",
						},
						"pull_request_created_by": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests created by users in a specific group.",
						},
						"pull_request_reviewers_contains": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests with reviewers in a specific group.",
						},
						"branch": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for pull requests in a specific branch.",
						},
					},
				},
			},
			"git_push": schema.ListNestedBlock{
				Description: "Triggers the subscription on git push events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"branch": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for code pushes to a specific branch.",
						},
						"pushed_by": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for code pushes by users in a specific group.",
						},
						"repository_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for code pushes to a specific repository (repository ID). If not specified, all repositories in the project will trigger the event.",
						},
					},
				},
			},
			"repository_created": schema.ListNestedBlock{
				Description: "Triggers the subscription on repository created events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"project_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for repositories created in a specific project.",
						},
					},
				},
			},
			"repository_deleted": schema.ListNestedBlock{
				Description: "Triggers the subscription on repository deleted events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"repository_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for repositories with a specific repository ID.",
						},
					},
				},
			},
			"repository_forked": schema.ListNestedBlock{
				Description: "Triggers the subscription on repository forked events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"repository_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for repositories with a specific repository ID.",
						},
					},
				},
			},
			"repository_renamed": schema.ListNestedBlock{
				Description: "Triggers the subscription on repository renamed events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"repository_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for repositories with a specific repository ID.",
						},
					},
				},
			},
			"repository_status_changed": schema.ListNestedBlock{
				Description: "Triggers the subscription on repository status changed events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"repository_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for repositories with a specific repository ID.",
						},
					},
				},
			},
			"service_connection_created": schema.ListNestedBlock{
				Description: "Triggers the subscription on service connection created events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"project_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for service connections created in a specific project.",
						},
					},
				},
			},
			"service_connection_updated": schema.ListNestedBlock{
				Description: "Triggers the subscription on service connection updated events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"project_id": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for service connections updated in a specific project.",
						},
					},
				},
			},
			"tfvc_checkin": schema.ListNestedBlock{
				Description: "Triggers the subscription on TFVC check-in events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"path": schema.StringAttribute{
							Required:    true,
							Description: "Include only events for check-ins that change files under a specific path.",
						},
					},
				},
			},
			"work_item_commented": schema.ListNestedBlock{
				Description: "Triggers the subscription on work item commented events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"area_path": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items under a specific area path.",
						},
						"comment_pattern": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items with a comment that contains a specific string.",
						},
						"work_item_type": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items of a specific type.",
						},
						"tag": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items that contain a specific tag.",
						},
					},
				},
			},
			"work_item_created": schema.ListNestedBlock{
				Description: "Triggers the subscription on work item created events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"area_path": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items under a specific area path.",
						},
						"work_item_type": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items of a specific type.",
						},
						"links_changed": schema.BoolAttribute{
							Optional:    true,
							Description: "Include only events for work items with one or more links added or removed.",
						},
						"tag": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items that contain a specific tag.",
						},
					},
				},
			},
			"work_item_deleted": schema.ListNestedBlock{
				Description: "Triggers the subscription on work item deleted events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"area_path": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items under a specific area path.",
						},
						"work_item_type": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items of a specific type.",
						},
						"tag": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items that contain a specific tag.",
						},
					},
				},
			},
			"work_item_restored": schema.ListNestedBlock{
				Description: "Triggers the subscription on work item restored events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"area_path": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items under a specific area path.",
						},
						"work_item_type": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items of a specific type.",
						},
						"tag": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items that contain a specific tag.",
						},
					},
				},
			},
			"work_item_updated": schema.ListNestedBlock{
				Description: "Triggers the subscription on work item updated events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"area_path": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items under a specific area path.",
						},
						"changed_fields": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items with a change in a specific field.",
						},
						"work_item_type": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items of a specific type.",
						},
						"links_changed": schema.BoolAttribute{
							Optional:    true,
							Description: "Include only events for work items with one or more links added or removed.",
						},
						"tag": schema.StringAttribute{
							Optional:    true,
							Description: "Include only events for work items that contain a specific tag.",
						},
					},
				},
			},
		},
	}
}

// ── Config validators ──────────────────────────────────────────────────────────

// ConfigValidators enforces that exactly one event block is set at a time
// by declaring all 19 event type blocks mutually conflicting.
func (r *servicehookWebhookTfsResource) ConfigValidators(_ context.Context) []resource.ConfigValidator {
	return []resource.ConfigValidator{
		resourcevalidator.Conflicting(
			path.MatchRoot("build_completed"),
			path.MatchRoot("git_pull_request_commented"),
			path.MatchRoot("git_pull_request_created"),
			path.MatchRoot("git_pull_request_merge_attempted"),
			path.MatchRoot("git_pull_request_updated"),
			path.MatchRoot("git_push"),
			path.MatchRoot("repository_created"),
			path.MatchRoot("repository_deleted"),
			path.MatchRoot("repository_forked"),
			path.MatchRoot("repository_renamed"),
			path.MatchRoot("repository_status_changed"),
			path.MatchRoot("service_connection_created"),
			path.MatchRoot("service_connection_updated"),
			path.MatchRoot("tfvc_checkin"),
			path.MatchRoot("work_item_commented"),
			path.MatchRoot("work_item_created"),
			path.MatchRoot("work_item_deleted"),
			path.MatchRoot("work_item_restored"),
			path.MatchRoot("work_item_updated"),
		),
	}
}

// ── Provider data injection ───────────────────────────────────────────────────

func (r *servicehookWebhookTfsResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	c, ok := req.ProviderData.(*client.AggregatedClient)
	if !ok {
		resp.Diagnostics.AddError(
			"Unexpected provider data type",
			fmt.Sprintf("Expected *client.AggregatedClient, got %T", req.ProviderData),
		)
		return
	}
	r.client = c
}

// ── Create ────────────────────────────────────────────────────────────────────

func (r *servicehookWebhookTfsResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	if r.client == nil {
		resp.Diagnostics.AddError("Client not configured", "betterado_servicehook_webhook_tfs Create: provider client not configured")
		return
	}

	var model servicehookWebhookTfsModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &model)...)
	if resp.Diagnostics.HasError() {
		return
	}

	subscription, err := r.expandModel(ctx, model)
	if err != nil {
		resp.Diagnostics.AddError("Expand error", fmt.Sprintf("expanding servicehook webhook tfs model: %s", err))
		return
	}

	created, err := r.client.ServiceHooksClient.CreateSubscription(r.client.Ctx, servicehooks.CreateSubscriptionArgs{
		Subscription: subscription,
	})
	if err != nil {
		resp.Diagnostics.AddError("Create error", fmt.Sprintf("creating servicehook webhook tfs subscription: %s", err))
		return
	}

	model.ID = types.StringValue(created.Id.String())
	if diags := r.flattenSubscription(ctx, created, &model); diags != nil {
		resp.Diagnostics.AddError("Flatten error", diags.Error())
		return
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, &model)...)
}

// ── Read ──────────────────────────────────────────────────────────────────────

func (r *servicehookWebhookTfsResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	if r.client == nil {
		resp.Diagnostics.AddError("Client not configured", "betterado_servicehook_webhook_tfs Read: provider client not configured")
		return
	}

	var model servicehookWebhookTfsModel
	resp.Diagnostics.Append(req.State.Get(ctx, &model)...)
	if resp.Diagnostics.HasError() {
		return
	}

	subscriptionID := converter.UUID(model.ID.ValueString())
	subscription, err := r.client.ServiceHooksClient.GetSubscription(r.client.Ctx, servicehooks.GetSubscriptionArgs{
		SubscriptionId: subscriptionID,
	})
	if err != nil {
		if utils.ResponseWasNotFound(err) {
			resp.State.RemoveResource(ctx)
			return
		}
		resp.Diagnostics.AddError("Read error", fmt.Sprintf("reading servicehook webhook tfs subscription: %s", err))
		return
	}

	// Preserve basic_auth_password from state — the API never returns the secret.
	savedPassword := model.BasicAuthPassword

	if diags := r.flattenSubscription(ctx, subscription, &model); diags != nil {
		resp.Diagnostics.AddError("Flatten error", diags.Error())
		return
	}
	model.BasicAuthPassword = savedPassword

	resp.Diagnostics.Append(resp.State.Set(ctx, &model)...)
}

// ── Update ────────────────────────────────────────────────────────────────────

func (r *servicehookWebhookTfsResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	if r.client == nil {
		resp.Diagnostics.AddError("Client not configured", "betterado_servicehook_webhook_tfs Update: provider client not configured")
		return
	}

	var model servicehookWebhookTfsModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &model)...)
	if resp.Diagnostics.HasError() {
		return
	}

	var stateModel servicehookWebhookTfsModel
	resp.Diagnostics.Append(req.State.Get(ctx, &stateModel)...)
	if resp.Diagnostics.HasError() {
		return
	}
	model.ID = stateModel.ID

	subscription, err := r.expandModel(ctx, model)
	if err != nil {
		resp.Diagnostics.AddError("Expand error", fmt.Sprintf("expanding servicehook webhook tfs model: %s", err))
		return
	}

	parsedID, err := uuid.Parse(model.ID.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Update error", fmt.Sprintf("parsing subscription ID: %s", err))
		return
	}
	subscription.Id = &parsedID

	updated, err := r.client.ServiceHooksClient.ReplaceSubscription(r.client.Ctx, servicehooks.ReplaceSubscriptionArgs{
		Subscription:   subscription,
		SubscriptionId: &parsedID,
	})
	if err != nil {
		resp.Diagnostics.AddError("Update error", fmt.Sprintf("updating servicehook webhook tfs subscription: %s", err))
		return
	}

	// Preserve basic_auth_password — not returned by API.
	savedPassword := model.BasicAuthPassword

	if diags := r.flattenSubscription(ctx, updated, &model); diags != nil {
		resp.Diagnostics.AddError("Flatten error", diags.Error())
		return
	}
	model.BasicAuthPassword = savedPassword

	resp.Diagnostics.Append(resp.State.Set(ctx, &model)...)
}

// ── Delete ────────────────────────────────────────────────────────────────────

func (r *servicehookWebhookTfsResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	if r.client == nil {
		resp.Diagnostics.AddError("Client not configured", "betterado_servicehook_webhook_tfs Delete: provider client not configured")
		return
	}

	var model servicehookWebhookTfsModel
	resp.Diagnostics.Append(req.State.Get(ctx, &model)...)
	if resp.Diagnostics.HasError() {
		return
	}

	subscriptionID := converter.UUID(model.ID.ValueString())
	if err := r.client.ServiceHooksClient.DeleteSubscription(r.client.Ctx, servicehooks.DeleteSubscriptionArgs{
		SubscriptionId: subscriptionID,
	}); err != nil {
		resp.Diagnostics.AddError("Delete error", fmt.Sprintf("deleting servicehook webhook tfs subscription: %s", err))
	}
}

// ── ImportState ───────────────────────────────────────────────────────────────

func (r *servicehookWebhookTfsResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}

// ── Expand / Flatten ──────────────────────────────────────────────────────────

func (r *servicehookWebhookTfsResource) expandModel(ctx context.Context, model servicehookWebhookTfsModel) (*servicehooks.Subscription, error) {
	publisherInputs := map[string]string{
		"projectId": model.ProjectID.ValueString(),
	}

	var eventType string

	// Determine the active event type and populate publisherInputs.
	switch {
	case len(model.BuildCompleted) > 0:
		ev := model.BuildCompleted[0]
		eventType = "build.complete"
		if v := ev.DefinitionName.ValueString(); v != "" {
			publisherInputs["definitionName"] = v
		}
		if v := ev.BuildStatus.ValueString(); v != "" {
			publisherInputs["buildStatus"] = v
		}

	case len(model.GitPullRequestCommented) > 0:
		ev := model.GitPullRequestCommented[0]
		eventType = "ms.vss-code.git-pullrequest-comment-event"
		if v := ev.RepositoryID.ValueString(); v != "" {
			publisherInputs["repository"] = v
		}
		if v := ev.Branch.ValueString(); v != "" {
			publisherInputs["branch"] = v
		}

	case len(model.GitPullRequestCreated) > 0:
		ev := model.GitPullRequestCreated[0]
		eventType = "git.pullrequest.created"
		if v := ev.RepositoryID.ValueString(); v != "" {
			publisherInputs["repository"] = v
		}
		if v := ev.Branch.ValueString(); v != "" {
			publisherInputs["branch"] = v
		}
		if v := ev.PullRequestCreatedBy.ValueString(); v != "" {
			publisherInputs["pullrequestCreatedBy"] = v
		}
		if v := ev.PullRequestReviewersContains.ValueString(); v != "" {
			publisherInputs["pullrequestReviewersContains"] = v
		}

	case len(model.GitPullRequestMergeAttempted) > 0:
		ev := model.GitPullRequestMergeAttempted[0]
		eventType = "git.pullrequest.merged"
		if v := ev.RepositoryID.ValueString(); v != "" {
			publisherInputs["repository"] = v
		}
		if v := ev.Branch.ValueString(); v != "" {
			publisherInputs["branch"] = v
		}
		if v := ev.PullRequestCreatedBy.ValueString(); v != "" {
			publisherInputs["pullrequestCreatedBy"] = v
		}
		if v := ev.PullRequestReviewersContains.ValueString(); v != "" {
			publisherInputs["pullrequestReviewersContains"] = v
		}
		if v := ev.MergeResult.ValueString(); v != "" {
			publisherInputs["mergeResult"] = v
		}

	case len(model.GitPullRequestUpdated) > 0:
		ev := model.GitPullRequestUpdated[0]
		eventType = "git.pullrequest.updated"
		if v := ev.NotificationType.ValueString(); v != "" {
			publisherInputs["notificationType"] = v
		}
		if v := ev.RepositoryID.ValueString(); v != "" {
			publisherInputs["repository"] = v
		}
		if v := ev.Branch.ValueString(); v != "" {
			publisherInputs["branch"] = v
		}
		if v := ev.PullRequestCreatedBy.ValueString(); v != "" {
			publisherInputs["pullrequestCreatedBy"] = v
		}
		if v := ev.PullRequestReviewersContains.ValueString(); v != "" {
			publisherInputs["pullrequestReviewersContains"] = v
		}

	case len(model.GitPush) > 0:
		ev := model.GitPush[0]
		eventType = "git.push"
		if v := ev.Branch.ValueString(); v != "" {
			publisherInputs["branch"] = v
		}
		if v := ev.PushedBy.ValueString(); v != "" {
			publisherInputs["pushedBy"] = v
		}
		if v := ev.RepositoryID.ValueString(); v != "" {
			publisherInputs["repository"] = v
		}

	case len(model.RepositoryCreated) > 0:
		ev := model.RepositoryCreated[0]
		eventType = "git.repo.created"
		if v := ev.ProjectID.ValueString(); v != "" {
			publisherInputs["projectId"] = v
		}

	case len(model.RepositoryDeleted) > 0:
		ev := model.RepositoryDeleted[0]
		eventType = "git.repo.deleted"
		if v := ev.RepositoryID.ValueString(); v != "" {
			publisherInputs["repository"] = v
		}

	case len(model.RepositoryForked) > 0:
		ev := model.RepositoryForked[0]
		eventType = "git.repo.forked"
		if v := ev.RepositoryID.ValueString(); v != "" {
			publisherInputs["repository"] = v
		}

	case len(model.RepositoryRenamed) > 0:
		ev := model.RepositoryRenamed[0]
		eventType = "git.repo.renamed"
		if v := ev.RepositoryID.ValueString(); v != "" {
			publisherInputs["repository"] = v
		}

	case len(model.RepositoryStatusChanged) > 0:
		ev := model.RepositoryStatusChanged[0]
		eventType = "git.repo.statuschanged"
		if v := ev.RepositoryID.ValueString(); v != "" {
			publisherInputs["repository"] = v
		}

	case len(model.ServiceConnectionCreated) > 0:
		ev := model.ServiceConnectionCreated[0]
		eventType = "ms.vss-endpoint.endpoint-created"
		if v := ev.ProjectID.ValueString(); v != "" {
			publisherInputs["project"] = v
		}

	case len(model.ServiceConnectionUpdated) > 0:
		ev := model.ServiceConnectionUpdated[0]
		eventType = "ms.vss-endpoint.endpoint-updated"
		if v := ev.ProjectID.ValueString(); v != "" {
			publisherInputs["project"] = v
		}

	case len(model.TfvcCheckin) > 0:
		ev := model.TfvcCheckin[0]
		eventType = "tfvc.checkin"
		if v := ev.Path.ValueString(); v != "" {
			publisherInputs["path"] = v
		}

	case len(model.WorkItemCommented) > 0:
		ev := model.WorkItemCommented[0]
		eventType = "workitem.commented"
		if v := ev.WorkItemType.ValueString(); v != "" {
			publisherInputs["workItemType"] = v
		}
		if v := ev.AreaPath.ValueString(); v != "" {
			publisherInputs["areaPath"] = v
		}
		if v := ev.Tag.ValueString(); v != "" {
			publisherInputs["tag"] = v
		}
		if v := ev.CommentPattern.ValueString(); v != "" {
			publisherInputs["commentPattern"] = v
		}

	case len(model.WorkItemCreated) > 0:
		ev := model.WorkItemCreated[0]
		eventType = "workitem.created"
		if v := ev.WorkItemType.ValueString(); v != "" {
			publisherInputs["workItemType"] = v
		}
		if v := ev.AreaPath.ValueString(); v != "" {
			publisherInputs["areaPath"] = v
		}
		if v := ev.Tag.ValueString(); v != "" {
			publisherInputs["tag"] = v
		}

	case len(model.WorkItemDeleted) > 0:
		ev := model.WorkItemDeleted[0]
		eventType = "workitem.deleted"
		if v := ev.WorkItemType.ValueString(); v != "" {
			publisherInputs["workItemType"] = v
		}
		if v := ev.AreaPath.ValueString(); v != "" {
			publisherInputs["areaPath"] = v
		}
		if v := ev.Tag.ValueString(); v != "" {
			publisherInputs["tag"] = v
		}

	case len(model.WorkItemRestored) > 0:
		ev := model.WorkItemRestored[0]
		eventType = "workitem.restored"
		if v := ev.WorkItemType.ValueString(); v != "" {
			publisherInputs["workItemType"] = v
		}
		if v := ev.AreaPath.ValueString(); v != "" {
			publisherInputs["areaPath"] = v
		}
		if v := ev.Tag.ValueString(); v != "" {
			publisherInputs["tag"] = v
		}

	case len(model.WorkItemUpdated) > 0:
		ev := model.WorkItemUpdated[0]
		eventType = "workitem.updated"
		if v := ev.WorkItemType.ValueString(); v != "" {
			publisherInputs["workItemType"] = v
		}
		if v := ev.AreaPath.ValueString(); v != "" {
			publisherInputs["areaPath"] = v
		}
		if v := ev.Tag.ValueString(); v != "" {
			publisherInputs["tag"] = v
		}
		if v := ev.ChangedFields.ValueString(); v != "" {
			publisherInputs["changedFields"] = v
		}
	}

	consumerInputs := map[string]string{
		"url":                    model.URL.ValueString(),
		"acceptUntrustedCerts":   strconv.FormatBool(model.AcceptUntrustedCerts.ValueBool()),
		"resourceDetailsToSend":  model.ResourceDetailsToSend.ValueString(),
		"messagesToSend":         model.MessagesToSend.ValueString(),
		"detailedMessagesToSend": model.DetailedMessagesToSend.ValueString(),
	}

	if v := model.BasicAuthUsername.ValueString(); v != "" {
		consumerInputs["basicAuthUsername"] = v
	}
	if v := model.BasicAuthPassword.ValueString(); v != "" {
		consumerInputs["basicAuthPassword"] = v
	}

	// Encode http_headers as newline-delimited key:value pairs.
	if !model.HttpHeaders.IsNull() && !model.HttpHeaders.IsUnknown() {
		headersMap := make(map[string]string)
		_ = model.HttpHeaders.ElementsAs(ctx, &headersMap, false)
		if len(headersMap) > 0 {
			keys := make([]string, 0, len(headersMap))
			for k := range headersMap {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			var sb strings.Builder
			for i, k := range keys {
				if i > 0 {
					sb.WriteString("\n")
				}
				sb.WriteString(k)
				sb.WriteString(":")
				sb.WriteString(headersMap[k])
			}
			consumerInputs["httpHeaders"] = sb.String()
		}
	}

	return &servicehooks.Subscription{
		ConsumerActionId: converter.String("httpRequest"),
		ConsumerId:       converter.String("webHooks"),
		ConsumerInputs:   &consumerInputs,
		EventType:        &eventType,
		PublisherId:      converter.String("tfs"),
		PublisherInputs:  &publisherInputs,
		ResourceVersion:  converter.String(model.ResourceVersion.ValueString()),
	}, nil
}

func (r *servicehookWebhookTfsResource) flattenSubscription(ctx context.Context, sub *servicehooks.Subscription, model *servicehookWebhookTfsModel) error {
	if sub == nil {
		return nil
	}

	if sub.ConsumerInputs != nil {
		ci := *sub.ConsumerInputs
		model.URL = types.StringValue(ci["url"])

		if v, err := strconv.ParseBool(ci["acceptUntrustedCerts"]); err == nil {
			model.AcceptUntrustedCerts = types.BoolValue(v)
		}
		if v, ok := ci["resourceDetailsToSend"]; ok {
			model.ResourceDetailsToSend = types.StringValue(v)
		}
		if v, ok := ci["messagesToSend"]; ok {
			model.MessagesToSend = types.StringValue(v)
		}
		if v, ok := ci["detailedMessagesToSend"]; ok {
			model.DetailedMessagesToSend = types.StringValue(v)
		}
		if v, ok := ci["basicAuthUsername"]; ok {
			model.BasicAuthUsername = types.StringValue(v)
		}

		// Decode http_headers from newline-delimited key:value string.
		if headersStr, ok := ci["httpHeaders"]; ok && headersStr != "" {
			headersMap := make(map[string]string)
			for _, line := range strings.Split(headersStr, "\n") {
				if line != "" {
					parts := strings.SplitN(line, ":", 2)
					if len(parts) == 2 {
						headersMap[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
					}
				}
			}
			if len(headersMap) > 0 {
				mapVal, diags := types.MapValueFrom(ctx, types.StringType, headersMap)
				if diags.HasError() {
					return fmt.Errorf("building http_headers map")
				}
				model.HttpHeaders = mapVal
			}
		}
	}

	if sub.ResourceVersion != nil {
		model.ResourceVersion = types.StringValue(*sub.ResourceVersion)
	}

	if sub.PublisherInputs != nil {
		pi := *sub.PublisherInputs
		model.ProjectID = types.StringValue(pi["projectId"])

		// Clear all event type blocks then set only the active one.
		model.BuildCompleted = []buildCompletedModel{}
		model.GitPullRequestCommented = []gitPullRequestCommentedModel{}
		model.GitPullRequestCreated = []gitPullRequestCreatedModel{}
		model.GitPullRequestMergeAttempted = []gitPullRequestMergeAttemptedModel{}
		model.GitPullRequestUpdated = []gitPullRequestUpdatedModel{}
		model.GitPush = []gitPushModel{}
		model.RepositoryCreated = []repositoryCreatedModel{}
		model.RepositoryDeleted = []repositoryDeletedModel{}
		model.RepositoryForked = []repositoryForkedModel{}
		model.RepositoryRenamed = []repositoryRenamedModel{}
		model.RepositoryStatusChanged = []repositoryStatusChangedModel{}
		model.ServiceConnectionCreated = []serviceConnectionCreatedModel{}
		model.ServiceConnectionUpdated = []serviceConnectionUpdatedModel{}
		model.TfvcCheckin = []tfvcCheckinModel{}
		model.WorkItemCommented = []workItemCommentedModel{}
		model.WorkItemCreated = []workItemCreatedModel{}
		model.WorkItemDeleted = []workItemDeletedModel{}
		model.WorkItemRestored = []workItemRestoredModel{}
		model.WorkItemUpdated = []workItemUpdatedModel{}

		if sub.EventType == nil {
			return nil
		}

		switch *sub.EventType {
		case "build.complete":
			model.BuildCompleted = []buildCompletedModel{{
				DefinitionName: tfsOptionalString(pi["definitionName"]),
				BuildStatus:    tfsOptionalString(pi["buildStatus"]),
			}}

		case "ms.vss-code.git-pullrequest-comment-event":
			model.GitPullRequestCommented = []gitPullRequestCommentedModel{{
				RepositoryID: tfsOptionalString(pi["repository"]),
				Branch:       tfsOptionalString(pi["branch"]),
			}}

		case "git.pullrequest.created":
			model.GitPullRequestCreated = []gitPullRequestCreatedModel{{
				RepositoryID:                 tfsOptionalString(pi["repository"]),
				PullRequestCreatedBy:         tfsOptionalString(pi["pullrequestCreatedBy"]),
				PullRequestReviewersContains: tfsOptionalString(pi["pullrequestReviewersContains"]),
				Branch:                       tfsOptionalString(pi["branch"]),
			}}

		case "git.pullrequest.merged":
			model.GitPullRequestMergeAttempted = []gitPullRequestMergeAttemptedModel{{
				RepositoryID:                 tfsOptionalString(pi["repository"]),
				PullRequestCreatedBy:         tfsOptionalString(pi["pullrequestCreatedBy"]),
				PullRequestReviewersContains: tfsOptionalString(pi["pullrequestReviewersContains"]),
				Branch:                       tfsOptionalString(pi["branch"]),
				MergeResult:                  tfsOptionalString(pi["mergeResult"]),
			}}

		case "git.pullrequest.updated":
			model.GitPullRequestUpdated = []gitPullRequestUpdatedModel{{
				NotificationType:             tfsOptionalString(pi["notificationType"]),
				RepositoryID:                 tfsOptionalString(pi["repository"]),
				PullRequestCreatedBy:         tfsOptionalString(pi["pullrequestCreatedBy"]),
				PullRequestReviewersContains: tfsOptionalString(pi["pullrequestReviewersContains"]),
				Branch:                       tfsOptionalString(pi["branch"]),
			}}

		case "git.push":
			model.GitPush = []gitPushModel{{
				Branch:       tfsOptionalString(pi["branch"]),
				PushedBy:     tfsOptionalString(pi["pushedBy"]),
				RepositoryID: tfsOptionalString(pi["repository"]),
			}}

		case "git.repo.created":
			model.RepositoryCreated = []repositoryCreatedModel{{
				ProjectID: tfsOptionalString(pi["projectId"]),
			}}

		case "git.repo.deleted":
			model.RepositoryDeleted = []repositoryDeletedModel{{
				RepositoryID: tfsOptionalString(pi["repository"]),
			}}

		case "git.repo.forked":
			model.RepositoryForked = []repositoryForkedModel{{
				RepositoryID: tfsOptionalString(pi["repository"]),
			}}

		case "git.repo.renamed":
			model.RepositoryRenamed = []repositoryRenamedModel{{
				RepositoryID: tfsOptionalString(pi["repository"]),
			}}

		case "git.repo.statuschanged":
			model.RepositoryStatusChanged = []repositoryStatusChangedModel{{
				RepositoryID: tfsOptionalString(pi["repository"]),
			}}

		case "ms.vss-endpoint.endpoint-created":
			model.ServiceConnectionCreated = []serviceConnectionCreatedModel{{
				ProjectID: tfsOptionalString(pi["project"]),
			}}

		case "ms.vss-endpoint.endpoint-updated":
			model.ServiceConnectionUpdated = []serviceConnectionUpdatedModel{{
				ProjectID: tfsOptionalString(pi["project"]),
			}}

		case "tfvc.checkin":
			model.TfvcCheckin = []tfvcCheckinModel{{
				Path: types.StringValue(pi["path"]), // Required field — always set
			}}

		case "workitem.commented":
			model.WorkItemCommented = []workItemCommentedModel{{
				AreaPath:       tfsOptionalString(pi["areaPath"]),
				CommentPattern: tfsOptionalString(pi["commentPattern"]),
				WorkItemType:   tfsOptionalString(pi["workItemType"]),
				Tag:            tfsOptionalString(pi["tag"]),
			}}

		case "workitem.created":
			model.WorkItemCreated = []workItemCreatedModel{{
				AreaPath:     tfsOptionalString(pi["areaPath"]),
				WorkItemType: tfsOptionalString(pi["workItemType"]),
				LinksChanged: types.BoolNull(),
				Tag:          tfsOptionalString(pi["tag"]),
			}}

		case "workitem.deleted":
			model.WorkItemDeleted = []workItemDeletedModel{{
				AreaPath:     tfsOptionalString(pi["areaPath"]),
				WorkItemType: tfsOptionalString(pi["workItemType"]),
				Tag:          tfsOptionalString(pi["tag"]),
			}}

		case "workitem.restored":
			model.WorkItemRestored = []workItemRestoredModel{{
				AreaPath:     tfsOptionalString(pi["areaPath"]),
				WorkItemType: tfsOptionalString(pi["workItemType"]),
				Tag:          tfsOptionalString(pi["tag"]),
			}}

		case "workitem.updated":
			model.WorkItemUpdated = []workItemUpdatedModel{{
				AreaPath:      tfsOptionalString(pi["areaPath"]),
				ChangedFields: tfsOptionalString(pi["changedFields"]),
				WorkItemType:  tfsOptionalString(pi["workItemType"]),
				LinksChanged:  types.BoolNull(),
				Tag:           tfsOptionalString(pi["tag"]),
			}}
		}
	}

	return nil
}

// tfsOptionalString converts an API string value to a types.String:
// empty string → null (preserves plan-time null for unset Optional attributes,
// preventing "Provider produced inconsistent result after apply" drift).
func tfsOptionalString(v string) types.String {
	if v == "" {
		return types.StringNull()
	}
	return types.StringValue(v)
}
