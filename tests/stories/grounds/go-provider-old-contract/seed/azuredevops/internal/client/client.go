package client

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/microsoft/azure-devops-go-api/azuredevops/v7"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/accounts"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/build"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/core"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/dashboard"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/elastic"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/extensionmanagement"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/featuremanagement"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/feed"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/git"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/graph"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/identity"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/memberentitlementmanagement"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/notification"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/operations"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/pipelinepermissions"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/pipelines"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/pipelinesapproval"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/pipelineschecks"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/policy"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/profile"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/release"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/security"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/serviceendpoint"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/servicehooks"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/taskagent"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/test"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/testplan"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/wiki"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/workitemtracking"
	"github.com/microsoft/azure-devops-go-api/azuredevops/v7/workitemtrackingprocess"
	"github.com/parsoFish/terraform-provider-betterado/azuredevops/utils/sdk/dashboardextras"
	"github.com/parsoFish/terraform-provider-betterado/azuredevops/utils/sdk/organization"
	"github.com/parsoFish/terraform-provider-betterado/azuredevops/utils/sdk/pipelineschecksextras"
	"github.com/parsoFish/terraform-provider-betterado/azuredevops/utils/sdk/securityroles"
	"github.com/parsoFish/terraform-provider-betterado/version"
)

// AggregatedClient aggregates all of the underlying clients into a single data
// type. Each client is ready to use and fully configured with the correct
// AzDO PAT/organization
//
// AggregatedClient uses interfaces derived from the underlying client structs to
// allow for mocking to support unit testing of the funcs that invoke the
// Azure DevOps client.
type AggregatedClient struct {
	OrganizationURL string
	// BasicAuth is the pre-computed "Basic <base64>" Authorization header value
	// for the configured credentials. It is stored here so that data sources
	// that must call VSSPS endpoints (accounts, profile) can build their own
	// HTTP requests without going through the SDK's location-service discovery,
	// which may return 401 when the PAT is scoped to a single org.
	BasicAuth                     string
	AccountsClient                accounts.Client
	CoreClient                    core.Client
	BuildClient                   build.Client
	DashboardClient               dashboard.Client
	DashboardClientExtra          dashboardextras.Client
	PipelinesClient               pipelines.Client
	GitReposClient                git.Client
	GraphClient                   graph.Client
	OperationsClient              operations.Client
	OrganizationClient            organization.Client
	PipelinesChecksClient         pipelineschecks.Client
	PipelinePermissionsClient     pipelinepermissions.Client
	PipelinesChecksClientExtras   pipelineschecksextras.Client
	PipelinesApprovalClient       pipelinesapproval.Client
	PolicyClient                  policy.Client
	ProfileClient                 profile.Client
	ElasticClient                 elastic.Client
	ExtensionManagementClient     extensionmanagement.Client
	ReleaseClient                 release.Client
	ServiceEndpointClient         serviceendpoint.Client
	TaskAgentClient               taskagent.Client
	TestClient                    test.Client
	TestPlanClient                testplan.Client
	MemberEntitleManagementClient memberentitlementmanagement.Client
	NotificationClient            notification.Client
	FeatureManagementClient       featuremanagement.Client
	FeedClient                    feed.Client
	SecurityClient                security.Client
	IdentityClient                identity.Client
	WikiClient                    wiki.Client
	WorkItemTrackingClient        workitemtracking.Client
	WorkItemTrackingProcessClient workitemtrackingprocess.Client
	ServiceHooksClient            servicehooks.Client
	Ctx                           context.Context
	SecurityRolesClient           securityroles.Client
}

