//go:build all || resource_servicehook_storage_queue

package servicehook

import (
	"context"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/parsoFish/terraform-provider-betterado/azuredevops/internal/client"
)

// TestServicehookStorageQueuePipelinesFramework_Configure verifies that the
// framework resource's Configure method behaves correctly:
//  1. NewServicehookStorageQueuePipelinesResource() returns a non-nil resource.
//  2. Configure with nil ProviderData is a graceful no-op (no panic, no diagnostics).
//  3. Configure with a valid *client.AggregatedClient stores the client without errors.
func TestServicehookStorageQueuePipelinesFramework_Configure(t *testing.T) {
	t.Run("constructor_returns_non_nil", func(t *testing.T) {
		r := NewServicehookStorageQueuePipelinesResource()
		if r == nil {
			t.Fatal("NewServicehookStorageQueuePipelinesResource() returned nil")
		}
	})

	t.Run("configure_with_nil_provider_data_is_noop", func(t *testing.T) {
		r := NewServicehookStorageQueuePipelinesResource()

		// Must not panic.
		defer func() {
			if rec := recover(); rec != nil {
				t.Fatalf("Configure panicked with nil ProviderData: %v", rec)
			}
		}()

		configurable, ok := r.(resource.ResourceWithConfigure)
		if !ok {
			t.Fatal("resource does not implement resource.ResourceWithConfigure")
		}

		configReq := resource.ConfigureRequest{
			ProviderData: nil,
		}
		configResp := &resource.ConfigureResponse{}
		configurable.Configure(context.Background(), configReq, configResp)

		if configResp.Diagnostics.HasError() {
			t.Fatalf("Configure(nil) produced unexpected diagnostics: %s", configResp.Diagnostics)
		}
	})

	t.Run("configure_with_aggregated_client_stores_client", func(t *testing.T) {
		r := NewServicehookStorageQueuePipelinesResource()

		configurable, ok := r.(resource.ResourceWithConfigure)
		if !ok {
			t.Fatal("resource does not implement resource.ResourceWithConfigure")
		}

		// Use a non-nil but empty *client.AggregatedClient — the Configure
		// method only type-asserts; it does not call any methods on the client.
		agg := &client.AggregatedClient{}

		configReq := resource.ConfigureRequest{
			ProviderData: agg,
		}
		configResp := &resource.ConfigureResponse{}
		configurable.Configure(context.Background(), configReq, configResp)

		if configResp.Diagnostics.HasError() {
			t.Fatalf("Configure(*AggregatedClient) produced unexpected diagnostics: %s", configResp.Diagnostics)
		}

		// Verify the client was stored by casting back to the concrete type.
		impl, ok := r.(*servicehookStorageQueuePipelinesResource)
		if !ok {
			t.Fatalf("resource is not *servicehookStorageQueuePipelinesResource, got %T", r)
		}
		if impl.client == nil {
			t.Fatal("Configure(*AggregatedClient) did not store the client")
		}
		if impl.client != agg {
			t.Fatal("Configure(*AggregatedClient) stored the wrong client pointer")
		}
	})
}
