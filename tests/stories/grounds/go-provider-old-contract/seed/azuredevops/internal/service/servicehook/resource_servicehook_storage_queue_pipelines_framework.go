package servicehook

import (
	"context"
	"fmt"
	"regexp"
	"strconv"

	"github.com/google/uuid"
	"github.com/hashicorp/terraform-plugin-framework-validators/int64validator"
	"github.com/hashicorp/terraform-plugin-framework-validators/resourcevalidator"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/int64default"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
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
	_ resource.Resource                     = &servicehookStorageQueuePipelinesResource{}
	_ resource.ResourceWithImportState      = &servicehookStorageQueuePipelinesResource{}
	_ resource.ResourceWithConfigValidators = &servicehookStorageQueuePipelinesResource{}
)

// servicehookStorageQueuePipelinesResource is the terraform-plugin-framework
// implementation of betterado_servicehook_storage_queue_pipelines.
type servicehookStorageQueuePipelinesResource struct {
	client *client.AggregatedClient
}

// NewServicehookStorageQueuePipelinesResource returns a new framework resource.
func NewServicehookStorageQueuePipelinesResource() resource.Resource {
	return &servicehookStorageQueuePipelinesResource{}
}

// ── Model ────────────────────────────────────────────────────────────────────

// stageStateChangedEventModel holds the optional stage-state-changed event block.
type stageStateChangedEventModel struct {
	PipelineID        types.String `tfsdk:"pipeline_id"`
	StageName         types.String `tfsdk:"stage_name"`
	StageStateFilter  types.String `tfsdk:"stage_state_filter"`
	StageResultFilter types.String `tfsdk:"stage_result_filter"`
}

// runStateChangedEventModel holds the optional run-state-changed event block.
type runStateChangedEventModel struct {
	PipelineID      types.String `tfsdk:"pipeline_id"`
	RunStateFilter  types.String `tfsdk:"run_state_filter"`
	RunResultFilter types.String `tfsdk:"run_result_filter"`
}

// servicehookStorageQueuePipelinesModel is the tfsdk model.
type servicehookStorageQueuePipelinesModel struct {
	ID                     types.String                  `tfsdk:"id"`
	ProjectID              types.String                  `tfsdk:"project_id"`
	AccountName            types.String                  `tfsdk:"account_name"`
	AccountKey             types.String                  `tfsdk:"account_key"`
	QueueName              types.String                  `tfsdk:"queue_name"`
	VisiTimeout            types.Int64                   `tfsdk:"visi_timeout"`
	TTL                    types.Int64                   `tfsdk:"ttl"`
	StageStateChangedEvent []stageStateChangedEventModel `tfsdk:"stage_state_changed_event"`
	RunStateChangedEvent   []runStateChangedEventModel   `tfsdk:"run_state_changed_event"`
}

// ── Metadata / Schema ────────────────────────────────────────────────────────

func (r *servicehookStorageQueuePipelinesResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_servicehook_storage_queue_pipelines"
}

// uuidRegexp matches a standard UUID (RFC 4122).
var uuidRegexp = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (r *servicehookStorageQueuePipelinesResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages a service hook subscription that sends pipeline events to an Azure Storage Queue.",
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
			"account_name": schema.StringAttribute{
				Required:    true,
				Description: "The queue's storage account name.",
			},
			"account_key": schema.StringAttribute{
				Required:    true,
				Sensitive:   true,
				Description: "A valid account key from the queue's storage account (64–100 characters).",
				Validators: []validator.String{
					stringvalidator.LengthBetween(64, 100),
				},
			},
			"queue_name": schema.StringAttribute{
				Required:    true,
				Description: "The name of the queue that will store the events.",
			},
			"visi_timeout": schema.Int64Attribute{
				Optional:    true,
				Computed:    true,
				Description: "Event visibility timeout — how long a message is invisible to other consumers after being dequeued.",
				Default:     int64default.StaticInt64(0),
				Validators: []validator.Int64{
					int64validator.AtLeast(0),
				},
			},
			"ttl": schema.Int64Attribute{
				Optional:    true,
				Computed:    true,
				Description: "Event time-to-live — the duration a message can remain in the queue before it is automatically removed.",
				Default:     int64default.StaticInt64(604800),
				Validators: []validator.Int64{
					int64validator.AtLeast(0),
				},
			},
		},
		Blocks: map[string]schema.Block{
			"stage_state_changed_event": schema.ListNestedBlock{
				Description: "Triggers the subscription on stage-state-changed pipeline events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"pipeline_id": schema.StringAttribute{
							Optional:    true,
							Description: "The pipeline ID to monitor. If not specified, all pipelines trigger the event.",
						},
						"stage_name": schema.StringAttribute{
							Optional:    true,
							Description: "Which stage should generate an event. If not specified, all stages trigger the event.",
						},
						"stage_state_filter": schema.StringAttribute{
							Optional:    true,
							Description: "Which stage state should generate an event (NotStarted, Waiting, Running, Completed).",
							Validators: []validator.String{
								stringvalidator.OneOf("NotStarted", "Waiting", "Running", "Completed"),
							},
						},
						"stage_result_filter": schema.StringAttribute{
							Optional:    true,
							Description: "Which stage result should generate an event (Canceled, Failed, Rejected, Skipped, Succeeded).",
							Validators: []validator.String{
								stringvalidator.OneOf("Canceled", "Failed", "Rejected", "Skipped", "Succeeded"),
							},
						},
					},
				},
			},
			"run_state_changed_event": schema.ListNestedBlock{
				Description: "Triggers the subscription on run-state-changed pipeline events.",
				NestedObject: schema.NestedBlockObject{
					Attributes: map[string]schema.Attribute{
						"pipeline_id": schema.StringAttribute{
							Optional:    true,
							Description: "The pipeline ID to monitor. If not specified, all pipelines trigger the event.",
						},
						"run_state_filter": schema.StringAttribute{
							Optional:    true,
							Description: "Which run state should generate an event (InProgress, Canceling, Completed).",
							Validators: []validator.String{
								stringvalidator.OneOf("InProgress", "Canceling", "Completed"),
							},
						},
						"run_result_filter": schema.StringAttribute{
							Optional:    true,
							Description: "Which run result should generate an event (Canceled, Failed, Succeeded).",
							Validators: []validator.String{
								stringvalidator.OneOf("Canceled", "Failed", "Succeeded"),
							},
						},
					},
				},
			},
		},
	}
}