// GetAzdoClient builds and provides a connection to the Azure DevOps API
func GetAzdoClient(authProvider azuredevops.AuthProvider, organizationURL string) (*AggregatedClient, error) {
	ctx := context.Background()

	if strings.EqualFold(organizationURL, "") {
		return nil, fmt.Errorf("the url of the Azure DevOps is required")
	}

	connection := &azuredevops.Connection{
		AuthProvider:            authProvider,
		BaseUrl:                 strings.ToLower(strings.TrimRight(organizationURL, "/")),
		SuppressFedAuthRedirect: true,
	}

	setUserAgent(connection)

	// Pre-compute the Basic auth header so that data sources making direct
	// HTTP calls to VSSPS endpoints (accounts, profile) can authenticate
	// without going through the SDK's location-service discovery.
	basicAuth := ""
	if authProvider != nil {
		if authHeader, authErr := authProvider.GetAuth(ctx); authErr == nil {
			basicAuth = authHeader
		}
	}

	// The Profile and Accounts APIs are hosted on the global VSSPS endpoint.
	// Their resource area IDs (8ccfef3d-... and 0d55247a-...) are NOT
	// registered on org-scoped URLs (https://dev.azure.com/<org>); the
	// discovery call to GetResourceAreas returns a 404/empty result for them
	// there. A separate connection to https://app.vssps.visualstudio.com is
	// required so that GetClientByResourceAreaId can resolve their locations.
	//
	// We use GetClientByUrl (not GetClientByResourceAreaId / accounts.NewClient)
	// to avoid resource-area discovery HTTP calls during provider Configure —
	// those calls can fail with 401 when the PAT scope is restricted to a
	// single org and poisons the whole provider Configure step. Location-service
	// discovery is deferred to the first real API call (GetAccounts / GetProfile)
	// when proper user-facing errors can be surfaced from the data source Read.
	vsspsConnection := &azuredevops.Connection{
		AuthProvider:            authProvider,
		BaseUrl:                 "https://app.vssps.visualstudio.com",
		SuppressFedAuthRedirect: true,
	}
	setUserAgent(vsspsConnection)

	vssspsSdkClient := vsspsConnection.GetClientByUrl("https://app.vssps.visualstudio.com")
	accountsClient := &accounts.ClientImpl{Client: *vssspsSdkClient}

	coreClient, err := core.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): core.NewClient failed.")
		return nil, err
	}

	buildClient, err := build.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): build.NewClient failed.")
		return nil, err
	}

	operationsClient := operations.NewClient(ctx, connection)

	organizationClient := organization.NewClient(ctx, connection)

	elasticClient := elastic.NewClient(ctx, connection)

	extensionManagementClient, err := extensionmanagement.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): extensionmanagement.NewClient failed.")
		return nil, err
	}

	dashboardClient, err := dashboard.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): dashboardClient.NewClient failed.")
		return nil, err
	}

	dashboardClientExtra, err := dashboardextras.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): dashboardClientExtra.NewClient failed.")
		return nil, err
	}

	serviceEndpointClient, err := serviceendpoint.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): serviceendpoint.NewClient failed.")
		return nil, err
	}

	taskagentClient, err := taskagent.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): taskagent.NewClient failed.")
		return nil, err
	}

	testplanClient := testplan.NewClient(ctx, connection)

	testClient, err := test.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): test.NewClient failed.")
		return nil, err
	}

	gitReposClient, err := git.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): git.NewClient failed.")
		return nil, err
	}

	graphClient, err := graph.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): graph.NewClient failed.")
		return nil, err
	}

	memberentitlementmanagementClient, err := memberentitlementmanagement.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): memberentitlementmanagement.NewClient failed.")
		return nil, err
	}

	notificationClient := notification.NewClient(ctx, connection)

	policyClient, err := policy.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): policy.NewClient failed.")
		return nil, err
	}

	// profile.NewClient also uses GetClientByResourceAreaId; bypass it for the
	// same reason as accounts above (deferred location-service discovery).
	profileClient := &profile.ClientImpl{Client: *vssspsSdkClient}

	releaseClient, err := release.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): release.NewClient failed.")
		return nil, err
	}

	securityClient := security.NewClient(ctx, connection)
	identityClient, err := identity.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): identity.NewClient failed.")
		return nil, err
	}

	wikiClient, err := wiki.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): wiki.NewClient failed.")
		return nil, err
	}

	featuremanagementClient := featuremanagement.NewClient(ctx, connection)

	feedClient, err := feed.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): feed.NewClient failed.")
		return nil, err
	}

	workitemtrackingClient, err := workitemtracking.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): workitemtracking.NewClient failed.")
		return nil, err
	}

	workitemtrackingprocessClient, err := workitemtrackingprocess.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): workitemtrackingprocess.NewClient failed.")
		return nil, err
	}

	pipelines := pipelines.NewClient(ctx, connection)

	pipelinesChecksClient, err := pipelineschecks.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): pipelineschecks.NewClient failed.")
		return nil, err
	}

	pipelinepermissionsClient, err := pipelinepermissions.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): pipelineschecks.NewClient failed.")
		return nil, err
	}

	pipelinesChecksClientExtras, err := pipelineschecksextras.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): pipelineschecksextras.NewClient failed.")
		return nil, err
	}

	pipelinesApprovalClient, err := pipelinesapproval.NewClient(ctx, connection)
	if err != nil {
		log.Printf("getAzdoClient(): pipelinesapproval.NewClient failed.")
		return nil, err
	}

	serviceHooksClient := servicehooks.NewClient(ctx, connection)

	securityRolesClient := securityroles.NewClient(ctx, connection)

	aggregatedClient := &AggregatedClient{
		OrganizationURL:               organizationURL,
		BasicAuth:                     basicAuth,
		AccountsClient:                accountsClient,
		CoreClient:                    coreClient,
		BuildClient:                   buildClient,
		DashboardClient:               dashboardClient,
		DashboardClientExtra:          dashboardClientExtra,
		ElasticClient:                 elasticClient,
		ExtensionManagementClient:     extensionManagementClient,
		GitReposClient:                gitReposClient,
		GraphClient:                   graphClient,
		OperationsClient:              operationsClient,
		OrganizationClient:            organizationClient,
		PipelinesClient:               pipelines,
		PipelinesChecksClient:         pipelinesChecksClient,
		PipelinePermissionsClient:     pipelinepermissionsClient,
		PipelinesChecksClientExtras:   pipelinesChecksClientExtras,
		PipelinesApprovalClient:       pipelinesApprovalClient,
		PolicyClient:                  policyClient,
		ProfileClient:                 profileClient,
		ReleaseClient:                 releaseClient,
		ServiceEndpointClient:         serviceEndpointClient,
		TaskAgentClient:               taskagentClient,
		TestClient:                    testClient,
		TestPlanClient:                testplanClient,
		MemberEntitleManagementClient: memberentitlementmanagementClient,
		NotificationClient:            notificationClient,
		FeatureManagementClient:       featuremanagementClient,
		FeedClient:                    feedClient,
		SecurityClient:                securityClient,
		IdentityClient:                identityClient,
		WikiClient:                    wikiClient,
		WorkItemTrackingClient:        workitemtrackingClient,
		WorkItemTrackingProcessClient: workitemtrackingprocessClient,
		ServiceHooksClient:            serviceHooksClient,
		SecurityRolesClient:           securityRolesClient,
		Ctx:                           ctx,
	}

	log.Printf("getAzdoClient(): Created core, build, operations, and serviceendpoint clients successfully!")
	return aggregatedClient, nil
}

// setUserAgent set UserAgent for http headers
func setUserAgent(connection *azuredevops.Connection) {
	providerUserAgent := fmt.Sprintf("terraform-provider-betterado/%s", version.ProviderVersion)
	connection.UserAgent = strings.TrimSpace(fmt.Sprintf("%s %s", connection.UserAgent, providerUserAgent))

	// append the CloudShell version to the user agent if it exists
	if azureAgent := os.Getenv("AZURE_HTTP_USER_AGENT"); azureAgent != "" {
		connection.UserAgent = fmt.Sprintf("%s %s", connection.UserAgent, azureAgent)
	}

	log.Printf("[DEBUG] AzureRM Client User Agent: %s\n", connection.UserAgent)
}