// ── Config validators ────────────────────────────────────────────────────────

// ConfigValidators enforces that stage_state_changed_event and
// run_state_changed_event are mutually exclusive (ConflictsWith equivalent).
func (r *servicehookStorageQueuePipelinesResource) ConfigValidators(_ context.Context) []resource.ConfigValidator {
	return []resource.ConfigValidator{
		resourcevalidator.Conflicting(
			path.MatchRoot("stage_state_changed_event"),
			path.MatchRoot("run_state_changed_event"),
		),
	}
}

// ── Provider data injection ───────────────────────────────────────────────────

func (r *servicehookStorageQueuePipelinesResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

// ── Create ───────────────────────────────────────────────────────────────────

func (r *servicehookStorageQueuePipelinesResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	if r.client == nil {
		resp.Diagnostics.AddError("Client not configured", "betterado_servicehook_storage_queue_pipelines Create: provider client not configured")
		return
	}

	var model servicehookStorageQueuePipelinesModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &model)...)
	if resp.Diagnostics.HasError() {
		return
	}

	subscription := r.expandModel(model)
	created, err := r.client.ServiceHooksClient.CreateSubscription(r.client.Ctx, servicehooks.CreateSubscriptionArgs{
		Subscription: subscription,
	})
	if err != nil {
		resp.Diagnostics.AddError("Create error", fmt.Sprintf("creating servicehook storage queue pipelines subscription: %s", err))
		return
	}

	model.ID = types.StringValue(created.Id.String())
	r.flattenSubscription(created, &model)
	resp.Diagnostics.Append(resp.State.Set(ctx, &model)...)
}

// ── Read ─────────────────────────────────────────────────────────────────────

func (r *servicehookStorageQueuePipelinesResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	if r.client == nil {
		resp.Diagnostics.AddError("Client not configured", "betterado_servicehook_storage_queue_pipelines Read: provider client not configured")
		return
	}

	var model servicehookStorageQueuePipelinesModel
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
		resp.Diagnostics.AddError("Read error", fmt.Sprintf("reading servicehook storage queue pipelines subscription: %s", err))
		return
	}

	// Preserve account_key from state — the API never returns the secret.
	accountKey := model.AccountKey.ValueString()
	r.flattenSubscription(subscription, &model)
	model.AccountKey = types.StringValue(accountKey)

	resp.Diagnostics.Append(resp.State.Set(ctx, &model)...)
}

// ── Update ───────────────────────────────────────────────────────────────────

func (r *servicehookStorageQueuePipelinesResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	if r.client == nil {
		resp.Diagnostics.AddError("Client not configured", "betterado_servicehook_storage_queue_pipelines Update: provider client not configured")
		return
	}

	var model servicehookStorageQueuePipelinesModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &model)...)
	if resp.Diagnostics.HasError() {
		return
	}

	var stateModel servicehookStorageQueuePipelinesModel
	resp.Diagnostics.Append(req.State.Get(ctx, &stateModel)...)
	if resp.Diagnostics.HasError() {
		return
	}
	model.ID = stateModel.ID

	subscription := r.expandModel(model)
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
		resp.Diagnostics.AddError("Update error", fmt.Sprintf("updating servicehook storage queue pipelines subscription: %s", err))
		return
	}

	// Preserve account_key — not returned by API.
	accountKey := model.AccountKey.ValueString()
	r.flattenSubscription(updated, &model)
	model.AccountKey = types.StringValue(accountKey)

	resp.Diagnostics.Append(resp.State.Set(ctx, &model)...)
}

// ── Delete ───────────────────────────────────────────────────────────────────

func (r *servicehookStorageQueuePipelinesResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	if r.client == nil {
		resp.Diagnostics.AddError("Client not configured", "betterado_servicehook_storage_queue_pipelines Delete: provider client not configured")
		return
	}

	var model servicehookStorageQueuePipelinesModel
	resp.Diagnostics.Append(req.State.Get(ctx, &model)...)
	if resp.Diagnostics.HasError() {
		return
	}

	subscriptionID := converter.UUID(model.ID.ValueString())
	if err := r.client.ServiceHooksClient.DeleteSubscription(r.client.Ctx, servicehooks.DeleteSubscriptionArgs{
		SubscriptionId: subscriptionID,
	}); err != nil {
		resp.Diagnostics.AddError("Delete error", fmt.Sprintf("deleting servicehook storage queue pipelines subscription: %s", err))
	}
}

// ── ImportState ───────────────────────────────────────────────────────────────

func (r *servicehookStorageQueuePipelinesResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)
}

// ── Expand / Flatten ──────────────────────────────────────────────────────────

func (r *servicehookStorageQueuePipelinesResource) expandModel(model servicehookStorageQueuePipelinesModel) *servicehooks.Subscription {
	visiTimeout := strconv.FormatInt(model.VisiTimeout.ValueInt64(), 10)
	ttl := strconv.FormatInt(model.TTL.ValueInt64(), 10)

	publisherInputs := map[string]string{
		"projectId": model.ProjectID.ValueString(),
	}
	var eventType string

	if len(model.StageStateChangedEvent) > 0 {
		ev := model.StageStateChangedEvent[0]
		eventType = "ms.vss-pipelines.stage-state-changed-event"
		publisherInputs["pipelineId"] = ev.PipelineID.ValueString()
		publisherInputs["stageNameId"] = ev.StageName.ValueString()
		publisherInputs["stageStateId"] = ev.StageStateFilter.ValueString()
		publisherInputs["stageResultId"] = ev.StageResultFilter.ValueString()
	} else if len(model.RunStateChangedEvent) > 0 {
		ev := model.RunStateChangedEvent[0]
		eventType = "ms.vss-pipelines.run-state-changed-event"
		publisherInputs["pipelineId"] = ev.PipelineID.ValueString()
		publisherInputs["runStateId"] = ev.RunStateFilter.ValueString()
		publisherInputs["runResultId"] = ev.RunResultFilter.ValueString()
	}

	return &servicehooks.Subscription{
		ConsumerActionId: converter.String("enqueue"),
		ConsumerId:       converter.String("azureStorageQueue"),
		ConsumerInputs: &map[string]string{
			"accountName": model.AccountName.ValueString(),
			"accountKey":  model.AccountKey.ValueString(),
			"queueName":   model.QueueName.ValueString(),
			"visiTimeout": visiTimeout,
			"ttl":         ttl,
		},
		EventType:       &eventType,
		PublisherId:     converter.String("pipelines"),
		PublisherInputs: &publisherInputs,
		ResourceVersion: converter.String("5.1-preview.1"),
	}
}

func (r *servicehookStorageQueuePipelinesResource) flattenSubscription(sub *servicehooks.Subscription, model *servicehookStorageQueuePipelinesModel) {
	if sub == nil {
		return
	}

	if sub.ConsumerInputs != nil {
		ci := *sub.ConsumerInputs
		model.AccountName = types.StringValue(ci["accountName"])
		model.QueueName = types.StringValue(ci["queueName"])

		if v, err := strconv.ParseInt(ci["visiTimeout"], 10, 64); err == nil {
			model.VisiTimeout = types.Int64Value(v)
		}
		if v, err := strconv.ParseInt(ci["ttl"], 10, 64); err == nil {
			model.TTL = types.Int64Value(v)
		}
	}

	if sub.PublisherInputs != nil {
		pi := *sub.PublisherInputs
		model.ProjectID = types.StringValue(pi["projectId"])

		switch *sub.EventType {
		case "ms.vss-pipelines.stage-state-changed-event":
			model.StageStateChangedEvent = []stageStateChangedEventModel{{
				PipelineID:        sqpOptionalString(pi["pipelineId"]),
				StageName:         sqpOptionalString(pi["stageNameId"]),
				StageStateFilter:  sqpOptionalString(pi["stageStateId"]),
				StageResultFilter: sqpOptionalString(pi["stageResultId"]),
			}}
			model.RunStateChangedEvent = []runStateChangedEventModel{}
		case "ms.vss-pipelines.run-state-changed-event":
			model.RunStateChangedEvent = []runStateChangedEventModel{{
				PipelineID:      sqpOptionalString(pi["pipelineId"]),
				RunStateFilter:  sqpOptionalString(pi["runStateId"]),
				RunResultFilter: sqpOptionalString(pi["runResultId"]),
			}}
			model.StageStateChangedEvent = []stageStateChangedEventModel{}
		}
	}
}

// sqpOptionalString converts an ADO string value to types.String.
// ADO returns "" for unset optional fields; we preserve null so that the plan
// (which holds null for unset Optional attributes) matches the read-back state
// and Terraform does not report a "Provider produced inconsistent result" error.
func sqpOptionalString(v string) types.String {
	if v == "" {
		return types.StringNull()
	}
	return types.StringValue(v)
}
